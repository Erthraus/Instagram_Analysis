import { useState } from "react";

export function UserCard({ user, badge, engagementCount }) {
    const [picFailed, setPicFailed] = useState(false);
    const initial = (user.username || "?")[0].toUpperCase();

    // Prefer base64-cached version (never expires) over raw CDN URL (expires 24-48h)
    const picSrc = user.profile_pic_b64 || user.profile_pic_url;

    return (
        <div className="user-card" onClick={() => window.open(`https://www.instagram.com/${user.username}/`, "_blank")}>
            <div className="user-avatar">
                {picSrc && !picFailed ? (
                    <img
                        src={picSrc}
                        alt={user.username}
                        referrerPolicy="no-referrer"
                        onError={() => setPicFailed(true)}
                    />
                ) : initial}
            </div>

            <div className="user-info">
                <span className="user-username">
                    @{user.username}
                    {user.is_verified && <span className="verified-badge" title="Verified">✓</span>}
                </span>
                {user.full_name && <span className="user-fullname">{user.full_name}</span>}
            </div>

            {engagementCount !== undefined && (
                <span className="engagement-count" title="Interactions on last 9 posts">
                    {engagementCount > 0 ? `♥ ${engagementCount}` : "👻"}
                </span>
            )}

            {badge && <span className={`user-badge badge-${badge}`}>{badge}</span>}

            <span className="user-open-icon">↗</span>
        </div>
    );
}
