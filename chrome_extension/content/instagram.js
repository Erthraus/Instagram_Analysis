/**
 * instagram.js — Content script running inside instagram.com pages.
 *
 * Aşamalar:
 *  1. Takipçiler    — sayfalı, checkpoint'li
 *  2. Takip edilenler — sayfalı, checkpoint'li
 *  3. Etkileşim     — gönderi beğenileri + hikaye görüntüleme + hikaye beğenileri
 *  4. Takip istekleri — bekleyen istekler (gizli hesaplar için)
 */

const IG_APP_ID          = "936619743392459";
const PAGE_DELAY         = { min: 2000, max: 3500 };
const PHASE_DELAY        = 5000;
const POST_DELAY         = { min: 1500, max: 2500 };
const CHECKPOINT_VERSION = 5;   // Snapshot şeması değiştiğinde artır — temiz fetch zorlar

// ── Inline IndexedDB (content scriptler ES modül import'u kullanamaz) ─────────

const DB = (() => {
    let _db = null;
    const open = () => _db ? Promise.resolve(_db) : new Promise((res, rej) => {
        const r = indexedDB.open("ig_analytics_pro", 1);
        r.onupgradeneeded = e => { if (!e.target.result.objectStoreNames.contains("snapshots")) e.target.result.createObjectStore("snapshots"); };
        r.onsuccess = e => { _db = e.target.result; res(_db); };
        r.onerror   = e => rej(e.target.error);
    });
    const tx = (mode) => open().then(db => db.transaction("snapshots", mode).objectStore("snapshots"));
    return {
        get: (key) => tx("readonly").then(s => new Promise((res, rej) => { const r = s.get(key); r.onsuccess = () => res(r.result ?? null); r.onerror = () => rej(r.error); })),
        set: (key, val) => tx("readwrite").then(s => new Promise((res, rej) => { const r = s.put(val, key); r.onsuccess = () => res(); r.onerror = () => rej(r.error); }))
    };
})();

// ── Yardımcılar ───────────────────────────────────────────────────────────────

const sleep = ms => new Promise(r => setTimeout(r, ms));
const jitter = (d = PAGE_DELAY) => sleep(d.min + Math.random() * (d.max - d.min));

// 30 saniyelik timeout — yavaş/challenge yanıtlarında sonsuz takılmayı önler
async function fetchWithTimeout(url, options, timeoutMs = 30000) {
    const ctrl = new AbortController();
    const id = setTimeout(() => ctrl.abort(), timeoutMs);
    try {
        return await fetch(url, { ...options, signal: ctrl.signal });
    } catch (err) {
        if (err.name === "AbortError") throw new Error("İstek zaman aşımına uğradı (30s). Instagram challenge/captcha gösteriyor olabilir.");
        throw err;
    } finally {
        clearTimeout(id);
    }
}

function getInstagramAuth() {
    const cookies = Object.fromEntries(document.cookie.split("; ").map(c => { const i = c.indexOf("="); return [c.slice(0,i), c.slice(i+1)]; }));
    const { csrftoken: csrfToken, ds_user_id: userId } = cookies;
    if (!csrfToken || !userId) throw new Error("Instagram'a giriş yapılmamış.");
    return { csrfToken, userId };
}

const igHeaders = (csrfToken) => ({
    "X-CSRFToken": csrfToken,
    "X-IG-App-ID": IG_APP_ID,
    "X-Requested-With": "XMLHttpRequest"
});

function sendProgress(step, detail = "") {
    chrome.runtime.sendMessage({ type: "ANALYSIS_PROGRESS", step, detail }).catch(() => {});
}

// ── Sayfalı fetch ─────────────────────────────────────────────────────────────

const MAX_PAGINATED_PAGES = 500; // güvenlik sınırı — takipçi/takip için yeterli

