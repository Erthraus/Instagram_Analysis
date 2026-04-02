/**
 * driveApi.js — Google Drive appDataFolder access from the React web client.
 * Read-only + delete from web client — writing is done by the Chrome Extension.
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
 * Decompress a gzip-compressed snapshot (v2 format).
 * Falls through for uncompressed (v1) snapshots.
 */
async function maybeDecompress(data) {
    if (data && data.v === 2 && data.gz) {
        const binary = atob(data.gz);
        const bytes = new Uint8Array(binary.length);
        for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
        const blob = new Blob([bytes]);
        const ds = new DecompressionStream("gzip");
        const decompressed = blob.stream().pipeThrough(ds);
        const text = await new Response(decompressed).text();
        return JSON.parse(text);
    }
    return data;
}

/**
 * List all snapshot files in appDataFolder.
 * Returns [{ id, name, modifiedTime, userId }] sorted newest first.
 * Handles pagination for accounts with many snapshot files.
 */
export async function listSnapshots(token) {
    const q = encodeURIComponent(`name contains '${FILE_PREFIX}'`);
    let allFiles = [];
    let pageToken = null;

    do {
        const ptParam = pageToken ? `&pageToken=${encodeURIComponent(pageToken)}` : "";
        const url = `${DRIVE_BASE}/files?spaces=appDataFolder&q=${q}&fields=files(id,name,modifiedTime),nextPageToken&orderBy=modifiedTime+desc&pageSize=100${ptParam}`;
        const json = await driveGet(token, url);
        allFiles.push(...(json.files || []));
        pageToken = json.nextPageToken || null;
    } while (pageToken);

    return allFiles.map(f => ({
        id:           f.id,
        name:         f.name,
        modifiedTime: f.modifiedTime,
        userId:       f.name.replace(FILE_PREFIX, "").replace(".json", "")
    }));
}

/**
 * Delete a snapshot file from Drive by file ID.
 */
export async function deleteSnapshot(token, fileId) {
    const res = await fetch(`${DRIVE_BASE}/files/${fileId}`, {
        method: "DELETE",
        headers: { Authorization: `Bearer ${token}` }
    });
    if (!res.ok && res.status !== 404) throw new Error(`Drive delete failed: ${res.status}`);
}

/**
 * Load a specific snapshot by Drive file ID.
 * Supports both compressed (v2) and uncompressed (v1) snapshots.
 */
export async function loadSnapshotById(token, fileId) {
    const res = await fetch(`${DRIVE_BASE}/files/${fileId}?alt=media`, {
        headers: { Authorization: `Bearer ${token}` }
    });
    if (!res.ok) throw new Error(`Drive read failed: ${res.status}`);
    const data = await res.json();
    return maybeDecompress(data);
}
