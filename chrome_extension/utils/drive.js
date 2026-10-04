/**
 * drive.js — Google Drive appDataFolder integration.
 *
 * Files written per account (userId):
 *   Analytics_Snapshot_{userId}.json        — main v3 snapshot (gzip-compressed)
 *   Analytics_Backup_{userId}.json          — previous snapshot, kept as a single rolling backup
 *   Avatars_{userId}.json                   — base64 profile pictures (gzip-compressed)
 *
 * The avatar split keeps the main snapshot small enough to fit comfortably
 * under Drive's 10 MB appDataFolder limit even for accounts with thousands
 * of followers. Avatars can be re-fetched from Instagram if the file is lost.
 *
 * All snapshots are transparently migrated to the current schema on read.
 */

import { migrate } from "./migrate.js";

const DRIVE_BASE        = "https://www.googleapis.com/drive/v3";
const UPLOAD_BASE       = "https://www.googleapis.com/upload/drive/v3";
const SNAPSHOT_PREFIX   = "Analytics_Snapshot_";
const BACKUP_PREFIX     = "Analytics_Backup_";
const AVATARS_PREFIX    = "Avatars_";
const QUERY_TIMEOUT_MS  = 15_000;
const UPLOAD_TIMEOUT_MS = 90_000;
const TOKEN_TIMEOUT_MS  = 15_000;
const BACKUP_TIMEOUT_MS = 20_000;  // backup is best-effort; don't hang the primary save

export const getFileName        = (userId) => `${SNAPSHOT_PREFIX}${userId}.json`;
export const getBackupFileName  = (userId) => `${BACKUP_PREFIX}${userId}.json`;
export const getAvatarsFileName = (userId) => `${AVATARS_PREFIX}${userId}.json`;

// ── Auth ────────────────────────────────────────────────────────────────────

export async function getToken(interactive = true) {
    try {
        return await Promise.race([
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
    } catch (err) {
        const msg = err.message || "";
        if (msg.includes("bad client id") || msg.includes("OAuth2 request failed")) {
            const extId = chrome.runtime.id;
            const redirectUri = chrome.identity.getRedirectURL();
            console.error("[ig-analytics] ❌ OAuth misconfiguration:");
            console.error("  Current extension ID  :", extId);
            console.error("  Manifest client_id    :", chrome.runtime.getManifest().oauth2?.client_id);
            console.error("  Redirect URI (web app):", redirectUri);
            console.error("  → Fix: GCP Console → OAuth 2.0 Client → Application ID alanına yukarıdaki extension ID'yi yaz.");
            throw new Error(`DRIVE_OAUTH_BAD_CLIENT_ID: Extension ID '${extId}' GCP'de kayıtlı değil`);
        }
        throw err;
    }
}

function fetchWithTimeout(url, opts, ms = QUERY_TIMEOUT_MS) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), ms);
    return fetch(url, { ...opts, signal: controller.signal }).finally(() => clearTimeout(timer));
}

function throwDriveError(status, context = "") {
    if (status === 401) throw new Error("DRIVE_AUTH_EXPIRED");
    if (status === 403) throw new Error("DRIVE_NO_PERMISSION");
    if (status === 429) throw new Error("DRIVE_RATE_LIMITED");
    throw new Error(`DRIVE_ERROR_${status}${context ? ": " + context : ""}`);
}

async function safeJson(res) {
    const ct = res.headers.get("content-type") || "";
    if (!ct.includes("application/json")) {
        const text = await res.text();
        throw new Error(`DRIVE_UNEXPECTED_RESPONSE: ${text.slice(0, 120)}`);
    }
    return res.json();
}

// ── Compression ─────────────────────────────────────────────────────────────

async function compressPayload(obj) {
    try {
        const json = JSON.stringify(obj);
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
        return obj;
    }
}

async function decompressPayload(data) {
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

// ── Generic file operations ─────────────────────────────────────────────────

async function findFileId(token, name) {
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
        `--${boundary}--`,
    ].join("\r\n");
}

async function uploadFile(token, fileName, content) {
    const boundary   = "ig_analytics_boundary_" + Date.now();
    const existingId = await findFileId(token, fileName);
    const metadata   = existingId ? { name: fileName } : { name: fileName, parents: ["appDataFolder"] };
    const compressed = await compressPayload(content);
    const body       = buildMultipart(boundary, metadata, compressed);
    const url        = existingId
        ? `${UPLOAD_BASE}/files/${existingId}?uploadType=multipart`
        : `${UPLOAD_BASE}/files?uploadType=multipart`;

    const res = await fetchWithTimeout(url, {
        method: existingId ? "PATCH" : "POST",
        headers: {
            Authorization:  `Bearer ${token}`,
            "Content-Type": `multipart/related; boundary=${boundary}`,
        },
        body,
    }, UPLOAD_TIMEOUT_MS);

    if (!res.ok) throwDriveError(res.status, "save");
    return safeJson(res);
}

