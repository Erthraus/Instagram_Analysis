/**
 * driveApi.js — Google Drive appDataFolder access from the React web client.
 * Read-only from web client — writing is done by the Chrome Extension.
 *
 * Hesap ayrımı: Her hesap kendi Analytics_Snapshot_{userId}.json dosyasında.
 */

const DRIVE_BASE    = "https://www.googleapis.com/drive/v3";
const FILE_PREFIX   = "Analytics_Snapshot_";

async function driveGet(token, url) {
    const res = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
    if (!res.ok) throw new Error(`Drive list failed: ${res.status}`);
    return res.json();
}

/**
 * List all snapshot files in appDataFolder.
 * Returns [{ id, name, modifiedTime, userId }] sorted newest first.
 */
export async function listSnapshots(token) {
    const q   = encodeURIComponent(`name contains '${FILE_PREFIX}'`);
    const url = `${DRIVE_BASE}/files?spaces=appDataFolder&q=${q}&fields=files(id,name,modifiedTime)&orderBy=modifiedTime+desc`;
    const json = await driveGet(token, url);
    return (json.files || []).map(f => ({
        id:           f.id,
        name:         f.name,
        modifiedTime: f.modifiedTime,
        userId:       f.name.replace(FILE_PREFIX, "").replace(".json", "")
    }));
}

/**
 * Load a specific snapshot by Drive file ID.
 */
export async function loadSnapshotById(token, fileId) {
    const res = await fetch(`${DRIVE_BASE}/files/${fileId}?alt=media`, {
        headers: { Authorization: `Bearer ${token}` }
    });
    if (!res.ok) throw new Error(`Drive read failed: ${res.status}`);
    return res.json();
}
