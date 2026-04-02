import { useState, useMemo, useCallback } from "react";
import { CategoryList } from "./CategoryList.jsx";
import { EngagementTab } from "./EngagementTab.jsx";
import { RequestsTab } from "./RequestsTab.jsx";
import { Chart } from "./Chart.jsx";
import { useLanguage } from "../i18n/index.js";

export function Dashboard({ snapshot, modifiedTime, accounts = [], selectedId, onSwitchAccount, onDeleteAccount, onLogout, onRefresh }) {
    const [activeTab, setActiveTab] = useState("lost");
    const [confirmDelete, setConfirmDelete] = useState(null); // { id, username }
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

    const stats      = snapshot?.stats      || {};
    const history    = snapshot?.history    || [];
    const engagement = snapshot?.engagement || {};
    const fullMap    = snapshot?.full_map   || {};
    const requests   = snapshot?.requests   || {};

    // Reconstruct followers/following from full_map if arrays are absent (new snapshot format).
    // Old format had explicit arrays; new format uses is_follower/is_following flags in full_map.
    const followers  = snapshot?.followers  || Object.values(fullMap).filter(u => u.is_follower);
    const following  = snapshot?.following  || Object.values(fullMap).filter(u => u.is_following);

    // Enrich stat arrays with full_map data (profile_pic, is_verified)
    function enrich(pks) {
        if (!pks?.length) return [];
        if (typeof pks[0] === "object") return pks; // Already enriched
        return pks.map(pk => fullMap[pk] || { pk, username: pk, full_name: "" });
    }

    // Memoize tab counts to avoid re-iterating on every render
    const tabCounts = useMemo(() => {
        const counts = {};
        for (const key of ["lost", "not_back", "new", "fans", "deactivated"]) {
            counts[key] = (stats[key] || []).length;
        }
        const getScore = v => v && typeof v === "object" ? (v.score ?? 0) : (v ?? 0);
        counts.engagement = followers.filter(u => getScore(engagement[u.pk]) === 0).length;
        counts.requests = (requests.pending?.length || 0);
        return counts;
    }, [stats, followers, engagement, requests]);

    // ── Data Export ──────────────────────────────────────────────────────────
    const handleExport = useCallback(() => {
        const normalize = e => {
            if (!e) return { post_likes: 0, story_views: 0, story_likes: 0, score: 0 };
            if (typeof e === "number") return { post_likes: e, story_views: 0, story_likes: 0, score: e };
            return { post_likes: e.post_likes ?? 0, story_views: e.story_views ?? 0, story_likes: e.story_likes ?? 0, score: e.score ?? 0 };
        };

        const mapUsers = list => (list || []).map(u => ({
            username: u.username, full_name: u.full_name || "", is_verified: !!u.is_verified,
        }));

        const exportData = {
            exported_at: new Date().toISOString(),
            account: snapshot?.currentUser?.username || snapshot?.userId || "unknown",
            follower_count: followers.length,
            following_count: following.length,
            stats: {
                lost: mapUsers(stats.lost),
                not_back: mapUsers(stats.not_back),
                new: mapUsers(stats.new),
                fans: mapUsers(stats.fans),
                deactivated: mapUsers(stats.deactivated),
            },
            engagement: Object.entries(engagement)
                .map(([pk, e]) => {
                    const user = fullMap[pk];
                    const n = normalize(e);
                    return { username: user?.username || pk, ...n };
                })
                .filter(e => e.score > 0)
                .sort((a, b) => b.score - a.score),
            history,
        };

        const blob = new Blob([JSON.stringify(exportData, null, 2)], { type: "application/json" });
        const url = URL.createObjectURL(blob);
        const a = document.createElement("a");
        a.href = url;
        a.download = `ig_analytics_${exportData.account}_${new Date().toISOString().slice(0, 10)}.json`;
        a.click();
        URL.revokeObjectURL(url);
    }, [snapshot, followers, following, stats, engagement, fullMap, history]);

    const lastSync = modifiedTime
        ? new Date(modifiedTime).toLocaleString()
        : snapshot?.timestamp ? new Date(snapshot.timestamp).toLocaleString() : "—";

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

            {/* Summary Cards */}
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

            {/* Tab Nav */}
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

            {/* Content */}
            {activeTab === "engagement" ? (
                <EngagementTab followers={followers} engagement={engagement} />
            ) : activeTab === "requests" ? (
                <RequestsTab
                    pending={enrich(requests.pending || [])}
                    withdrawn={enrich(requests.withdrawn || [])}
                    fullMap={fullMap}
                />
            ) : (
                <CategoryList
                    users={enrich(stats[activeTab])}
                    badge={activeTab === "deactivated" ? "frozen" : null}
                    engagement={activeTab === "fans" ? engagement : null}
                />
            )}

            <footer className="dash-footer">
                {t("lastUpdated")}: {lastSync} &bull; {t("dataStoredDrive")}
            </footer>

            {/* Delete confirmation modal */}
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
