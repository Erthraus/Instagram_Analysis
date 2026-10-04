import { useState, useMemo, useCallback } from "react";
import { CategoryList } from "./CategoryList.jsx";
import { EngagementTab } from "./EngagementTab.jsx";
import { RequestsTab } from "./RequestsTab.jsx";
import { Chart } from "./Chart.jsx";
import { useLanguage } from "../i18n/index.js";
import { deriveStats, deriveEngagement } from "../utils/derive.js";

export function Dashboard({ snapshot, avatars = {}, modifiedTime, accounts = [], selectedId, onSwitchAccount, onDeleteAccount, onLogout, onRefresh }) {
    const [activeTab, setActiveTab] = useState("lost");
    const [confirmDelete, setConfirmDelete] = useState(null);
    const { t, lang, toggle } = useLanguage();

    const TABS = [
        { key: "lost",        label: t("tabLost"),        color: "#ff6b6b" },
        { key: "not_back",    label: t("tabNotBack"),     color: "#ffa94d" },
        { key: "new",         label: t("tabNew"),         color: "#69db7c" },
        { key: "fans",        label: t("tabFans"),        color: "#74c0fc" },
        { key: "deactivated", label: t("tabDeactivated"), color: "#a9e4ef" },
        { key: "engagement",  label: t("tabEngagement"),  color: "#da77f2" },
        { key: "requests",    label: t("tabRequests"),    color: "#f783ac" },
    ];

    // Derive stats + engagement directly from v3 snapshot — single source of truth.
    const stats = useMemo(() => snapshot ? deriveStats(snapshot) : {
        lost: [], not_back: [], new: [], fans: [], deactivated: [], pending: [],
    }, [snapshot]);

    const engagementSummary = useMemo(
        () => snapshot ? deriveEngagement(snapshot) : { ghost_count: 0, weights: {}, engagers: [] },
        [snapshot]
    );

    const history = snapshot?.history || [];

    // Attach avatar b64 to each user from the separate avatars file
    const withAvatar = useCallback((u) => ({
        ...u,
        profile_pic_b64: avatars[u.pk] || null,
    }), [avatars]);

    const followers = useMemo(() => {
        if (!snapshot?.users) return [];
        return Object.entries(snapshot.users)
            .filter(([, u]) => u.flags?.is_follower)
            .map(([pk, u]) => withAvatar({ pk, ...flatten(u) }));
    }, [snapshot, withAvatar]);

    // Engagement map: pk → engagement (for legacy EngagementTab API)
    const engagementMap = useMemo(() => {
        if (!snapshot?.users) return {};
        const map = {};
        for (const [pk, u] of Object.entries(snapshot.users)) {
            if (u.engagement?.score > 0 || u.flags?.is_follower) {
                map[pk] = u.engagement || { post_likes: 0, story_views: 0, story_likes: 0, score: 0 };
            }
        }
        return map;
    }, [snapshot]);

    const tabCounts = useMemo(() => ({
        lost:        stats.lost.length,
        not_back:    stats.not_back.length,
        new:         stats.new.length,
        fans:        stats.fans.length,
        deactivated: stats.deactivated.length,
        engagement:  engagementSummary.ghost_count,
        requests:    stats.pending.length,
    }), [stats, engagementSummary]);

    // ── Data Export ──────────────────────────────────────────────────────────
    const handleExport = useCallback(() => {
        const mapUsers = list => (list || []).map(u => ({
            username:    u.username,
            full_name:   u.full_name || "",
            is_verified: !!u.is_verified,
        }));

        const exportData = {
            schema_version: snapshot?.schema_version,
            exported_at: new Date().toISOString(),
            account: snapshot?.account?.username || snapshot?.account?.pk || "unknown",
            follower_count: followers.length,
            following_count: Object.values(snapshot?.users || {}).filter(u => u.flags?.is_following).length,
            stats: {
                lost:        mapUsers(stats.lost),
                not_back:    mapUsers(stats.not_back),
                new:         mapUsers(stats.new),
                fans:        mapUsers(stats.fans),
                deactivated: mapUsers(stats.deactivated),
            },
            engagement: engagementSummary.engagers.map(u => ({
                username:    u.username,
                post_likes:  u.engagement?.post_likes ?? 0,
                story_views: u.engagement?.story_views ?? 0,
                story_likes: u.engagement?.story_likes ?? 0,
                score:       u.engagement?.score ?? 0,
            })),
            history,
        };

        const blob = new Blob([JSON.stringify(exportData, null, 2)], { type: "application/json" });
        const url = URL.createObjectURL(blob);
        const a = document.createElement("a");
        a.href = url;
        a.download = `ig_analytics_${exportData.account}_${new Date().toISOString().slice(0, 10)}.json`;
        a.click();
        URL.revokeObjectURL(url);
    }, [snapshot, followers, stats, engagementSummary, history]);

    const lastSync = modifiedTime
        ? new Date(modifiedTime).toLocaleString()
        : snapshot?.snapshot_at ? new Date(snapshot.snapshot_at).toLocaleString() : "—";

    const activeUsers = (stats[activeTab] || []).map(withAvatar);
    const pendingUsers = stats.pending.map(withAvatar);

    return (
        <div className="dashboard">
            <header className="dash-header">
                <span className="logo">IG Analytics</span>
                <div className="dash-actions">
                    {accounts.length > 1 && (
                        <select
                            className="account-switcher"
                            value={selectedId || ""}
                            onChange={e => onSwitchAccount(e.target.value)}
                        >
                            {accounts.map(acc => (
                                <option key={acc.id} value={acc.id}>
                                    @{acc.username || acc.userId}
                                </option>
                            ))}
                        </select>
                    )}
                    {accounts.length > 1 && (
                        <button
                            className="btn-delete-account"
                            title={t("deleteAccountTip")}
                            onClick={() => {
                                const acc = accounts.find(a => a.id === selectedId);
                                setConfirmDelete({ id: selectedId, username: acc?.username || acc?.userId || "?" });
                            }}
                        >
                            {t("deleteAccount")}
                        </button>
                    )}
                    <button className="btn-export" onClick={handleExport} title={t("exportBtn")}>
                        {t("exportBtn")}
                    </button>
                    <button className="btn-lang" onClick={toggle}>{lang === "tr" ? "EN" : "TR"}</button>
                    <button className="btn-secondary" onClick={onRefresh}>{t("refresh")}</button>
                    <button className="btn-ghost" onClick={onLogout}>{t("logout")}</button>
                </div>
            </header>

            <div className="summary-strip">
                {TABS.map(tab => (
                    <div key={tab.key}
                        className={`stat-card ${activeTab === tab.key ? "active" : ""}`}
                        onClick={() => setActiveTab(tab.key)}
                        style={{ "--accent": tab.color }}>
                        <div className="stat-count" style={{ color: tab.color }}>{tabCounts[tab.key]}</div>
                        <div className="stat-label">{tab.label}</div>
                    </div>
                ))}
            </div>

            <Chart history={history} />

            <nav className="tab-nav">
                {TABS.map(tab => (
                    <button key={tab.key}
                        className={`tab-btn ${activeTab === tab.key ? "active" : ""}`}
                        style={activeTab === tab.key ? { borderBottomColor: tab.color, color: tab.color } : {}}
                        onClick={() => setActiveTab(tab.key)}>
                        {tab.label}
                        <span className="tab-count">{tabCounts[tab.key]}</span>
                    </button>
                ))}
            </nav>

            {activeTab === "engagement" ? (
                <EngagementTab followers={followers} engagement={engagementMap} />
            ) : activeTab === "requests" ? (
                <RequestsTab
                    pending={pendingUsers}
                    withdrawn={[]}
                    fullMap={snapshot?.users || {}}
                />
            ) : (
                <CategoryList
                    users={activeUsers}
                    badge={activeTab === "deactivated" ? "frozen" : null}
                    engagement={activeTab === "fans" ? engagementMap : null}
                />
            )}

            <footer className="dash-footer">
                {t("lastUpdated")}: {lastSync} &bull; {t("dataStoredDrive")}
            </footer>

            {confirmDelete && (
                <div className="modal-overlay" onClick={() => setConfirmDelete(null)}>
                    <div className="modal-card" onClick={e => e.stopPropagation()}>
                        <p className="modal-title">{t("deleteConfirmTitle")}</p>
                        <p className="modal-desc">
                            {t("deleteConfirmDesc").replace("{account}", `@${confirmDelete.username}`)}
                        </p>
                        <div className="modal-actions">
                            <button className="btn-secondary" onClick={() => setConfirmDelete(null)}>
                                {t("deleteCancel")}
                            </button>
                            <button
                                className="btn-danger"
                                onClick={() => {
                                    onDeleteAccount(confirmDelete.id);
                                    setConfirmDelete(null);
                                }}
                            >
                                {t("deleteConfirm")}
                            </button>
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
}

// Flatten a v3 user entry into the shape existing components expect.
function flatten(u) {
    return {
        username:        u.username,
        full_name:       u.full_name,
        profile_pic_url: u.profile_pic_url,
        is_verified:     u.is_verified,
        is_follower:     !!u.flags?.is_follower,
        is_following:    !!u.flags?.is_following,
        is_pending:      !!u.flags?.is_pending,
        status:          u.lifecycle?.status,
        engagement:      u.engagement,
    };
}
