# Security

This document describes LogiTrack's security model, the review carried out for version 2.0, what was found and fixed, and what remains out of scope.

> **Version 3.0** replaced or extended several controls below: two-factor authentication, CSP, account lockout, idle sessions, the password policy, reset links and logging. Rows changed in 3.0 are marked **(3.0)**. For the details see [SECURITY_HARDENING.md](SECURITY_HARDENING.md).

> **Scope of this statement.** The review was a self-conducted code audit with automated regression tests. It is **not** an independent penetration test and LogiTrack holds no security certification. LogiTrack is a portfolio project intended to run locally; treat the residual risks below as real before exposing it to the internet.

## Security model

| Area | Control |
| --- | --- |
| Passwords | bcrypt (cost 10). Minimum 8 characters with a letter and a digit; **(3.0)** at most 72 bytes, common and personal passwords refused. Hashes are never selected into API responses. Optional TOTP two-factor **(3.0)**. |
| Sessions | 256-bit random token in an `HttpOnly`, `SameSite=Lax` cookie (`Secure` when `COOKIE_SECURE=true`). Only the token's SHA-256 is stored. 7-day expiry, checked on every request. **(3.0)** 12-hour idle timeout, at most 10 sessions per user, `__Host-` cookie prefix over HTTPS. |
| Session revocation | On logout, password change, role change and deactivation. Open websockets are disconnected at the same moment. |
| Authorisation | Role → permission matrix in one file. Enforced on the server for every page and every API route; the client only hides controls. |
| Data scoping | Services restrict queries to what the caller may see. A driver's delivery queries are ANDed with their own driver ID. |
| Input validation | Every request body is parsed by a Zod schema; unknown fields are dropped. Sort columns are whitelisted, page sizes clamped. |
| SQL safety | All queries go through Prisma (parameterised). The one raw statement is a constant `PRAGMA`. |
| CSRF | State-changing requests must come from the same origin (`Origin` / `Sec-Fetch-Site` check), on top of `SameSite=Lax`. |
| Websockets | Handshake requires the app's own origin and a valid session. Staff and driver rooms are separate. |
| Error handling | Central mapper: clients receive a safe message and code; stack traces and SQL stay in the server log. |
| Brute force | **(3.0)** 30 sign-ins per address per 15 minutes, 10 per unknown e-mail, and a persistent account lockout after 10 consecutive failures (15 minutes). (2.0 used in-memory per-account counters.) |
| Enumeration | Unknown email and wrong password return the same response and take the same time. |
| Headers | `X-Content-Type-Options: nosniff`, `X-Frame-Options: DENY`, `Referrer-Policy`, `Permissions-Policy`; `X-Powered-By` removed. **(3.0)** Nonce-based Content Security Policy, COOP/CORP, `no-store` on API responses. |
| Secrets | None in the repository. Configuration comes from environment variables; `.env` is git-ignored. No API keys exist. |
| Exports | CSV cells that begin with `= + - @` are neutralised against spreadsheet formula injection. |
| Audit | Every significant change is written to the activity log with user, action, entity and time. |

## Review findings

Severity reflects impact in a deployed, multi-user setting.

