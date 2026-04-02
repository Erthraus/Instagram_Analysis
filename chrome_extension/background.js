/**
 * background.js — Service Worker (Manifest V3)
 *
 * Responsibilities:
 *  1. Message routing between popup ↔ content script ↔ Drive API
 *  2. Google Drive API calls (cannot be done from content scripts due to CORS)
 *  3. Scheduled deactivated-account checks via chrome.alarms
 *  4. Rate limit enforcement (30-min cooldown between full syncs)
 *
 * Architecture notes:
 *  - Content script writes snapshot to chrome.storage.local (avoids message size limits)
 *  - SYNC_COMPLETE is sent BEFORE Drive save (popup shows results immediately)
 *  - Drive save runs in background; DRIVE_SAVE_COMPLETE/FAILED notify popup via toast
 *  - Interrupted Drive saves are retried on service worker restart
 */

import { saveSnapshot, loadSnapshot } from "./utils/drive.js";
import { computeDiff, applyStatusChecks, buildFullMap } from "./utils/analyzer.js";

const ALARM_STATUS_CHECK        = "deactivated_status_check";
const ALARM_DRIVE_RETRY         = "drive_save_retry";
const MIN_SYNC_INTERVAL_MS      = 30 * 60 * 1000; // 30 minutes
const MAX_STATUS_CHECKS_PER_RUN = 50;
const FETCH_B64_TIMEOUT_MS      = 5_000;            // 5s per image
const FETCH_B64_MAX_BYTES       = 2 * 1024 * 1024;  // 2 MB safety cap
const DRIVE_RETRY_MAX           = 3;

// ── Startup: retry any Drive save interrupted by service worker termination ────

(async () => {
    try {
        const data = await chrome.storage.local.get(["pending_drive_snapshot", "pending_drive_retry_count"]);
        if (data.pending_drive_snapshot) {
            const retryCount = data.pending_drive_retry_count || 0;
            if (retryCount < DRIVE_RETRY_MAX) {
                await saveToDriveInBackground(data.pending_drive_snapshot, [], data.pending_drive_snapshot.userId, retryCount);
            } else {
                // Max retries reached — give up, clean up
                await chrome.storage.local.remove(["pending_drive_snapshot", "pending_drive_retry_count"]);
            }
        }
    } catch { /* startup check failed — not critical */ }
})();

// ── Alarm Listener ────────────────────────────────────────────────────────────

chrome.alarms.onAlarm.addListener(async (alarm) => {
    if (alarm.name === ALARM_STATUS_CHECK) {
        await runDeactivatedStatusChecks();
    }
    if (alarm.name === ALARM_DRIVE_RETRY) {
        const data = await chrome.storage.local.get(["pending_drive_snapshot", "pending_drive_retry_count"]);
        if (data.pending_drive_snapshot) {
            const retryCount = data.pending_drive_retry_count || 0;
            if (retryCount < DRIVE_RETRY_MAX) {
                await saveToDriveInBackground(data.pending_drive_snapshot, [], data.pending_drive_snapshot.userId, retryCount);
            } else {
                await chrome.storage.local.remove(["pending_drive_snapshot", "pending_drive_retry_count"]);
            }
        }
    }
});

