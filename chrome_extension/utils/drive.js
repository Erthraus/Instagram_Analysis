/**
 * drive.js — Google Drive appDataFolder integration.
 * All Drive operations run from the background service worker.
 *
 * Hesap ayrımı: Her Instagram hesabı kendi dosyasına kaydedilir.
 * Dosya adı: Analytics_Snapshot_{userId}.json
 *
 * Compression: Snapshots are gzip-compressed (v2 format) before upload.
 * Old uncompressed snapshots (v1) are transparently decompressed on read.
 */

const DRIVE_BASE       = "https://www.googleapis.com/drive/v3";
const UPLOAD_BASE      = "https://www.googleapis.com/upload/drive/v3";
const FILE_PREFIX      = "Analytics_Snapshot_";
const QUERY_TIMEOUT_MS = 15_000;  // metadata queries (fast)
const UPLOAD_TIMEOUT_MS = 90_000; // file upload (allow for slow connections / large files)
const TOKEN_TIMEOUT_MS  = 15_000; // getAuthToken timeout

export function getFileName(userId) {
    return `${FILE_PREFIX}${userId}.json`;
}

export function getToken(interactive = true) {
    return Promise.race([
        new Promise((resolve, reject) => {
            chrome.identity.getAuthToken({ interactive }, (token) => {
                if (chrome.runtime.lastError) reject(new Error(chrome.runtime.lastError.message));
                else if (!token) reject(new Error("DRIVE_AUTH_EXPIRED"));
                else resolve(token);
            });
        }),
        new Promise((_, reject) =>
            setTimeout(() => reject(new Error("DRIVE_AUTH_EXPIRED")), TOKEN_TIMEOUT_MS)
        )
    ]);
}

/** fetch with a hard timeout via AbortController */
function fetchWithTimeout(url, opts, ms = QUERY_TIMEOUT_MS) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), ms);
    return fetch(url, { ...opts, signal: controller.signal })
        .finally(() => clearTimeout(timer));
}

/** Translate HTTP status codes to user-readable error codes */
function throwDriveError(status, context = "") {
    if (status === 401) throw new Error("DRIVE_AUTH_EXPIRED");
    if (status === 403) throw new Error("DRIVE_NO_PERMISSION");
    if (status === 429) throw new Error("DRIVE_RATE_LIMITED");
    throw new Error(`DRIVE_ERROR_${status}${context ? ": " + context : ""}`);
}

/** Safe JSON parse — avoids crash if Drive returns an HTML error page */
async function safeJson(res) {
    const ct = res.headers.get("content-type") || "";
    if (!ct.includes("application/json")) {
        const text = await res.text();
        throw new Error(`DRIVE_UNEXPECTED_RESPONSE: ${text.slice(0, 120)}`);
    }
    return res.json();
}

// ── Compression (gzip via CompressionStream) ────────────────────────────────
// v2 format: { v: 2, gz: "<base64-gzipped-json>" }
// Falls back to uncompressed if CompressionStream is unavailable.

async function compressSnapshot(snapshot) {
    try {
        const json = JSON.stringify(snapshot);
        const blob = new Blob([json]);
        const cs = new CompressionStream("gzip");
        const compressed = blob.stream().pipeThrough(cs);
        const buffer = await new Response(compressed).arrayBuffer();
        const bytes = new Uint8Array(buffer);
        let binary = "";
        for (let i = 0; i < bytes.length; i += 8192) {
            binary += String.fromCharCode(...bytes.subarray(i, i + 8192));
        }
        return { v: 2, gz: btoa(binary) };
    } catch {
        // Fallback: save uncompressed
        return snapshot;
    }
}

async function decompressSnapshot(data) {
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

// ── Drive Operations ────────────────────────────────────────────────────────

async function findFileId(token, userId) {
    const name = getFileName(userId);
    const url = `${DRIVE_BASE}/files?spaces=appDataFolder&q=name%3D'${encodeURIComponent(name)}'&fields=files(id)`;
    const res = await fetchWithTimeout(url, { headers: { Authorization: `Bearer ${token}` } });
    if (!res.ok) throwDriveError(res.status, "list");
    const json = await safeJson(res);
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
 * Compresses with gzip before upload to reduce Drive storage usage.
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

    const compressed = await compressSnapshot(snapshot);
    const body = buildMultipart(boundary, metadata, compressed);

    const url = existingId
        ? `${UPLOAD_BASE}/files/${existingId}?uploadType=multipart`
        : `${UPLOAD_BASE}/files?uploadType=multipart`;

    const res = await fetchWithTimeout(url, {
        method: existingId ? "PATCH" : "POST",
        headers: {
            Authorization: `Bearer ${token}`,
            "Content-Type": `multipart/related; boundary=${boundary}`
        },
        body
    }, UPLOAD_TIMEOUT_MS);

    if (!res.ok) throwDriveError(res.status, "save");
    return safeJson(res);
}

/**
 * Load a snapshot by userId. Returns null if no file exists for this user.
 * Transparently decompresses v2 (gzipped) snapshots.
 */
export async function loadSnapshot(userId) {
    const token  = await getToken();
    const fileId = await findFileId(token, userId);
    if (!fileId) return null;

    const res = await fetchWithTimeout(`${DRIVE_BASE}/files/${fileId}?alt=media`, {
        headers: { Authorization: `Bearer ${token}` }
    });
    if (!res.ok) throwDriveError(res.status, "load");
    const raw = await safeJson(res);
    return decompressSnapshot(raw);
}

/**
 * List all snapshot files for the account switcher UI.
 * Returns [{ id, name, userId, modifiedTime }, ...]
 */
export async function listSnapshots(token) {
    const q = encodeURIComponent(`name contains '${FILE_PREFIX}'`);
    const url = `${DRIVE_BASE}/files?spaces=appDataFolder&q=${q}&fields=files(id,name,modifiedTime)&orderBy=modifiedTime desc`;
    const res = await fetchWithTimeout(url, { headers: { Authorization: `Bearer ${token}` } });
    if (!res.ok) throwDriveError(res.status, "list-all");
    const json = await safeJson(res);
    return (json.files || []).map(f => ({
        id:           f.id,
        name:         f.name,
        userId:       f.name.replace(FILE_PREFIX, "").replace(".json", ""),
        modifiedTime: f.modifiedTime,
    }));
}

/**
 * Load a snapshot by Drive file ID (used by account switcher).
 * Transparently decompresses v2 (gzipped) snapshots.
 */
export async function loadSnapshotById(token, fileId) {
    const res = await fetchWithTimeout(`${DRIVE_BASE}/files/${fileId}?alt=media`, {
        headers: { Authorization: `Bearer ${token}` }
    });
    if (!res.ok) throwDriveError(res.status, "load-by-id");
    const raw = await safeJson(res);
    return decompressSnapshot(raw);
}
