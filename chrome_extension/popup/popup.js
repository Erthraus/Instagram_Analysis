// ── i18n ──────────────────────────────────────────────────────────────────────

const I18N = {
    tr: {
        syncStart:       "Instagram'a bağlanılıyor...",
        forceStart:      "⚡ Zorla sync başlatılıyor...",
        fetchFollowers:  "Takipçiler çekiliyor...",
        noData:          "Henüz veri yok. Sync'e bas.",
        syncFail:        "Sync başarısız.",
        noUsers:         "Bu kategoride kullanıcı yok.",
        engEmpty:        "Etkileşim verisi yok. Bir sonraki sync'te analiz edilecek.",
        ghostLabel:      "hayalet takipçi",
        topTitle:        "♥ En Çok Etkileşim",
        frozenBadge:     "Donmuş",
        lastSyncNever:   "Son sync: hiç",
        lastSyncPrefix:  "Son sync:",
        forceTip:        "Cooldown'ı atla (geliştirici)",
        syncTimeout:     "Senkronizasyon zaman aşımına uğradı. Tekrar deneyin.",
        // card labels
        cardLost:        "Takipten Çıkan",
        cardNotBack:     "Geri Takip Etmeyen",
        cardNew:         "Yeni Takipçi",
        cardFans:        "Karşılıksız",
        cardFrozen:      "Dondurulmuş",
        cardGhost:       "Hayalet",
        // tab labels
        tabLost:         "Çıkanlar",
        tabNotBack:      "Geri Yok",
        tabNew:          "Yeni",
        tabFans:         "Karşılıksız",
        tabFrozen:       "Donmuş",
        tabEng:          "Etkileşim",
        // auth message (HTML — this is static, not user-provided, so safe)
        authMsg:         "<strong>instagram.com</strong>'a giriş yap, sonra Sync'e bas.",
        // progress steps
        pAuth:           "Kimlik doğrulanıyor...",
        pFollowers:      "Takipçiler çekiliyor...",
        pFollowersCached:"Takipçiler önbellekten yüklendi.",
        pFollowersDone:  "Takipçiler tamam.",
        pPause:          "Kısa bekleme...",
        pFollowing:      "Takip edilenler çekiliyor...",
        pFollowingCached:"Takip edilenler önbellekten.",
        pFollowingDone:  "Takip edilenler tamam.",
        pEngStart:       "Etkileşim analiz ediliyor...",
        pEng:            "Analiz ediliyor...",
        pEngCached:      "Etkileşim önbellekten.",
        pRateLimit:      "Hız sınırı, bekleniyor...",
        pFetching:       "Çekiliyor...",
        pRequests:       "Takip istekleri alınıyor...",
        pSaving:         "İşleniyor...",
    },
    en: {
        syncStart:       "Connecting to Instagram...",
        forceStart:      "⚡ Force sync starting...",
        fetchFollowers:  "Fetching followers...",
        noData:          "No data yet. Press Sync.",
        syncFail:        "Sync failed.",
        noUsers:         "No users in this category.",
        engEmpty:        "No engagement data. Will be analyzed on next sync.",
        ghostLabel:      "ghost followers",
        topTitle:        "♥ Top Engagement",
        frozenBadge:     "Frozen",
        lastSyncNever:   "Last sync: never",
        lastSyncPrefix:  "Last sync:",
        forceTip:        "Bypass cooldown (dev)",
        syncTimeout:     "Sync timed out. Please try again.",
        // card labels
        cardLost:        "Unfollowers",
        cardNotBack:     "Not Following Back",
        cardNew:         "New Followers",
        cardFans:        "One-Sided",
        cardFrozen:      "Frozen",
        cardGhost:       "Ghosts",
        // tab labels
        tabLost:         "Lost",
        tabNotBack:      "No Back",
        tabNew:          "New",
        tabFans:         "One-Sided",
        tabFrozen:       "Frozen",
        tabEng:          "Engagement",
        // auth message
        authMsg:         "Log in to <strong>instagram.com</strong>, then press Sync.",
        // progress steps
        pAuth:           "Authenticating...",
        pFollowers:      "Fetching followers...",
        pFollowersCached:"Followers loaded from cache.",
        pFollowersDone:  "Followers done.",
        pPause:          "Brief pause...",
        pFollowing:      "Fetching following list...",
        pFollowingCached:"Following from cache.",
        pFollowingDone:  "Following done.",
        pEngStart:       "Analyzing engagement...",
        pEng:            "Analyzing...",
        pEngCached:      "Engagement from cache.",
        pRateLimit:      "Rate limited, waiting...",
        pFetching:       "Fetching...",
        pRequests:       "Fetching follow requests...",
        pSaving:         "Processing...",
    }
};

