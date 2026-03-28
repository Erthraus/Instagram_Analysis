import { useState, useCallback, useEffect } from "react";
import { useGoogleLogin } from "@react-oauth/google";

const TOKEN_KEY  = "ig_analytics_token";
const EXPIRY_KEY = "ig_analytics_token_expiry";

function loadStoredToken() {
    try {
        const token  = localStorage.getItem(TOKEN_KEY);
        const expiry = parseInt(localStorage.getItem(EXPIRY_KEY) || "0", 10);
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
                localStorage.setItem(TOKEN_KEY, access_token);
                localStorage.setItem(EXPIRY_KEY, String(expiresAt));
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
        try {
            localStorage.removeItem(TOKEN_KEY);
            localStorage.removeItem(EXPIRY_KEY);
        } catch {}
        setToken(null);
        setError(null);
    }, []);

    return { token, error, login, logout };
}
