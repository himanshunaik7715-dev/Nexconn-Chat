# Credential and authentication audit

Audit date: 2026-11-22

This report records credential names and findings only. It does not contain credential values.

## Findings

- The local `nexconn-demo/.env` contains populated `JWT_SECRET` and `NEXCONN_APP_SECRET` entries, along with the Nexconn App Key and non-secret connection settings. The secret values were not printed. Because local `.env` material may have appeared in screenshots, treat both secret entries as potentially exposed.
- The checked-in template `.env.example` was found with populated `JWT_SECRET`, `NEXCONN_APP_KEY`, and `NEXCONN_APP_SECRET` values during the localhost error investigation. It has now been corrected to use placeholders; if those former secret values were shared, rotate the former JWT secret and App Secret as above. The App Key is an identifier and does not need rotation solely due to exposure. The secret audit now also rejects non-placeholder sensitive values in `.env.example`.
- The current `.env` does not contain `NEXCONN_ACCESS_KEY`, `VITE_NEXCONN_ACCESS_KEY`, or `VITE_NEXCONN_USER_TOKEN`. Earlier workspace material had populated `VITE_NEXCONN_ACCESS_KEY` and `VITE_NEXCONN_USER_TOKEN` entries. Treat those previously displayed values as exposed even though they are absent from the current file.
- `NEXCONN_APP_KEY` is an application identifier required by the Web SDK and is sent in Nexconn Server API headers. It is not the App Secret. The app returns the App Key with the authenticated SDK connection configuration because the browser SDK must initialize with it.
- The Nexconn Chat session JWT is signed and verified only by the server. The browser receives it only as an HttpOnly, SameSite=Strict cookie (Secure in production); protected endpoints derive account identity from the verified JWT and matching server-side session row.
- The server signs the documented Nexconn access-token request. App Secret handling, request signing, token issuance, user-ID matching, and response shape are server-side. No Access Key management or credential regeneration API is called by the app.
- The Web SDK requires a per-user Nexconn access token to connect. The server returns that user identity token to the browser in the login/session response, as the Nexconn Web SDK flow requires; Nexconn Chat does not put it in localStorage or sessionStorage. Treat it as a bearer credential for that Nexconn user. Nexconn documentation says these tokens are valid indefinitely by default unless the Console token-validity setting is changed, and multiple tokens for a user can remain valid concurrently. The app cannot verify the Console validity setting. Set and verify a finite validity period before production use.
- The supplied browser console transcript contained Nexconn SDK debug/info messages that included the user's access token in connection/navigation logs. This token is potentially compromised and should be expired in the Nexconn Console/API. The app now configures the SDK to emit errors only in development and production; SDK debug/info payloads are disabled.
- Nexconn's `RCConnectionStatus` values are `CONNECTED=0`, `CONNECTING=1`, `DISCONNECTED=2`, and `SUSPENDED=3`; the app now maps those correctly. The documented `RC_CONN_TOKEN_EXPIRED` code (`31020`) is shown as a reconnect error. A page refresh obtains a new token through the documented server-side issue-token API. There is no silent automatic renewal: Nexconn documents token issuance and expiry, but the Console's validity configuration and a refresh-token grant are not available to this app. Each new issued token can remain valid independently, so configure finite validity in the Console.
- The SDK package itself uses browser local storage for internal cache/configuration data. Static inspection found SDK-managed cache/navigation fields and a device ID; Nexconn Chat application code does not store its JWT or Nexconn token there. The minified vendor SDK is not a security boundary, so the per-user token should still be considered exposed to code running in the page and browser extensions.
- Production startup now fails closed when the public origin is not an exact HTTPS origin, Nexconn API URL is not a clean HTTPS origin, the database path is not absolute, the configured region is unsupported, or the Nexconn server credentials are missing. `TRUST_PROXY_HOPS` defaults to zero and must match the verified host proxy topology for accurate client-IP rate limits.
- GitHub publication is not configured in this workspace: `master` has no commits, there are no remotes, and all intended project files are untracked. `.env` is ignored. Do not create a commit/push until the owner supplies the intended repository URL and initial-branch choice.

## Exposure and rotation recommendations

No credential was rotated, revoked, or changed during this audit.

