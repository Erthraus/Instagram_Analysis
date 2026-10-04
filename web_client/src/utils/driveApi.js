/**
 * driveApi.js — Google Drive appDataFolder access from the React web client.
 * Read-only + delete from web client. Writing is done by the Chrome Extension.
 *
 * All snapshots are migrated to v3 on read.
 * Avatars live in a separate Avatars_{userId}.json file.
 */

import { migrate } from "./migrate.js";

const DRIVE_BASE      = "https://www.googleapis.com/drive/v3";
const SNAPSHOT_PREFIX = "Analytics_Snapshot_";
const AVATARS_PREFIX  = "Avatars_";

async function driveGet(token, url) {
    const res = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
    if (!res.ok) throw new Error(`Drive list failed: ${res.status}`);
    return res.json();
}

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
 * List snapshot files (excluding backups and avatars). Newest first.
 */
export async function listSnapshots(token) {
    const q = encodeURIComponent(`name contains '${SNAPSHOT_PREFIX}'`);
    let allFiles = [];
    let pageToken = null;

    do {
        const ptParam = pageToken ? `&pageToken=${encodeURIComponent(pageToken)}` : "";
        const url = `${DRIVE_BASE}/files?spaces=appDataFolder&q=${q}&fields=files(id,name,modifiedTime),nextPageToken&orderBy=modifiedTime+desc&pageSize=100${ptParam}`;
        const json = await driveGet(token, url);
        allFiles.push(...(json.files || []));
        pageToken = json.nextPageToken || null;
    } while (pageToken);

    return allFiles
        .filter(f => f.name.startsWith(SNAPSHOT_PREFIX))
        .map(f => ({
            id:           f.id,
            name:         f.name,
            modifiedTime: f.modifiedTime,
            userId:       f.name.replace(SNAPSHOT_PREFIX, "").replace(".json", ""),
        }));
}

export async function deleteSnapshot(token, fileId) {
    const res = await fetch(`${DRIVE_BASE}/files/${fileId}`, {
        method: "DELETE",
        headers: { Authorization: `Bearer ${token}` }
    });
    if (!res.ok && res.status !== 404) throw new Error(`Drive delete failed: ${res.status}`);
}

/**
 * Load a snapshot by Drive file ID. Migration to v3 happens transparently.
 */
export async function loadSnapshotById(token, fileId) {
    const res = await fetch(`${DRIVE_BASE}/files/${fileId}?alt=media`, {
        headers: { Authorization: `Bearer ${token}` }
    });
    if (!res.ok) throw new Error(`Drive read failed: ${res.status}`);
    const raw = await res.json();
    const decompressed = await maybeDecompress(raw);
    return migrate(decompressed);
}

/**
 * Load the avatars side-file for a given userId, if present.
 * Returns { pk: dataURI } or null.
 */
export async function loadAvatars(token, userId) {
    const name = `${AVATARS_PREFIX}${userId}.json`;
    const q = encodeURIComponent(`name='${name}'`);
    const url = `${DRIVE_BASE}/files?spaces=appDataFolder&q=${q}&fields=files(id)`;
    const json = await driveGet(token, url);
    const fileId = json.files?.[0]?.id;
    if (!fileId) return null;
    const res = await fetch(`${DRIVE_BASE}/files/${fileId}?alt=media`, {
        headers: { Authorization: `Bearer ${token}` }
    });
    if (!res.ok) return null;
    const raw = await res.json();
    const decompressed = await maybeDecompress(raw);
    return decompressed?.avatars || null;
}
