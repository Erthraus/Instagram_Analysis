import { useState } from "react";
import { UserCard } from "./UserCard.jsx";
import { useLanguage } from "../i18n/index.js";

const PAGE_SIZE = 50;

export function CategoryList({ users = [], badge, engagement }) {
    const [page, setPage]       = useState(0);
    const [search, setSearch]   = useState("");
    const [filter, setFilter]   = useState("all"); // "all" | "verified" | "unverified"
    const { t } = useLanguage();

    const filtered = users.filter(u => {
        const matchSearch = !search ||
            u.username?.toLowerCase().includes(search.toLowerCase()) ||
            u.full_name?.toLowerCase().includes(search.toLowerCase());
        const matchFilter =
            filter === "all"        ? true :
            filter === "verified"   ? u.is_verified :
            /* unverified */          !u.is_verified;
        return matchSearch && matchFilter;
    });

    const paginated = filtered.slice(0, (page + 1) * PAGE_SIZE);
    const hasMore   = paginated.length < filtered.length;

    return (
        <div className="category-list">
            <div className="category-list-header">
                <span className="category-count">{filtered.length} {t("users")}</span>

                <div className="filter-group">
                    {["all", "verified", "unverified"].map(f => (
                        <button
                            key={f}
                            className={`filter-btn ${filter === f ? "active" : ""}`}
                            onClick={() => { setFilter(f); setPage(0); }}
                        >
                            {f === "all" ? t("filterAll") : f === "verified" ? t("filterVerified") : t("filterUnverified")}
                        </button>
                    ))}
                </div>

                <input
                    className="search-input"
                    type="text"
                    placeholder={t("searchPlaceholder")}
                    value={search}
                    onChange={e => { setSearch(e.target.value); setPage(0); }}
                />
            </div>

            <div className="user-grid">
                {paginated.length === 0 ? (
                    <div className="empty-state">{t("noUsersInCategory")}</div>
                ) : (
                    paginated.map(user => (
                        <UserCard
                            key={user.pk || user.username}
                            user={user}
                            badge={badge}
                            engagementCount={engagement ? (engagement[user.pk]?.score ?? engagement[user.pk] ?? 0) : undefined}
                        />
                    ))
                )}
            </div>

            {hasMore && (
                <button className="load-more-btn" onClick={() => setPage(p => p + 1)}>
                    {t("loadMore")} ({filtered.length - paginated.length} {t("remaining")})
                </button>
            )}
        </div>
    );
}