1. Rotate the value in `nexconn-demo/.env` named `NEXCONN_APP_SECRET` in the Nexconn Console if it was visible in a screenshot or shared material. Nexconn documents that refreshing the App Secret invalidates existing Nexconn access tokens; users will need fresh tokens to reconnect.
2. Replace `nexconn-demo/.env`'s `JWT_SECRET` with a new random value if it was visible. This invalidates existing Nexconn Chat session cookies and signs users out.
3. Revoke/regenerate the previously populated `VITE_NEXCONN_ACCESS_KEY` in Nexconn Access Key Management if it appeared in shared material. This app does not use that Access Key.
4. Expire the user-scoped token visible in the supplied console transcript, and the previously populated `VITE_NEXCONN_USER_TOKEN` if it is still valid. Nexconn documents `POST /v4/auth/access-token/expire`; this invalidates eligible tokens for future connections but does not immediately disconnect an already connected session.
5. Do not rotate `NEXCONN_APP_KEY` solely because it was visible; Nexconn defines it as the client SDK/application identifier. Review the Console separately if it was paired with a compromised App Secret or Access Key.

These steps affect active credentials or sessions and require explicit authorization. They were not performed by this audit.

## Checks performed

- Inspected app source, server routes, Nexconn request signer, Vite configuration, `.env` variable names, `.env.example`, current build assets, and relevant repository state without printing values. The development server's configured port was 3000 while Vite's `/api` proxy was hard-coded to 3001; Vite now reads only the `PORT` setting and proxies to the matching server port. Local smoke checks now return 200 for `/api/health` through Vite and 401 for unauthenticated `/api/auth/session` (expected).
- Compared each populated secret-like `.env` value to the current browser build. Neither `JWT_SECRET` nor `NEXCONN_APP_SECRET` is present in the bundle.
- Confirmed `.env` is ignored and untracked. The new app repository has no commits or staged files. The separate SDK repository's seven commits were scanned for common literal credential patterns; none matched.
- Added tests for missing, invalid, expired JWTs, expired server sessions, logout revocation, and a request that attempts to change another user's profile. The server uses the signed-in user's ID and ignores the spoofed ID.
- Inspected the supplied SDK logs: connection status advanced from `CONNECTING` to `CONNECTED`. Fixed the chat view to initialize from the SDK's current status so it does not remain stuck on “Connecting…” after missing the initial event. Disabled verbose SDK logs that included the token.
- Ran the current `npm test` suite: 38 passed, 0 failed. `npx tsc --noEmit` passed. `npm run build` passed, with a remaining SDK Engine chunk-size warning (860 kB minified, about 179 kB gzip). `npm audit` and `npm audit --omit=dev --audit-level=moderate` reported zero vulnerabilities. `npm run audit:secrets` passed and printed no values. The 26.2.0 postinstall patch now removes its raw-message/debug output idempotently, and the installed-bundle regression test covers those output markers.
- `npm ci` could not replace native dependency binaries while the local dev server was holding files open. Dependencies were restored with `npm install --ignore-scripts`, then the guarded SDK postinstall patch and `npm rebuild better-sqlite3` were run; the final tests/build/typecheck passed afterward. A clean-install verification should be repeated after stopping the local dev server.
- A source-level review found no safely removable project folders or direct dependencies: the UI, SDK patch, license notices, database/API, deployment files, tests, and static controls are referenced or required by the app. No tracked-file deletion was made.

## Remaining verification

- The Console's actual token-validity period and Access Key inventory were not read or modified. Verify the token validity setting in the Nexconn Console and rotate/revoke credentials only with approval.
- No live token was issued and no production Nexconn account was changed during testing. End-to-end SDK connection and message send/receive still require a deliberate test using the configured Nexconn application after credential-rotation decisions.
- A per-user Nexconn access token must reach the Web SDK in the browser. Its exposure is limited to the authenticated user's Nexconn identity, but it remains a bearer credential; the Console token-validity setting is the primary control over how long a leaked token remains useful.
- No public deployment was created or verified. This workspace has no Git remote or hosting-account connection. The Render Docker/persistent-disk instructions in the README are a documented target architecture, not a completed deployment.
