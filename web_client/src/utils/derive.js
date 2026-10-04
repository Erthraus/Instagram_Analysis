/**
 * derive.js — Compute UI categories from a v3 snapshot.
 *
 * In v3, only `users` (current state) and `events` (history) are persisted.
 * Categories like "lost", "new", "fans" are NOT stored — they are derived
 * by this module so there is exactly one source of truth.
 *
 * All functions are pure and work on the v3 schema.
 */

import { STATUS, EVENT_TYPES } from "./migrate.js";

// ── Stateful categories — read from users[pk].flags + lifecycle ──────────────

/** Users I follow who do not follow me back. */
export function deriveNotBack(snapshot) {
    const out = [];
    for (const [pk, u] of Object.entries(snapshot.users || {})) {
        if (u.flags?.is_following && !u.flags?.is_follower) {
            out.push(withPk(pk, u));
        }
    }
    return out;
}

/** Users who follow me but I don't follow back. */
export function deriveFans(snapshot) {
    const out = [];
    for (const [pk, u] of Object.entries(snapshot.users || {})) {
        if (u.flags?.is_follower && !u.flags?.is_following) {
            out.push(withPk(pk, u));
        }
    }
    return out;
}

/** Users whose account is deactivated or deleted. */
export function deriveDeactivated(snapshot) {
    const out = [];
    for (const [pk, u] of Object.entries(snapshot.users || {})) {
        const s = u.lifecycle?.status;
        if (s === STATUS.DEACTIVATED || s === STATUS.DELETED) {
            out.push(withPk(pk, u));
        }
    }
    return out;
}

/** Currently pending follow requests I've sent. */
export function derivePending(snapshot) {
    const out = [];
    for (const [pk, u] of Object.entries(snapshot.users || {})) {
        if (u.flags?.is_pending) out.push(withPk(pk, u));
    }
    return out;
}

// ── Event-driven categories — read from events log ───────────────────────────

/**
 * Users who unfollowed me since `sinceTs` (defaults to previous sync).
 * Returns deduplicated list — only the most recent FOLLOWER_LOST per pk.
 * Excludes users whose lifecycle.status is deactivated/deleted (those live
 * in deriveDeactivated instead).
 */
export function deriveLostSince(snapshot, sinceTs = null) {
    const since = sinceTs || snapshot.metadata?.previous_snapshot_at || "0";
    const seen = new Set();
    const out = [];
    for (let i = (snapshot.events || []).length - 1; i >= 0; i--) {
        const ev = snapshot.events[i];
        if (ev.type !== EVENT_TYPES.FOLLOWER_LOST) continue;
        if (ev.ts < since) break;
        if (seen.has(ev.pk)) continue;
        seen.add(ev.pk);
        const u = snapshot.users?.[ev.pk];
        if (!u) continue;
        const s = u.lifecycle?.status;
        if (s === STATUS.DEACTIVATED || s === STATUS.DELETED) continue;
        out.push(withPk(ev.pk, u));
    }
    return out;
}

/** Users who started following me since `sinceTs`. */
export function deriveNewSince(snapshot, sinceTs = null) {
    const since = sinceTs || snapshot.metadata?.previous_snapshot_at || "0";
    const seen = new Set();
    const out = [];
    for (let i = (snapshot.events || []).length - 1; i >= 0; i--) {
        const ev = snapshot.events[i];
        if (ev.type !== EVENT_TYPES.FOLLOWER_GAINED) continue;
        if (ev.ts < since) break;
        if (seen.has(ev.pk)) continue;
        seen.add(ev.pk);
        const u = snapshot.users?.[ev.pk];
        if (!u || !u.flags?.is_follower) continue; // user re-unfollowed: skip
        out.push(withPk(ev.pk, u));
    }
    return out;
}

// ── Engagement summary ───────────────────────────────────────────────────────

export function deriveEngagement(snapshot, weights = { post_likes: 2, story_views: 1, story_likes: 3 }) {
    const followers = [];
    for (const [pk, u] of Object.entries(snapshot.users || {})) {
        if (u.flags?.is_follower) followers.push(withPk(pk, u));
    }
    const engagers = followers
        .filter(u => (u.engagement?.score ?? 0) > 0)
        .sort((a, b) => (b.engagement.score ?? 0) - (a.engagement.score ?? 0));
    const ghostCount = followers.filter(u => (u.engagement?.score ?? 0) === 0).length;
    return { ghost_count: ghostCount, weights, engagers };
}

// ── Convenience: build legacy-shaped "stats" object for consumers ────────────

/**
 * Returns the same shape the old popup/web client used:
 * { lost, new, not_back, fans, deactivated, pending }
 * Each list contains plain user objects (with pk attached).
 *
 * `sinceTs` selects the cutoff for event-based categories (lost/new).
 * Defaults to metadata.previous_snapshot_at; if absent, returns everything.
 */
export function deriveStats(snapshot, sinceTs = null) {
    return {
        lost:        deriveLostSince(snapshot, sinceTs),
        new:         deriveNewSince(snapshot, sinceTs),
        not_back:    deriveNotBack(snapshot),
        fans:        deriveFans(snapshot),
        deactivated: deriveDeactivated(snapshot),
        pending:     derivePending(snapshot),
    };
}

// ── Helpers ──────────────────────────────────────────────────────────────────

function withPk(pk, u) {
    // Flatten flags/lifecycle/engagement so existing UI code keeps working.
    const eng = u.engagement || {};
    return {
        pk,
        username:        u.username,
        full_name:       u.full_name,
        profile_pic_url: u.profile_pic_url,
        is_verified:     u.is_verified,
        is_follower:     !!u.flags?.is_follower,
        is_following:    !!u.flags?.is_following,
        is_pending:      !!u.flags?.is_pending,
        status:          u.lifecycle?.status ?? STATUS.ACTIVE,
        // Flat engagement (legacy popup/web compatibility)
        post_likes:      eng.post_likes  ?? 0,
        story_views:     eng.story_views ?? 0,
        story_likes:     eng.story_likes ?? 0,
        score:           eng.score       ?? 0,
        // Nested (new code paths)
        engagement:      eng,
    };
}
