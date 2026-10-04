/**
 * background.js — Service Worker (Manifest V3)
 *
 * Responsibilities:
 *  1. Message routing between popup ↔ content script ↔ Drive API
 *  2. Google Drive API calls (cannot be done from content scripts due to CORS)
 *  3. Scheduled deactivated-account checks via chrome.alarms
 *  4. Rate limit enforcement (30-min cooldown between full syncs)
 *
 * Snapshot format: v3 (see utils/migrate.js).
 * Profile picture base64 lives in a separate Avatars_{userId}.json file
 * to keep the main snapshot under Drive's 10 MB limit. The popup loads
 * avatars from chrome.storage.local; the web client loads them from Drive.
 */

import { saveSnapshot, loadSnapshot, loadRawSnapshot, saveAvatars } from "./utils/drive.js";
import { buildSnapshot, applyStatusChecks, applyLegacyBaseline } from "./utils/analyzer.js";
import { deriveStats, deriveEngagement } from "./utils/derive.js";
import { reconcileLegacyUsernames, extractLegacyAvatars, migrate, STATUS } from "./utils/migrate.js";

const ALARM_STATUS_CHECK        = "deactivated_status_check";
const ALARM_DRIVE_RETRY         = "drive_save_retry";
const MIN_SYNC_INTERVAL_MS      = 30 * 60 * 1000;
const MAX_STATUS_CHECKS_PER_RUN = 200;  // was 50 — more aggressive resolution
const STATUS_CHECK_BATCH        = 40;   // ~4s per check — keeps one alarm run well under the 5-min service-worker limit
const FETCH_B64_TIMEOUT_MS      = 5_000;
const FETCH_B64_MAX_BYTES       = 2 * 1024 * 1024;
const DRIVE_RETRY_MAX           = 3;

// ── Startup: retry any Drive save interrupted by service worker termination ─

(async () => {
    try {
        const data = await chrome.storage.local.get(["pending_drive_snapshot", "pending_drive_retry_count", "pending_drive_userId"]);
        if (data.pending_drive_snapshot && data.pending_drive_userId) {
            const retryCount = data.pending_drive_retry_count || 0;
            if (retryCount < DRIVE_RETRY_MAX) {
                await saveToDriveInBackground(data.pending_drive_snapshot, [], data.pending_drive_userId, retryCount);
            } else {
                await chrome.storage.local.remove(["pending_drive_snapshot", "pending_drive_retry_count", "pending_drive_userId"]);
            }
        }
    } catch { /* startup check failed — not critical */ }
})();

// ── Alarms ───────────────────────────────────────────────────────────────────

chrome.alarms.onAlarm.addListener(async (alarm) => {
    if (alarm.name === ALARM_STATUS_CHECK) {
        await runDeactivatedStatusChecks();
    }
    if (alarm.name === ALARM_DRIVE_RETRY) {
        const data = await chrome.storage.local.get(["pending_drive_snapshot", "pending_drive_retry_count", "pending_drive_userId"]);
        if (data.pending_drive_snapshot && data.pending_drive_userId) {
            const retryCount = data.pending_drive_retry_count || 0;
            if (retryCount < DRIVE_RETRY_MAX) {
                await saveToDriveInBackground(data.pending_drive_snapshot, [], data.pending_drive_userId, retryCount);
            } else {
                await chrome.storage.local.remove(["pending_drive_snapshot", "pending_drive_retry_count", "pending_drive_userId"]);
            }
        }
    }
});

// ── Message Router ───────────────────────────────────────────────────────────

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
            (async () => {
                try {
                    const data = await chrome.storage.local.get(["analysis_snapshot"]);
                    const scraped = data.analysis_snapshot;
                    if (!scraped) {
                        throw new Error("Snapshot verisi bulunamadı. Content script yazamadı olabilir.");
                    }
                    await handleAnalysisComplete(scraped);
                    sendResponse({ ok: true });
                } catch (err) {
                    await chrome.storage.local.set({ sync_in_progress: false, sync_heartbeat: null }).catch(() => {});
                    chrome.runtime.sendMessage({ type: "SYNC_ERROR", error: err.message }).catch(() => {});
                    sendResponse({ ok: false, error: err.message });
                } finally {
                    chrome.storage.local.remove(["analysis_snapshot"]).catch(() => {});
                }
            })();
            return true;
        }

        case "ANALYSIS_PROGRESS": {
            chrome.storage.local.set({
                sync_heartbeat:    Date.now(),
                sync_in_progress:  true,
                sync_last_step:    message.step,
                sync_last_detail:  message.detail || ""
            });
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

// ── Sync Handler ─────────────────────────────────────────────────────────────

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

    try {
        await chrome.tabs.sendMessage(igTab, { type: "RUN_ANALYSIS" });
    } catch {
        // Content script is missing — the tab was opened before the extension was (re)loaded.
        throw new Error("Instagram sekmesine ulaşılamadı. Sekmeyi yenileyip (F5) tekrar deneyin.");
    }
    await chrome.storage.local.set({ last_run_time: Date.now() });
}