async function fetchPaginated(urlFn, csrfToken, dataKey = "users") {
    const results = [];
    let cursor = null, attempt = 0, pages = 0;
    do {
        const res = await fetchWithTimeout(urlFn(cursor), { headers: igHeaders(csrfToken), credentials: "include" });
        if (res.status === 429 || res.status === 401) {
            if (++attempt > 3) throw new Error(`Hız sınırı aşıldı (HTTP ${res.status})`);
            const wait = Math.pow(2, attempt) * 5000;
            sendProgress("rate_limit", `${wait/1000}s`);
            await sleep(wait); continue;
        }
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const ct = res.headers.get("content-type") || "";
        if (!ct.includes("json")) {
            throw new Error(`Beklenmedik yanıt (${ct}). Instagram güvenlik kontrolü istiyor olabilir — instagram.com'u ziyaret et.`);
        }
        const data = await res.json();
        results.push(...(data[dataKey] || []));
        cursor = data.next_max_id || null;
        attempt = 0;
        pages++;
        sendProgress("fetching", `${results.length} (${pages}. sayfa)`);
        if (cursor) await jitter();
    } while (cursor && pages < MAX_PAGINATED_PAGES);
    return results;
}

const fetchFollowers = (userId, csrfToken) => fetchPaginated(
    c => `https://www.instagram.com/api/v1/friendships/${userId}/followers/?count=200${c ? `&max_id=${c}` : ""}`, csrfToken);

const fetchFollowing = (userId, csrfToken) => fetchPaginated(
    c => `https://www.instagram.com/api/v1/friendships/${userId}/following/?count=200${c ? `&max_id=${c}` : ""}`, csrfToken);

// ── Etkileşim: gönderi beğenileri ─────────────────────────────────────────────

async function fetchPostLikes(userId, csrfToken) {
    // { pk → beğeni_sayısı } — aktif + arşivlenmiş gönderiler
    const likes = {};
    const posts = [];

    sendProgress("engagement", "Gönderiler çekiliyor...");

    // Sayfalı gönderi çekici — tüm gönderileri getirir, sınır yok
    // progressLabel: ilerleme mesajında gösterilecek etiket
    async function fetchFeedAll(baseUrl, progressLabel = "Gönderi") {
        const items = [];
        let cursor = null, pages = 0;
        const MAX_FEED_PAGES = 300; // ~10.000 gönderi — sonsuz döngüye karşı guard
        do {
            const url = `${baseUrl}${cursor ? `&max_id=${cursor}` : ""}`;
            try {
                const res = await fetchWithTimeout(url, { headers: igHeaders(csrfToken), credentials: "include" });
                if (!res.ok) break;
                const data = await res.json();
                const batch = data.items || [];
                items.push(...batch);
                cursor = data.next_max_id || null;
                if (batch.length === 0) break;
                pages++;
                sendProgress("engagement", `${progressLabel}: ${items.length} (sayfa ${pages})`);
                if (cursor) await jitter(POST_DELAY);
            } catch { break; }
        } while (cursor && pages < MAX_FEED_PAGES);
        return items;
    }

    // Aktif gönderiler (tümü)
    try {
        const active = await fetchFeedAll(`https://www.instagram.com/api/v1/feed/user/${userId}/?count=33`, "Aktif gönderi");
        posts.push(...active);
        sendProgress("engagement", `Aktif gönderiler tamamlandı: ${active.length}`);
    } catch { /* aktif gönderi fetch başarısız */ }

    // Arşivlenmiş gönderiler (tümü)
    try {
        const archived = await fetchFeedAll(`https://www.instagram.com/api/v1/feed/only_me_feed/?count=33`, "Arşiv gönderi");
        posts.push(...archived);
        sendProgress("engagement", `Arşiv gönderiler tamamlandı: ${archived.length}`);
    } catch { /* arşiv gönderi fetch başarısız */ }

    // pk'ya göre tekil yap
    const seen = new Set();
    const unique = [];
    for (const p of posts) {
        const id = String(p.pk || p.id);
        if (!seen.has(id)) { seen.add(id); unique.push(p); }
    }

    for (let i = 0; i < unique.length; i++) {
        const mediaId = unique[i].pk || unique[i].id;
        sendProgress("engagement", `Gönderi ${i+1}/${unique.length} beğenileri`);
        try {
            const res = await fetchWithTimeout(
                `https://www.instagram.com/api/v1/media/${mediaId}/likers/`,
                { headers: igHeaders(csrfToken), credentials: "include" }
            );
            if (!res.ok) continue;
            const data = await res.json();
            for (const liker of data.users || []) {
                const pk = String(liker.pk);
                likes[pk] = (likes[pk] || 0) + 1;
            }
        } catch { continue; }
        await jitter(POST_DELAY);
    }

    return likes;
}