// ── Message Router ────────────────────────────────────────────────────────────

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    switch (message.type) {

        case "RUN_SYNC": {
            handleRunSync(sender.tab?.id, false)
                .then(result => sendResponse({ ok: true, result }))
                .catch(err => sendResponse({ ok: false, error: err.message }));
            return true;
        }

        case "FORCE_SYNC": {
            handleRunSync(sender.tab?.id, true)
                .then(result => sendResponse({ ok: true, result }))
                .catch(err => sendResponse({ ok: false, error: err.message }));
            return true;
        }

        case "LOAD_SNAPSHOT": {
            loadSnapshot(message.userId)
                .then(snapshot => sendResponse({ ok: true, snapshot }))
                .catch(err => sendResponse({ ok: false, error: err.message }));
            return true;
        }

        case "GET_DIFF": {
            chrome.storage.local.get(["diff_result"], (data) => {
                sendResponse({ ok: true, diff: data.diff_result || null });
            });
            return true;
        }

        case "ANALYSIS_COMPLETE": {
            // Content script wrote the snapshot to chrome.storage.local (avoids message size limit).
            // Read it from storage, process, then clean up.
            (async () => {
                try {
                    const data = await chrome.storage.local.get(["analysis_snapshot"]);
                    const snapshot = data.analysis_snapshot;
                    if (!snapshot) {
                        throw new Error("Snapshot verisi bulunamadı. Content script yazamadı olabilir.");
                    }
                    await handleAnalysisComplete(snapshot);
                    sendResponse({ ok: true });
                } catch (err) {
                    // Ensure popup is notified of ANY error during processing
                    await chrome.storage.local.set({ sync_in_progress: false, sync_heartbeat: null }).catch(() => {});
                    chrome.runtime.sendMessage({ type: "SYNC_ERROR", error: err.message }).catch(() => {});
                    sendResponse({ ok: false, error: err.message });
                } finally {
                    // Clean up the transfer payload regardless of success/failure
                    chrome.storage.local.remove(["analysis_snapshot"]).catch(() => {});
                }
            })();
            return true;
        }

        case "ANALYSIS_PROGRESS": {
            // Write heartbeat to storage — popup reads this as fallback if sendMessage is dropped
            chrome.storage.local.set({
                sync_heartbeat:    Date.now(),
                sync_in_progress:  true,
                sync_last_step:    message.step,
                sync_last_detail:  message.detail || ""
            });
            // Forward to popup if open
            chrome.runtime.sendMessage({ type: "PROGRESS_UPDATE", step: message.step, detail: message.detail })
                .catch(() => {});
            return false;
        }

        case "ANALYSIS_ERROR": {
            chrome.storage.local.set({ sync_in_progress: false, sync_heartbeat: null });
            chrome.runtime.sendMessage({ type: "SYNC_ERROR", error: message.error })
                .catch(() => {});
            return false;
        }
    }
});

// ── Sync Handler ──────────────────────────────────────────────────────────────

async function handleRunSync(tabId, force = false) {
    if (!force) {
        const { last_run_time } = await chrome.storage.local.get(["last_run_time"]);
        if (last_run_time && Date.now() - last_run_time < MIN_SYNC_INTERVAL_MS) {
            const remaining = Math.ceil((MIN_SYNC_INTERVAL_MS - (Date.now() - last_run_time)) / 60000);
            throw new Error(`Tekrar sync için ${remaining} dakika daha bekleyin.`);
        }
    }

    const igTab = tabId || await getInstagramTabId();
    if (!igTab) {
        throw new Error("Sync başlatmadan önce bir sekmede instagram.com'u açın.");
    }

    // Fire-and-forget: content script ACKs immediately, sends ANALYSIS_COMPLETE later.
    chrome.tabs.sendMessage(igTab, { type: "RUN_ANALYSIS" }).catch(() => {});
    await chrome.storage.local.set({ last_run_time: Date.now() });
}

async function getInstagramTabId() {
    const tabs = await chrome.tabs.query({ url: "https://www.instagram.com/*" });
    return tabs[0]?.id || null;
}

// ── Fetch image as base64 ─────────────────────────────────────────────────────

async function fetchAsBase64(url) {
    try {
        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), FETCH_B64_TIMEOUT_MS);
        const res = await fetch(url, { signal: controller.signal }).finally(() => clearTimeout(timer));
        if (!res.ok) return null;

        const reader = res.body?.getReader();
        if (!reader) {
            const buffer = await res.arrayBuffer();
            if (buffer.byteLength > FETCH_B64_MAX_BYTES) return null;
            return encodeArrayBuffer(buffer, res.headers.get("content-type"));
        }
        const chunks = [];
        let total = 0;
        while (true) {
            const { done, value } = await reader.read();
            if (done) break;
            total += value.length;
            if (total > FETCH_B64_MAX_BYTES) { reader.cancel(); return null; }
            chunks.push(value);
        }
        const buffer = new Uint8Array(total);
        let offset = 0;
        for (const chunk of chunks) { buffer.set(chunk, offset); offset += chunk.length; }
        return encodeArrayBuffer(buffer.buffer, res.headers.get("content-type"));
    } catch { return null; }
}

function encodeArrayBuffer(buffer, contentType) {
    const bytes = new Uint8Array(buffer);
    let binary = "";
    for (let i = 0; i < bytes.length; i += 8192) {
        binary += String.fromCharCode(...bytes.subarray(i, i + 8192));
    }
    return `data:${contentType || "image/jpeg"};base64,${btoa(binary)}`;
}

// ── Snapshot normalizer (backward compat) ─────────────────────────────────────
// Old Drive snapshots have followers/following arrays.
// New snapshots omit them and use is_follower/is_following flags in full_map.

