/**
 * analyzer.js — Pure diff functions. No browser/DOM dependencies.
 * Can be tested in Node.js: node -e "import('./utils/analyzer.js').then(m => console.log(m.computeDiff(...)))"
 */

/**
 * Compute the full diff between two snapshots.
 * Uses stable numeric `pk` IDs (not usernames, which can change).
 *
 * @param {Object|null} oldSnapshot - Previous snapshot (null if first run)
 * @param {Object} newSnapshot - Current snapshot
 * @returns {Object} diff result
 */
export function computeDiff(oldSnapshot, newSnapshot) {
    const newFollowers  = newSnapshot.followers  ?? [];
    const newFollowing  = newSnapshot.following  ?? [];

    const newFollowerIds  = new Set(newFollowers.map(u => u.pk));
    const newFollowingIds = new Set(newFollowing.map(u => u.pk));

    const not_back = newFollowing.filter(u => !newFollowerIds.has(u.pk));
    const fans     = newFollowers.filter(u => !newFollowingIds.has(u.pk));

    let lost = [];
    let newFollowersList = [];
    let deactivated = [];

    if (oldSnapshot && oldSnapshot.userId === newSnapshot.userId) {
        const oldFollowers  = oldSnapshot.followers  ?? [];
        const oldFollowing  = oldSnapshot.following  ?? [];
        const oldFollowerIds    = new Set(oldFollowers.map(u => u.pk));
        const oldDeactivatedIds = new Set((oldSnapshot.stats?.deactivated ?? []).map(u => u.pk));
        const oldTrueLostIds    = new Set((oldSnapshot.stats?.lost        ?? []).map(u => u.pk));

        // Build pk → user map for old snapshot (to preserve display data for lost users)
        const oldUserMap = {};
        for (const u of [...oldFollowers, ...oldFollowing]) {
            oldUserMap[u.pk] = u;
        }

        const rawLostIds = [...oldFollowerIds].filter(id => !newFollowerIds.has(id));
        newFollowersList = newFollowers.filter(u => !oldFollowerIds.has(u.pk));

        // Re-use previous classifications where possible
        for (const pk of rawLostIds) {
            const user = oldUserMap[pk] || { pk, username: String(pk), full_name: "" };
            if (oldDeactivatedIds.has(pk)) {
                deactivated.push(user); // Already known deactivated — keep without re-check
            } else if (oldTrueLostIds.has(pk)) {
                lost.push(user); // Already confirmed active unfollower
            } else {
                // Newly lost — must be checked (extension does this via background alarm)
                lost.push({ ...user, pendingStatusCheck: true });
            }
        }
    }

    return { lost, newFollowers: newFollowersList, not_back, fans, deactivated };
}

/**
 * Merge a deactivated-check result back into a diff.
 * Called after background alarm completes status checks.
 *
 * @param {Object} diff - Result of computeDiff
 * @param {Object} statusMap - { pk: 'active'|'deactivated'|'deleted'|'unknown' }
 * @returns {Object} updated diff
 */
export function applyStatusChecks(diff, statusMap) {
    const resolvedLost = [];
    const resolvedDeactivated = [...diff.deactivated];

    for (const user of diff.lost) {
        if (!user.pendingStatusCheck) {
            resolvedLost.push(user);
            continue;
        }
        const status = statusMap[user.pk] || "unknown";
        if (status === "active") {
            const { pendingStatusCheck: _, ...clean } = user;
            resolvedLost.push(clean);
        } else {
            const { pendingStatusCheck: _, ...clean } = user;
            resolvedDeactivated.push(clean);
        }
    }

    return { ...diff, lost: resolvedLost, deactivated: resolvedDeactivated };
}

/**
 * Build the full_map (pk → user info) from follower + following arrays.
 * Merges with previous map to preserve data for lost users.
 */
export function buildFullMap(followers, following, previousMap = {}) {
    const followerSet  = new Set(followers.map(u => u.pk));
    const followingSet = new Set(following.map(u => u.pk));
    const map = { ...previousMap };
    for (const u of [...followers, ...following]) {
        map[u.pk] = {
            pk:              u.pk,
            username:        u.username,
            full_name:       u.full_name,
            profile_pic_url: u.profile_pic_url || null,
            is_verified:     u.is_verified     || false,
            is_follower:     followerSet.has(u.pk),
            is_following:    followingSet.has(u.pk)
        };
    }
    // Clear flags for users who dropped out (they're in previousMap but not current lists)
    for (const pk of Object.keys(map)) {
        if (!followerSet.has(pk) && !followingSet.has(pk)) {
            map[pk].is_follower  = false;
            map[pk].is_following = false;
        }
    }
    return map;
}
