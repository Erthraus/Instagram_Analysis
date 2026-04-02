import { useState, useCallback, useEffect } from "react";
import { useGoogleLogin } from "@react-oauth/google";

const TOKEN_KEY  = "ig_analytics_token";
const EXPIRY_KEY = "ig_analytics_token_expiry";

function loadStoredToken() {
    try {
        const token  = sessionStorage.getItem(TOKEN_KEY);
        const expiry = parseInt(sessionStorage.getItem(EXPIRY_KEY) || "0", 10);
        if (token && Date.now() < expiry) return token;
    } catch {}
    return null;
}

export function useGoogleAuth() {
    const [token, setToken] = useState(() => loadStoredToken());
    const [error, setError] = useState(null);

    const login = useGoogleLogin({
        scope: "https://www.googleapis.com/auth/drive.appdata",
        onSuccess: (tokenResponse) => {
            const { access_token, expires_in = 3600 } = tokenResponse;
            const expiresAt = Date.now() + expires_in * 1000 - 60_000; // 1 min buffer
            try {
                sessionStorage.setItem(TOKEN_KEY, access_token);
                sessionStorage.setItem(EXPIRY_KEY, String(expiresAt));
            } catch {}
            setToken(access_token);
            setError(null);
        },
        onError: (err) => {
            setError("Google login failed. Please try again.");
            console.error("OAuth error:", err);
        }
    });

    const logout = useCallback(() => {
        const currentToken = token;
        try {
            sessionStorage.removeItem(TOKEN_KEY);
            sessionStorage.removeItem(EXPIRY_KEY);
        } catch {}
        setToken(null);
        setError(null);
        // Revoke the token so it can't be reused
        if (currentToken) {
            fetch(`https://oauth2.googleapis.com/revoke?token=${currentToken}`, {
                method: "POST",
                headers: { "Content-Type": "application/x-www-form-urlencoded" },
            }).catch(() => {});
        }
    }, [token]);

    // Auto-logout when token expires
    useEffect(() => {
        if (!token) return;
        const expiry = parseInt(sessionStorage.getItem(EXPIRY_KEY) || "0", 10);
        const remaining = expiry - Date.now();
        if (remaining <= 0) { logout(); return; }
        const timer = setTimeout(logout, remaining);
        return () => clearTimeout(timer);
    }, [token, logout]);

    return { token, error, login, logout };
}
