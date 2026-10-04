# IG Analytics — instructions for AI sessions

- Read `PROJE-DURUM-VE-HANDOFF.md` first: it holds the current status, open issues and next step.
  When you finish a piece of work, update its "Hızlı bakış" table and add an entry to the work log.
- `PROJECT_DOCS.md` is the technical reference (architecture, schema v3, algorithms).
- Run `npm test` from the repository root before committing. For the web client also run
  `cd web_client && npm run build`.
- `chrome_extension/utils/migrate.js` and `derive.js` are duplicated in `web_client/src/utils/`.
  Change both copies together; a test fails if they differ.
- This repository is public. Never commit personal Instagram data (`*_data.json`, `session_*`),
  `.env` files, or real usernames in docs, tests or fixtures.
- Code, comments and commit messages are in English. The handoff document is in Turkish.