async function getInstagramTabId() {
    const tabs = await chrome.tabs.query({ url: "https://www.instagram.com/*" });
    return tabs[0]?.id || null;
}

// ── Fetch image as base64 ────────────────────────────────────────────────────

async function fetchAsBase64(url) {
    try {
        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), FETCH_B64_TIMEOUT_MS);
        // Instagram CDN: must NOT send our extension origin as referrer.
        const res = await fetch(url, {
            signal: controller.signal,
            referrerPolicy: "no-referrer",
            credentials: "omit",
            mode: "cors",
        }).finally(() => clearTimeout(timer));
        if (!res.ok) {
            console.warn("[ig-analytics] avatar fetch HTTP", res.status, url.slice(0, 80));
            return null;
        }

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
    } catch (err) {
        console.warn("[ig-analytics] avatar fetch error:", err.message);
        return null;
    }
}

function encodeArrayBuffer(buffer, contentType) {
    const bytes = new Uint8Array(buffer);
    let binary = "";
    for (let i = 0; i < bytes.length; i += 8192) {
        binary += String.fromCharCode(...bytes.subarray(i, i + 8192));
    }
    return `data:${contentType || "image/jpeg"};base64,${btoa(binary)}`;
}

// ── Analysis Complete Handler ────────────────────────────────────────────────

async function handleAnalysisComplete(scraped) {
    const sendProgress = (detail) =>
        chrome.runtime.sendMessage({ type: "PROGRESS_UPDATE", step: "saving", detail }).catch(() => {});

    sendProgress("Önceki veriler yükleniyor...");

    // Load raw first so we can recover any legacy b64 avatars before migrate drops them.
    let rawPrev = null;
    try {
        rawPrev = await loadRawSnapshot(scraped.userId);
    } catch {
        // Drive unreachable — treat as first run.
    }
    const prevSnapshot = migrate(rawPrev);
    const legacyAvatars = extractLegacyAvatars(rawPrev);
    if (Object.keys(legacyAvatars).length > 0) {
        console.log(`[ig-analytics] Recovered ${Object.keys(legacyAvatars).length} legacy avatars from old snapshot`);
    }

    sendProgress("Snapshot oluşturuluyor...");

    let { snapshot, pendingStatusChecks } = buildSnapshot(prevSnapshot, scraped);

    // Legacy data file imported via import/import.html → retroactive diff
    const { legacy_baseline } = await chrome.storage.local.get(["legacy_baseline"]);
    if (legacy_baseline) {
        const merged = applyLegacyBaseline(snapshot, migrate(legacy_baseline));
        if (merged.applied) {
            snapshot = merged.snapshot;
            pendingStatusChecks = [...pendingStatusChecks, ...merged.pendingStatusChecks];
        } else {
            console.warn("[ig-analytics] Imported legacy data does not match this account — skipped");
        }
    }

    // Fold leftover legacy:<username> entries from v0 migration into matching pks
    if (prevSnapshot?.metadata?.legacy_v0) {
        snapshot.users = reconcileLegacyUsernames(snapshot.users);
    }

    // ── Fetch profile pictures (cached locally; ALSO synced to Drive) ────────
    const localAvatars = (await chrome.storage.local.get(["avatars_" + scraped.userId]))["avatars_" + scraped.userId] || {};
    // Merge order: recovered legacy < local cache (local is most recent on re-run)
    const avatarsMap = { ...legacyAvatars, ...localAvatars };

    // Only fetch pics for users we'll display (followers, fans, lost, pending, deactivated, engagers)
    const displayPks = new Set();
    for (const [pk, u] of Object.entries(snapshot.users)) {
        if (u.flags.is_follower || u.flags.is_following || u.flags.is_pending) displayPks.add(pk);
        if (u.lifecycle.status === STATUS.DEACTIVATED || u.lifecycle.status === STATUS.DELETED) displayPks.add(pk);
    }
    const picsToFetch = [...displayPks].filter(pk => {
        const u = snapshot.users[pk];
        return u?.profile_pic_url && !avatarsMap[pk];
    });

    if (picsToFetch.length > 0) {
        sendProgress(`Profil resimleri yükleniyor... (0/${picsToFetch.length})`);
        let successCount = 0;
        for (let i = 0; i < picsToFetch.length; i += 10) {
            const batch = picsToFetch.slice(i, i + 10);
            await Promise.allSettled(batch.map(async pk => {
                const b64 = await fetchAsBase64(snapshot.users[pk].profile_pic_url);
                if (b64) { avatarsMap[pk] = b64; successCount++; }
            }));
            sendProgress(`Profil resimleri yükleniyor... (${Math.min(i + 10, picsToFetch.length)}/${picsToFetch.length})`);
        }
        console.log(`[ig-analytics] Avatars: ${successCount}/${picsToFetch.length} fetched successfully (${Object.keys(avatarsMap).length} total in cache)`);
    } else {
        console.log(`[ig-analytics] Avatars: ${Object.keys(avatarsMap).length} already cached, no fetch needed`);
    }

    // Persist avatars locally for the popup
    await chrome.storage.local.set({ ["avatars_" + scraped.userId]: avatarsMap });

    // ── Derive stats for popup (UI shape) ────────────────────────────────────
    const stats = deriveStats(snapshot);
    const engagement_summary = deriveEngagement(snapshot);

    // Enrich derived users with locally-cached b64 pics so popup renders them
    const enrich = (list) => list.map(u => ({ ...u, profile_pic_b64: avatarsMap[u.pk] || null }));
    const diffResult = {
        lost:        enrich(stats.lost),
        not_back:    enrich(stats.not_back),
        new:         enrich(stats.new),
        fans:        enrich(stats.fans),
        deactivated: enrich(stats.deactivated),
        pending:     enrich(stats.pending),
        engagement_summary: {
            ...engagement_summary,
            engagers: enrich(engagement_summary.engagers),
        },
        requests: {
            pending:   enrich(stats.pending),
            withdrawn: [],   // historical events only — not displayed as current state
        },
    };

    // ── Step 1: Persist + clear busy state ───────────────────────────────────
    await chrome.storage.local.set({
        diff_result:       diffResult,
        sync_in_progress:  false,
        sync_heartbeat:    null,
    });

    // ── Step 2: Notify popup ─────────────────────────────────────────────────
    chrome.runtime.sendMessage({ type: "SYNC_COMPLETE", stats: diffResult }).catch(() => {});

    // ── Step 3: Save to Drive in background ──────────────────────────────────
    saveToDriveInBackground(snapshot, pendingStatusChecks, scraped.userId, 0, avatarsMap);
}