// ── Etkileşim: hikaye görüntüleme + beğenileri ────────────────────────────────

async function fetchStoryItems(userId, csrfToken) {
    const items = [];

    // Aktif hikayeler (son 24 saat)
    try {
        const res = await fetchWithTimeout(
            `https://www.instagram.com/api/v1/feed/user/${userId}/reel_media/`,
            { headers: igHeaders(csrfToken), credentials: "include" }
        );
        if (res.ok) {
            const data = await res.json();
            items.push(...(data.items || []));
        }
    } catch { /* aktif hikaye yok */ }

    // Hikaye arşivi — son 14 güne kadar (Instagram viewer verisini 14 gün tutar)
    // Tüm shell'leri sayfalı çek
    try {
        let cursor = null, shellPage = 0;
        do {
            const url = `https://www.instagram.com/api/v1/archive/reel/day_shells/${cursor ? `?max_id=${cursor}` : ""}`;
            const res = await fetchWithTimeout(url, { headers: igHeaders(csrfToken), credentials: "include" });
            if (!res.ok) break;
            const data = await res.json();
            const shells = data.items || [];
            shellPage++;

            let reachedOld = false;
            for (const shell of shells) {
                // Shell timestamp'i 14 günden eskiyse dur (viewer verisi yoktur)
                const shellTs = shell.taken_at || shell.timestamp || 0;
                if (shellTs && (Date.now() / 1000 - shellTs) > 14 * 86400) {
                    reachedOld = true;
                    break;
                }
                const shellItems = shell.reel_media?.items || shell.items || [];
                items.push(...shellItems);
            }

            sendProgress("engagement", `Hikaye arşivi taranıyor... ${items.length} hikaye (${shellPage}. gün grubu)`);
            cursor = (!reachedOld && data.next_max_id) ? data.next_max_id : null;
            if (cursor) await jitter(POST_DELAY);
        } while (cursor);
    } catch { /* arşiv mevcut değil */ }

    // Pk'ya göre tekil yap, sınır yok
    const seen = new Set();
    const unique = [];
    for (const item of items) {
        const pk = String(item.pk || item.id);
        if (!seen.has(pk)) { seen.add(pk); unique.push(item); }
    }
    return unique;
}

async function fetchStoryViewers(storyPk, csrfToken) {
    const viewers = [];
    let cursor = null, pages = 0;
    do {
        try {
            const url = `https://www.instagram.com/api/v1/media/${storyPk}/list_reel_media_viewer/?count=50${cursor ? `&max_id=${cursor}` : ""}`;
            const res = await fetchWithTimeout(url, { headers: igHeaders(csrfToken), credentials: "include" });
            if (!res.ok) break;
            const data = await res.json();
            viewers.push(...(data.users || []));
            cursor = data.next_max_id || null;
            if (cursor) await jitter(POST_DELAY);
        } catch { break; }
        pages++;
    } while (cursor && pages < 5);
    return viewers;
}

// ── Etkileşim: hepsini birleştir ──────────────────────────────────────────────
//
// engagement[pk] = { post_likes: N, story_views: N, story_likes: N, score: N }
// Skor = post_likes×1 + story_views×1 + story_likes×2

