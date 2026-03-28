/**
 * drive.js — Google Drive appDataFolder integration.
 * All Drive operations run from the background service worker.
 *
 * Hesap ayrımı: Her Instagram hesabı kendi dosyasına kaydedilir.
 * Dosya adı: Analytics_Snapshot_{userId}.json
 */

const DRIVE_BASE  = "https://www.googleapis.com/drive/v3";
const UPLOAD_BASE = "https://www.googleapis.com/upload/drive/v3";
const FILE_PREFIX = "Analytics_Snapshot_";

export function getFileName(userId) {
    return `${FILE_PREFIX}${userId}.json`;
}

export function getToken(interactive = true) {
    return new Promise((resolve, reject) => {
        chrome.identity.getAuthToken({ interactive }, (token) => {
            if (chrome.runtime.lastError) reject(new Error(chrome.runtime.lastError.message));
            else resolve(token);
        });
    });
}

async function findFileId(token, userId) {
    const name = getFileName(userId);
    const url = `${DRIVE_BASE}/files?spaces=appDataFolder&q=name%3D'${encodeURIComponent(name)}'&fields=files(id)`;
    const res = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
    if (!res.ok) throw new Error(`Drive list failed: ${res.status}`);
    const json = await res.json();
    return json.files?.[0]?.id || null;
}

function buildMultipart(boundary, metadata, content) {
    return [
        `--${boundary}`,
        "Content-Type: application/json; charset=UTF-8",
        "",
        JSON.stringify(metadata),
        `--${boundary}`,
        "Content-Type: application/json",
        "",
        JSON.stringify(content),
        `--${boundary}--`
    ].join("\r\n");
}

/**
 * Save (upsert) a snapshot to Drive — uses userId-specific filename.
 * Prevents different accounts from overwriting each other.
 */
export async function saveSnapshot(snapshot) {
    const userId = snapshot.userId;
    if (!userId) throw new Error("snapshot.userId eksik — kaydedilemez.");

    const token      = await getToken();
    const boundary   = "ig_analytics_boundary_" + Date.now();
    const fileName   = getFileName(userId);
    const existingId = await findFileId(token, userId);

    const metadata = existingId
        ? { name: fileName }
        : { name: fileName, parents: ["appDataFolder"] };

    const body = buildMultipart(boundary, metadata, snapshot);

    const url = existingId
        ? `${UPLOAD_BASE}/files/${existingId}?uploadType=multipart`
        : `${UPLOAD_BASE}/files?uploadType=multipart`;

    const res = await fetch(url, {
        method: existingId ? "PATCH" : "POST",
        headers: {
            Authorization: `Bearer ${token}`,
            "Content-Type": `multipart/related; boundary=${boundary}`
        },
        body
    });

    if (!res.ok) {
        const errText = await res.text();
        throw new Error(`Drive kaydetme hatası (${res.status}): ${errText}`);
    }
    return res.json();
}

/**
 * Load a snapshot by userId. Returns null if no file exists for this user.
 */
export async function loadSnapshot(userId) {
    const token  = await getToken();
    const fileId = await findFileId(token, userId);
    if (!fileId) return null;

    const res = await fetch(`${DRIVE_BASE}/files/${fileId}?alt=media`, {
        headers: { Authorization: `Bearer ${token}` }
    });
    if (!res.ok) throw new Error(`Drive okuma hatası: ${res.status}`);
    return res.json();
}