async function downloadFile(token, fileName) {
    const fileId = await findFileId(token, fileName);
    if (!fileId) return null;
    const res = await fetchWithTimeout(`${DRIVE_BASE}/files/${fileId}?alt=media`, {
        headers: { Authorization: `Bearer ${token}` }
    });
    if (!res.ok) throwDriveError(res.status, "load");
    const raw = await safeJson(res);
    return decompressPayload(raw);
}

// ── Snapshot API ────────────────────────────────────────────────────────────

/**
 * Save a v3 snapshot to Drive. Before overwriting, the existing snapshot is
 * copied to Analytics_Backup_{userId}.json as a rolling single-snapshot backup.
 */
export async function saveSnapshot(snapshot) {
    const userId = snapshot.account?.pk || snapshot.userId;
    if (!userId) throw new Error("snapshot.account.pk eksik — kaydedilemez.");

    const token = await getToken();

    // Rolling backup: copy the current main file to backup before overwriting.
    // Strictly bounded so a slow/failing backup never blocks the primary save.
    try {
        await Promise.race([
            (async () => {
                const existing = await downloadFile(token, getFileName(userId));
                if (existing) await uploadFile(token, getBackupFileName(userId), existing);
            })(),
            new Promise((_, reject) => setTimeout(() => reject(new Error("BACKUP_TIMEOUT")), BACKUP_TIMEOUT_MS))
        ]);
    } catch (err) {
        // Backup is best-effort; log but do not block the primary save.
        console.warn("[ig-analytics] Backup skipped:", err.message);
    }

    await uploadFile(token, getFileName(userId), snapshot);
}

/**
 * Load and migrate a snapshot by userId. Returns null if no snapshot exists.
 */
export async function loadSnapshot(userId) {
    const token = await getToken();
    const raw = await downloadFile(token, getFileName(userId));
    return migrate(raw);
}

/**
 * Load the raw (pre-migration) snapshot for a userId. Used when the caller
 * needs access to legacy fields (e.g. embedded profile_pic_b64) before they
 * are stripped by migration.
 */
export async function loadRawSnapshot(userId) {
    const token = await getToken();
    return await downloadFile(token, getFileName(userId));
}

/** Save the avatars side-file (pk → base64 data-URI). */
export async function saveAvatars(userId, avatarMap) {
    if (!userId) throw new Error("userId eksik — avatarlar kaydedilemez.");
    const token = await getToken();
    await uploadFile(token, getAvatarsFileName(userId), {
        v: 1,
        updated_at: new Date().toISOString(),
        avatars: avatarMap,
    });
}

/** Load avatars file. Returns { pk: dataURI } or null. */
export async function loadAvatars(userId) {
    const token = await getToken();
    const raw = await downloadFile(token, getAvatarsFileName(userId));
    return raw?.avatars || null;
}

/**
 * List all snapshot files for the account switcher UI.
 * Filters to only Analytics_Snapshot_{userId}.json (excludes backups and avatars).
 */
export async function listSnapshots(token) {
    const q = encodeURIComponent(`name contains '${SNAPSHOT_PREFIX}'`);
    const url = `${DRIVE_BASE}/files?spaces=appDataFolder&q=${q}&fields=files(id,name,modifiedTime)&orderBy=modifiedTime desc`;
    const res = await fetchWithTimeout(url, { headers: { Authorization: `Bearer ${token}` } });
    if (!res.ok) throwDriveError(res.status, "list-all");
    const json = await safeJson(res);
    return (json.files || [])
        .filter(f => f.name.startsWith(SNAPSHOT_PREFIX))
        .map(f => ({
            id:           f.id,
            name:         f.name,
            userId:       f.name.replace(SNAPSHOT_PREFIX, "").replace(".json", ""),
            modifiedTime: f.modifiedTime,
        }));
}

/** Load a snapshot by Drive file ID (used by web client account switcher). */
export async function loadSnapshotById(token, fileId) {
    const res = await fetchWithTimeout(`${DRIVE_BASE}/files/${fileId}?alt=media`, {
        headers: { Authorization: `Bearer ${token}` }
    });
    if (!res.ok) throwDriveError(res.status, "load-by-id");
    const raw = await safeJson(res);
    const decompressed = await decompressPayload(raw);
    return migrate(decompressed);
}
