/**
 * background.js — Service Worker (Manifest V3)
 *
 * Responsibilities:
 *  1. Message routing between popup ↔ content script ↔ Drive API
 *  2. Google Drive API calls (cannot be done from content scripts due to CORS)
 *  3. Scheduled deactivated-account checks via chrome.alarms
 *  4. Rate limit enforcement (30-min cooldown between full syncs)
 */

import { saveSnapshot, loadSnapshot } from "./utils/drive.js";
import { computeDiff, applyStatusChecks, buildFullMap } from "./utils/analyzer.js";

const ALARM_STATUS_CHECK = "deactivated_status_check";
const MIN_SYNC_INTERVAL_MS = 30 * 60 * 1000; // 30 minutes
const MAX_STATUS_CHECKS_PER_RUN = 50;

// ── Alarm Listener ────────────────────────────────────────────────────────────

chrome.alarms.onAlarm.addListener(async (alarm) => {
    if (alarm.name === ALARM_STATUS_CHECK) {
        await runDeactivatedStatusChecks();
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
            // Received from content script after fetching followers/following
            handleAnalysisComplete(message.snapshot)
                .then(() => sendResponse({ ok: true }))
                .catch(err => sendResponse({ ok: false, error: err.message }));
            return true;
        }

        case "ANALYSIS_PROGRESS": {
            // Forward to popup if open
            chrome.runtime.sendMessage({ type: "PROGRESS_UPDATE", step: message.step, detail: message.detail })
                .catch(() => {});
            return false;
        }

        case "ANALYSIS_ERROR": {
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
            throw new Error(`Please wait ${remaining} more minute(s) before syncing again.`);
        }
    }

    // Find the active Instagram tab
    const igTab = tabId || await getInstagramTabId();
    if (!igTab) {
        throw new Error("Please open instagram.com in a tab before syncing.");
    }

    // Fire-and-forget: content script ACKs immediately, sends ANALYSIS_COMPLETE later.
    // Do NOT await — message port would time out on large accounts (>5 min sync).
    chrome.tabs.sendMessage(igTab, { type: "RUN_ANALYSIS" }).catch(() => {});

    await chrome.storage.local.set({ last_run_time: Date.now() });
}

async function getInstagramTabId() {
    const tabs = await chrome.tabs.query({ url: "https://www.instagram.com/*" });
    return tabs[0]?.id || null;
}

// ── Analysis Complete Handler ─────────────────────────────────────────────────

// Fetch an image URL and return it as a base64 data URI.
// Works from service worker (no FileReader — uses ArrayBuffer + btoa).
async function fetchAsBase64(url) {
    try {
        const res = await fetch(url);
        if (!res.ok) return null;
        const buffer = await res.arrayBuffer();
        const bytes  = new Uint8Array(buffer);
        let binary = "";
        // Process in chunks to avoid call stack overflow on large images
        for (let i = 0; i < bytes.length; i += 8192) {
            binary += String.fromCharCode(...bytes.subarray(i, i + 8192));
        }
        const ct = res.headers.get("content-type") || "image/jpeg";
        return `data:${ct};base64,${btoa(binary)}`;
    } catch { return null; }
}