function normalizeDriveSnapshot(driveSnapshot) {
    if (!driveSnapshot) return null;
    if (Array.isArray(driveSnapshot.followers)) return driveSnapshot;
    const map = driveSnapshot.full_map || {};
    return {
        ...driveSnapshot,
        followers: Object.values(map).filter(u => u.is_follower),
        following: Object.values(map).filter(u => u.is_following)
    };
}

// ── Analysis Complete Handler ─────────────────────────────────────────────────

async function handleAnalysisComplete(newSnapshot) {
    const sendProgress = (detail) =>
        chrome.runtime.sendMessage({ type: "PROGRESS_UPDATE", step: "saving", detail }).catch(() => {});

    sendProgress("Önceki veriler yükleniyor...");

    // Load previous snapshot from Drive — graceful fallback if Drive is unreachable.
    // A Drive failure should NOT prevent the user from seeing their current data.
    let driveSnapshot = null;
    try {
        driveSnapshot = await loadSnapshot(newSnapshot.userId);
    } catch {
        // Drive unreachable — continue as if first run.
        // The diff will show no lost/new users, which is correct for a first run.
    }

    // Normalize old-format snapshots so computeDiff always has followers/following arrays
    const normalizedDriveSnapshot = normalizeDriveSnapshot(driveSnapshot);

    sendProgress("Diff hesaplanıyor...");

    // Compute diff
    const diff = computeDiff(normalizedDriveSnapshot, newSnapshot);

    // Build full_map (pk → user info) with is_follower/is_following flags
    const previousMap = driveSnapshot?.full_map || {};
    const fullMap = buildFullMap(newSnapshot.followers, newSnapshot.following, previousMap);

    // Collect users that need status checking (newly lost)
    const pendingChecks = diff.lost
        .filter(u => u.pendingStatusCheck)
        .slice(0, MAX_STATUS_CHECKS_PER_RUN)
        .map(u => ({ pk: u.pk, username: u.username }));

    // Compute withdrawn follow requests
    const prevPendingPks  = new Set((driveSnapshot?.requests?.pending   || []).map(u => String(u.pk || u)));
    const currPendingPks  = new Set((newSnapshot.requests?.pending      || []).map(u => String(u.pk || u)));
    const currFollowerPks = new Set(newSnapshot.followers.map(u => String(u.pk)));

    const newlyWithdrawn = [...prevPendingPks]
        .filter(pk => !currPendingPks.has(pk) && !currFollowerPks.has(pk))
        .map(pk => {
            const prev = (driveSnapshot?.requests?.pending || []).find(u => String(u.pk || u) === pk);
            return prev || { pk };
        });

    const allWithdrawn = [...(driveSnapshot?.requests?.withdrawn || []), ...newlyWithdrawn]
        .filter((u, i, arr) => arr.findIndex(x => String(x.pk || x) === String(u.pk || u)) === i);

    // Build snapshot — WITHOUT followers/following arrays (redundant with full_map flags).
    // This halves the Drive file size for large accounts.
    const snapshotToSave = {
        timestamp:   newSnapshot.timestamp,
        userId:      newSnapshot.userId,
        currentUser: newSnapshot.currentUser || null,
        full_map:    fullMap,
        history:     buildHistory(driveSnapshot, {
            follower_count:  newSnapshot.followers.length,
            following_count: newSnapshot.following.length,
        }),
        engagement:  newSnapshot.engagement || {},
        requests: {
            pending:   newSnapshot.requests?.pending   || [],
            withdrawn: allWithdrawn
        },
        stats: {
            lost:          diff.lost.filter(u => !u.pendingStatusCheck),
            not_back:      diff.not_back,
            new:           diff.newFollowers,
            fans:          diff.fans,
            deactivated:   diff.deactivated,
            pending_check: pendingChecks
        }
    };

    // Fetch ALL profile pics as base64 — previously cached pics are skipped.
    const eng = snapshotToSave.engagement || {};
    const getEng = (pk) => {
        const v = eng[pk];
        if (v && typeof v === "object") return v;
        return { post_likes: 0, story_views: 0, story_likes: 0, score: typeof v === "number" ? v : 0 };
    };

    const allUserPks = Object.keys(fullMap);
    const picsToFetch = allUserPks
        .filter(pk => fullMap[pk]?.profile_pic_url && !fullMap[pk]?.profile_pic_b64);

    if (picsToFetch.length > 0) {
        sendProgress(`Profil resimleri yükleniyor... (0/${picsToFetch.length})`);
        for (let i = 0; i < picsToFetch.length; i += 10) {
            const batch = picsToFetch.slice(i, i + 10);
            await Promise.allSettled(batch.map(async pk => {
                const b64 = await fetchAsBase64(fullMap[pk].profile_pic_url);
                if (b64) fullMap[pk].profile_pic_b64 = b64;
            }));
            sendProgress(`Profil resimleri yükleniyor... (${Math.min(i + 10, picsToFetch.length)}/${picsToFetch.length})`);
        }
    }

    // Enrich stats/requests arrays with base64 pics + latest data from fullMap.
    // Without this, popup only has CDN URLs which don't load from extension context.
    const enrichUser = (user) => {
        const entry = fullMap[String(user.pk)];
        if (entry) {
            if (entry.profile_pic_b64)  user.profile_pic_b64 = entry.profile_pic_b64;
            if (entry.profile_pic_url)  user.profile_pic_url = entry.profile_pic_url;
        }
    };
    for (const list of [
        snapshotToSave.stats.lost,
        snapshotToSave.stats.new,
        snapshotToSave.stats.not_back,
        snapshotToSave.stats.fans,
        snapshotToSave.stats.deactivated,
        snapshotToSave.requests.pending,
        snapshotToSave.requests.withdrawn,
    ]) {
        for (const user of (list || [])) enrichUser(user);
    }

    // Engagement summary — full per-user breakdown for popup display (with pics)
    const engagementSummary = {
        ghost_count: newSnapshot.followers.filter(u => getEng(u.pk).score === 0).length,
        weights: { post_likes: 2, story_views: 1, story_likes: 3 },
        engagers: newSnapshot.followers
            .filter(u => getEng(u.pk).score > 0)
            .sort((a, b) => getEng(b.pk).score - getEng(a.pk).score)
            .map(u => {
                const e = getEng(u.pk);
                const fm = fullMap[String(u.pk)];
                return {
                    pk: u.pk,
                    username: u.username,
                    full_name: u.full_name || "",
                    profile_pic_url: fm?.profile_pic_url || u.profile_pic_url || null,
                    profile_pic_b64: fm?.profile_pic_b64 || null,
                    is_verified: u.is_verified || false,
                    post_likes:  e.post_likes  || 0,
                    story_views: e.story_views || 0,
                    story_likes: e.story_likes || 0,
                    score:       e.score       || 0
                };
            })
    };

    const diffResult = {
        ...snapshotToSave.stats,
        engagement_summary: engagementSummary,
        requests: snapshotToSave.requests
    };

    // ── Step 1: Persist results + clear busy state ────────────────────────────
    await chrome.storage.local.set({
        diff_result:       diffResult,
        sync_in_progress:  false,
        sync_heartbeat:    null
    });

    // ── Step 2: Notify popup — user sees results immediately ──────────────────
    chrome.runtime.sendMessage({ type: "SYNC_COMPLETE", stats: diffResult }).catch(() => {});

    // ── Step 3: Save to Drive in background (never blocks popup) ──────────────
    saveToDriveInBackground(snapshotToSave, pendingChecks, newSnapshot.userId, 0);
}

