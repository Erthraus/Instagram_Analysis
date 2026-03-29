import { createContext, useContext, useState, useEffect, createElement } from "react";

// ── Translations ───────────────────────────────────────────────────────────────

const translations = {
    tr: {
        // Login / Auth
        signInTitle: "Google ile Giriş Yap",
        signInDesc: "Instagram analizlerini görüntülemek için Google hesabınla giriş yap.\nVerilerin kendi Google Drive'ında saklanır.",
        signInBtn: "Google ile Giriş Yap",
        signInHint: "Önce masaüstünde Chrome Extension ile veri senkronize et.",

        // Loading
        loading: "Veriler Google Drive'dan yükleniyor...",

        // Error
        tryAgain: "Tekrar Dene",
        signOut: "Çıkış",

        // No Data
        noDataTitle: "Henüz Veri Yok",
        noDataDesc: "IG Analytics Chrome Extension'ı yükle, instagram.com'u aç ve Sync'e bas. Ardından buraya geri dön.",

        // Dashboard Header
        refresh: "Yenile",
        logout: "Çıkış",

        // Tabs
        tabLost: "Takipten Çıkanlar",
        tabNotBack: "Geri Takip Etmeyenler",
        tabNew: "Yeni Takipçiler",
        tabFans: "Karşılıksız Takip",
        tabDeactivated: "Dondurulmuş / Silindi",
        tabEngagement: "Etkileşim",
        tabRequests: "İstek Gönderenler",

        // Footer
        lastUpdated: "Son güncelleme",
        dataStoredDrive: "Veriler Google Drive'ınızda saklanıyor",

        // Category List
        users: "kullanıcı",
        filterAll: "Tümü",
        filterVerified: "✓ Onaylı",
        filterUnverified: "Onaysız",
        searchPlaceholder: "Ara...",
        noUsersInCategory: "Bu kategoride kullanıcı yok.",
        loadMore: "Daha fazla yükle",
        remaining: "kaldı",

        // Engagement Tab
        ghostFollowers: "Hayalet Takipçi",
        topEngagement: "En Çok Etkileşim",
        engagementNote: "Gönderi beğenisi + hikaye görüntülenme/beğeni",
        noEngagementData: "Etkileşim verisi yok.",
        noEngagementHint: "Extension'dan bir sonraki sync'te hikaye görüntülemeleri analiz edilecek.",

        // Requests Tab
        pendingRequests: "Bekleyen İstekler",
        withdrawnRequests: "Geri Çekilen İstekler",
        noRequests: "Bekleyen istek yok.",
        noWithdrawn: "Geri çekilen istek yok.",
        requestsNote: "Seni takip etmek isteyen ancak henüz onaylamadığın hesaplar",
        withdrawnNote: "Daha önce istek gönderip geri çeken hesaplar",

        // Chart
        chartNoData: "Grafik için yeterli veri yok. Trendleri görmek için en az iki kez senkronize edin.",
        chartTitle: "Takipçi Geçmişi",

        // UserCard / Engagement breakdown
        verifiedTitle: "Onaylı Hesap",
        interactionsTitle: "Etkileşim puanı",
        postLikes: "gönderi ♥",
        storyViews: "hikaye 👁",
        storyLikes: "hikaye ♥",
        score: "puan",
        noScore: "etkileşim yok",
    },
    en: {
        // Login / Auth
        signInTitle: "Sign In with Google",
        signInDesc: "Sign in with Google to view your Instagram analytics.\nYour data is stored privately in your own Google Drive.",
        signInBtn: "Sign in with Google",
        signInHint: "Use the Chrome Extension on your desktop to sync data first.",

        // Loading
        loading: "Loading your analytics from Google Drive...",

        // Error
        tryAgain: "Try Again",
        signOut: "Sign Out",

        // No Data
        noDataTitle: "No Data Yet",
        noDataDesc: "Install the IG Analytics Chrome Extension, open instagram.com, and click Sync. Then come back here.",

        // Dashboard Header
        refresh: "Refresh",
        logout: "Sign Out",

        // Tabs
        tabLost: "Unfollowers",
        tabNotBack: "Not Following Back",
        tabNew: "New Followers",
        tabFans: "One-Sided Follow",
        tabDeactivated: "Frozen / Deleted",
        tabEngagement: "Engagement",
        tabRequests: "Follow Requests",

        // Footer
        lastUpdated: "Last updated",
        dataStoredDrive: "Your data is stored in Google Drive",

        // Category List
        users: "users",
        filterAll: "All",
        filterVerified: "✓ Verified",
        filterUnverified: "Unverified",
        searchPlaceholder: "Search...",
        noUsersInCategory: "No users in this category.",
        loadMore: "Load more",
        remaining: "remaining",

        // Engagement Tab
        ghostFollowers: "Ghost Followers",
        topEngagement: "Top Engagement",
        engagementNote: "Post likes + story views/likes",
        noEngagementData: "No engagement data available.",
        noEngagementHint: "Story views will be analyzed on the next extension sync.",

        // Requests Tab
        pendingRequests: "Pending Requests",
        withdrawnRequests: "Withdrawn Requests",
        noRequests: "No pending requests.",
        noWithdrawn: "No withdrawn requests.",
        requestsNote: "Accounts that requested to follow you but you haven't approved yet",
        withdrawnNote: "Accounts that sent a follow request and then withdrew it",

        // Chart
        chartNoData: "Not enough data for chart yet. Sync at least twice to see trends.",
        chartTitle: "Follower History",

        // UserCard / Engagement breakdown
        verifiedTitle: "Verified Account",
        interactionsTitle: "Engagement score",
        postLikes: "post ♥",
        storyViews: "story 👁",
        storyLikes: "story ♥",
        score: "score",
        noScore: "no engagement",
    }
};

// ── Context ────────────────────────────────────────────────────────────────────

const LanguageContext = createContext(null);
const STORAGE_KEY = "ig_analytics_lang";

export function LanguageProvider({ children }) {
    const [lang, setLang] = useState(() => {
        return localStorage.getItem(STORAGE_KEY) || "tr";
    });

    useEffect(() => {
        localStorage.setItem(STORAGE_KEY, lang);
    }, [lang]);

    const t = (key) => translations[lang]?.[key] ?? translations["tr"][key] ?? key;
    const toggle = () => setLang(l => l === "tr" ? "en" : "tr");

    return createElement(LanguageContext.Provider, { value: { lang, t, toggle } }, children);
}

export function useLanguage() {
    return useContext(LanguageContext);
}