let currentLang = "tr";
function t(key) { return I18N[currentLang]?.[key] ?? I18N.tr[key] ?? key; }

function applyLanguage() {
    document.getElementById("btn-lang").textContent = currentLang === "tr" ? "EN" : "TR";
    document.documentElement.lang = currentLang;

    document.getElementById("label-lost").textContent        = t("cardLost");
    document.getElementById("label-not_back").textContent    = t("cardNotBack");
    document.getElementById("label-new").textContent         = t("cardNew");
    document.getElementById("label-fans").textContent        = t("cardFans");
    document.getElementById("label-deactivated").textContent = t("cardFrozen");
    document.getElementById("label-ghost").textContent       = t("cardGhost");

    document.getElementById("tab-lost").textContent        = t("tabLost");
    document.getElementById("tab-not_back").textContent    = t("tabNotBack");
    document.getElementById("tab-new").textContent         = t("tabNew");
    document.getElementById("tab-fans").textContent        = t("tabFans");
    document.getElementById("tab-deactivated").textContent = t("tabFrozen");
    document.getElementById("tab-engagement").textContent  = t("tabEng");

    // authMsg is a static string (not user data), safe to use innerHTML
    document.getElementById("auth-message").innerHTML = t("authMsg");
    document.getElementById("btn-force-sync").title = t("forceTip");

    const footer = document.getElementById("last-sync-text");
    if (footer.dataset.never === "true") footer.textContent = t("lastSyncNever");

    if (currentStats && currentCategory === "engagement") {
        renderEngagementTab(currentStats.engagement_summary || {});
    }
}

// ── Security helpers ──────────────────────────────────────────────────────────