// ── Background Drive Save ─────────────────────────────────────────────────────
// Runs AFTER SYNC_COMPLETE. Popup already shows results.
// On failure: schedules a retry alarm instead of losing data.

async function saveToDriveInBackground(snapshotToSave, pendingChecks, userId, retryCount = 0) {
    // Mark as pending so a service worker restart can retry
    await chrome.storage.local.set({
        pending_drive_snapshot:    snapshotToSave,
        pending_drive_retry_count: retryCount
    });

    try {
        await saveSnapshot(snapshotToSave);
    } catch (err) {
        const msg = translateDriveError(err.message);
        const isRetriable = ["DRIVE_AUTH_EXPIRED", "DRIVE_RATE_LIMITED"].includes(err.message)
            || err.message?.includes("AbortError")
            || err.message?.includes("network");

        if (isRetriable && retryCount < DRIVE_RETRY_MAX - 1) {
            // Schedule retry via alarm (survives service worker restart)
            await chrome.storage.local.set({ pending_drive_retry_count: retryCount + 1 });
            chrome.alarms.create(ALARM_DRIVE_RETRY, { delayInMinutes: 2 });
            chrome.runtime.sendMessage({
                type: "DRIVE_SAVE_FAILED",
                error: msg + " (otomatik yeniden deneme planlandı)"
            }).catch(() => {});
        } else {
            // Non-retriable or max retries exhausted — clean up
            await chrome.storage.local.remove(["pending_drive_snapshot", "pending_drive_retry_count"]);
            chrome.runtime.sendMessage({ type: "DRIVE_SAVE_FAILED", error: msg }).catch(() => {});
        }
        return;
    }

    // Success — clean up and notify
    await chrome.storage.local.remove(["pending_drive_snapshot", "pending_drive_retry_count"]);

    // Schedule deactivated status checks
    if (pendingChecks.length > 0) {
        await chrome.storage.local.set({
            pending_status_checks:  pendingChecks,
            pending_checks_user_id: userId
        });
        const existing = await chrome.alarms.get(ALARM_STATUS_CHECK);
        if (!existing) {
            chrome.alarms.create(ALARM_STATUS_CHECK, { delayInMinutes: 5 });
        }
    }

    chrome.runtime.sendMessage({ type: "DRIVE_SAVE_COMPLETE" }).catch(() => {});
}

