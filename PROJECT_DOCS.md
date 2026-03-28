# ERTHRAUS | IG Analytics Pro — Project Documentation

## 1. Executive Summary

A decentralized Instagram analytics platform that tracks follower/following asymmetries, detects frozen/deleted accounts, and monitors audience changes over time. Risky operations (scraping, session management) are performed either through the user's own browser (Chrome Extension) or their desktop app — never on a central server. Data is stored encrypted and isolated in the user's own Google Drive. This eliminates server costs and removes the project from the scope of data protection regulations (GDPR/KVKK).

---

## 2. System Architecture (3-Tier)

```
┌─────────────────────────────────────────────────────────┐
│  Tier 1: Data Collection                                 │
│  ┌─────────────────────┐   ┌──────────────────────────┐ │
│  │  Python Desktop App │   │   Chrome Extension (MV3) │ │
│  │  (insta_flet.py)    │   │   (chrome_extension/)    │ │
│  │  - instaloader      │   │   - Instagram internal   │ │
│  │  - Session cookies  │   │     API endpoints        │ │
│  │  - Local JSON       │   │   - IndexedDB cache      │ │
│  └─────────────────────┘   └──────────────────────────┘ │
└─────────────────────┬───────────────────────────────────┘
                      │ writes Analytics_Snapshot.json
                      ▼
┌─────────────────────────────────────────────────────────┐
│  Tier 2: Storage                                         │
│  Google Drive appDataFolder (hidden, app-private)        │
│  - Only this app can read/write                          │
│  - Not visible in user's standard Drive UI              │
│  - Max 10 MB per file                                    │
└─────────────────────┬───────────────────────────────────┘
                      │ reads via OAuth 2.0
                      ▼
┌─────────────────────────────────────────────────────────┐
│  Tier 3: Presentation                                    │
│  React Web Client (web_client/) — statically hosted      │
│  - Google OAuth login                                    │
│  - Reads Drive JSON, renders charts + lists             │
│  - No backend, no server — Vercel / GitHub Pages        │
└─────────────────────────────────────────────────────────┘
```

**Why this design?**
- Traditional server-side requests hit CORS blocks and IP bans. The browser extension uses the active organic session — not flagged as a bot.
- `appDataFolder` is a hidden app-private folder: zero data breach risk and zero database maintenance cost.
- The web client is a pure "viewer" — separating presentation from data collection prevents session conflicts.

---

## 3. Feature Matrix

