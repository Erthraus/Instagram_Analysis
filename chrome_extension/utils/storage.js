/**
 * storage.js — IndexedDB wrapper for local snapshot caching.
 * Stores current and previous snapshots for diff computation,
 * plus the last computed diff result for instant popup rendering.
 */

const DB_NAME = "ig_analytics_pro";
const DB_VERSION = 1;
const STORE_NAME = "snapshots";

let _db = null;

function openDB() {
    if (_db) return Promise.resolve(_db);
    return new Promise((resolve, reject) => {
        const req = indexedDB.open(DB_NAME, DB_VERSION);
        req.onupgradeneeded = (e) => {
            const db = e.target.result;
            if (!db.objectStoreNames.contains(STORE_NAME)) {
                db.createObjectStore(STORE_NAME);
            }
        };
        req.onsuccess = (e) => {
            _db = e.target.result;
            _db.onerror = () => { _db = null; }; // reset on unexpected connection error
            resolve(_db);
        };
        req.onerror = (e) => reject(e.target.error);
    });
}

function get(key) {
    return openDB().then(db => new Promise((resolve, reject) => {
        const tx = db.transaction(STORE_NAME, "readonly");
        const req = tx.objectStore(STORE_NAME).get(key);
        req.onsuccess = () => resolve(req.result ?? null);
        req.onerror = () => reject(req.error);
    }));
}

function set(key, value) {
    return openDB().then(db => new Promise((resolve, reject) => {
        const tx = db.transaction(STORE_NAME, "readwrite");
        const req = tx.objectStore(STORE_NAME).put(value, key);
        req.onsuccess = () => resolve();
        req.onerror = () => reject(req.error);
    }));
}

/**
 * Rotate snapshots: current → previous, then store new current.
 * If the account changed, the previous snapshot is cleared to prevent
 * cross-account diffs (e.g. Account B diffed against Account A's followers).
 */
export async function rotateAndSave(newSnapshot) {
    const current = await get("current_snapshot");
    if (current) {
        if (current.userId !== newSnapshot.userId) {
            // Different account — don't carry over old history
            await set("previous_snapshot", null);
        } else {
            await set("previous_snapshot", current);
        }
    }
    await set("current_snapshot", newSnapshot);
}

export const getCurrentSnapshot = () => get("current_snapshot");
export const getPreviousSnapshot = () => get("previous_snapshot");

export const getDiffResult = () => get("diff_result");
export const saveDiffResult = (diff) => set("diff_result", diff);

export const getLastRunTime = () => get("last_run_time");
export const saveLastRunTime = () => set("last_run_time", Date.now());

export const getPendingStatusChecks = () => get("pending_status_checks");
export const savePendingStatusChecks = (list) => set("pending_status_checks", list);

// ── Checkpoint (interrupt-safe resume) ───────────────────────────────────────
// Checkpoint structure: { phase: 'followers'|'following'|'done', followers: [...], following: [...], userId, timestamp }

export const getCheckpoint = () => get("sync_checkpoint");
export const saveCheckpoint = (data) => set("sync_checkpoint", data);
export const clearCheckpoint = () => set("sync_checkpoint", null);