async function fetchAllEngagement(userId, csrfToken) {
    const engagement = {};

    const ensure = pk => {
        if (!engagement[pk]) engagement[pk] = { post_likes: 0, story_views: 0, story_likes: 0, score: 0 };
    };

    // --- Gönderi beğenileri ---
    sendProgress("engagement_start");
    const postLikes = await fetchPostLikes(userId, csrfToken);
    for (const [pk, count] of Object.entries(postLikes)) {
        ensure(pk);
        engagement[pk].post_likes = count;
    }

    // --- Hikaye görüntülemeleri + beğenileri ---
    sendProgress("engagement", "Hikayeler analiz ediliyor...");
    try {
        const stories = await fetchStoryItems(userId, csrfToken);
        for (let i = 0; i < stories.length; i++) {
            const storyPk = String(stories[i].pk || stories[i].id);
            sendProgress("engagement", `Hikaye ${i+1}/${stories.length}`);
            try {
                const viewers = await fetchStoryViewers(storyPk, csrfToken);
                for (const viewer of viewers) {
                    const pk = String(viewer.pk);
                    ensure(pk);
                    engagement[pk].story_views += 1;
                    if (viewer.has_liked) engagement[pk].story_likes += 1;
                }
            } catch { continue; }
            await jitter(POST_DELAY);
        }
    } catch { /* hikaye fetch başarısız */ }

    // Skorları hesapla
    for (const e of Object.values(engagement)) {
        e.score = e.post_likes + e.story_views + e.story_likes * 2;
    }

    return engagement;
}

// ── Takip istekleri ───────────────────────────────────────────────────────────

async function fetchPendingRequests(csrfToken) {
    try {
        const users = await fetchPaginated(
            c => `https://www.instagram.com/api/v1/friendships/pending/?count=100${c ? `&max_id=${c}` : ""}`,
            csrfToken
        );
        return users.map(mapUser);
    } catch {
        return []; // Açık hesaplarda istek yoktur
    }
}

// ── Mevcut kullanıcı bilgisi ──────────────────────────────────────────────────

async function fetchCurrentUser(userId, csrfToken) {
    try {
        const res = await fetchWithTimeout(
            `https://www.instagram.com/api/v1/users/${userId}/info/`,
            { headers: igHeaders(csrfToken), credentials: "include" }
        );
        if (!res.ok) return null;
        const data = await res.json();
        const u = data.user;
        if (!u) return null;
        return { pk: String(u.pk), username: u.username, full_name: u.full_name || "" };
    } catch { return null; }
}

// ── Kullanıcı dönüştürücü ─────────────────────────────────────────────────────

const mapUser = u => ({
    pk:              String(u.pk),
    username:        u.username,
    full_name:       u.full_name || "",
    profile_pic_url: u.profile_pic_url || null,
    is_verified:     u.is_verified || false
});

// ── Ana Analiz ────────────────────────────────────────────────────────────────

