/**
 * Tests for chrome_extension/utils/analyzer.js (v3 snapshot builder)
 * Run: node --test tests/analyzer.test.js
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { buildSnapshot, applyStatusChecks, applyLegacyBaseline, sanitizeLegacyBaseline } from "../chrome_extension/utils/analyzer.js";
import { migrate, STATUS, EVENT_TYPES, SCHEMA_VERSION } from "../chrome_extension/utils/migrate.js";
import { deriveStats } from "../chrome_extension/utils/derive.js";

const legacyFixture = () => JSON.parse(readFileSync(new URL("./fixtures/legacy_v0_sample.json", import.meta.url), "utf8"));

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
    currentUser: { username: "me", full_name: "Me" },
    followers: [],
    following: [],
    engagement: {},
    requests: { pending: [] },
    ...overrides,
});

// ── buildSnapshot — first run ────────────────────────────────────────────────

describe("buildSnapshot (first run, prev=null)", () => {
    const scraped = scrape({
        followers: [user(1, "alice"), user(2, "bob")],
        following: [user(2, "bob"), user(3, "charlie")],
    });
    const { snapshot, events, pendingStatusChecks } = buildSnapshot(null, scraped);

    it("emits schema_version=3", () => {
        assert.equal(snapshot.schema_version, SCHEMA_VERSION);
    });

    it("records correct flags per user", () => {
        assert.equal(snapshot.users["1"].flags.is_follower, true);
        assert.equal(snapshot.users["1"].flags.is_following, false);
        assert.equal(snapshot.users["2"].flags.is_follower, true);
        assert.equal(snapshot.users["2"].flags.is_following, true);
        assert.equal(snapshot.users["3"].flags.is_follower, false);
        assert.equal(snapshot.users["3"].flags.is_following, true);
    });

    it("emits no events on first run", () => {
        assert.equal(events.length, 0);
        assert.equal(snapshot.events.length, 0);
    });

    it("schedules no status checks", () => {
        assert.equal(pendingStatusChecks.length, 0);
    });

    it("appends a history point", () => {
        assert.equal(snapshot.history.length, 1);
        assert.equal(snapshot.history[0].follower_count, 2);
        assert.equal(snapshot.history[0].following_count, 2);
    });

    it("sets metadata.sync_count = 1", () => {
        assert.equal(snapshot.metadata.sync_count, 1);
        assert.equal(snapshot.metadata.previous_snapshot_at, null);
    });
});

// ── buildSnapshot — diff (gain + loss) ───────────────────────────────────────

describe("buildSnapshot (diff)", () => {
    const prev = buildSnapshot(null, scrape({
        followers: [user(1), user(2)],
        following: [],
    })).snapshot;

    const next = scrape({
        timestamp: "2026-05-15T10:00:00.000Z",
        followers: [user(1), user(3)],   // 2 lost, 3 gained
        following: [],
    });
    const { snapshot, events, pendingStatusChecks } = buildSnapshot(prev, next);

    it("emits FOLLOWER_LOST for unfollower", () => {
        const e = events.find(e => e.pk === "2");
        assert.ok(e);
        assert.equal(e.type, EVENT_TYPES.FOLLOWER_LOST);
    });

    it("emits FOLLOWER_GAINED for new follower", () => {
        const e = events.find(e => e.pk === "3");
        assert.ok(e);
        assert.equal(e.type, EVENT_TYPES.FOLLOWER_GAINED);
    });

    it("schedules status check only for lost (active) users", () => {
        assert.equal(pendingStatusChecks.length, 1);
        assert.equal(pendingStatusChecks[0].pk, "2");
    });

    it("preserves first_seen_at for carried-over users", () => {
        assert.equal(
            snapshot.users["1"].lifecycle.first_seen_at,
            prev.users["1"].lifecycle.first_seen_at
        );
    });

    it("clears follower flag on the unfollower in next users map", () => {
        assert.equal(snapshot.users["2"].flags.is_follower, false);
    });

    it("bumps sync_count and stores previous_snapshot_at", () => {
        assert.equal(snapshot.metadata.sync_count, 2);
        assert.equal(snapshot.metadata.previous_snapshot_at, prev.snapshot_at);
    });
});

// ── account switch protection ────────────────────────────────────────────────

describe("buildSnapshot (different account)", () => {
    it("ignores previous snapshot from a different account", () => {
        const prev = buildSnapshot(null, scrape({
            userId: "account_a",
            followers: [user(1), user(2)],
        })).snapshot;
        const next = scrape({
            userId: "account_b",
            followers: [user(3)],
        });
        const { snapshot, events } = buildSnapshot(prev, next);

        // No users carried over from account_a
        assert.equal(Object.keys(snapshot.users).length, 1);
        assert.ok(snapshot.users["3"]);
        // No events because we treat it as first run for this account
        assert.equal(events.length, 0);
    });
});

// ── deactivated users do NOT trigger status check ────────────────────────────

describe("already-deactivated users", () => {
    it("does NOT schedule status check for a user marked deactivated", () => {
        const prev = buildSnapshot(null, scrape({
            followers: [user(1), user(2)],
        })).snapshot;
        // Manually mark user 2 as deactivated (as a previous run would have)
        prev.users["2"].lifecycle.status = STATUS.DEACTIVATED;

        // User 2 is no longer in the followers list (they're deactivated)
        const next = scrape({
            timestamp: "2026-05-15T10:00:00.000Z",
            followers: [user(1)],
        });
        const { pendingStatusChecks } = buildSnapshot(prev, next);
        assert.equal(pendingStatusChecks.length, 0);
    });
});

// ── pending request lifecycle ────────────────────────────────────────────────

describe("pending follow requests", () => {
    it("marks is_pending and emits REQUEST_WITHDRAWN when it disappears", () => {
        const prev = buildSnapshot(null, scrape({
            requests: { pending: [user(9, "target")] },
        })).snapshot;
        assert.equal(prev.users["9"].flags.is_pending, true);

        // Pending request disappears (withdrawn or accepted)
        const next = scrape({
            timestamp: "2026-05-15T10:00:00.000Z",
            requests: { pending: [] },
        });
        const { snapshot, events } = buildSnapshot(prev, next);
        assert.equal(snapshot.users["9"].flags.is_pending, false);
        const ev = events.find(e => e.pk === "9");
        assert.ok(ev);
        assert.equal(ev.type, EVENT_TYPES.REQUEST_WITHDRAWN);
    });
});

// ── applyStatusChecks ────────────────────────────────────────────────────────

describe("applyStatusChecks (v3)", () => {
    const snap = buildSnapshot(null, scrape({
        followers: [user(1), user(2), user(3)],
    })).snapshot;

    it("updates lifecycle.status and emits STATUS_CHANGED events", () => {
        const out = applyStatusChecks(snap, { "2": "deactivated", "3": "deleted" });
        assert.equal(out.users["2"].lifecycle.status, STATUS.DEACTIVATED);
        assert.equal(out.users["3"].lifecycle.status, STATUS.DELETED);

        const evs = out.events.filter(e => e.type === EVENT_TYPES.STATUS_CHANGED);
        assert.equal(evs.length, 2);
    });

    it("leaves the user untouched when the check failed (unknown)", () => {
        const out = applyStatusChecks(snap, { "1": "unknown" });
        assert.equal(out.users["1"].lifecycle.status, STATUS.ACTIVE);
        assert.equal(out.users["1"].lifecycle.status_checked_at, null);
        assert.equal(out.events.filter(e => e.type === EVENT_TYPES.STATUS_CHANGED).length, 0);
    });

    it("does not emit events when status is unchanged", () => {
        // First flip user to deactivated, then reapply same status
        const once = applyStatusChecks(snap, { "1": "deactivated" });
        const twice = applyStatusChecks(once, { "1": "deactivated" });
        const evCount = twice.events.filter(e => e.pk === "1" && e.type === EVENT_TYPES.STATUS_CHANGED).length;
        assert.equal(evCount, 1);
    });
});

// ── history cap ──────────────────────────────────────────────────────────────

describe("history capping", () => {
    it("keeps at most 365 history entries", () => {
        // Build 400 fake history points into a prev snapshot
        const longPrev = buildSnapshot(null, scrape({ followers: [user(1)] })).snapshot;
        longPrev.history = Array.from({ length: 400 }, (_, i) => ({
            ts: `2025-01-${String(i % 30 + 1).padStart(2, "0")}`,
            follower_count: i,
        }));
        const { snapshot } = buildSnapshot(longPrev, scrape({
            timestamp: "2026-05-15T10:00:00.000Z",
            followers: [user(1)],
        }));
        assert.equal(snapshot.history.length, 365);
    });
});

// ── engagement merge ─────────────────────────────────────────────────────────

describe("engagement merge", () => {
    it("replaces engagement with new sync value", () => {
        const prev = buildSnapshot(null, scrape({
            followers: [user(1)],
            engagement: { "1": { post_likes: 1, story_views: 0, story_likes: 0, score: 2 } },
        })).snapshot;
        const { snapshot } = buildSnapshot(prev, scrape({
            timestamp: "2026-05-15T10:00:00.000Z",
            followers: [user(1)],
            engagement: { "1": { post_likes: 10, story_views: 5, story_likes: 1, score: 28 } },
        }));
        assert.equal(snapshot.users["1"].engagement.score, 28);
        assert.equal(snapshot.users["1"].engagement.last_updated_at, "2026-05-15T10:00:00.000Z");
    });

    it("preserves previous engagement when not in incoming sync", () => {
        const prev = buildSnapshot(null, scrape({
            followers: [user(1)],
            engagement: { "1": { post_likes: 5, story_views: 0, story_likes: 0, score: 10 } },
        })).snapshot;
        const { snapshot } = buildSnapshot(prev, scrape({
            timestamp: "2026-05-15T10:00:00.000Z",
            followers: [user(1)],
            engagement: {},
        }));
        assert.equal(snapshot.users["1"].engagement.score, 10);
    });
});

// ── legacy baseline (retroactive diff) ───────────────────────────────────────

describe("sanitizeLegacyBaseline", () => {
    it("keeps only the fields the diff needs", () => {
        const out = sanitizeLegacyBaseline(legacyFixture());
        assert.deepEqual(out.followers_list, ["alice", "bob", "carol", "erin"]);
        assert.deepEqual(out.following_list, ["alice", "dave"]);
        assert.deepEqual(out.full_map.alice, { username: "alice", full_name: "Alice Example" });
        assert.equal(out.timestamp, "2026-02-05 01:19:16");
        assert.equal(out.stats, undefined);
    });

    it("drops entries that are not plausible usernames", () => {
        const raw = legacyFixture();
        raw.followers_list.push(42, "", "x".repeat(65));
        assert.deepEqual(sanitizeLegacyBaseline(raw).followers_list, ["alice", "bob", "carol", "erin"]);
    });

    it("rejects files that are not in the v0 format", () => {
        assert.throws(() => sanitizeLegacyBaseline({}));
        assert.throws(() => sanitizeLegacyBaseline(buildSnapshot(null, scrape()).snapshot));
        assert.throws(() => sanitizeLegacyBaseline({ ...legacyFixture(), followers_list: [] }));
    });
});

describe("applyLegacyBaseline", () => {
    // Baseline (2026-02-05) followers: alice, bob, carol, erin.
    // Today: alice and carol still follow, bob is only followed by me,
    // erin is gone entirely and frank is a new follower.
    const baseline = migrate(sanitizeLegacyBaseline(legacyFixture()));
    const today = buildSnapshot(null, scrape({
        followers: [user(1, "alice"), user(3, "Carol"), user(6, "frank")],
        following: [user(1, "alice"), user(2, "bob")],
    })).snapshot;
    const out = applyLegacyBaseline(today, baseline);
    const pksOf = (type) => out.snapshot.events.filter(e => e.type === type).map(e => e.pk).sort();

    it("emits follower_lost for baseline followers who no longer follow", () => {
        assert.equal(out.applied, true);
        assert.deepEqual(pksOf(EVENT_TYPES.FOLLOWER_LOST), ["2", "legacy:erin"]);
        assert.equal(out.snapshot.users["legacy:erin"].username, "erin");
        assert.equal(out.snapshot.users["legacy:erin"].flags.is_follower, false);
    });

    it("emits follower_gained for followers missing from the baseline", () => {
        assert.deepEqual(pksOf(EVENT_TYPES.FOLLOWER_GAINED), ["6"]);
    });

    it("matches usernames case-insensitively and backdates first_seen_at", () => {
        assert.equal(out.snapshot.users["3"].lifecycle.first_seen_at, baseline.snapshot_at);
        assert.equal(out.snapshot.users["6"].lifecycle.first_seen_at, today.snapshot_at);
    });

    it("marks events with the baseline date and records it in metadata", () => {
        assert.ok(out.snapshot.events.every(e => e.since === baseline.snapshot_at));
        assert.equal(out.snapshot.metadata.legacy_baseline_at, baseline.snapshot_at);
    });

    it("surfaces the differences through deriveStats", () => {
        const stats = deriveStats(out.snapshot);
        assert.deepEqual(stats.lost.map(u => u.username).sort(), ["bob", "erin"]);
        assert.deepEqual(stats.new.map(u => u.username), ["frank"]);
    });

    it("queues account status checks for the lost users", () => {
        assert.deepEqual(out.pendingStatusChecks, [
            { pk: "2", username: "bob" },
            { pk: "legacy:erin", username: "erin" },
        ]);
    });

    it("adds nothing when applied a second time", () => {
        const again = applyLegacyBaseline(out.snapshot, baseline);
        assert.equal(again.snapshot.events.length, out.snapshot.events.length);
        assert.deepEqual(again.pendingStatusChecks, []);
    });

    it("does not duplicate a loss the regular diff already recorded", () => {
        const prev = buildSnapshot(null, scrape({
            timestamp: "2026-04-01T10:00:00.000Z",
            followers: [user(1, "alice"), user(2, "bob"), user(3, "carol")],
        })).snapshot;
        const next = buildSnapshot(prev, scrape({ followers: [user(1, "alice"), user(3, "carol")] })).snapshot;
        const merged = applyLegacyBaseline(next, baseline).snapshot;
        assert.equal(merged.events.filter(e => e.type === EVENT_TYPES.FOLLOWER_LOST && e.pk === "2").length, 1);
    });

    it("ignores a baseline that belongs to a different account", () => {
        const other = buildSnapshot(null, scrape({ followers: [user(7, "zed"), user(8, "yan")] })).snapshot;
        const res = applyLegacyBaseline(other, baseline);
        assert.equal(res.applied, false);
        assert.equal(res.snapshot, other);
    });
});