// ── Deactivated Status Check Alarm Handler ────────────────────────────────────

async function runDeactivatedStatusChecks() {
    const { pending_status_checks, pending_checks_user_id } =
        await chrome.storage.local.get(["pending_status_checks", "pending_checks_user_id"]);
    if (!pending_status_checks?.length || !pending_checks_user_id) return;

    const igTabId = await getInstagramTabId();
    if (!igTabId) return;

    const cookies = await chrome.cookies.getAll({ domain: "instagram.com" });
    const csrfToken = cookies.find(c => c.name === "csrftoken")?.value;
    if (!csrfToken) return;

    const statusMap = {};
    for (const user of pending_status_checks) {
        try {
            const response = await chrome.tabs.sendMessage(igTabId, {
                type: "CHECK_ACCOUNT_STATUS",
                username: user.username,
                csrfToken
            });
            statusMap[user.pk] = response?.status || "unknown";
        } catch {
            statusMap[user.pk] = "unknown";
        }
        await new Promise(r => setTimeout(r, 3000 + Math.random() * 2000));
    }

    let driveSnapshot = null;
    try {
        driveSnapshot = await loadSnapshot(pending_checks_user_id);
    } catch { /* Drive unreachable */ }
    if (!driveSnapshot) return;

    const currentDiff = {
        lost:         driveSnapshot.stats?.lost        || [],
        deactivated:  driveSnapshot.stats?.deactivated || [],
        not_back:     driveSnapshot.stats?.not_back    || [],
        newFollowers: driveSnapshot.stats?.new         || [],
        fans:         driveSnapshot.stats?.fans        || []
    };

    const pendingUsers = (driveSnapshot.stats?.pending_check || []).map(u => ({
        ...u, pendingStatusCheck: true
    }));
    currentDiff.lost = [...currentDiff.lost, ...pendingUsers];

    const resolvedDiff = applyStatusChecks(currentDiff, statusMap);

    const updatedSnapshot = {
        ...driveSnapshot,
        stats: {
            lost:          resolvedDiff.lost,
            not_back:      resolvedDiff.not_back,
            new:           resolvedDiff.newFollowers,
            fans:          resolvedDiff.fans,
            deactivated:   resolvedDiff.deactivated,
            pending_check: []
        }
    };

    try {
        await saveSnapshot(updatedSnapshot);
    } catch { return; }

    await chrome.storage.local.set({ diff_result: updatedSnapshot.stats, pending_status_checks: [] });
    chrome.runtime.sendMessage({ type: "STATUS_CHECKS_COMPLETE" }).catch(() => {});
}

// ── History Builder ───────────────────────────────────────────────────────────

function buildHistory(previousSnapshot, counts) {
    if (typeof counts === "number") counts = { follower_count: counts };
    if (!counts?.follower_count) return previousSnapshot?.history || [];
    const previous = previousSnapshot?.history || [];
    const entry = { timestamp: new Date().toISOString(), follower_count: counts.follower_count };
    if (counts.following_count != null) entry.following_count = counts.following_count;
    return [...previous.slice(-29), entry];
}

// ── Drive Error Translator ────────────────────────────────────────────────────

function translateDriveError(code) {
    if (code === "DRIVE_AUTH_EXPIRED")   return "Google oturumu sona erdi. Lütfen yeniden giriş yapın.";
    if (code === "DRIVE_NO_PERMISSION")  return "Google Drive erişim izni yok. Drive.appdata iznini kontrol edin.";
    if (code === "DRIVE_RATE_LIMITED")   return "Google Drive hız sınırı — birkaç dakika bekleyip tekrar deneyin.";
    if (code?.startsWith("DRIVE_ERROR")) return `Drive hatası: ${code}`;
    return code || "Bilinmeyen hata";
}
