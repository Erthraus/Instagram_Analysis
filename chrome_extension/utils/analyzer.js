/**
 * analyzer.js — v3 snapshot builder. Pure functions, no browser deps.
 *
 * Takes the previous v3 snapshot (or null on first run) plus the freshly
 * scraped state from Instagram, and produces:
 *   - the next v3 users map (with merged lifecycle, engagement, flags)
 *   - a list of events newly observed during this sync
 *   - a list of pks that need a deactivated-status check
 */

import { STATUS, EVENT_TYPES, SCHEMA_VERSION } from "./migrate.js";

const HISTORY_CAP = 365;
const EVENT_CAP   = 5000;

/**
 * Build a fresh v3 snapshot.
 *
 * @param {object|null} prev  Previous v3 snapshot (or null)
 * @param {object} scraped    { timestamp, userId, currentUser,
 *                              followers: [user], following: [user],
 *                              engagement: { pk: {post_likes,story_views,story_likes,score} },
 *                              requests: { pending: [user] } }
 * @returns {{ snapshot, events: array, pendingStatusChecks: array }}
 */
export function buildSnapshot(prev, scraped) {
    const ts = scraped.timestamp || new Date().toISOString();
    const followerSet  = new Set(scraped.followers.map(u => String(u.pk)));
    const followingSet = new Set(scraped.following.map(u => String(u.pk)));
    const pendingSet   = new Set((scraped.requests?.pending || []).map(u => String(u.pk ?? u)));

    // Start from previous users (preserve lifecycle, engagement, status history)
    // Only carry over real-pk entries; cross-account safeguard
    const prevSameAccount = prev && prev.account?.pk && scraped.userId && prev.account.pk === scraped.userId;
    const baseUsers = prevSameAccount ? { ...(prev.users || {}) } : {};
    const newEvents = [];
    const pendingStatusChecks = [];

    // Index incoming users by pk
    const incoming = new Map();
    for (const u of [...scraped.followers, ...scraped.following, ...(scraped.requests?.pending || [])]) {
        const pk = String(u.pk ?? u);
        if (!incoming.has(pk)) incoming.set(pk, u);
    }

    // Update/insert all users seen in this sync
    const nextUsers = {};
    for (const [pk, u] of incoming.entries()) {
        const prevEntry = baseUsers[pk];
        const prevEng   = prevEntry?.engagement;
        const incomingEng = (scraped.engagement || {})[pk];

        nextUsers[pk] = {
            username:        u.username ?? prevEntry?.username ?? "",
            full_name:       u.full_name ?? prevEntry?.full_name ?? "",
            profile_pic_url: u.profile_pic_url ?? prevEntry?.profile_pic_url ?? null,
            is_verified:     !!u.is_verified || !!prevEntry?.is_verified,
            flags: {
                is_follower:   followerSet.has(pk),
                is_following:  followingSet.has(pk),
                is_pending:    pendingSet.has(pk),
                is_requester:  !!prevEntry?.flags?.is_requester,
            },
            lifecycle: {
                first_seen_at:     prevEntry?.lifecycle?.first_seen_at ?? ts,
                last_seen_at:      ts,
                status:            STATUS.ACTIVE,                    // they showed up → active
                status_checked_at: prevEntry?.lifecycle?.status_checked_at ?? null,
            },
            engagement: mergeEngagement(prevEng, incomingEng, ts),
        };
    }

    // Carry forward users NOT seen in this sync, but adjust their flags
    for (const [pk, prevEntry] of Object.entries(baseUsers)) {
        if (nextUsers[pk]) continue;
        nextUsers[pk] = {
            ...prevEntry,
            flags: {
                ...(prevEntry.flags || {}),
                is_follower:  false,    // not in current followers
                is_following: false,    // not in current following
                is_pending:   false,    // not in current pending
            },
        };
    }

    // ── Emit diff events vs. previous snapshot ───────────────────────────────
    if (prevSameAccount) {
        const prevUsers = prev.users || {};
        for (const [pk, u] of Object.entries(nextUsers)) {
            const before = prevUsers[pk];
            const wasFollower = !!before?.flags?.is_follower;
            const isFollower  = !!u.flags.is_follower;

            if (!wasFollower && isFollower) {
                newEvents.push({ ts, type: EVENT_TYPES.FOLLOWER_GAINED, pk });
            }
            if (wasFollower && !isFollower) {
                // Newly lost — schedule status check unless we already classified them
                const prevStatus = before?.lifecycle?.status;
                if (prevStatus !== STATUS.DEACTIVATED && prevStatus !== STATUS.DELETED) {
                    pendingStatusChecks.push({ pk, username: u.username });
                }
                newEvents.push({ ts, type: EVENT_TYPES.FOLLOWER_LOST, pk });
            }

            // Pending → not pending and not follower → withdrawn request
            const wasPending = !!before?.flags?.is_pending;
            if (wasPending && !u.flags.is_pending && !u.flags.is_follower) {
                newEvents.push({ ts, type: EVENT_TYPES.REQUEST_WITHDRAWN, pk });
            }
        }
    }

    // Append-only event log, capped
    const allEvents = [...(prev?.events || []), ...newEvents].slice(-EVENT_CAP);

    // History: append the latest point, cap at 365 entries
    const history = [...(prev?.history || []), {
        ts,
        follower_count:  scraped.followers.length,
        following_count: scraped.following.length,
    }].slice(-HISTORY_CAP);

    const snapshot = {
        schema_version: SCHEMA_VERSION,
        snapshot_at:    ts,
        account: {
            pk:        scraped.userId,
            username:  scraped.currentUser?.username ?? null,
            full_name: scraped.currentUser?.full_name ?? null,
        },
        client: scraped.client || { name: "chrome_extension", version: "1.1.0" },
        users:    nextUsers,
        events:   allEvents,
        history,
        metadata: {
            last_full_sync_at:     ts,
            previous_snapshot_at:  prev?.snapshot_at || null,
            sync_count:           (prev?.metadata?.sync_count || 0) + 1,
        },
    };

    return { snapshot, events: newEvents, pendingStatusChecks };
}