// ── Background Drive Save ────────────────────────────────────────────────────

async function saveToDriveInBackground(snapshot, pendingChecks, userId, retryCount = 0, avatarsMap = null) {
    await chrome.storage.local.set({
        pending_drive_snapshot:    snapshot,
        pending_drive_retry_count: retryCount,
        pending_drive_userId:      userId,
    });

    try {
        await saveSnapshot(snapshot);
        if (avatarsMap && Object.keys(avatarsMap).length > 0) {
            // Don't block on avatar upload — main snapshot is what web client needs.
            saveAvatars(userId, avatarsMap).catch(err => {
                console.warn("[ig-analytics] Avatars save failed (non-fatal):", err.message);
            });
        }
    } catch (err) {
        console.error("[ig-analytics] Drive save failed:", err.message, err);
        const msg = translateDriveError(err.message);
        const isRetriable = ["DRIVE_AUTH_EXPIRED", "DRIVE_RATE_LIMITED"].includes(err.message)
            || /DRIVE_ERROR_5\d{2}/.test(err.message || "")  // 5xx server errors
            || err.message?.includes("AbortError")
            || err.message?.includes("network")
            || err.message?.includes("Failed to fetch");

        if (isRetriable && retryCount < DRIVE_RETRY_MAX - 1) {
            await chrome.storage.local.set({ pending_drive_retry_count: retryCount + 1 });
            chrome.alarms.create(ALARM_DRIVE_RETRY, { delayInMinutes: 2 });
            chrome.runtime.sendMessage({
                type: "DRIVE_SAVE_FAILED",
                error: msg + " (otomatik yeniden deneme planlandı)"
            }).catch(() => {});
        } else {
            await chrome.storage.local.remove(["pending_drive_snapshot", "pending_drive_retry_count", "pending_drive_userId"]);
            chrome.runtime.sendMessage({ type: "DRIVE_SAVE_FAILED", error: msg }).catch(() => {});
        }
        return;
    }

    await chrome.storage.local.remove(["pending_drive_snapshot", "pending_drive_retry_count", "pending_drive_userId"]);

    // The baseline is now part of the Drive snapshot — drop the local copy so it is applied only once.
    if (snapshot.metadata?.legacy_baseline_at) {
        await chrome.storage.local.remove(["legacy_baseline"]);
    }

    // Schedule deactivated status checks (limit per run honored by alarm handler)
    if (pendingChecks.length > 0) {
        const truncated = pendingChecks.slice(0, MAX_STATUS_CHECKS_PER_RUN);
        await chrome.storage.local.set({
            pending_status_checks:  truncated,
            pending_checks_user_id: userId,
        });
        const existing = await chrome.alarms.get(ALARM_STATUS_CHECK);
        if (!existing) {
            chrome.alarms.create(ALARM_STATUS_CHECK, { delayInMinutes: 5 });
        }
    }

    chrome.runtime.sendMessage({ type: "DRIVE_SAVE_COMPLETE" }).catch(() => {});
}