| # | Finding | Severity | Status |
| --- | --- | --- | --- |
| 1 | **Driver could list other drivers' deliveries.** A `?driverId=` filter replaced the access scope in the query. | High | Fixed (v1 test pass). The scope is now ANDed into every delivery query. |
| 2 | **Websocket outlived its session.** A socket authenticated at connect time kept receiving fleet positions after logout or deactivation. | High | Fixed. Revocation disconnects the user's sockets immediately; a 60-second re-check covers expiry. |
| 3 | **Cross-site websocket connections not rejected.** Browsers do not apply CORS to websockets; only `SameSite` stood in the way. | Medium | Fixed. The handshake is refused unless `Origin` matches the host. |
| 4 | **Double-booking race.** Two simultaneous assignments could both pass the availability check for the same driver or vehicle. | Medium | Fixed. Claims are conditional updates (`WHERE status = 'AVAILABLE'`); the loser aborts with 409. |
| 5 | **Duplicate status transition.** The same transition sent twice at once could apply twice (two events, odometer added twice). | Medium | Fixed. Transitions are conditional on the previous status. |
| 6 | **Open redirect after login.** `?next=/\evil.example` passed the "starts with /" check; browsers treat `\` as `/`. | Medium | Fixed. Only paths matching a strict same-site pattern are accepted. |
| 7 | **Delivery service spread its input into the update.** Safe through the API (the schema strips unknown fields) but any other caller could have written `status` or timestamps. | Low | Fixed. The service writes an explicit list of columns. |
| 8 | **Login timing revealed whether an email exists.** No password comparison ran for unknown accounts. | Low | Fixed. A dummy bcrypt comparison runs in that case. |
| 9 | **Throttle keyed only on a spoofable address header.** Rotating `X-Forwarded-For` reset the counter. | Low | Fixed. A per-account counter is checked as well. |
| 10 | **No defensive response headers.** The app could be framed; the framework was advertised. | Low | Fixed. Headers added, `X-Powered-By` removed. |
| 11 | **Unbounded login-attempt map.** Spraying many emails could grow memory. | Low | Fixed. The map is capped. |

Checked and found sound: password hashing and storage, session token handling, permission checks on all 53 route files that existed at the time (76 in 3.0; the new ones are covered by the access-control inventory in `tests/e2e/v3.spec.ts`), notification ownership, driver access to performance data, the delivery state machine, financial input validation (negative, zero, non-numeric, infinite and oversized values), server-side computation of fuel totals, administrator invariants (no self-demotion, last Super Admin protected), and CSRF handling.

## Regression tests

Every finding has a test that fails if the hole reopens.

| Test file | Covers |
| --- | --- |
| `tests/integration/security.test.ts` | Assignment and status races (4, 5), IDOR and scope manipulation (1), mass assignment and role escalation (7), login timing and throttling (8, 9), session revocation (2), invalid financial input |
| `tests/e2e/security.spec.ts` | Websocket authentication, origin check and room isolation (2, 3), disconnect on logout (2), response headers (10), enumeration (8), API-level escalation, query manipulation, invalid transitions |
| `tests/e2e/roles.spec.ts` | Page and API permissions for all four roles, cookie flags, CSRF, logout |
| `tests/e2e/product.spec.ts` | Redirect validation (6), demo reset permissions |
| `tests/unit/intelligence.test.ts` | Redirect path validation cases (6) |
| `tests/integration/deliveries.test.ts` | State machine, assignment rules, driver scoping |

## Demo mode

`DEMO_MODE=true` (the default) shows demo credentials on the login page and enables two extra actions for staff roles: reset the sample data and rewind simulated trips. Both are permission-checked, CSRF-protected, logged, and refused when demo mode is off. **Set `DEMO_MODE=false` for any instance that holds real data**: the credentials panel, the reset endpoint and the restart action all disappear.

## Residual risks and limitations

These are known and accepted for a local portfolio project. They would need addressing before production use.

| Limitation | Why it matters | What production would need |
| --- | --- | --- |
| Demo credentials are public | Anyone can sign in as any role in demo mode | `DEMO_MODE=false`, real accounts |
| No HTTPS by default | Cookie and data travel in clear text off localhost | TLS termination and `COOKIE_SECURE=true` |
| No Content-Security-Policy | An XSS bug would have more room | A nonce-based CSP |
| In-memory throttling | Resets on restart; not shared across processes | A shared store (for example Redis) |
| Account-level throttle | An attacker can lock a known account out for 10 minutes | CAPTCHA or progressive delays |
| No multi-factor authentication, password reset by email or breach checks | Standard account protections are absent | An identity provider or equivalent |
| No rate limiting beyond login | Endpoints can be hammered | A reverse proxy or middleware limiter |
| SQLite, single process | No row-level locking; guarded writes rely on SQLite's single-writer model | PostgreSQL with the same guarded updates |
| Public OSM tile and OSRM demo servers | Third parties see map tile and route requests from the browser and server | Self-hosted tiles and routing |
| Dependencies | `npm audit` reports advisories in transitive development dependencies | Routine dependency review |

## Reporting

This is a personal project. If you find a problem, open an issue describing the steps to reproduce; please do not include real personal data.
