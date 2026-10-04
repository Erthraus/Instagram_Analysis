/**
 * Tests for chrome_extension/utils/migrate.js
 * Run: node --test tests/migrate.test.js
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

import {
    migrate,
    detectVersion,
    reconcileLegacyUsernames,
    SCHEMA_VERSION,
    STATUS,
    EVENT_TYPES,
} from "../chrome_extension/utils/migrate.js";

const __dirname = dirname(fileURLToPath(import.meta.url));

// ── detectVersion ────────────────────────────────────────────────────────────

describe("detectVersion", () => {
    it("returns -1 for null/invalid", () => {
        assert.equal(detectVersion(null), -1);
        assert.equal(detectVersion(undefined), -1);
        assert.equal(detectVersion("string"), -1);
        assert.equal(detectVersion({}), -1);
    });

    it("trusts explicit schema_version", () => {
        assert.equal(detectVersion({ schema_version: 3 }), 3);
        assert.equal(detectVersion({ schema_version: 42 }), 42);
    });

    it("detects v0 (username-keyed, no pk)", () => {
        const s = { full_map: { alice: { username: "alice", full_name: "A", pic: "..." } } };
        assert.equal(detectVersion(s), 0);
    });

    it("detects v1 (pk-keyed full_map + followers/following arrays)", () => {
        const s = {
            full_map: { "1": { pk: "1", username: "alice" } },
            followers: [{ pk: "1" }],
            following: [],
        };
        assert.equal(detectVersion(s), 1);
    });

    it("detects v2 (pk-keyed full_map, no arrays, flags inside)", () => {
        const s = {
            full_map: { "1": { pk: "1", username: "alice", is_follower: true } },
        };
        assert.equal(detectVersion(s), 2);
    });
});

// ── migrate() — top-level invariants ─────────────────────────────────────────

describe("migrate()", () => {
    it("returns null on null/undefined input", () => {
        assert.equal(migrate(null), null);
        assert.equal(migrate(undefined), null);
    });

    it("is a no-op on v3 snapshots", () => {
        const s = { schema_version: SCHEMA_VERSION, users: {}, events: [], history: [] };
        assert.strictEqual(migrate(s), s);
    });

    it("throws on unrecognized input", () => {
        assert.throws(() => migrate({ foo: "bar" }), /unrecognized snapshot schema/);
    });
});

// ── v2 → v3 ──────────────────────────────────────────────────────────────────

describe("v2 → v3", () => {
    const v2Snapshot = {
        timestamp: "2026-05-14T10:00:00.000Z",
        userId: "12345",
        currentUser: { username: "me", full_name: "Me" },
        full_map: {
            "1": { pk: "1", username: "alice", full_name: "Alice", is_verified: true,
                   profile_pic_url: "http://x/a.jpg", is_follower: true, is_following: true },
            "2": { pk: "2", username: "bob", is_follower: true, is_following: false },
            "3": { pk: "3", username: "charlie", is_follower: false, is_following: true },
        },
        engagement: {
            "1": { post_likes: 5, story_views: 10, story_likes: 2, score: 26 },
            "2": 3, // legacy numeric form
        },
        history: [{ timestamp: "2026-05-13", follower_count: 100 }],
        requests: {
            pending:   [{ pk: "4", username: "dan" }],
            withdrawn: [{ pk: "5", username: "eve" }],
        },
        stats: {
            lost:        [{ pk: "6", username: "frank" }],
            new:         [{ pk: "7", username: "grace" }],
            deactivated: [{ pk: "8", username: "henry" }],
            not_back:    [{ pk: "3", username: "charlie" }],
            fans:        [{ pk: "2", username: "bob" }],
        },
    };

    const v3 = migrate(v2Snapshot);

    it("sets schema_version = 3", () => {
        assert.equal(v3.schema_version, SCHEMA_VERSION);
    });

    it("preserves account info", () => {
        assert.equal(v3.account.pk, "12345");
        assert.equal(v3.account.username, "me");
    });

    it("converts full_map entries to v3 users with flags", () => {
        assert.equal(v3.users["1"].flags.is_follower, true);
        assert.equal(v3.users["1"].flags.is_following, true);
        assert.equal(v3.users["1"].is_verified, true);
        assert.equal(v3.users["1"].profile_pic_url, "http://x/a.jpg");
    });

    it("normalizes engagement (including legacy numeric form)", () => {
        assert.equal(v3.users["1"].engagement.post_likes, 5);
        assert.equal(v3.users["1"].engagement.score, 26);
        // legacy numeric → post_likes = score = number
        assert.equal(v3.users["2"].engagement.post_likes, 3);
        assert.equal(v3.users["2"].engagement.score, 3);
    });

    it("flags pending requests", () => {
        assert.equal(v3.users["4"].flags.is_pending, true);
    });

    it("emits withdrawn-request events", () => {
        const ev = v3.events.find(e => e.pk === "5");
        assert.ok(ev);
        assert.equal(ev.type, EVENT_TYPES.REQUEST_WITHDRAWN);
    });

    it("marks deactivated users with lifecycle.status and event", () => {
        assert.equal(v3.users["8"].lifecycle.status, STATUS.DEACTIVATED);
        const ev = v3.events.find(e => e.pk === "8" && e.type === EVENT_TYPES.STATUS_CHANGED);
        assert.ok(ev);
        assert.equal(ev.to, STATUS.DEACTIVATED);
    });

    it("creates entries + events for lost/new users not in full_map", () => {
        assert.ok(v3.users["6"]);  // lost
        assert.equal(v3.users["6"].flags.is_follower, false);
        assert.ok(v3.events.find(e => e.pk === "6" && e.type === EVENT_TYPES.FOLLOWER_LOST));

        assert.ok(v3.users["7"]);  // new
        assert.ok(v3.events.find(e => e.pk === "7" && e.type === EVENT_TYPES.FOLLOWER_GAINED));
    });

    it("preserves history", () => {
        assert.equal(v3.history.length, 1);
    });
});

// ── v1 → v3 ──────────────────────────────────────────────────────────────────

describe("v1 → v3", () => {
    it("derives flags from explicit followers/following arrays", () => {
        const v1 = {
            timestamp: "2026-05-01",
            userId: "999",
            full_map: {
                "1": { pk: "1", username: "alice" },
                "2": { pk: "2", username: "bob" },
            },
            followers: [{ pk: "1" }],
            following: [{ pk: "2" }],
            stats: {},
        };
        const v3 = migrate(v1);
        assert.equal(v3.users["1"].flags.is_follower, true);
        assert.equal(v3.users["1"].flags.is_following, false);
        assert.equal(v3.users["2"].flags.is_follower, false);
        assert.equal(v3.users["2"].flags.is_following, true);
    });

    it("backfills users present in arrays but missing from full_map", () => {
        const v1 = {
            timestamp: "2026-05-01",
            full_map: {},
            followers: [{ pk: "1", username: "alice" }],
            following: [],
        };
        const v3 = migrate(v1);
        assert.ok(v3.users["1"]);
        assert.equal(v3.users["1"].flags.is_follower, true);
    });
});

// ── v0 → v3 (synthetic fixture in the legacy Python desktop format) ──────────

describe("v0 → v3 (legacy_v0_sample.json fixture)", () => {
    const legacy = JSON.parse(readFileSync(
        resolve(__dirname, "fixtures", "legacy_v0_sample.json"),
        "utf8"
    ));

    it("detects as v0", () => {
        assert.equal(detectVersion(legacy), 0);
    });

    const v3 = migrate(legacy);

    it("produces v3 schema", () => {
        assert.equal(v3.schema_version, SCHEMA_VERSION);
        assert.equal(v3.metadata.legacy_v0, true);
    });

    it("creates legacy:<username>-keyed user entries", () => {
        const keys = Object.keys(v3.users);
        assert.ok(keys.length > 0);
        assert.ok(keys.every(k => k.startsWith("legacy:")));
    });

    it("maps follower/following sets from username arrays", () => {
        // Pick a username present in followers_list
        const u = legacy.followers_list[0];
        assert.equal(v3.users[`legacy:${u}`].flags.is_follower, true);
    });

    it("drops expired profile_pic URLs (legacy `pic` field)", () => {
        const u = legacy.followers_list[0];
        assert.equal(v3.users[`legacy:${u}`].profile_pic_url, null);
    });
});

// ── reconcileLegacyUsernames ─────────────────────────────────────────────────

describe("reconcileLegacyUsernames", () => {
    it("folds legacy:<username> into matching real pk and keeps oldest first_seen_at", () => {
        const users = {
            "legacy:alice": {
                username: "alice", full_name: "",
                profile_pic_url: null, is_verified: false,
                flags: { is_follower: true, is_following: false, is_pending: false, is_requester: false },
                lifecycle: { first_seen_at: "2026-01-01T00:00:00.000Z", last_seen_at: "2026-01-01T00:00:00.000Z", status: STATUS.ACTIVE, status_checked_at: null },
                engagement: { post_likes: 0, story_views: 0, story_likes: 0, score: 0, last_updated_at: null },
            },
            "777": {
                username: "alice", full_name: "Alice",
                profile_pic_url: "http://x/a.jpg", is_verified: false,
                flags: { is_follower: true, is_following: true, is_pending: false, is_requester: false },
                lifecycle: { first_seen_at: "2026-05-14T00:00:00.000Z", last_seen_at: "2026-05-14T00:00:00.000Z", status: STATUS.ACTIVE, status_checked_at: null },
                engagement: { post_likes: 0, story_views: 0, story_likes: 0, score: 0, last_updated_at: null },
            },
        };
        const out = reconcileLegacyUsernames(users);
        assert.equal(out["legacy:alice"], undefined);  // dropped
        assert.equal(out["777"].lifecycle.first_seen_at, "2026-01-01T00:00:00.000Z");
        assert.equal(out["777"].profile_pic_url, "http://x/a.jpg"); // real entry wins
    });

    it("keeps legacy entries with no real match", () => {
        const users = {
            "legacy:ghost": {
                username: "ghost",
                flags: { is_follower: false, is_following: false, is_pending: false, is_requester: false },
                lifecycle: { first_seen_at: "2026-01-01", last_seen_at: "2026-01-01", status: STATUS.ACTIVE, status_checked_at: null },
                engagement: { post_likes: 0, story_views: 0, story_likes: 0, score: 0, last_updated_at: null },
            },
        };
        const out = reconcileLegacyUsernames(users);
        assert.ok(out["legacy:ghost"]);
    });
});