// ── Deactivated Status Check Alarm Handler ───────────────────────────────────

async function runDeactivatedStatusChecks() {
    const { pending_status_checks, pending_checks_user_id } =
        await chrome.storage.local.get(["pending_status_checks", "pending_checks_user_id"]);
    if (!pending_status_checks?.length || !pending_checks_user_id) return;

    const igTabId = await getInstagramTabId();
    if (!igTabId) return;

    const cookies = await chrome.cookies.getAll({ domain: "instagram.com" });
    const csrfToken = cookies.find(c => c.name === "csrftoken")?.value;
    if (!csrfToken) return;

    const batch     = pending_status_checks.slice(0, STATUS_CHECK_BATCH);
    const remaining = pending_status_checks.slice(STATUS_CHECK_BATCH);

    const statusMap = {};
    for (const user of batch) {
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
    try { driveSnapshot = await loadSnapshot(pending_checks_user_id); }
    catch { /* Drive unreachable */ }
    if (!driveSnapshot) return;

    const updatedSnapshot = applyStatusChecks(driveSnapshot, statusMap);

    try { await saveSnapshot(updatedSnapshot); }
    catch { return; }

    // Refresh popup diff result with new derive
    const stats = deriveStats(updatedSnapshot);
    const avatars = (await chrome.storage.local.get(["avatars_" + pending_checks_user_id]))["avatars_" + pending_checks_user_id] || {};
    const enrich = (list) => list.map(u => ({ ...u, profile_pic_b64: avatars[u.pk] || null }));
    const { diff_result: prevDiff } = await chrome.storage.local.get(["diff_result"]);
    await chrome.storage.local.set({
        diff_result: {
            ...(prevDiff || {}),   // keep engagement_summary / requests from the sync
            lost:        enrich(stats.lost),
            not_back:    enrich(stats.not_back),
            new:         enrich(stats.new),
            fans:        enrich(stats.fans),
            deactivated: enrich(stats.deactivated),
            pending:     enrich(stats.pending),
        },
        pending_status_checks: remaining,
    });
    if (remaining.length > 0) {
        chrome.alarms.create(ALARM_STATUS_CHECK, { delayInMinutes: 1 });
    }
    chrome.runtime.sendMessage({ type: "STATUS_CHECKS_COMPLETE" }).catch(() => {});
}

// ── Drive Error Translator ───────────────────────────────────────────────────

function translateDriveError(code) {
    if (code === "DRIVE_AUTH_EXPIRED")   return "Google oturumu sona erdi. Lütfen yeniden giriş yapın.";
    if (code === "DRIVE_NO_PERMISSION")  return "Google Drive erişim izni yok. Drive.appdata iznini kontrol edin.";
    if (code === "DRIVE_RATE_LIMITED")   return "Google Drive hız sınırı — birkaç dakika bekleyip tekrar deneyin.";
    if (code?.startsWith("DRIVE_OAUTH_BAD_CLIENT_ID")) {
        return "Google Cloud OAuth client ID extension ID ile eşleşmiyor. Service worker konsoluna bak (kırmızı log) ve GCP'de extension ID'yi kaydet.";
    }
    if (/DRIVE_ERROR_5\d{2}/.test(code || "")) return `Google Drive geçici hata (${code}) — otomatik tekrar denenecek.`;
    if (code?.startsWith("DRIVE_ERROR")) return `Drive hatası: ${code}`;
    return code || "Bilinmeyen hata";
}