async function handleAnalysisComplete(newSnapshot) {
    // Load previous snapshot for THIS user from Drive (source of truth)
    // Passing userId prevents cross-account diff contamination.
    const driveSnapshot = await loadSnapshot(newSnapshot.userId);

    // Compute diff
    const diff = computeDiff(driveSnapshot, newSnapshot);

    // Build full_map (pk → user info), preserving data for lost users
    const previousMap = driveSnapshot?.full_map || {};
    const fullMap = buildFullMap(newSnapshot.followers, newSnapshot.following, previousMap);

    // Collect users that need status checking (newly lost)
    const pendingChecks = diff.lost
        .filter(u => u.pendingStatusCheck)
        .slice(0, MAX_STATUS_CHECKS_PER_RUN)
        .map(u => ({ pk: u.pk, username: u.username }));

    // Compute withdrawn follow requests: were in previous pending, no longer pending, not a follower
    const prevPendingPks = new Set((driveSnapshot?.requests?.pending || []).map(u => String(u.pk || u)));
    const currPendingPks = new Set((newSnapshot.requests?.pending || []).map(u => String(u.pk || u)));
    const currFollowerPks = new Set(newSnapshot.followers.map(u => String(u.pk)));
    const prevWithdrawnPks = new Set((driveSnapshot?.requests?.withdrawn || []).map(u => String(u.pk || u)));

    const newlyWithdrawn = [...prevPendingPks]
        .filter(pk => !currPendingPks.has(pk) && !currFollowerPks.has(pk))
        .map(pk => {
            const prev = (driveSnapshot?.requests?.pending || []).find(u => String(u.pk || u) === pk);
            return prev || { pk };
        });

    const allWithdrawn = [...(driveSnapshot?.requests?.withdrawn || []), ...newlyWithdrawn]
        .filter((u, i, arr) => arr.findIndex(x => String(x.pk || x) === String(u.pk || u)) === i);

    const snapshotToSave = {
        timestamp: newSnapshot.timestamp,
        userId: newSnapshot.userId,
        currentUser: newSnapshot.currentUser || null,
        full_map: fullMap,
        followers: newSnapshot.followers,
        following: newSnapshot.following,
        history: buildHistory(driveSnapshot, newSnapshot.followers.length),
        engagement: newSnapshot.engagement || {},
        requests: {
            pending:   newSnapshot.requests?.pending   || [],
            withdrawn: allWithdrawn
        },
        stats: {
            lost: diff.lost.filter(u => !u.pendingStatusCheck),
            not_back: diff.not_back,
            new: diff.newFollowers,
            fans: diff.fans,
            deactivated: diff.deactivated,
            pending_check: pendingChecks
        }
    };

    // Profil fotoğraflarını base64 olarak önbelle: CDN URL'si 24-48s sonra expire olsa bile
    // web client'ta gösterilebilir. Zaten önbelleğe alınmış (profile_pic_b64 var) olanları atla.
    const picsToFetch = Object.keys(fullMap)
        .filter(pk => fullMap[pk]?.profile_pic_url && !fullMap[pk]?.profile_pic_b64)
        .slice(0, 400); // cap: ~400 × ~8KB ≈ 3.2MB ek, Drive 10MB sınırı içinde kalır

    // 20'lik gruplar halinde getir — CDN'i boğmamak için
    for (let i = 0; i < picsToFetch.length; i += 20) {
        const batch = picsToFetch.slice(i, i + 20);
        await Promise.all(batch.map(async pk => {
            const b64 = await fetchAsBase64(fullMap[pk].profile_pic_url);
            if (b64) fullMap[pk].profile_pic_b64 = b64;
        }));
    }

    // Compute engagement summary for popup display
    // engagement[pk] may be { score, story_views, story_likes } (new) or number (legacy)
    const eng = snapshotToSave.engagement || {};
    const getScore = (v) => (v && typeof v === "object") ? (v.score ?? 0) : (v ?? 0);
    const engagementSummary = {
        ghost_count:  newSnapshot.followers.filter(u => getScore(eng[u.pk]) === 0).length,
        top_engagers: newSnapshot.followers
            .filter(u => getScore(eng[u.pk]) > 0)
            .sort((a, b) => getScore(eng[b.pk]) - getScore(eng[a.pk]))
            .slice(0, 5)
            .map(u => ({ pk: u.pk, username: u.username, count: getScore(eng[u.pk]) }))
    };

    await chrome.storage.local.set({
        diff_result: {
            ...snapshotToSave.stats,
            engagement_summary: engagementSummary,
            requests: snapshotToSave.requests
        }
    });

    // Save full snapshot to Drive
    await saveSnapshot(snapshotToSave);

    // Schedule deactivated status checks 5 minutes later
    if (pendingChecks.length > 0) {
        await chrome.storage.local.set({ pending_status_checks: pendingChecks });
        chrome.alarms.create(ALARM_STATUS_CHECK, { delayInMinutes: 5 });
    }

    // Notify popup (send full diff_result so engagement_summary and requests are included)
    const diffResult = {
        ...snapshotToSave.stats,
        engagement_summary: engagementSummary,
        requests: snapshotToSave.requests
    };
    chrome.runtime.sendMessage({ type: "SYNC_COMPLETE", stats: diffResult })
        .catch(() => {}); // Popup might not be open
}

// ── Deactivated Status Check Alarm Handler ────────────────────────────────────

async function runDeactivatedStatusChecks() {
    const { pending_status_checks } = await chrome.storage.local.get(["pending_status_checks"]);
    if (!pending_status_checks || pending_status_checks.length === 0) return;

    const igTabId = await getInstagramTabId();
    if (!igTabId) return; // Instagram tab not open, skip

    // Get csrfToken from Instagram cookies
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

        // Rate limit: 3-5 second delay between checks
        await new Promise(r => setTimeout(r, 3000 + Math.random() * 2000));
    }

    // Load current Drive snapshot and apply status checks
    const driveSnapshot = await loadSnapshot();
    if (!driveSnapshot) return;

    const currentDiff = {
        lost: driveSnapshot.stats?.lost || [],
        deactivated: driveSnapshot.stats?.deactivated || [],
        not_back: driveSnapshot.stats?.not_back || [],
        newFollowers: driveSnapshot.stats?.new || [],
        fans: driveSnapshot.stats?.fans || []
    };

    // Add pending_check users back into lost for applyStatusChecks to process
    const pendingUsers = (driveSnapshot.stats?.pending_check || []).map(u => ({
        ...u,
        pendingStatusCheck: true
    }));
    currentDiff.lost = [...currentDiff.lost, ...pendingUsers];

    const resolvedDiff = applyStatusChecks(currentDiff, statusMap);

    // Update snapshot with resolved results
    const updatedSnapshot = {
        ...driveSnapshot,
        stats: {
            lost: resolvedDiff.lost,
            not_back: resolvedDiff.not_back,
            new: resolvedDiff.newFollowers,
            fans: resolvedDiff.fans,
            deactivated: resolvedDiff.deactivated,
            pending_check: []
        }
    };

    await saveSnapshot(updatedSnapshot);
    await chrome.storage.local.set({
        diff_result: updatedSnapshot.stats,
        pending_status_checks: []
    });

    chrome.runtime.sendMessage({ type: "STATUS_CHECKS_COMPLETE" }).catch(() => {});
}

// ── History Builder ───────────────────────────────────────────────────────────

function buildHistory(previousSnapshot, currentFollowerCount) {
    const previous = previousSnapshot?.history || [];
    return [
        ...previous.slice(-29), // Keep last 30 entries
        {
            timestamp: new Date().toISOString(),
            follower_count: currentFollowerCount
        }
    ];
}
