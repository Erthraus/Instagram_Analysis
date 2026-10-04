/**
 * migrate.js — Snapshot schema migration.
 *
 * Supported source versions:
 *   v0 — Legacy Python desktop format. full_map is username-keyed, no pk.
 *        Top-level: { timestamp, full_map: {username: {username, full_name, pic}},
 *                     followers_list: [username], following_list: [username],
 *                     stats: { lost, not_back, new, fans } }
 *
 *   v1 — Early Chrome Extension format. full_map is pk-keyed,
 *        with explicit followers/following arrays.
 *
 *   v2 — Current Chrome Extension format. full_map is pk-keyed,
 *        is_follower/is_following flags inside full_map, no top-level arrays.
 *        stats lists contain enriched user objects (with profile_pic_b64).
 *
 *   v3 — New normalized format. See SCHEMA_VERSION below.
 *
 * All migrate functions are pure: input -> output, no side effects.
 */

export const SCHEMA_VERSION = 3;

export const EVENT_TYPES = Object.freeze({
    FOLLOWER_GAINED:    "follower_gained",
    FOLLOWER_LOST:      "follower_lost",
    STATUS_CHANGED:     "status_changed",
    REQUEST_WITHDRAWN:  "request_withdrawn",
});

export const STATUS = Object.freeze({
    ACTIVE:      "active",
    DEACTIVATED: "deactivated",
    DELETED:     "deleted",
    UNKNOWN:     "unknown",
});

const EVENT_LOG_CAP   = 5000;
const HISTORY_CAP_V3  = 365;

// ── Version detection ────────────────────────────────────────────────────────

export function detectVersion(snapshot) {
    if (!snapshot || typeof snapshot !== "object") return -1;
    if (typeof snapshot.schema_version === "number") return snapshot.schema_version;
    if (!snapshot.full_map) return -1;

    // Explicit followers/following arrays at top-level → v1 (regardless of full_map)
    if (Array.isArray(snapshot.followers) || Array.isArray(snapshot.following)) return 1;

    const firstKey = Object.keys(snapshot.full_map)[0];
    if (!firstKey) {
        // Empty map, no arrays — modern empty snapshot
        return 2;
    }
    const firstEntry = snapshot.full_map[firstKey];

    // v0: username-keyed, no pk on entries
    if (!firstEntry?.pk) return 0;

    return 2;
}

// ── Public API ───────────────────────────────────────────────────────────────

/**
 * Migrate any supported snapshot to v3. Returns null on null input.
 * Throws on unrecognized schemas.
 */
export function migrate(raw) {
    if (raw == null) return null;
    const v = detectVersion(raw);
    if (v === SCHEMA_VERSION) return raw;
    if (v === 2) return v2ToV3(raw);
    if (v === 1) return v1ToV3(raw);
    if (v === 0) return v0ToV3(raw);
    throw new Error(`migrate: unrecognized snapshot schema (detected v=${v})`);
}

// ── Helpers ──────────────────────────────────────────────────────────────────

function tsToISO(raw) {
    if (!raw) return new Date().toISOString();
    // "2026-02-05 01:19:16" (legacy) → ISO
    if (typeof raw === "string" && /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/.test(raw)) {
        return raw.replace(" ", "T") + "Z";
    }
    const d = new Date(raw);
    return isNaN(d.getTime()) ? new Date().toISOString() : d.toISOString();
}

function emptyEngagement() {
    return { post_likes: 0, story_views: 0, story_likes: 0, score: 0, last_updated_at: null };
}

function normalizeEngagement(e) {
    if (!e) return emptyEngagement();
    if (typeof e === "number") return { ...emptyEngagement(), post_likes: e, score: e };
    return {
        post_likes:      e.post_likes ?? 0,
        story_views:     e.story_views ?? 0,
        story_likes:     e.story_likes ?? 0,
        score:           e.score ?? 0,
        last_updated_at: e.last_updated_at ?? null,
    };
}

function newUserEntry(base, ts) {
    return {
        username:        base.username ?? "",
        full_name:       base.full_name ?? "",
        profile_pic_url: base.profile_pic_url ?? null,
        is_verified:     !!base.is_verified,
        flags: {
            is_follower:   !!base.is_follower,
            is_following:  !!base.is_following,
            is_pending:    !!base.is_pending,
            is_requester:  !!base.is_requester,
        },
        lifecycle: {
            first_seen_at:      ts,
            last_seen_at:       ts,
            status:             STATUS.ACTIVE,
            status_checked_at:  null,
        },
        engagement: emptyEngagement(),
    };
}

function capHistory(history) {
    if (!Array.isArray(history)) return [];
    return history.slice(-HISTORY_CAP_V3);
}

function capEvents(events) {
    if (!Array.isArray(events)) return [];
    return events.slice(-EVENT_LOG_CAP);
}