async function runAnalysis() {
    const { csrfToken, userId } = getInstagramAuth();

    let cp = await DB.get("sync_checkpoint");
    if (cp && (cp.userId !== userId || cp.version !== CHECKPOINT_VERSION)) cp = null;

    // Mevcut hesap bilgisini çek (hesap adı web client'ta göstermek için)
    const currentUser = await fetchCurrentUser(userId, csrfToken);

    let followers, following;

    // Aşama 1 — Takipçiler
    if (cp?.phase === "following" || cp?.phase === "engagement" || cp?.phase === "requests" || cp?.phase === "done") {
        followers = cp.followers;
        sendProgress("followers_cached", `${followers.length} takipçi (önbellek)`);
    } else {
        sendProgress("followers", "Takipçiler yükleniyor...");
        followers = await fetchFollowers(userId, csrfToken);
        await DB.set("sync_checkpoint", { version: CHECKPOINT_VERSION, phase: "following", userId, followers, timestamp: Date.now() });
        sendProgress("followers_done", `${followers.length} takipçi alındı`);
    }

    // Aşama 2 — Takip edilenler
    if (cp?.phase === "engagement" || cp?.phase === "requests" || cp?.phase === "done") {
        following = cp.following;
        sendProgress("following_cached", `${following.length} takip (önbellek)`);
    } else {
        sendProgress("pause", "Kısa bekleme...");
        await sleep(PHASE_DELAY);
        sendProgress("following", "Takip edilenler yükleniyor...");
        following = await fetchFollowing(userId, csrfToken);
        await DB.set("sync_checkpoint", { version: CHECKPOINT_VERSION, phase: "engagement", userId, followers, following, timestamp: Date.now() });
        sendProgress("following_done", `${following.length} takip alındı`);
    }

    // Aşama 3 — Etkileşim (gönderi + hikaye)
    let engagement = (cp?.phase === "requests" || cp?.phase === "done") ? cp.engagement : null;
    if (!engagement) {
        await sleep(PHASE_DELAY);
        engagement = await fetchAllEngagement(userId, csrfToken);
        await DB.set("sync_checkpoint", { version: CHECKPOINT_VERSION, phase: "requests", userId, followers, following, engagement, timestamp: Date.now() });
    } else {
        sendProgress("engagement_cached");
    }

    // Aşama 4 — Takip istekleri
    let requests = cp?.phase === "done" ? cp.requests : null;
    if (!requests) {
        await sleep(PHASE_DELAY);
        sendProgress("requests", "Bekleyen takip istekleri alınıyor...");
        const pending = await fetchPendingRequests(csrfToken);
        requests = { pending };
        await DB.set("sync_checkpoint", { version: CHECKPOINT_VERSION, phase: "done", userId, followers, following, engagement, requests, timestamp: Date.now() });
        sendProgress("requests_done", `${pending.length} istek`);
    }

    // Tamamlandı — veriyi chrome.storage.local'a yaz, ardından küçük bildirim gönder.
    // Büyük hesaplarda chrome.runtime.sendMessage boyut limitine takılır ve sessizce düşer.
    // Storage'a yazmak bu sorunu tamamen ortadan kaldırır.
    sendProgress("saving", "Veriler işleniyor...");
    await DB.set("sync_checkpoint", null);

    const snapshot = {
        timestamp: new Date().toISOString(),
        userId,
        currentUser,
        followers: followers.map(mapUser),
        following: following.map(mapUser),
        engagement,
        requests
    };

    try {
        await chrome.storage.local.set({ analysis_snapshot: snapshot });
    } catch (err) {
        throw new Error(`Veri kaydedilemedi (storage): ${err.message || "bilinmeyen hata"}`);
    }

    // Küçük bildirim — payload yok, background storage'dan okuyacak
    chrome.runtime.sendMessage({ type: "ANALYSIS_COMPLETE" }).catch(() => {});
}

// ── Mesaj Dinleyici ───────────────────────────────────────────────────────────

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
    if (message.type === "RUN_ANALYSIS") {
        sendResponse({ ok: true, started: true }); // Hemen ACK gönder
        runAnalysis().catch(err => chrome.runtime.sendMessage({ type: "ANALYSIS_ERROR", error: err.message }).catch(() => {}));
        return false;
    }
    if (message.type === "CHECK_ACCOUNT_STATUS") {
        checkAccountStatus(message.username, message.csrfToken)
            .then(status => sendResponse({ status }))
            .catch(() => sendResponse({ status: "unknown" }));
        return true;
    }
});

async function checkAccountStatus(username, csrfToken) {
    try {
        const res = await fetchWithTimeout(`https://www.instagram.com/api/v1/users/web_profile_info/?username=${encodeURIComponent(username)}`, { headers: igHeaders(csrfToken), credentials: "include" });
        if (res.status === 404) return "deleted";
        if (!res.ok) return "unknown";
        const data = await res.json();
        const u = data?.data?.user;
        if (!u) return "deleted";
        if ((u.edge_owner_to_timeline_media?.count ?? 0) === 0 && (u.edge_followed_by?.count ?? 0) === 0 && (u.edge_follow?.count ?? 0) === 0) return "deactivated";
        return "active";
    } catch { return "unknown"; }
}
