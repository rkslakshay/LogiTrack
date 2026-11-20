# Security hardening (LogiTrack 3.0)

This document lists the security controls added in 3.0, how to configure them, how they were tested, and what they do **not** cover. The 2.0 security model and review findings are in [SECURITY.md](SECURITY.md).

> LogiTrack's security has been reviewed by its own developers and covered by automated regression tests. It has **not** been independently audited or penetration-tested and holds no certification. Treat the limitations below as real before exposing an instance to the internet.

## Summary of controls

| Area | 3.0 control |
| --- | --- |
| Content Security Policy | Per-request nonce: `script-src 'self' 'nonce-…' 'strict-dynamic'` (no `unsafe-inline` scripts; `unsafe-eval` only in development). Also `object-src 'none'`, `frame-ancestors 'none'`, `base-uri 'self'`, `form-action 'self'`, `connect-src` limited to the app's own origin and websocket, and images limited to the app and OpenStreetMap tiles. Violations are reported to `/api/csp-report` and shown on the Diagnostics page. |
| Other headers | `X-Frame-Options: DENY`, `nosniff`, `Referrer-Policy: strict-origin-when-cross-origin`, a restrictive `Permissions-Policy`, `Cross-Origin-Opener-Policy` and `Cross-Origin-Resource-Policy: same-origin`, `Origin-Agent-Cluster`, `X-DNS-Prefetch-Control: off`. HSTS is added when `COOKIE_SECURE=true` at **build** time (see Deployment). API responses are `Cache-Control: no-store` and carry an `X-Request-Id`. |
| Password policy | 8–72 characters (72 bytes is bcrypt's limit), at least one letter and one digit, not a common or app-themed password (e.g. `password1`, `admin123`, `logitrack123`), not the person's full name or e-mail name. The server enforces it everywhere a password is set. A strength meter guides users without replacing the checks. |
| Brute force | Per-address sliding window (30 sign-ins / 15 min, configurable with `LOGIN_LIMIT_PER_ADDRESS`). Per-unknown-e-mail limit (10 / 15 min). Persistent **account lockout** after 10 consecutive failures for 15 minutes, stored in the database so it survives restarts. A locked account answers 429 before the password is checked, so a lock cannot be used to probe passwords. Separate limits for two-factor codes, re-authentication, reset links, writes (240/min/user), imports and backups. |
| Enumeration | Unknown e-mail, wrong password and a deactivated account all cost one bcrypt comparison. Unknown and wrong-password answers are identical. |
| Sessions | 256-bit random token; only its SHA-256 is stored. 7-day absolute lifetime, **12-hour idle timeout** (`SESSION_IDLE_MINUTES`), at most 10 sessions per user (oldest signed out). Cookie is `HttpOnly`, `SameSite=Lax`, `Priority=High`. With `COOKIE_SECURE=true` it is also `Secure` with the `__Host-` prefix. Users can list and end their sessions (**Settings → Security**). Sessions end on password change, reset, role change, deactivation, two-factor changes and restore. Websockets are disconnected at the same moment. |
| Two-factor (optional) | TOTP (RFC 6238, SHA-1, 6 digits, 30 s, ±1 step), works with any authenticator app. Secrets are encrypted at rest with **AES-256-GCM**, with a key derived (HKDF-SHA256) from `APP_SECRET`, or from a random `app-secret.key` generated next to the database. A secret is only returned once, to its owner, during enrolment, and becomes active only after a valid code. **Replay protection:** each time step is accepted once (guarded database update). Sign-in becomes password → short-lived challenge cookie (5 min, 5 attempts, `SameSite=Strict`) → code. |
| Recovery codes | 10 single-use codes (≈50 bits each, no ambiguous characters), shown once, stored as **bcrypt hashes**, consumed atomically. Regenerating or turning off two-factor requires the password **and** a current code. |
| Account recovery without e-mail | A Super Admin creates a **one-time reset link** (valid 60 min; only its SHA-256 is stored; creating a new one cancels the old one; the token travels in the URL fragment, which browsers never send to servers or proxies). Using it sets a new password, clears any lockout and ends every session. Two-factor still applies at the next sign-in. The CLI covers the case where no Super Admin can sign in: `npm run auth:reset-link`, `auth:reset-mfa`, `auth:unlock`. |
| Sensitive actions | Turning two-factor off, regenerating codes, deleting a backup and restoring a database require **re-authentication** (password, plus a code when two-factor is on). Restore also requires typing `RESTORE`. |
| Mass assignment | Unchanged from 2.0: every body goes through a Zod schema that drops unknown fields. Imports go through the same schemas and the same service functions. |
| Data exposure | `passwordHash`, `mfaSecret`, `mfaPendingSecret`, recovery-code hashes and token hashes are never selected into API responses. Tests assert this for user lists, two-factor status, diagnostics and exports. |
| Diagnostics and backups | Super Admin only (`system:diagnostics`, `system:backup`), checked on the server for pages and APIs. The public `/api/health` returns only status, version and response time. |
| Logging | Structured JSON. Fields named like secrets (password, token, secret, cookie, authorization, session, otp, recovery, hash, code, api key) are replaced with `[redacted]`, and e-mail addresses are masked (`a****@example.in`) wherever they appear. Errors are logged with a request ID that the client also receives. Auth events logged: sign-in success and failure (with reason), lockout, rate limiting, two-factor enrolled, disabled or recovery code used, reset link created, used or rejected, session revoked, logout. |

## Configuration

| Variable | Default | Purpose |
| --- | --- | --- |
| `APP_SECRET` | generated into `app-secret.key` | At least 32 characters. Key material for two-factor secret encryption. Back it up with your database. |
| `COOKIE_SECURE` | `false` | `true` behind HTTPS: Secure + `__Host-` cookies, HSTS (build-time), `upgrade-insecure-requests`. |
| `SESSION_TTL_DAYS` | `7` | Absolute session lifetime. |
| `SESSION_IDLE_MINUTES` | `720` | Idle timeout. |
| `TRUST_PROXY` | `false` | `true` only behind a reverse proxy you control. The client address for rate limiting is then taken from `X-Forwarded-For`. Otherwise the socket address is used and any client-supplied header is discarded. |
| `LOGIN_LIMIT_PER_ADDRESS` | `30` | Sign-ins per address per 15 minutes. Only the automated test server raises it. |
| `LOG_LEVEL` / `LOG_FORMAT` | `info` / `pretty` in dev, `json` in production | |

## How it was tested

- `tests/unit/hardening.test.ts`: password policy, AES-GCM round-trip and tamper detection, rate limiter, log redaction and e-mail masking, CSP directives, backup-name validation, restore confirmation, system permissions.
- `tests/integration/account-security.test.ts`: lockout and unlock, identical errors for unknown and wrong accounts, per-address rate limiting, deactivated accounts, encrypted secret at rest, no secrets in user lists, the two-step sign-in, wrong and **replayed** codes rejected, challenge reuse and expiry, single-use recovery codes, re-authentication, administrator two-factor reset (and refusal for oneself), reset links (single use, newest only, expiry, malformed tokens, sessions ended, lockout cleared), idle timeout, session cap, credential purge.
- `tests/e2e/v3.spec.ts`: CSP and headers on real responses, every inline script carrying the nonce, no CSP violations while using the app, anonymous access refused on 25 endpoints, non-admin roles refused on backups and diagnostics (API and pages), drivers refused on import and export, an invalid reset link refused in the UI.
- A manual live run of the full two-factor flow against the dev server (enrol, wrong code, replay, next code, recovery code once, disable with a second factor).

## Known limitations

- **Rate limits are in memory** and per process: they reset on restart and are not shared between instances. The account lockout is persistent. LogiTrack is designed as a single process.
- **Account lockout can be triggered by someone else** who knows an e-mail address (a denial of service on that account for 15 minutes). This is the usual trade-off of lockouts. Administrators can unlock immediately.
- `style-src` allows `'unsafe-inline'` because Leaflet and Recharts set inline style attributes, which a nonce cannot cover. Styles cannot run scripts, but CSS-based data exfiltration is not prevented by the CSP.
- **HSTS** is decided when the app is built. In Docker, or if you build without `COOKIE_SECURE=true`, let your HTTPS reverse proxy send HSTS.
- Two-factor is optional for every role. There is no policy to force it for administrators.
- No e-mail or SMS delivery exists (by design, so the app needs no paid or external services). Reset links are handed over by an administrator.
- Backups are not encrypted at rest.
- No independent penetration test has been carried out.