// ── v2 → v3 ──────────────────────────────────────────────────────────────────

function v2ToV3(s) {
    const ts = tsToISO(s.timestamp);
    const users = {};
    const fullMap = s.full_map || {};
    const engagementMap = s.engagement || {};

    for (const [pk, entry] of Object.entries(fullMap)) {
        const eng = normalizeEngagement(engagementMap[pk]);
        users[pk] = {
            username:        entry.username ?? "",
            full_name:       entry.full_name ?? "",
            profile_pic_url: entry.profile_pic_url ?? null,
            is_verified:     !!entry.is_verified,
            flags: {
                is_follower:   !!entry.is_follower,
                is_following:  !!entry.is_following,
                is_pending:    false,
                is_requester:  false,
            },
            lifecycle: {
                first_seen_at:     ts,
                last_seen_at:      ts,
                status:            STATUS.ACTIVE,
                status_checked_at: null,
            },
            engagement: eng,
        };
    }

    // Pending requests → is_pending flag
    for (const u of s.requests?.pending || []) {
        const pk = String(u.pk ?? u);
        if (!users[pk]) {
            users[pk] = newUserEntry({ username: u.username, full_name: u.full_name, is_verified: u.is_verified, is_pending: true }, ts);
        } else {
            users[pk].flags.is_pending = true;
        }
    }

    // Withdrawn requests → emit event (no flag — historical)
    const events = [];
    for (const u of s.requests?.withdrawn || []) {
        const pk = String(u.pk ?? u);
        events.push({ ts, type: EVENT_TYPES.REQUEST_WITHDRAWN, pk });
    }

    // Deactivated users → lifecycle.status
    for (const u of s.stats?.deactivated || []) {
        const pk = String(u.pk ?? u);
        if (!users[pk]) users[pk] = newUserEntry({ username: u.username, full_name: u.full_name }, ts);
        users[pk].lifecycle.status = STATUS.DEACTIVATED;
        users[pk].lifecycle.status_checked_at = ts;
        events.push({ ts, type: EVENT_TYPES.STATUS_CHANGED, pk, from: STATUS.ACTIVE, to: STATUS.DEACTIVATED });
    }

    // Lost users → ensure entry exists, emit event
    for (const u of s.stats?.lost || []) {
        const pk = String(u.pk ?? u);
        if (!users[pk]) users[pk] = newUserEntry({ username: u.username, full_name: u.full_name }, ts);
        // Ensure is_follower=false (they unfollowed)
        users[pk].flags.is_follower = false;
        events.push({ ts, type: EVENT_TYPES.FOLLOWER_LOST, pk });
    }

    // New followers → emit event
    for (const u of s.stats?.new || []) {
        const pk = String(u.pk ?? u);
        if (!users[pk]) users[pk] = newUserEntry({ username: u.username, full_name: u.full_name, is_follower: true }, ts);
        events.push({ ts, type: EVENT_TYPES.FOLLOWER_GAINED, pk });
    }

    return {
        schema_version: SCHEMA_VERSION,
        snapshot_at:    ts,
        account: {
            pk:        s.userId ?? null,
            username:  s.currentUser?.username ?? null,
            full_name: s.currentUser?.full_name ?? null,
        },
        client: { name: "migration", version: "v2->v3" },
        users,
        events:   capEvents(events),
        history:  capHistory(s.history),
        metadata: {
            last_full_sync_at: ts,
            sync_count:        1,
        },
    };
}

// ── v1 → v3 ──────────────────────────────────────────────────────────────────

function v1ToV3(s) {
    // v1 has explicit followers/following arrays + pk-keyed full_map without flags.
    const ts = tsToISO(s.timestamp);
    const followerSet  = new Set((s.followers  || []).map(u => String(u.pk ?? u)));
    const followingSet = new Set((s.following || []).map(u => String(u.pk ?? u)));

    const users = {};
    const fullMap = s.full_map || {};
    for (const [pk, entry] of Object.entries(fullMap)) {
        users[pk] = {
            username:        entry.username ?? "",
            full_name:       entry.full_name ?? "",
            profile_pic_url: entry.profile_pic_url ?? null,
            is_verified:     !!entry.is_verified,
            flags: {
                is_follower:   followerSet.has(String(pk)),
                is_following:  followingSet.has(String(pk)),
                is_pending:    false,
                is_requester:  false,
            },
            lifecycle: {
                first_seen_at:     ts,
                last_seen_at:      ts,
                status:            STATUS.ACTIVE,
                status_checked_at: null,
            },
            engagement: emptyEngagement(),
        };
    }

    // Ensure all users from arrays are present (might not be in full_map)
    for (const u of [...(s.followers || []), ...(s.following || [])]) {
        const pk = String(u.pk ?? u);
        if (!users[pk]) {
            users[pk] = newUserEntry({
                username:     u.username,
                full_name:    u.full_name,
                is_verified:  u.is_verified,
                is_follower:  followerSet.has(pk),
                is_following: followingSet.has(pk),
            }, ts);
        }
    }

    const events = [];
    for (const u of s.stats?.deactivated || []) {
        const pk = String(u.pk ?? u);
        if (!users[pk]) users[pk] = newUserEntry({ username: u.username, full_name: u.full_name }, ts);
        users[pk].lifecycle.status = STATUS.DEACTIVATED;
        users[pk].lifecycle.status_checked_at = ts;
    }

    return {
        schema_version: SCHEMA_VERSION,
        snapshot_at:    ts,
        account: {
            pk:        s.userId ?? null,
            username:  s.currentUser?.username ?? null,
            full_name: s.currentUser?.full_name ?? null,
        },
        client: { name: "migration", version: "v1->v3" },
        users,
        events:   capEvents(events),
        history:  capHistory(s.history),
        metadata: { last_full_sync_at: ts, sync_count: 1 },
    };
}

