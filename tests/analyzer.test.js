/**
 * Tests for chrome_extension/utils/analyzer.js
 * Run: node --test tests/analyzer.test.js
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { computeDiff, applyStatusChecks, buildFullMap } from "../chrome_extension/utils/analyzer.js";

// ── Helpers ──────────────────────────────────────────────────────────────────

const user = (pk, username) => ({
    pk: String(pk), username: username || `user_${pk}`, full_name: "", is_verified: false,
    profile_pic_url: null,
});

// ── buildFullMap ─────────────────────────────────────────────────────────────

describe("buildFullMap", () => {
    it("creates map with correct follower/following flags", () => {
        const followers = [user(1, "alice"), user(2, "bob")];
        const following = [user(2, "bob"), user(3, "charlie")];
        const map = buildFullMap(followers, following);

        assert.equal(map["1"].is_follower, true);
        assert.equal(map["1"].is_following, false);
        assert.equal(map["2"].is_follower, true);
        assert.equal(map["2"].is_following, true);
        assert.equal(map["3"].is_follower, false);
        assert.equal(map["3"].is_following, true);
    });

    it("preserves previous map entries with cleared flags", () => {
        const previousMap = {
            "99": { pk: "99", username: "old_user", full_name: "", is_follower: true, is_following: false }
        };
        const followers = [user(1, "alice")];
        const following = [];
        const map = buildFullMap(followers, following, previousMap);

        assert.equal(map["99"].is_follower, false);
        assert.equal(map["99"].is_following, false);
        assert.equal(map["99"].username, "old_user");
        assert.equal(map["1"].is_follower, true);
    });

    it("returns empty map for empty inputs", () => {
        const map = buildFullMap([], []);
        assert.deepEqual(map, {});
    });

    it("updates existing user data from previous map", () => {
        const previousMap = {
            "1": { pk: "1", username: "old_name", full_name: "Old", is_follower: true, is_following: false }
        };
        const followers = [{ pk: "1", username: "new_name", full_name: "New", is_verified: true, profile_pic_url: "pic.jpg" }];
        const map = buildFullMap(followers, [], previousMap);

        assert.equal(map["1"].username, "new_name");
        assert.equal(map["1"].full_name, "New");
        assert.equal(map["1"].is_verified, true);
    });
});

// ── computeDiff ──────────────────────────────────────────────────────────────

describe("computeDiff", () => {
    it("returns empty diff on first run (no old snapshot)", () => {
        const newSnap = { userId: "me", followers: [user(1), user(2)], following: [user(2)] };
        const diff = computeDiff(null, newSnap);

        assert.equal(diff.lost.length, 0);
        assert.equal(diff.newFollowers.length, 0);
        assert.equal(diff.not_back.length, 0);
        assert.equal(diff.deactivated.length, 0);
    });

    it("detects not_back (following but not follower)", () => {
        const newSnap = {
            userId: "me",
            followers: [user(1)],
            following: [user(1), user(2), user(3)]
        };
        const diff = computeDiff(null, newSnap);

        assert.equal(diff.not_back.length, 2);
        assert.deepEqual(diff.not_back.map(u => u.pk).sort(), ["2", "3"]);
    });

    it("detects fans (follower but not following)", () => {
        const newSnap = {
            userId: "me",
            followers: [user(1), user(2), user(3)],
            following: [user(1)]
        };
        const diff = computeDiff(null, newSnap);

        assert.equal(diff.fans.length, 2);
        assert.deepEqual(diff.fans.map(u => u.pk).sort(), ["2", "3"]);
    });

    it("detects lost followers with pendingStatusCheck", () => {
        const oldSnap = {
            userId: "me",
            followers: [user(1), user(2), user(3)],
            following: [],
            stats: { deactivated: [], lost: [] }
        };
        const newSnap = {
            userId: "me",
            followers: [user(1)],
            following: []
        };
        const diff = computeDiff(oldSnap, newSnap);

        assert.equal(diff.lost.length, 2);
        assert.ok(diff.lost.every(u => u.pendingStatusCheck === true));
    });

    it("detects new followers", () => {
        const oldSnap = {
            userId: "me",
            followers: [user(1)],
            following: [],
            stats: { deactivated: [], lost: [] }
        };
        const newSnap = {
            userId: "me",
            followers: [user(1), user(2), user(3)],
            following: []
        };
        const diff = computeDiff(oldSnap, newSnap);

        assert.equal(diff.newFollowers.length, 2);
        assert.deepEqual(diff.newFollowers.map(u => u.pk).sort(), ["2", "3"]);
    });

    it("preserves already-confirmed lost users without pendingStatusCheck", () => {
        const oldSnap = {
            userId: "me",
            followers: [user(1), user(2)],
            following: [],
            stats: { deactivated: [], lost: [user(2)] }
        };
        const newSnap = {
            userId: "me",
            followers: [user(1)],
            following: []
        };
        const diff = computeDiff(oldSnap, newSnap);

        const lostUser = diff.lost.find(u => u.pk === "2");
        assert.ok(lostUser);
        assert.equal(lostUser.pendingStatusCheck, undefined);
    });

    it("preserves already-deactivated users", () => {
        const oldSnap = {
            userId: "me",
            followers: [user(1), user(2)],
            following: [],
            stats: { deactivated: [user(2)], lost: [] }
        };
        const newSnap = {
            userId: "me",
            followers: [user(1)],
            following: []
        };
        const diff = computeDiff(oldSnap, newSnap);

        assert.equal(diff.deactivated.length, 1);
        assert.equal(diff.deactivated[0].pk, "2");
        assert.equal(diff.lost.length, 0);
    });

    it("returns empty diff when userId changes (different account)", () => {
        const oldSnap = {
            userId: "account_a",
            followers: [user(1), user(2)],
            following: [],
            stats: {}
        };
        const newSnap = {
            userId: "account_b",
            followers: [user(3)],
            following: []
        };
        const diff = computeDiff(oldSnap, newSnap);

        assert.equal(diff.lost.length, 0);
        assert.equal(diff.newFollowers.length, 0);
    });
});

// ── applyStatusChecks ────────────────────────────────────────────────────────

describe("applyStatusChecks", () => {
    it("moves deactivated/deleted users from lost to deactivated", () => {
        const diff = {
            lost: [
                { pk: "1", username: "active_user", pendingStatusCheck: true },
                { pk: "2", username: "deact_user", pendingStatusCheck: true },
                { pk: "3", username: "deleted_user", pendingStatusCheck: true },
            ],
            deactivated: [],
            not_back: [],
            newFollowers: [],
            fans: [],
        };
        const statusMap = {
            "1": "active",
            "2": "deactivated",
            "3": "deleted",
        };
        const result = applyStatusChecks(diff, statusMap);

        assert.equal(result.lost.length, 1);
        assert.equal(result.lost[0].pk, "1");
        assert.equal(result.lost[0].pendingStatusCheck, undefined);

        assert.equal(result.deactivated.length, 2);
        assert.deepEqual(result.deactivated.map(u => u.pk).sort(), ["2", "3"]);
    });

    it("keeps non-pending users in lost unchanged", () => {
        const diff = {
            lost: [
                { pk: "1", username: "confirmed_lost" },
                { pk: "2", username: "pending", pendingStatusCheck: true },
            ],
            deactivated: [],
            not_back: [],
            newFollowers: [],
            fans: [],
        };
        const statusMap = { "2": "active" };
        const result = applyStatusChecks(diff, statusMap);

        assert.equal(result.lost.length, 2);
        assert.equal(result.lost[0].pk, "1");
    });

    it("treats unknown status as deactivated", () => {
        const diff = {
            lost: [{ pk: "1", username: "mystery", pendingStatusCheck: true }],
            deactivated: [],
            not_back: [],
            newFollowers: [],
            fans: [],
        };
        const statusMap = { "1": "unknown" };
        const result = applyStatusChecks(diff, statusMap);

        assert.equal(result.lost.length, 0);
        assert.equal(result.deactivated.length, 1);
    });

    it("preserves existing deactivated users", () => {
        const diff = {
            lost: [{ pk: "2", username: "new_deact", pendingStatusCheck: true }],
            deactivated: [{ pk: "1", username: "old_deact" }],
            not_back: [],
            newFollowers: [],
            fans: [],
        };
        const statusMap = { "2": "deactivated" };
        const result = applyStatusChecks(diff, statusMap);

        assert.equal(result.deactivated.length, 2);
        assert.deepEqual(result.deactivated.map(u => u.pk).sort(), ["1", "2"]);
    });
});
