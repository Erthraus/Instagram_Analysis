/**
 * Tests for chrome_extension/utils/derive.js
 * Run: node --test tests/derive.test.js
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { buildSnapshot } from "../chrome_extension/utils/analyzer.js";
import {
    deriveStats, deriveNotBack, deriveFans, deriveLostSince, deriveNewSince,
    deriveDeactivated, deriveEngagement, derivePending,
} from "../chrome_extension/utils/derive.js";
import { STATUS } from "../chrome_extension/utils/migrate.js";

const user = (pk, username, extras = {}) => ({
    pk: String(pk),
    username: username || `user_${pk}`,
    full_name: "",
    is_verified: false,
    profile_pic_url: null,
    ...extras,
});

const scrape = (overrides = {}) => ({
    timestamp: "2026-05-14T10:00:00.000Z",
    userId: "me",
    currentUser: { username: "me" },
    followers: [], following: [], engagement: {}, requests: { pending: [] },
    ...overrides,
});

// ── Stateful categories ──────────────────────────────────────────────────────

describe("deriveNotBack / deriveFans", () => {
    const snap = buildSnapshot(null, scrape({
        followers: [user(1), user(2)],           // I'm followed by 1, 2
        following: [user(2), user(3)],           // I follow 2, 3
    })).snapshot;

    it("returns users I follow who don't follow back", () => {
        const out = deriveNotBack(snap);
        assert.equal(out.length, 1);
        assert.equal(out[0].pk, "3");
    });

    it("returns users who follow me but I don't follow back", () => {
        const out = deriveFans(snap);
        assert.equal(out.length, 1);
        assert.equal(out[0].pk, "1");
    });
});

// ── Deactivated ──────────────────────────────────────────────────────────────

describe("deriveDeactivated", () => {
    it("returns users with deactivated/deleted status", () => {
        const snap = buildSnapshot(null, scrape({
            followers: [user(1), user(2)],
        })).snapshot;
        snap.users["1"].lifecycle.status = STATUS.DEACTIVATED;
        snap.users["2"].lifecycle.status = STATUS.DELETED;
        const out = deriveDeactivated(snap);
        assert.equal(out.length, 2);
    });
});

// ── Pending ──────────────────────────────────────────────────────────────────

describe("derivePending", () => {
    it("returns users with is_pending flag", () => {
        const snap = buildSnapshot(null, scrape({
            requests: { pending: [user(7, "target")] },
        })).snapshot;
        const out = derivePending(snap);
        assert.equal(out.length, 1);
        assert.equal(out[0].pk, "7");
    });
});

// ── Event-driven categories ──────────────────────────────────────────────────

describe("deriveLostSince / deriveNewSince", () => {
    // T1: have 1, 2
    const t1 = buildSnapshot(null, scrape({ followers: [user(1), user(2)] })).snapshot;
    // T2: lose 2, gain 3
    const { snapshot: t2 } = buildSnapshot(t1, scrape({
        timestamp: "2026-05-15T10:00:00.000Z",
        followers: [user(1), user(3)],
    }));

    it("lists lost users since previous snapshot", () => {
        const out = deriveLostSince(t2);
        assert.equal(out.length, 1);
        assert.equal(out[0].pk, "2");
    });

    it("lists new followers since previous snapshot", () => {
        const out = deriveNewSince(t2);
        assert.equal(out.length, 1);
        assert.equal(out[0].pk, "3");
    });

    it("excludes deactivated users from lost", () => {
        t2.users["2"].lifecycle.status = STATUS.DEACTIVATED;
        assert.equal(deriveLostSince(t2).length, 0);
        // But still shows up in deactivated
        assert.equal(deriveDeactivated(t2).length, 1);
    });
});

// ── deriveStats convenience ──────────────────────────────────────────────────

describe("deriveStats", () => {
    const t1 = buildSnapshot(null, scrape({
        followers: [user(1), user(2)],
        following: [user(3)],
    })).snapshot;
    const { snapshot: t2 } = buildSnapshot(t1, scrape({
        timestamp: "2026-05-15T10:00:00.000Z",
        followers: [user(1), user(4)],
        following: [user(3)],
    }));

    it("returns the full legacy-shaped stats object", () => {
        const stats = deriveStats(t2);
        assert.ok(stats.lost.find(u => u.pk === "2"));
        assert.ok(stats.new.find(u => u.pk === "4"));
        assert.ok(stats.not_back.find(u => u.pk === "3"));
        assert.ok(stats.fans.find(u => u.pk === "1"));
        assert.equal(stats.deactivated.length, 0);
        assert.equal(stats.pending.length, 0);
    });
});

// ── Engagement ───────────────────────────────────────────────────────────────

describe("deriveEngagement", () => {
    it("ranks engagers by score and counts ghosts", () => {
        const snap = buildSnapshot(null, scrape({
            followers: [user(1), user(2), user(3)],
            engagement: {
                "1": { post_likes: 0, story_views: 0, story_likes: 0, score: 0 },
                "2": { post_likes: 5, story_views: 1, story_likes: 0, score: 11 },
                "3": { post_likes: 10, story_views: 0, story_likes: 2, score: 26 },
            },
        })).snapshot;
        const eng = deriveEngagement(snap);
        assert.equal(eng.ghost_count, 1);
        assert.equal(eng.engagers.length, 2);
        assert.equal(eng.engagers[0].pk, "3"); // highest score first
    });
});
