import { useState } from "react";
import { CategoryList } from "./CategoryList.jsx";
import { EngagementTab } from "./EngagementTab.jsx";
import { RequestsTab } from "./RequestsTab.jsx";
import { Chart } from "./Chart.jsx";
import { useLanguage } from "../i18n/index.js";

export function Dashboard({ snapshot, modifiedTime, accounts = [], selectedId, onSwitchAccount, onLogout, onRefresh }) {
    const [activeTab, setActiveTab] = useState("lost");
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
    const followers  = snapshot?.followers  || [];
    const fullMap    = snapshot?.full_map   || {};
    const requests   = snapshot?.requests   || {};

    // Enrich stat arrays with full_map data (profile_pic, is_verified)
    function enrich(pks) {
        if (!pks?.length) return [];
        if (typeof pks[0] === "object") return pks; // Already enriched
        return pks.map(pk => fullMap[pk] || { pk, username: pk, full_name: "" });
    }

    function getTabCount(key) {
        if (key === "engagement") {
            const getScore = v => v && typeof v === "object" ? (v.score ?? 0) : (v ?? 0);
            return followers.filter(u => getScore(engagement[u.pk]) === 0).length;
        }
        if (key === "requests") {
            return (requests.pending?.length || 0);
        }
        return (stats[key] || []).length;
    }

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
                        <div className="stat-count" style={{ color: tab.color }}>{getTabCount(tab.key)}</div>
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
                        <span className="tab-count">{getTabCount(tab.key)}</span>
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
        </div>
    );
}