| Feature | Python App | Chrome Extension | Web Client |
|---------|-----------|-----------------|------------|
| Non-followers (not_back) | ✅ | ✅ | ✅ (view) |
| New followers | ✅ | ✅ | ✅ (view) |
| Unfollowers (lost) | ✅ | ✅ | ✅ (view) |
| Fans (follow you, you don't follow back) | ✅ | ✅ | ✅ (view) |
| Frozen / Deleted accounts | ✅ | ✅ | ✅ (view) |
| Historical comparison | ✅ | ✅ | ✅ (chart) |
| Google Drive sync | ❌ | ✅ | ✅ |
| Rate limit protection | ✅ | ✅ | N/A |
| Cross-device access | ❌ | ✅ (via Drive) | ✅ |

---

## 4. Algorithm Documentation

### 4.1 Non-followers
```
not_back = following_set − followers_set
```
Recalculated from scratch on every sync.

### 4.2 Unfollowers & New Followers (Diff)
```
lost = T1_followers − T2_followers     # was following, now isn't
new  = T2_followers − T1_followers     # wasn't following, now is
```
Where T1 = previous snapshot, T2 = current snapshot.

### 4.3 Frozen / Deleted Account Detection
For each user in `lost`, after comparing snapshots:

```
1. Try to load profile via API
   ├─ ProfileNotExistsException (HTTP 404) → "deleted"
   ├─ Profile loads but mediacount=0 AND followers=0 AND followees=0 → "deactivated"
   └─ Profile loads normally → "active" (truly unfollowed)

2. Classification carries forward to next run (no re-checking stable entries)
3. If newly_lost > 50: process first 50, defer rest to next run
4. Sleep 2.5–4.0 seconds between each check (rate limit protection)
```

**Why this matters:** Without this check, a deactivated account would appear in the "Unfollowers" tab — a false positive. This separates intentional unfollows from account deactivations.

### 4.4 Pending & Canceled Follow Requests
*(Chrome Extension only)*
Sent requests are scraped from DOM / internal API. Compared to previous snapshot:
- Was in T1, not in T2 → request canceled or accepted
- In T2, not in T1 → new pending request

### 4.5 Ghost / Loyal Followers (Interaction Scoring)
*(Future feature)*
User's last N posts + 24h stories are scanned. Likes, comments, story views are mapped to follower IDs:
- High interaction → "Loyal Followers"
- Zero interaction → "Ghost Followers"

---

## 5. Instagram Internal API Reference

All endpoints require these headers:
```
X-CSRFToken: {csrftoken_cookie}
X-IG-App-ID: 936619743392459
X-Requested-With: XMLHttpRequest
credentials: include  (sends session cookie)
```

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/api/v1/friendships/{user_id}/followers/?count=200&max_id={cursor}` | GET | Paginated followers list |
| `/api/v1/friendships/{user_id}/following/?count=200&max_id={cursor}` | GET | Paginated following list |
| `/api/v1/users/web_profile_info/?username={username}` | GET | Profile info (deactivated check) |
| `/api/v1/users/{user_id}/info/` | GET | Detailed user info |

**Pagination:** Each response includes `next_max_id`. Keep fetching until `next_max_id` is null.

**Auth Extraction (Chrome Extension):**
```javascript
// ds_user_id = numeric user ID, csrftoken = CSRF token
const cookies = Object.fromEntries(document.cookie.split('; ').map(c => c.split('=')));
const { ds_user_id: userId, csrftoken: csrfToken } = cookies;
```

---

## 6. Data Format: Analytics_Snapshot.json

```json
{
  "timestamp": "2026-03-27 14:30:00",
  "full_map": {
    "username123": {
      "username": "username123",
      "full_name": "Display Name",
      "pk": "123456789"
    }
  },
  "followers_list": ["username1", "username2"],
  "following_list": ["username1", "username3"],
  "history": [
    { "timestamp": "2026-03-20 10:00:00", "follower_count": 1240 },
    { "timestamp": "2026-03-27 14:30:00", "follower_count": 1255 }
  ],
  "stats": {
    "lost":        ["username_a"],
    "not_back":    ["username_b"],
    "new":         ["username_c"],
    "fans":        ["username_d"],
    "deactivated": ["username_e"]
  }
}
```

> **Note:** Profile picture URLs (`pic`) are NOT stored in Drive — Instagram CDN URLs contain expiring tokens (`oe=` parameter, expires 24–48h). Only `pk`, `username`, and `full_name` are persisted.

---

## 7. Chrome Extension Architecture

```
chrome_extension/
├── manifest.json          # Manifest V3 — permissions, host_permissions, oauth2
├── background.js          # Service worker: message router, Drive API calls, alarms
├── popup/
│   ├── popup.html         # Static shell with 5 category tabs
│   ├── popup.js           # Reads IndexedDB, dispatches messages, renders counts
│   └── popup.css          # Dark theme, card styles
├── content/
│   └── instagram.js       # Instagram API calls inside page context
└── utils/
    ├── analyzer.js        # Pure diff functions — unit-testable in Node.js
    ├── drive.js           # Google Drive upsert/read (appDataFolder)
    └── storage.js         # IndexedDB wrapper (current + previous snapshots)
```

### Required Permissions (manifest.json)
```json
{
  "permissions": ["cookies", "storage", "identity"],
  "host_permissions": [
    "https://www.instagram.com/*",
    "https://www.googleapis.com/*"
  ],
  "oauth2": {
    "client_id": "YOUR_GOOGLE_CLIENT_ID.apps.googleusercontent.com",
    "scopes": ["https://www.googleapis.com/auth/drive.appdata"]
  }
}
```

### Rate Limiting Strategy
- Followers fetch → **30 second pause** → Following fetch
- Deactivated checks: scheduled via `chrome.alarms` **5 minutes after** main analysis
- On HTTP 429 or 401: exponential backoff — `2^attempt × 5000ms`, max 3 retries
- Last-run timestamp stored in `chrome.storage.local`; block re-run if < 30 minutes elapsed

### Critical Implementation Notes
- `chrome.runtime.onMessage` listeners **must `return true`** for async `sendResponse` calls — missing this silently closes the message port
- Manifest `"type": "module"` is required in background for ES module `import/export` syntax
- For local dev (no Chrome Web Store): use `chrome.identity.launchWebAuthFlow()` instead of `chrome.identity.getAuthToken()`

---

## 8. Google Drive Integration

### appDataFolder Properties
- Hidden from user's standard Drive UI
- Only this application can read/write to it
- Max file size: 10 MB
- Identified by `spaces=appDataFolder` query parameter

### Upsert Pattern
```
1. GET /drive/v3/files?spaces=appDataFolder&q=name='Analytics_Snapshot.json'&fields=files(id)
2. If file exists → PATCH /upload/drive/v3/files/{id}?uploadType=multipart
3. If not exists → POST /upload/drive/v3/files?uploadType=multipart
   Body: multipart with metadata { name, parents: ['appDataFolder'] } + JSON content
```

### OAuth Scope
```
https://www.googleapis.com/auth/drive.appdata
```

---

## 9. React Web Client Architecture

```
web_client/
├── package.json           # React 18, Vite 5, recharts, @react-oauth/google
├── vite.config.js
└── src/
    ├── App.jsx            # State machine: login → loading → dashboard
    ├── hooks/
    │   ├── useGoogleAuth.js   # OAuth token via @react-oauth/google
    │   └── useDriveData.js    # Fetches snapshot JSON from Drive
    ├── components/
    │   ├── Dashboard.jsx      # 5-tab layout
    │   ├── UserCard.jsx       # Single user display
    │   ├── CategoryList.jsx   # Scrollable user list per category
    │   └── Chart.jsx          # recharts LineChart for follower history
    └── utils/
        └── driveApi.js        # loadSnapshot(token), saveSnapshot(token, data)
```

**State Flow:**
```
No token → <GoogleLoginButton>
Token + loading → <Spinner>
Token + snapshot → <Dashboard> (5 tabs: Lost, Not Back, New, Fans, Frozen/Deleted)
```

**Hosting:** Vercel (free tier) or GitHub Pages — fully static, zero server cost.

---

## 10. Monetization Strategy

| Revenue Source | Mechanism | Notes |
|---------------|-----------|-------|
| Ad Placement | Google AdSense on web client | Loading screens, between-tab transitions have high impression rates |
| Premium Tier | Unlock history charts, CSV export, 2+ accounts | Stripe one-time or subscription |
| No data sales | User data never touches our servers | Legal safety and trust differentiator |

**Unit economics:** No server = no infrastructure cost. Break-even requires minimal ad revenue or a small number of premium subscribers.

---

## 11. Development Roadmap

### Phase 0 — Done ✅
- Python desktop app (`insta_flet.py`)
- Follower diff analysis (lost, new, not_back, fans)
- Frozen / deleted account detection tab
- Session persistence + Firefox cookie import

### Phase 1 — In Progress
- Chrome Extension scaffold (Manifest V3)
- Instagram internal API integration
- Google Drive appDataFolder sync
- IndexedDB local cache

### Phase 2 — Planned
- React web client
- Google OAuth login
- Drive data viewer (5-tab dashboard)
- Follower history chart (recharts)

### Phase 3 — Future
- Mobile app (React Native / Flutter)
- Interaction analytics (ghost/loyal follower scoring)
- Pending follow request tracking
- CSV / Excel export
- Push notifications for follower changes

---

## 12. Setup & Development

### Python Desktop App
```bash
cd Instagram_Analysis
python -m venv .venv
source .venv/bin/activate   # Windows: .venv\Scripts\activate
pip install -r requirements.txt
python insta_flet.py
```

### Chrome Extension (Local)
1. Open `chrome://extensions/` in Chrome
2. Enable **Developer Mode**
3. Click **Load unpacked** → select `chrome_extension/` directory
4. Navigate to instagram.com (must be logged in)
5. Click extension icon → **Sync**

### React Web Client
```bash
cd web_client
npm install
npm run dev        # Local dev server
npm run build      # Production build → dist/
```
Deploy `dist/` to Vercel or GitHub Pages.

### Google Cloud Setup (for Drive + Extension OAuth)
1. Go to [console.cloud.google.com](https://console.cloud.google.com)
2. Create project → Enable **Google Drive API**
3. OAuth Consent Screen → External, add `drive.appdata` scope
4. Credentials → Create OAuth 2.0 Client ID (Chrome Extension)
5. Copy Client ID → `chrome_extension/manifest.json` → `oauth2.client_id`
6. For web client: Create separate OAuth Client ID (Web Application)
   - Authorized origins: `http://localhost:5173` (dev) + your Vercel domain