/** Escape user-provided strings before inserting into innerHTML */
function esc(str) {
    return String(str ?? "")
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;")
        .replace(/'/g, "&#39;");
}

// ── Toast notifications ───────────────────────────────────────────────────────

function showToast(msg, type = "error") {
    const toast = document.createElement("div");
    toast.className = `toast toast-${type}`;
    toast.textContent = msg;
    document.body.appendChild(toast);
    setTimeout(() => toast.remove(), 4000);
}

// ── DOM refs ──────────────────────────────────────────────────────────────────

const btnSync       = document.getElementById("btn-sync");
const btnForceSync  = document.getElementById("btn-force-sync");
const btnLang       = document.getElementById("btn-lang");
const statusBar     = document.getElementById("status-bar");
const statusText    = document.getElementById("status-text");
const viewAuthError = document.getElementById("view-auth-error");
const viewLoading   = document.getElementById("view-loading");
const viewResults   = document.getElementById("view-results");
const loadingText   = document.getElementById("loading-text");
const userList      = document.getElementById("user-list");
const lastSyncText  = document.getElementById("last-sync-text");

let currentCategory = "lost";
let currentStats    = null;
let syncTimeoutId   = null;
let storagePollId   = null;

// ── Init ──────────────────────────────────────────────────────────────────────

document.addEventListener("DOMContentLoaded", async () => {
    chrome.storage.local.get(["popup_lang"], (data) => {
        if (data.popup_lang) currentLang = data.popup_lang;
        applyLanguage();
    });

    // Restore busy state if a sync was already in progress when popup was (re)opened
    chrome.storage.local.get(["sync_in_progress", "sync_heartbeat", "sync_last_step", "sync_last_detail"], (data) => {
        if (data.sync_in_progress && data.sync_heartbeat) {
            const age = Date.now() - data.sync_heartbeat;
            if (age < HEARTBEAT_MAX_AGE_MS) {
                setSyncBusy(true);
                resetInactivityTimer();
                startStoragePoll();
                const step = data.sync_last_step || "";
                const detail = data.sync_last_detail || "";
                showStatus(step ? `${step}${detail ? ": " + detail : ""}` : t("syncStart"));
            }
        }
    });

    const res = await bgMessage({ type: "GET_DIFF" });
    if (res.ok && res.diff) {
        showResults(res.diff);
    } else {
        showView(viewLoading);
        loadingText.textContent = t("noData");
    }

    chrome.storage.local.get(["last_run_time"], (data) => {
        if (data.last_run_time) {
            lastSyncText.dataset.never = "false";
            lastSyncText.textContent = `${t("lastSyncPrefix")} ${new Date(data.last_run_time).toLocaleString(currentLang === "tr" ? "tr-TR" : "en-GB")}`;
        } else {
            lastSyncText.dataset.never = "true";
            lastSyncText.textContent = t("lastSyncNever");
        }
    });
});

// ── Language toggle ───────────────────────────────────────────────────────────

btnLang.addEventListener("click", () => {
    currentLang = currentLang === "tr" ? "en" : "tr";
    chrome.storage.local.set({ popup_lang: currentLang });
    applyLanguage();
    if (currentStats) renderList(currentCategory, currentStats);
});

// ── Sync ──────────────────────────────────────────────────────────────────────

// Inactivity timeout: 10 minutes without any heartbeat → assume stuck.
// Primary: resets on every PROGRESS_UPDATE message.
// Fallback: storage poll every 30s checks sync_heartbeat independently.
const INACTIVITY_TIMEOUT_MS   = 10 * 60 * 1000;
const HEARTBEAT_MAX_AGE_MS    =  4 * 60 * 1000; // stale after 4 min
const STORAGE_POLL_INTERVAL   = 30_000;

function setSyncBusy(busy) {
    btnSync.disabled = busy;
    btnForceSync.disabled = busy;
    if (!busy) {
        clearTimeout(syncTimeoutId);
        syncTimeoutId = null;
        clearInterval(storagePollId);
        storagePollId = null;
    }
}

function resetInactivityTimer() {
    clearTimeout(syncTimeoutId);
    syncTimeoutId = setTimeout(() => {
        setSyncBusy(false);
        hideStatus();
        showToast(t("syncTimeout"), "warning");
    }, INACTIVITY_TIMEOUT_MS);
}

/** Fallback: poll storage every 30s. If heartbeat is fresh, keep busy state alive.
 *  If heartbeat is missing/stale AND sync_in_progress is false, release buttons.  */
function startStoragePoll() {
    clearInterval(storagePollId);
    storagePollId = setInterval(() => {
        // Guard: if buttons are already re-enabled (SYNC_COMPLETE already handled),
        // stop the poll. Prevents an in-flight storage.get callback from re-showing
        // the status bar after the sync has already completed.
        if (!btnSync.disabled) {
            clearInterval(storagePollId);
            storagePollId = null;
            return;
        }
        chrome.storage.local.get(["sync_in_progress", "sync_heartbeat", "sync_last_step", "sync_last_detail"], (data) => {
            // Re-check after the async storage read — state may have changed.
            if (!btnSync.disabled) return;
            if (!data.sync_in_progress) {
                // Background finished (or never started) — release
                setSyncBusy(false);
                hideStatus();
                return;
            }
            if (data.sync_heartbeat) {
                const age = Date.now() - data.sync_heartbeat;
                if (age < HEARTBEAT_MAX_AGE_MS) {
                    // Still active — show last known step and reset inactivity timer
                    const step = data.sync_last_step || "";
                    const detail = data.sync_last_detail || "";
                    if (step) showStatus(`${step}${detail ? ": " + detail : ""}`);
                    resetInactivityTimer();
                }
                // If age > HEARTBEAT_MAX_AGE_MS, inactivity timer will fire on its own
            }
        });
    }, STORAGE_POLL_INTERVAL);
}

async function startSync(force = false) {
    setSyncBusy(true);
    resetInactivityTimer();
    startStoragePoll();
    showStatus(force ? t("forceStart") : t("syncStart"));
    try {
        const res = await bgMessage({ type: force ? "FORCE_SYNC" : "RUN_SYNC" });
        if (!res.ok) {
            setSyncBusy(false);
            showStatus(res.error || t("syncFail"), true);
            showToast(res.error || t("syncFail"), "error");
        } else {
            showStatus(t("fetchFollowers"));
        }
    } catch (err) {
        setSyncBusy(false);
        showStatus(err.message, true);
        showToast(err.message, "error");
    }
}

btnSync.addEventListener("click",      () => startSync(false));
btnForceSync.addEventListener("click", () => startSync(true));

// ── Tab buttons ───────────────────────────────────────────────────────────────

document.querySelectorAll(".tab-btn").forEach(btn => {
    btn.addEventListener("click", () => {
        document.querySelectorAll(".tab-btn").forEach(b => b.classList.remove("active"));
        btn.classList.add("active");
        currentCategory = btn.dataset.category;
        if (currentStats) renderList(currentCategory, currentStats);
    });
});

document.querySelectorAll(".summary-card").forEach(card => {
    card.addEventListener("click", () => {
        const cat = card.dataset.category;
        document.querySelectorAll(".tab-btn").forEach(b => b.classList.toggle("active", b.dataset.category === cat));
        currentCategory = cat;
        if (currentStats) renderList(cat, currentStats);
    });
});

// ── Background messages ───────────────────────────────────────────────────────

chrome.runtime.onMessage.addListener((message) => {
    const detail = message.detail || "";

    const LABELS = {
        auth:              t("pAuth"),
        followers:         `${t("pFollowers")} ${detail}`.trim(),
        followers_cached:  `${t("pFollowersCached")} ${detail}`.trim(),
        followers_done:    `${t("pFollowersDone")} ${detail}`.trim(),
        pause:             t("pPause"),
        following:         `${t("pFollowing")} ${detail}`.trim(),
        following_cached:  `${t("pFollowingCached")} ${detail}`.trim(),
        following_done:    `${t("pFollowingDone")} ${detail}`.trim(),
        engagement_start:  t("pEngStart"),
        engagement:        `${t("pEng")} ${detail}`.trim(),
        engagement_cached: t("pEngCached"),
        rate_limit:        `${t("pRateLimit")} ${detail}`.trim(),
        fetching:          `${t("pFetching")} ${detail}`.trim(),
        requests:          `${t("pRequests")} ${detail}`.trim(),
        requests_done:     `${t("pRequests")} ✓ ${detail}`.trim(),
        saving:            detail || t("pSaving"),
    };

    switch (message.type) {
        case "PROGRESS_UPDATE":
            resetInactivityTimer(); // still alive — reset the inactivity clock
            showStatus(LABELS[message.step] || message.step || (detail ? `${message.step}: ${detail}` : message.step));
            break;

        case "SYNC_COMPLETE":
            chrome.storage.local.set({ sync_in_progress: false, sync_heartbeat: null });
            setSyncBusy(false);
            hideStatus();
            showResults(message.stats);
            showToast(currentLang === "tr" ? "Senkronizasyon tamamlandı ✓" : "Sync complete ✓", "success");
            chrome.storage.local.get(["last_run_time"], (data) => {
                if (data.last_run_time) {
                    lastSyncText.dataset.never = "false";
                    lastSyncText.textContent = `${t("lastSyncPrefix")} ${new Date(data.last_run_time).toLocaleString(currentLang === "tr" ? "tr-TR" : "en-GB")}`;
                }
            });
            break;

        case "SYNC_ERROR":
            chrome.storage.local.set({ sync_in_progress: false, sync_heartbeat: null });
            setSyncBusy(false);
            showStatus(message.error || t("syncFail"), true);
            showToast(message.error || t("syncFail"), "error");
            break;

        case "DRIVE_SAVE_COMPLETE":
            showToast(currentLang === "tr" ? "Drive'a kaydedildi ✓" : "Saved to Drive ✓", "success");
            break;

        case "DRIVE_SAVE_FAILED":
            showToast(
                currentLang === "tr"
                    ? `Drive kayıt hatası: ${message.error} (Veriler korundu)`
                    : `Drive save failed: ${message.error} (Local data preserved)`,
                "warning"
            );
            break;

        case "STATUS_CHECKS_COMPLETE":
            bgMessage({ type: "GET_DIFF" }).then(res => { if (res.ok && res.diff) showResults(res.diff); });
            break;
    }
});

// ── Render ────────────────────────────────────────────────────────────────────

function showResults(stats) {
    currentStats = stats;
    hideStatus(); // always clear status bar when results are displayed

    for (const cat of ["lost", "not_back", "new", "fans", "deactivated"]) {
        const el = document.getElementById(`count-${cat}`);
        if (el) el.textContent = (stats[cat] || []).length;
    }

    const ghostEl = document.getElementById("count-ghost");
    if (ghostEl) ghostEl.textContent = stats.engagement_summary?.ghost_count ?? "—";

    renderList(currentCategory, stats);
    showView(viewResults);
}

function renderList(category, stats) {
    userList.innerHTML = "";

    if (category === "engagement") {
        renderEngagementTab(stats.engagement_summary || {});
        return;
    }

    const users = stats[category] || [];
    if (users.length === 0) {
        const empty = document.createElement("div");
        empty.className = "empty-list";
        empty.textContent = t("noUsers");
        userList.appendChild(empty);
        return;
    }
    for (const user of users) userList.appendChild(createUserItem(user, category));
}

function renderEngagementTab(summary) {
    const ghost    = summary.ghost_count ?? 0;
    const engagers = summary.engagers || [];
    const weights  = summary.weights || { post_likes: 2, story_views: 1, story_likes: 3 };

    if (ghost === 0 && engagers.length === 0) {
        const empty = document.createElement("div");
        empty.className = "empty-list";
        empty.textContent = t("engEmpty");
        userList.appendChild(empty);
        return;
    }

    // ── Summary stats ────────────────────────────────────────────────────────
    const totals = engagers.reduce((acc, u) => {
        acc.post_likes  += u.post_likes  || 0;
        acc.story_views += u.story_views || 0;
        acc.story_likes += u.story_likes || 0;
        return acc;
    }, { post_likes: 0, story_views: 0, story_likes: 0 });

    const summaryBox = document.createElement("div");
    summaryBox.className = "eng-stats-box";

    const statsRow = document.createElement("div");
    statsRow.className = "eng-stats-row";
    const statItems = [
        { label: currentLang === "tr" ? "Beğeni"       : "Post Likes",   value: totals.post_likes,  cls: "eng-stat-likes",  icon: "♥" },
        { label: currentLang === "tr" ? "Görüntüleme"   : "Story Views",  value: totals.story_views, cls: "eng-stat-views",  icon: "◉" },
        { label: currentLang === "tr" ? "Hik. Beğeni"  : "Story Likes",  value: totals.story_likes, cls: "eng-stat-slikes", icon: "★" },
        { label: currentLang === "tr" ? "Hayalet"       : "Ghosts",       value: ghost,              cls: "eng-stat-ghost",  icon: "👻" },
    ];
    for (const s of statItems) {
        const stat = document.createElement("div");
        stat.className = `eng-stat ${s.cls}`;
        const val = document.createElement("div");
        val.className = "eng-stat-value";
        val.textContent = `${s.icon} ${s.value}`;
        const lbl = document.createElement("div");
        lbl.className = "eng-stat-label";
        lbl.textContent = s.label;
        stat.appendChild(val);
        stat.appendChild(lbl);
        statsRow.appendChild(stat);
    }
    summaryBox.appendChild(statsRow);

    // Weights legend
    const legend = document.createElement("div");
    legend.className = "eng-weights";
    legend.textContent = currentLang === "tr"
        ? `Skor = Beğeni×${weights.post_likes} + Görüntüleme×${weights.story_views} + Hik.Beğeni×${weights.story_likes}`
        : `Score = Likes×${weights.post_likes} + Views×${weights.story_views} + S.Likes×${weights.story_likes}`;
    summaryBox.appendChild(legend);

    userList.appendChild(summaryBox);

    if (engagers.length === 0) return;

    // ── Table header ─────────────────────────────────────────────────────────
    const header = document.createElement("div");
    header.className = "eng-row eng-header";
    const cols = [
        { text: "#",                                    cls: "eng-col-rank" },
        { text: currentLang === "tr" ? "Kullanıcı" : "User", cls: "eng-col-user" },
        { text: "♥",                                    cls: "eng-col-num", title: currentLang === "tr" ? "Gönderi Beğeni" : "Post Likes" },
        { text: "◉",                                    cls: "eng-col-num", title: currentLang === "tr" ? "Hikaye Görüntüleme" : "Story Views" },
        { text: "★",                                    cls: "eng-col-num", title: currentLang === "tr" ? "Hikaye Beğeni" : "Story Likes" },
        { text: currentLang === "tr" ? "Skor" : "Score", cls: "eng-col-score" },
    ];
    for (const col of cols) {
        const cell = document.createElement("div");
        cell.className = col.cls;
        cell.textContent = col.text;
        if (col.title) cell.title = col.title;
        header.appendChild(cell);
    }
    userList.appendChild(header);

    // ── Engager rows ─────────────────────────────────────────────────────────
    for (let i = 0; i < engagers.length; i++) {
        const u = engagers[i];
        const row = document.createElement("div");
        row.className = "eng-row eng-data-row";

        const rank = document.createElement("div");
        rank.className = "eng-col-rank";
        rank.textContent = i + 1;

        const user = document.createElement("div");
        user.className = "eng-col-user";
        // Avatar
        const avatar = document.createElement("div");
        avatar.className = "eng-avatar-sm";
        const picSrc = u.profile_pic_b64 || u.profile_pic_url;
        if (picSrc) {
            const img = document.createElement("img");
            img.src = picSrc;
            img.alt = u.username;
            img.referrerPolicy = "no-referrer";
            img.addEventListener("error", () => { img.style.display = "none"; avatar.textContent = (u.username || "?")[0].toUpperCase(); });
            avatar.appendChild(img);
        } else {
            avatar.textContent = (u.username || "?")[0].toUpperCase();
        }
        user.appendChild(avatar);
        const nameSpan = document.createElement("span");
        nameSpan.className = "eng-col-username";
        nameSpan.textContent = `@${u.username}`;
        if (u.is_verified) { const v = document.createElement("span"); v.className = "verified-dot"; v.textContent = "✓"; nameSpan.appendChild(v); }
        user.appendChild(nameSpan);
        user.title = u.full_name || u.username;

        const likes = document.createElement("div");
        likes.className = "eng-col-num eng-val-likes";
        likes.textContent = u.post_likes || 0;

        const views = document.createElement("div");
        views.className = "eng-col-num eng-val-views";
        views.textContent = u.story_views || 0;

        const slikes = document.createElement("div");
        slikes.className = "eng-col-num eng-val-slikes";
        slikes.textContent = u.story_likes || 0;

        const score = document.createElement("div");
        score.className = "eng-col-score";
        score.textContent = u.score || 0;

        row.appendChild(rank);
        row.appendChild(user);
        row.appendChild(likes);
        row.appendChild(views);
        row.appendChild(slikes);
        row.appendChild(score);

        row.addEventListener("click", () => {
            if (u.username) chrome.tabs.create({ url: `https://www.instagram.com/${encodeURIComponent(u.username)}/` });
        });

        userList.appendChild(row);
    }
}

function createUserItem(user, category) {
    const item = document.createElement("div");
    item.className = "user-item";

    const username = user.username || String(user.pk || "?");
    const initial  = username[0].toUpperCase();

    // Avatar
    const avatar = document.createElement("div");
    avatar.className = "avatar";

    if (user.profile_pic_url || user.profile_pic_b64) {
        const img = document.createElement("img");
        img.src = user.profile_pic_b64 || user.profile_pic_url;
        img.alt = username;
        img.referrerPolicy = "no-referrer";
        img.addEventListener("error", () => {
            img.style.display = "none";
            avatar.textContent = initial;
        });
        avatar.appendChild(img);
    } else {
        avatar.textContent = initial;
    }

    // User info
    const info = document.createElement("div");
    info.className = "user-info";

    const nameEl = document.createElement("div");
    nameEl.className = "user-username";
    nameEl.textContent = `@${username}`;

    if (user.is_verified) {
        const dot = document.createElement("span");
        dot.className = "verified-dot";
        dot.title = "✓";
        dot.textContent = "✓";
        nameEl.appendChild(dot);
    }

    const fullEl = document.createElement("div");
    fullEl.className = "user-fullname";
    fullEl.textContent = user.full_name || "";

    info.appendChild(nameEl);
    info.appendChild(fullEl);

    item.appendChild(avatar);
    item.appendChild(info);

    if (category === "deactivated") {
        const badge = document.createElement("span");
        badge.className = "user-badge badge-deactivated";
        badge.textContent = t("frozenBadge");
        item.appendChild(badge);
    }

    item.addEventListener("click", () => {
        if (username !== "?") chrome.tabs.create({ url: `https://www.instagram.com/${encodeURIComponent(username)}/` });
    });

    return item;
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function showView(view) {
    [viewAuthError, viewLoading, viewResults].forEach(v => v.classList.add("hidden"));
    view.classList.remove("hidden");
}
function showStatus(msg, isError = false) {
    statusText.textContent = msg;
    statusBar.classList.remove("hidden", "error");
    if (isError) statusBar.classList.add("error");
}
function hideStatus() { statusBar.classList.add("hidden"); }
function bgMessage(message) {
    return new Promise((resolve, reject) => {
        chrome.runtime.sendMessage(message, res => {
            if (chrome.runtime.lastError) reject(new Error(chrome.runtime.lastError.message));
            else resolve(res || {});
        });
    });
}