// ── v0 → v3 ──────────────────────────────────────────────────────────────────
//
// v0 is username-keyed (no pk). Without pks we can't reliably reconcile with
// future syncs (Instagram pk is the stable identifier; usernames can change).
// We migrate everything into a "seed" v3 snapshot keyed by `legacy:<username>`
// so it doesn't collide with real pks. The next real sync will overwrite these
// with proper pk-keyed entries (via username match in reconcileLegacyUsernames).

function v0ToV3(s) {
    const ts = tsToISO(s.timestamp);
    const followerSet  = new Set(s.followers_list  || []);
    const followingSet = new Set(s.following_list || []);

    const users = {};
    for (const [username, entry] of Object.entries(s.full_map || {})) {
        const legacyKey = `legacy:${username}`;
        users[legacyKey] = {
            username,
            full_name:       entry.full_name ?? "",
            profile_pic_url: null,        // legacy `pic` is an expired CDN URL — drop it
            is_verified:     false,
            flags: {
                is_follower:   followerSet.has(username),
                is_following:  followingSet.has(username),
                is_pending:    false,
                is_requester:  false,
            },
            lifecycle: {
                first_seen_at:     ts,
                last_seen_at:      ts,
                status:            STATUS.ACTIVE,
                status_checked_at: null,
            },
            engagement: emptyEngagement(),
        };
    }

    return {
        schema_version: SCHEMA_VERSION,
        snapshot_at:    ts,
        account: { pk: null, username: null, full_name: null },
        client: { name: "migration", version: "v0->v3" },
        users,
        events:   [],
        history:  [],
        metadata: { last_full_sync_at: ts, sync_count: 1, legacy_v0: true },
    };
}

/**
 * Pull any `profile_pic_b64` fields out of a pre-v3 snapshot.
 * Used to migrate avatars from the old in-snapshot location to the new
 * separate Avatars_{userId}.json file (or chrome.storage.local for the popup).
 * Returns { pk: dataURI } — empty map if input is already v3 or has no b64s.
 */
export function extractLegacyAvatars(raw) {
    if (!raw || raw.schema_version === SCHEMA_VERSION) return {};
    const out = {};
    for (const [key, entry] of Object.entries(raw.full_map || {})) {
        // v2 uses pk-keyed full_map; v0 is username-keyed (no useful b64).
        if (entry?.pk && entry?.profile_pic_b64) {
            out[String(entry.pk)] = entry.profile_pic_b64;
        }
    }
    return out;
}

/**
 * After a fresh sync produces real pk-keyed user data, fold any surviving
 * `legacy:<username>` entries into the matching real pk entries (preserving
 * first_seen_at). Returns a new users map.
 */
export function reconcileLegacyUsernames(users) {
    const realByUsername = {};
    for (const [pk, u] of Object.entries(users)) {
        if (!pk.startsWith("legacy:") && u.username) {
            realByUsername[u.username.toLowerCase()] = pk;
        }
    }
    const out = {};
    for (const [pk, u] of Object.entries(users)) {
        if (pk.startsWith("legacy:")) {
            const realPk = realByUsername[u.username?.toLowerCase()];
            if (realPk) {
                // Real entry exists — merge first_seen_at (oldest wins)
                const real = out[realPk] || users[realPk];
                const oldest = [real.lifecycle.first_seen_at, u.lifecycle.first_seen_at].sort()[0];
                out[realPk] = { ...real, lifecycle: { ...real.lifecycle, first_seen_at: oldest } };
                // drop the legacy entry
                continue;
            }
            // No real match — keep legacy entry as-is (user not seen in latest sync)
            out[pk] = u;
        } else if (!out[pk]) {
            out[pk] = u;
        }
    }
    return out;
}
