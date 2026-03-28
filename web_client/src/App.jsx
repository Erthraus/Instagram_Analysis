import { useEffect } from "react";
import { useGoogleAuth } from "./hooks/useGoogleAuth.js";
import { useDriveData } from "./hooks/useDriveData.js";
import { Dashboard } from "./components/Dashboard.jsx";
import { useLanguage } from "./i18n/index.js";

function LangToggle() {
    const { lang, toggle } = useLanguage();
    return (
        <button className="btn-lang" onClick={toggle} title="TR / EN">
            {lang === "tr" ? "EN" : "TR"}
        </button>
    );
}

export default function App() {
    const { token, error: authError, login, logout } = useGoogleAuth();
    const { snapshot, modifiedTime, accounts, selectedId, loading, error: driveError, refresh, switchAccount } = useDriveData(token);
    const { t } = useLanguage();

    // Auto-logout when Drive token is expired or invalid (401)
    useEffect(() => {
        if (driveError?.includes("401")) logout();
    }, [driveError, logout]);

    // ── Login Screen ──────────────────────────────────────────────────────────
    if (!token) {
        return (
            <div className="screen-center">
                <div className="login-card">
                    <div className="login-logo">IG Analytics</div>
                    <p className="login-desc">
                        {t("signInDesc").split("\n").map((line, i) => (
                            <span key={i}>{line}{i === 0 && <br />}</span>
                        ))}
                    </p>
                    {authError && <div className="error-msg">{authError}</div>}
                    <button className="btn-google" onClick={() => login()}>
                        <svg viewBox="0 0 24 24" width="18" height="18">
                            <path fill="#4285F4" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"/>
                            <path fill="#34A853" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"/>
                            <path fill="#FBBC05" d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z"/>
                            <path fill="#EA4335" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"/>
                        </svg>
                        {t("signInBtn")}
                    </button>
                    <p className="login-hint">{t("signInHint")}</p>
                    <LangToggle />
                </div>
            </div>
        );
    }

    // ── Loading Screen ────────────────────────────────────────────────────────
    if (loading) {
        return (
            <div className="screen-center">
                <div className="spinner-lg"></div>
                <p className="loading-label">{t("loading")}</p>
            </div>
        );
    }

    // ── Error Screen ──────────────────────────────────────────────────────────
    if (driveError) {
        return (
            <div className="screen-center">
                <div className="error-card">
                    <div className="error-icon">⚠️</div>
                    <p>{driveError}</p>
                    <div className="error-actions">
                        <button className="btn-primary" onClick={refresh}>{t("tryAgain")}</button>
                        <button className="btn-ghost" onClick={logout}>{t("signOut")}</button>
                    </div>
                </div>
            </div>
        );
    }

    // ── No Data Screen ────────────────────────────────────────────────────────
    if (!snapshot) {
        return (
            <div className="screen-center">
                <div className="login-card">
                    <div className="login-logo">{t("noDataTitle")}</div>
                    <p className="login-desc">{t("noDataDesc")}</p>
                    <button className="btn-ghost" onClick={logout}>{t("signOut")}</button>
                    <LangToggle />
                </div>
            </div>
        );
    }

    // ── Dashboard ─────────────────────────────────────────────────────────────
    return (
        <Dashboard
            snapshot={snapshot}
            modifiedTime={modifiedTime}
            accounts={accounts}
            selectedId={selectedId}
            onSwitchAccount={switchAccount}
            onLogout={logout}
            onRefresh={refresh}
        />
    );
}
