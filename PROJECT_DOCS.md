# ERTHRAUS | IG Analytics Pro — Project Documentation

## 1. Executive Summary

A decentralized Instagram analytics platform that tracks follower/following asymmetries, detects frozen/deleted accounts, and monitors audience changes over time. Risky operations (scraping, session management) are performed in the user's own browser (Chrome Extension) — never on a central server. Data is stored gzip-compressed in an app-private folder of the user's own Google Drive; the app adds no encryption of its own beyond what Drive provides. This eliminates server costs and removes the project from the scope of data protection regulations (GDPR/KVKK).

---

## 2. System Architecture (3-Tier)

> **Note:** the Python desktop app (`insta_flet.py`) was removed from the repository. It still appears below and in the feature matrix because its data file (schema v0) can be imported as a baseline — see 4.6.

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
3. At most 200 checks are queued per sync; they run in batches of 40 per alarm
4. Sleep 3–5 seconds between each check (rate limit protection)
5. If the check itself fails (rate limit, network) the result is "unknown" and
   the user is left unchanged — they stay under "Unfollowers"
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

### 4.6 Retroactive Diff from a Legacy File
*(Chrome Extension only)*

The old desktop app wrote a `<username>_data.json` file (schema v0). The extension can use it as a one-time baseline:

```
1. Popup → "⇪" → import page → choose the file
   (validated, reduced to follower/following usernames + names, kept in chrome.storage.local)
2. Next sync: applyLegacyBaseline(snapshot, baseline)
   ├─ baseline follower, not a follower now  → follower_lost   event
   ├─ follower now, not in the baseline      → follower_gained event
   └─ events carry `since: <baseline date>` and are skipped if already recorded
3. After the snapshot is saved to Drive the local baseline copy is deleted
```

Limits: v0 has no numeric ids, so matching is by username — someone who renamed their account shows up as one lost plus one gained. If fewer than 30% of the baseline's followers still follow, the file is treated as belonging to another account and ignored. The Unfollowers tab shows changes since the previous sync, so the retroactive list is visible until the sync after it (the events stay in the log).

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

## 6. Data Format: Analytics_Snapshot_{userId}.json (schema v3)

### v3 schema

```json
{
  "schema_version": 3,
  "snapshot_at": "2026-05-14T13:00:00.000Z",
  "account": { "pk": "1234567", "username": "...", "full_name": "..." },
  "client": { "name": "chrome_extension", "version": "1.1.0" },

  "users": {
    "<pk>": {
      "username": "...",
      "full_name": "...",
      "profile_pic_url": "<expiring CDN url>",
      "is_verified": false,
      "flags": {
        "is_follower":  true,
        "is_following": true,
        "is_pending":   false,
        "is_requester": false
      },
      "lifecycle": {
        "first_seen_at":    "2026-01-01T00:00:00.000Z",
        "last_seen_at":     "2026-05-14T13:00:00.000Z",
        "status":           "active",
        "status_checked_at": null
      },
      "engagement": {
        "post_likes": 0, "story_views": 0, "story_likes": 0, "score": 0,
        "last_updated_at": null
      }
    }
  },

  "events": [
    { "ts": "...", "type": "follower_gained",  "pk": "..." },
    { "ts": "...", "type": "follower_lost",    "pk": "..." },
    { "ts": "...", "type": "status_changed",   "pk": "...", "from": "active", "to": "deactivated" },
    { "ts": "...", "type": "request_withdrawn","pk": "..." }
  ],

  "history": [
    { "ts": "...", "follower_count": 1240, "following_count": 760 }
  ],

  "metadata": {
    "last_full_sync_at":    "...",
    "previous_snapshot_at": "...",
    "sync_count":           42
  }
}
```

**Design rationale:**
- **Single source of truth.** Categories like `lost`, `new`, `fans`, `not_back`, `deactivated` are **not stored**. They are derived from `users[pk].flags` and `events` by `utils/derive.js`. This eliminates the 3-4× duplication of user data that existed in v2.
- **Lifecycle.** `first_seen_at`/`last_seen_at`/`status`/`status_checked_at` per user enables long-term analytics ("longest-standing follower", "frozen since when").
- **Event log.** Append-only `events` array (capped at 5000) keeps the historical record of follow/unfollow/status changes. Powers premium "trend over time" features.
- **History cap.** 365 entries (was 30) — enough for a year of daily follower-count points.
- **Schema versioning.** Every snapshot carries `schema_version`. Older formats are auto-migrated on read by `utils/migrate.js`.

