# Nexconn project audit

Audit date: 2026-11-22. Findings are based on the current source, installed Nexconn SDK 26.2.0 types/bundle, API tests, TypeScript check, production build, and secret scanner. Browser and live Nexconn service verification are listed separately so static checks are not mistaken for runtime proof.

## Audit checklist

| Area | Result | Evidence / remaining work |
| --- | --- | --- |
| Project architecture and scripts | Complete | React/Vite frontend and Express API are served same-origin in production; npm scripts and Docker build reviewed. |
| Authentication and authorization | Implemented; API-tested | bcrypt, HS256 app JWT, HttpOnly cookie, server session row, logout revocation, protected routes, Origin validation, rate limit, tests for invalid/expired/revoked sessions and spoofed account IDs. |
| Nexconn auth boundary | Implemented; live account not verified in this run | App Secret signing and token issuance are server-side; browser receives only the user-scoped token needed by the Web SDK. Console token lifetime must be finite. |
| SDK lifecycle and second login | Implemented; unit-tested | Page-lifetime Chat UI instance is reused; login connects before chat mounts; single-flight and stale-result cancellation tests exist. Live reconnect still requires a connected Nexconn app. |
| Channels and favorites | Implemented; API-tested | Direct/group existing channels, persistent per-user Favorites, All/Unread/Favorites filters. Favorite ownership derives from app session. |
| Message history, timestamp and receipts | Implemented from SDK fields; patch-tested | SDK sentTime is rendered; SENT and read-receipt-backed READ are used. No separate delivered state exists. Real message delivery was previously reported by the owner but was not re-proven in this audit. |
| Search | Implemented with scope limitation | User/channel search and loaded SDK message search exist; no unbounded Nexconn history index. |
| Attachments | Integrated; end-to-end unverified | Uses SDK upload/download flow and `Message.downloadMedia()`, image/PDF preview behavior, inline PDF disposition; real sender/receiver transfer, expiry and browser preview require Nexconn credentials and two sessions. |
| Database | Implemented; schema reviewed | SQLite users/sessions/favorites; foreign keys, indexes, WAL, idempotent DDL. No versioned migrations; one service instance and durable disk required. |
| Existing account-data migration | Prepared; fixture-tested | `npm run db:prepare-migration` uses SQLite online backup, keeps accounts/favorites, clears prior sessions, checks integrity and reports counts only. Transfer output securely after creating the live persistent volume. |
| Responsive/accessibility UI | Source and regression tests pass; browser QA pending | Mobile layout and SDK themes are covered by source tests; device/browser screenshots and interaction audit were not run in this turn. |
| Security headers and logging | Implemented; static checks pass | Helmet/CSP, request-size cap, safe API diagnostics, SDK error-only log level; vendor patch removes raw message/debug logs. Inline styles remain permitted for Lit SDK rendering. |
| Environment and Git secret checks | Passed | `.env` ignored and untracked; template placeholders only; client-bundle secret scan passed without printing values. No commit history exists to inspect. |
| Dependency audit | Passed | `npm audit` and production-only audit report zero vulnerabilities. SDK peer mismatch is documented in `.npmrc`/README. |
| Lint and formatting | Not configured | No ESLint/formatter script or dependency exists; none was added solely to imply a clean lint run. |
| Public hosting | Not configured | No GitHub remote or hosting-account access; no live URL is claimed. |

## Findings fixed in this pass

1. The SDK postinstall patch's empty-replacement idempotency check could skip removal of a debug statement during clean installs. It now distinguishes “replacement already applied” from “empty replacement source still exists,” and the installed SDK bundle test checks for raw-message and picker/channel debug strings.
2. Production server configuration could silently fall back to local development defaults or defer Nexconn configuration failure until account registration. Startup now requires the correct production origins/credentials, supported region, and an absolute persistent SQLite path. It validates `PORT` and `TRUST_PROXY_HOPS`; Express only trusts the configured proxy count.
3. The root README lacked the requested architecture, auth/message flow, data model, route inventory, file lifecycle, verification limits and production deployment steps. It now documents those based on the current code and labels unverified deployment/service behaviors.

## Cleanup assessment

No project files, folders, or direct dependencies were deleted. In the reviewed small repo, UI assets are loaded dynamically or by SDK configuration; SDK patching, license notices, tests, Docker configuration, environment templates and SQLite storage are required. No deletion was justified by actual references or build behavior. Build outputs, dependency directories, local data, logs and `.env` remain excluded from Git.

## Verification record

- `npm test`: 38 passed, 0 failed.
- `npx tsc --noEmit`: passed.
- `npm run build`: passed; warning remains for the SDK Engine chunk (860 kB minified / roughly 179 kB gzip).
- `npm audit`: zero vulnerabilities.
- `npm audit --omit=dev --audit-level=moderate`: zero vulnerabilities.
- `npm run audit:secrets`: passed; the scanner checked local secret-like values without printing them and confirmed `.env` is ignored/untracked.
- `git diff --check`: passed for available tracked diff; project files are currently untracked because the repository has no commits.
- Clean `npm ci`: not fully verified because the running local Node/Vite processes held native Windows dependency files open (`EPERM`). `npm install --ignore-scripts` restored dependencies, `npm rebuild better-sqlite3` restored the native binding, then the postinstall patch, test suite, typecheck and build passed. Repeat `npm ci` after stopping local dev processes.
- The database migration utility was tested against a temporary fixture containing an account, session and favorite; it preserved the account/favorite, removed the session only from the export, and passed SQLite integrity checking. A private local migration export was generated from the active database and passed SQLite integrity checking; it is ignored by Git and has not been uploaded.
- Live Nexconn message/file transfer, current Console token expiry, browser/device screenshot QA, and a public deployment were not verified.

## GitHub/deployment blocker

Current Git state is branch `master`, zero commits, zero remotes, and all source files untracked. The exact target GitHub repository and initial branch are unknown. The attached master instructions explicitly require stopping when the remote is missing, so no initial commit or push was created. Provide the intended GitHub repository URL (and confirm `master` or `main`) to continue. A hosting account, private production secrets, persistent disk, and optional custom domain must also be configured before deployment.
