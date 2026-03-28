import { useState } from "react";
import { useLanguage } from "../i18n/index.js";

const PAGE_SIZE = 50;

// engagement[pk] may be { post_likes, story_views, story_likes, score } (new)
// or { score, story_views, story_likes } (v4) or number (legacy)
function normalize(eng) {
    if (!eng) return { post_likes: 0, story_views: 0, story_likes: 0, score: 0 };
    if (typeof eng === "number") return { post_likes: eng, story_views: 0, story_likes: 0, score: eng };
    return {
        post_likes:  eng.post_likes  ?? 0,
        story_views: eng.story_views ?? 0,
        story_likes: eng.story_likes ?? 0,
        score:       eng.score       ?? 0,
    };
}

function EngagementBreakdown({ eng }) {
    const { t } = useLanguage();
    const { post_likes, story_views, story_likes, score } = normalize(eng);
    if (score === 0) return <span className="eng-no-score">👻 {t("noScore")}</span>;
    return (
        <div className="eng-breakdown">
            {post_likes  > 0 && <span className="eng-chip eng-chip-post"  title={t("postLikes")}>♥ {post_likes}</span>}
            {story_views > 0 && <span className="eng-chip eng-chip-view"  title={t("storyViews")}>👁 {story_views}</span>}
            {story_likes > 0 && <span className="eng-chip eng-chip-slike" title={t("storyLikes")}>★ {story_likes}</span>}
            <span className="eng-chip eng-chip-score" title={t("score")}>{score} {t("score")}</span>
        </div>
    );
}

function UserRow({ user, eng }) {
    const initial = (user.username || "?")[0].toUpperCase();
    const picSrc  = user.profile_pic_b64 || user.profile_pic_url;
    return (
        <div className="eng-user-row" onClick={() => window.open(`https://www.instagram.com/${user.username}/`, "_blank")}>
            <div className="eng-avatar">
                {picSrc
                    ? <img src={picSrc} referrerPolicy="no-referrer" alt={user.username} onError={e => { e.target.style.display = "none"; e.target.parentElement.textContent = initial; }} />
                    : initial}
            </div>
            <div className="eng-user-info">
                <div className="eng-username">
                    @{user.username}
                    {user.is_verified && <span className="verified-badge" title="Onaylı">✓</span>}
                </div>
                {user.full_name && <div className="eng-fullname">{user.full_name}</div>}
            </div>
            <EngagementBreakdown eng={eng} />
        </div>
    );
}

export function EngagementTab({ followers = [], engagement = {} }) {
    const [section, setSection] = useState("ghost");
    const [search, setSearch]   = useState("");
    const [filter, setFilter]   = useState("all");
    const [page, setPage]       = useState(0);
    const { t } = useLanguage();

    const getScore = u => normalize(engagement[u.pk]).score;

    const ghosts = followers.filter(u => getScore(u) === 0);
    const top    = followers
        .filter(u => getScore(u) > 0)
        .sort((a, b) => getScore(b) - getScore(a));

    const baseList = section === "ghost" ? ghosts : top;

    const filtered = baseList.filter(u => {
        const matchSearch = !search ||
            u.username?.toLowerCase().includes(search.toLowerCase()) ||
            u.full_name?.toLowerCase().includes(search.toLowerCase());
        const matchFilter =
            filter === "all"      ? true :
            filter === "verified" ? u.is_verified : !u.is_verified;
        return matchSearch && matchFilter;
    });

    const paginated = filtered.slice(0, (page + 1) * PAGE_SIZE);
    const hasMore   = paginated.length < filtered.length;

    if (Object.keys(engagement).length === 0) {
        return (
            <div className="engagement-empty">
                <div className="engagement-empty-icon">📊</div>
                <p>{t("noEngagementData")}</p>
                <p className="muted">{t("noEngagementHint")}</p>
            </div>
        );
    }

    return (
        <div className="category-list">
            {/* Section switcher */}
            <div className="engagement-sections">
                <button
                    className={`section-btn ${section === "ghost" ? "active ghost" : ""}`}
                    onClick={() => { setSection("ghost"); setPage(0); setSearch(""); }}
                >
                    👻 {t("ghostFollowers")}
                    <span className="tab-count">{ghosts.length}</span>
                </button>
                <button
                    className={`section-btn ${section === "top" ? "active top" : ""}`}
                    onClick={() => { setSection("top"); setPage(0); setSearch(""); }}
                >
                    ♥ {t("topEngagement")}
                    <span className="tab-count">{top.length}</span>
                </button>
                <span className="engagement-note">{t("engagementNote")}</span>
            </div>

            {/* Filters */}
            <div className="category-list-header">
                <span className="category-count">{filtered.length} {t("users")}</span>
                <div className="filter-group">
                    {["all", "verified", "unverified"].map(f => (
                        <button key={f} className={`filter-btn ${filter === f ? "active" : ""}`}
                            onClick={() => { setFilter(f); setPage(0); }}>
                            {f === "all" ? t("filterAll") : f === "verified" ? t("filterVerified") : t("filterUnverified")}
                        </button>
                    ))}
                </div>
                <input className="search-input" type="text" placeholder={t("searchPlaceholder")}
                    value={search} onChange={e => { setSearch(e.target.value); setPage(0); }} />
            </div>

            {/* List */}
            <div className="eng-list">
                {paginated.length === 0
                    ? <div className="empty-state">{t("noUsersInCategory")}</div>
                    : paginated.map(user => (
                        <UserRow key={user.pk || user.username} user={user} eng={engagement[user.pk]} />
                    ))
                }
            </div>

            {hasMore && (
                <button className="load-more-btn" onClick={() => setPage(p => p + 1)}>
                    {t("loadMore")} ({filtered.length - paginated.length} {t("remaining")})
                </button>
            )}
        </div>
    );
}