### Companion files

| File | Purpose |
|------|---------|
| `Analytics_Snapshot_{userId}.json` | Main v3 snapshot (gzip-compressed) |
| `Analytics_Backup_{userId}.json`   | Rolling 1-snapshot backup (previous version, gzipped) — created before each overwrite |
| `Avatars_{userId}.json`            | `{ pk: dataURI }` — base64 profile pictures, kept separate so they don't bloat the main snapshot. Best-effort: if missing, the extension re-fetches on next sync. |

> Profile pictures live in `Avatars_*.json` (not in the main snapshot) so the snapshot stays well under Drive's 10 MB appDataFolder limit even for accounts with thousands of followers.

### Legacy schemas + auto-migration

`utils/migrate.js` transparently migrates older formats to v3 on read:

| Detected | Source format | Migration notes |
|----------|---------------|----------------|
| **v0** | Python desktop `<username>_data.json` — `full_map` keyed by *username*, `pic` is an expired CDN URL, `followers_list`/`following_list` are username arrays, no `pk`. | Each user becomes `users["legacy:<username>"]`. Expired `pic` is dropped. The next real sync produces pk-keyed entries; `reconcileLegacyUsernames()` then folds `legacy:*` into the matching real pk (preserving the earliest `first_seen_at`). |
| **v1** | Early Chrome Extension format with explicit `followers`/`following` arrays + `pk`-keyed `full_map`. | Flags derived from the arrays; lifecycle/engagement initialized to defaults. |
| **v2** | Current Chrome Extension format with `is_follower`/`is_following` inside `full_map`, plus enriched stats lists. | Direct field mapping; stats lists become `events`; `requests.pending` → `flags.is_pending`. |
| **v3** | No migration needed. | Returned as-is. |

Migration is **lazy on read** (any consumer that calls `loadSnapshot()` gets a v3 object back) and **eager on write** (the next sync overwrites with native v3). Detection is purely structural — no field has to be added to old snapshots before reading them.

---

## 7. Chrome Extension Architecture

```
chrome_extension/
├── manifest.json          # Manifest V3 — permissions, host_permissions, oauth2
├── background.js          # Service worker: message router, Drive API calls, alarms
├── popup/
│   ├── popup.html         # Static shell with 5 category tabs
│   ├── popup.js           # Reads diff_result from chrome.storage.local, renders counts
│   └── popup.css          # Dark theme, card styles
├── content/
│   └── instagram.js       # Instagram API calls inside page context
├── import/
│   ├── import.html        # Legacy data file import (opens in its own tab)
│   └── import.js
└── utils/
    ├── analyzer.js        # buildSnapshot / applyStatusChecks / applyLegacyBaseline — pure, unit-testable
    ├── migrate.js         # v0/v1/v2 → v3 transparent schema migration
    ├── derive.js          # Compute stats/engagement from a v3 snapshot
    ├── drive.js           # Google Drive upsert/read + avatars side-file
    └── storage.js         # IndexedDB wrapper (sync checkpoint, etc.)
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
- Deactivated checks: scheduled via `chrome.alarms` **5 minutes after** main analysis, in batches of 40
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

### Phase 2 — Done ✅
- React web client
- Google OAuth login
- Drive data viewer (7-tab dashboard)
- Follower history chart (recharts)
- Engagement scoring (ghost / loyal followers)
- Pending follow request tracking
- JSON export

### Phase 3 — In Progress
- Schema v3 migration (single source of truth, event log, lifecycle)
- Profile picture separation (`Avatars_{userId}.json`)
- Rolling backup (`Analytics_Backup_{userId}.json`)
- 365-day follower history
- Retroactive diff from a legacy v0 file (import page)

### Phase 4 — Future
- Mobile app / PWA
- CSV / Excel export
- Push notifications for follower changes
- Per-post engagement breakdown
- Premium tier (extended history, multi-account, exports)

---

## 12. Setup & Development

### Tests
```bash
npm test           # node --test tests/*.test.js — no install needed (Node 20+)
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
