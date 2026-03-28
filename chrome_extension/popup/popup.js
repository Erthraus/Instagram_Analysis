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
        // auth message (HTML)
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
        // auth message (HTML)
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
    }
};

let currentLang = "tr";
function t(key) { return I18N[currentLang]?.[key] ?? I18N.tr[key] ?? key; }

function applyLanguage() {
    // Update lang toggle button
    document.getElementById("btn-lang").textContent = currentLang === "tr" ? "EN" : "TR";
    document.documentElement.lang = currentLang;

    // Card labels
    document.getElementById("label-lost").textContent        = t("cardLost");
    document.getElementById("label-not_back").textContent    = t("cardNotBack");
    document.getElementById("label-new").textContent         = t("cardNew");
    document.getElementById("label-fans").textContent        = t("cardFans");
    document.getElementById("label-deactivated").textContent = t("cardFrozen");
    document.getElementById("label-ghost").textContent       = t("cardGhost");

    // Tab labels
    document.getElementById("tab-lost").textContent        = t("tabLost");
    document.getElementById("tab-not_back").textContent    = t("tabNotBack");
    document.getElementById("tab-new").textContent         = t("tabNew");
    document.getElementById("tab-fans").textContent        = t("tabFans");
    document.getElementById("tab-deactivated").textContent = t("tabFrozen");
    document.getElementById("tab-engagement").textContent  = t("tabEng");

    // Auth message
    document.getElementById("auth-message").innerHTML = t("authMsg");

    // Force sync title
    document.getElementById("btn-force-sync").title = t("forceTip");

    // Footer (only if "never")
    const footer = document.getElementById("last-sync-text");
    if (footer.dataset.never === "true") footer.textContent = t("lastSyncNever");

    // Re-render engagement tab if currently active
    if (currentStats && currentCategory === "engagement") {
        renderEngagementTab(currentStats.engagement_summary || {});
    }
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

// ── Init ──────────────────────────────────────────────────────────────────────

document.addEventListener("DOMContentLoaded", async () => {
    // Load saved language
    chrome.storage.local.get(["popup_lang"], ({ popup_lang }) => {
        if (popup_lang) currentLang = popup_lang;
        applyLanguage();
    });

    const res = await bgMessage({ type: "GET_DIFF" });
    if (res.ok && res.diff) {
        showResults(res.diff);
    } else {
        showView(viewLoading);
        loadingText.textContent = t("noData");
    }

    chrome.storage.local.get(["last_run_time"], ({ last_run_time }) => {
        if (last_run_time) {
            lastSyncText.dataset.never = "false";
            lastSyncText.textContent = `${t("lastSyncPrefix")} ${new Date(last_run_time).toLocaleString(currentLang === "tr" ? "tr-TR" : "en-GB")}`;
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
    // Re-render if data is loaded
    if (currentStats) renderList(currentCategory, currentStats);
});

// ── Sync ──────────────────────────────────────────────────────────────────────

async function startSync(force = false) {
    btnSync.disabled = true;
    btnForceSync.disabled = true;
    showStatus(force ? t("forceStart") : t("syncStart"));
    try {
        const res = await bgMessage({ type: force ? "FORCE_SYNC" : "RUN_SYNC" });
        if (!res.ok) {
            showStatus(res.error || t("syncFail"), true);
            btnSync.disabled = false;
            btnForceSync.disabled = false;
        } else {
            showStatus(t("fetchFollowers"));
        }
    } catch (err) {
        showStatus(err.message, true);
        btnSync.disabled = false;
        btnForceSync.disabled = false;
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
        followers:         t("pFollowers"),
        followers_cached:  t("pFollowersCached"),
        followers_done:    t("pFollowersDone"),
        pause:             t("pPause"),
        following:         t("pFollowing"),
        following_cached:  t("pFollowingCached"),
        following_done:    t("pFollowingDone"),
        engagement_start:  t("pEngStart"),
        engagement:        `${t("pEng")} ${detail}`,
        engagement_cached: t("pEngCached"),
        rate_limit:        `${t("pRateLimit")} ${detail}`,
        fetching:          `${t("pFetching")} ${detail}`,
        requests:          t("pRequests"),
    };

    switch (message.type) {
        case "PROGRESS_UPDATE":
            showStatus(LABELS[message.step] || message.step);
            break;
        case "SYNC_COMPLETE":
            btnSync.disabled = false;
            btnForceSync.disabled = false;
            hideStatus();
            showResults(message.stats);
            chrome.storage.local.get(["last_run_time"], ({ last_run_time }) => {
                if (last_run_time) {
                    lastSyncText.dataset.never = "false";
                    lastSyncText.textContent = `${t("lastSyncPrefix")} ${new Date(last_run_time).toLocaleString(currentLang === "tr" ? "tr-TR" : "en-GB")}`;
                }
            });
            break;
        case "SYNC_ERROR":
            btnSync.disabled = false;
            btnForceSync.disabled = false;
            showStatus(message.error || t("syncFail"), true);
            break;
        case "STATUS_CHECKS_COMPLETE":
            bgMessage({ type: "GET_DIFF" }).then(res => { if (res.ok && res.diff) showResults(res.diff); });
            break;
    }
});

// ── Render ────────────────────────────────────────────────────────────────────

function showResults(stats) {
    currentStats = stats;

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
        userList.innerHTML = `<div class="empty-list">${t("noUsers")}</div>`;
        return;
    }
    for (const user of users) userList.appendChild(createUserItem(user, category));
}

function renderEngagementTab(summary) {
    const ghost = summary.ghost_count ?? 0;
    const top   = summary.top_engagers || [];

    if (ghost === 0 && top.length === 0) {
        userList.innerHTML = `<div class="empty-list">${t("engEmpty")}</div>`;
        return;
    }

    let html = `<div class="eng-summary">
        <span class="eng-ghost">👻 ${ghost} ${t("ghostLabel")}</span>
    </div>`;

    if (top.length > 0) {
        html += `<div class="eng-top-title">${t("topTitle")}</div>`;
        for (const u of top) {
            html += `<div class="user-item eng-top-item" onclick="openProfile('${u.username}')">
                <div class="avatar">${(u.username || "?")[0].toUpperCase()}</div>
                <div class="user-info">
                    <div class="user-username">@${u.username}</div>
                </div>
                <span class="eng-count">♥ ${u.count}</span>
            </div>`;
        }
    }
    userList.innerHTML = html;
}

function createUserItem(user, category) {
    const item = document.createElement("div");
    item.className = "user-item";
    const username = user.username || user.pk || "?";
    const initial  = username[0].toUpperCase();
    const badge    = category === "deactivated"
        ? `<span class="user-badge badge-deactivated">${t("frozenBadge")}</span>` : "";
    const verified = user.is_verified ? `<span class="verified-dot" title="✓">✓</span>` : "";

    let avatarContent = initial;
    if (user.profile_pic_url) {
        avatarContent = `<img src="${user.profile_pic_url}" referrerpolicy="no-referrer" alt="${username}" onerror="this.style.display='none';this.parentElement.textContent='${initial}'">`;
    }

    item.innerHTML = `
        <div class="avatar">${avatarContent}</div>
        <div class="user-info">
            <div class="user-username">@${username}${verified}</div>
            <div class="user-fullname">${user.full_name || ""}</div>
        </div>
        ${badge}
    `;
    item.addEventListener("click", () => { if (username !== "?") chrome.tabs.create({ url: `https://www.instagram.com/${username}/` }); });
    return item;
}

function openProfile(username) {
    chrome.tabs.create({ url: `https://www.instagram.com/${username}/` });
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
