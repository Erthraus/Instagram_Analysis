import { useState } from "react";
import { UserCard } from "./UserCard.jsx";
import { useLanguage } from "../i18n/index.js";

const PAGE_SIZE = 50;

export function RequestsTab({ pending = [], withdrawn = [] }) {
    const [section, setSection] = useState("pending");
    const [search, setSearch]   = useState("");
    const [page, setPage]       = useState(0);
    const { t } = useLanguage();

    const baseList = section === "pending" ? pending : withdrawn;

    const filtered = baseList.filter(u =>
        !search ||
        u.username?.toLowerCase().includes(search.toLowerCase()) ||
        u.full_name?.toLowerCase().includes(search.toLowerCase())
    );

    const paginated = filtered.slice(0, (page + 1) * PAGE_SIZE);
    const hasMore   = paginated.length < filtered.length;

    return (
        <div className="category-list">
            <div className="engagement-sections">
                <button
                    className={`section-btn ${section === "pending" ? "active" : ""}`}
                    style={section === "pending" ? { color: "#f783ac", borderBottomColor: "#f783ac" } : {}}
                    onClick={() => { setSection("pending"); setPage(0); setSearch(""); }}
                >
                    📩 {t("pendingRequests")}
                    <span className="tab-count">{pending.length}</span>
                </button>
                <button
                    className={`section-btn ${section === "withdrawn" ? "active" : ""}`}
                    style={section === "withdrawn" ? { color: "#868e96", borderBottomColor: "#868e96" } : {}}
                    onClick={() => { setSection("withdrawn"); setPage(0); setSearch(""); }}
                >
                    ↩ {t("withdrawnRequests")}
                    <span className="tab-count">{withdrawn.length}</span>
                </button>
                <span className="engagement-note">
                    {section === "pending" ? t("requestsNote") : t("withdrawnNote")}
                </span>
            </div>

            <div className="category-list-header">
                <span className="category-count">{filtered.length} {t("users")}</span>
                <input className="search-input" type="text" placeholder={t("searchPlaceholder")}
                    value={search} onChange={e => { setSearch(e.target.value); setPage(0); }} />
            </div>

            <div className="user-grid">
                {paginated.length === 0 ? (
                    <div className="empty-state">
                        {section === "pending" ? t("noRequests") : t("noWithdrawn")}
                    </div>
                ) : paginated.map(user => (
                    <UserCard
                        key={user.pk || user.username}
                        user={user}
                    />
                ))}
            </div>

            {hasMore && (
                <button className="load-more-btn" onClick={() => setPage(p => p + 1)}>
                    {t("loadMore")} ({filtered.length - paginated.length} {t("remaining")})
                </button>
            )}
        </div>
    );
}
