import React from "react";
import ReactDOM from "react-dom/client";
import { GoogleOAuthProvider } from "@react-oauth/google";
import { LanguageProvider } from "./i18n/index.js";
import App from "./App.jsx";
import "./styles/global.css";

const GOOGLE_CLIENT_ID = import.meta.env.VITE_GOOGLE_CLIENT_ID;

ReactDOM.createRoot(document.getElementById("root")).render(
    <React.StrictMode>
        <GoogleOAuthProvider clientId={GOOGLE_CLIENT_ID}>
            <LanguageProvider>
                <App />
            </LanguageProvider>
        </GoogleOAuthProvider>
    </React.StrictMode>
);