/**
 * Apply deactivated-check results to a v3 snapshot.
 * Each pk in statusMap may be one of: active | deactivated | deleted | unknown.
 * `unknown` is treated as deactivated (matches old behavior).
 */
export function applyStatusChecks(snapshot, statusMap) {
    const ts = new Date().toISOString();
    const users = { ...snapshot.users };
    const events = [...(snapshot.events || [])];

    for (const [pk, status] of Object.entries(statusMap)) {
        const u = users[pk];
        if (!u) continue;
        const before = u.lifecycle.status;
        const after = status === "active" ? STATUS.ACTIVE
                    : status === "deleted" ? STATUS.DELETED
                    : status === "deactivated" ? STATUS.DEACTIVATED
                    : STATUS.DEACTIVATED; // unknown
        users[pk] = {
            ...u,
            lifecycle: { ...u.lifecycle, status: after, status_checked_at: ts },
        };
        if (before !== after) {
            events.push({ ts, type: EVENT_TYPES.STATUS_CHANGED, pk, from: before, to: after });
        }
    }
    return {
        ...snapshot,
        users,
        events: events.slice(-EVENT_CAP),
    };
}

// ── Helpers ──────────────────────────────────────────────────────────────────

function mergeEngagement(prevEng, incomingEng, ts) {
    if (!incomingEng) {
        return prevEng || { post_likes: 0, story_views: 0, story_likes: 0, score: 0, last_updated_at: null };
    }
    // Incoming engagement is always a snapshot (not delta) — replace fully.
    const norm = typeof incomingEng === "number"
        ? { post_likes: incomingEng, story_views: 0, story_likes: 0, score: incomingEng }
        : {
            post_likes:  incomingEng.post_likes ?? 0,
            story_views: incomingEng.story_views ?? 0,
            story_likes: incomingEng.story_likes ?? 0,
            score:       incomingEng.score ?? 0,
          };
    return { ...norm, last_updated_at: ts };
}
