# Changelog

All notable changes to LogiTrack are recorded here. The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and versions follow [Semantic Versioning](https://semver.org/) (see CONTRIBUTING.md).

## [3.0.0] - 2026-11-19

Production engineering and release readiness. Upgrading from 2.x applies one database migration (`v3_account_security`) that adds columns and tables only. Back up first (`npm run db:backup`).

### Added
- **Two-factor authentication (optional):** TOTP for any authenticator app, QR enrolment, 10 single-use recovery codes, replay protection, secrets encrypted at rest (AES-256-GCM). Administrators can reset a user's two-factor, and so can the `auth:reset-mfa` CLI.
- **Password reset without e-mail:** Super Admins create one-time links (60 minutes, single use, token hashed, kept in the URL fragment). New `/reset-password` page. CLI `auth:reset-link`.
- **Account lockout** after 10 failed sign-ins (15 minutes, persistent), with unlock from User Management or `auth:unlock`.
- **Session management:** idle timeout (12 h), at most 10 sessions per user, a list of signed-in devices with sign-out (Settings → Security).
- **Content Security Policy** with per-request nonces, a violation report endpoint and additional isolation headers.
- **Backup and restore:** verified SQLite backups (`VACUUM INTO`, integrity and foreign-key checks, SHA-256 manifest), scheduled backups with retention, a transactional restore with a safety backup, password re-authentication and typed confirmation. **Backup & Restore** page and `db:backup`, `db:backups`, `db:verify`, `db:check`, `db:restore` commands.
- **Observability:** structured JSON logging with redaction of secrets and e-mail addresses, request IDs, a background-job registry, a public `/api/health` and a Super Admin **Diagnostics** page (application, database, realtime, simulator, jobs, recent errors).
- **CSV import** for vehicles, drivers, deliveries, fuel and maintenance: templates, row-by-row validation with the same rules as the forms, duplicate detection, a dry-run preview, an all-or-nothing transactional commit by default, and optional skipping of invalid rows. **Import & Export** page.
- **Import-format exports** with filters and selected-record export (`ids=`), and a new **Analytics** report.
- **Performance tooling:** synthetic dataset generator (`perf:seed`), API, websocket and memory benchmark (`perf:bench`), service profiler, map-render and import timings. Results are in `docs/PERFORMANCE_REPORT.md`.
- **Accessibility:** skip-to-content link, keyboard-operable table rows and scroll areas, dialog semantics for the mobile menu, and automated axe checks on 20 pages (all four roles plus the public pages) in the e2e suite.
- **Release engineering:** GitHub Actions CI (typecheck, lint, Vitest, build, Playwright), Dependabot, MIT licence with third-party notices, `SECURITY.md`, optional Docker image and compose file with persistent storage, healthcheck, pre-migration backup and optional demo seeding.
- Tests: 55 new Vitest tests (security, backup, diagnostics, import) and 15 new Playwright tests (headers, CSP, access-control inventory, operations pages, import, axe).

### Changed
- Password policy: also rejects common and app-themed passwords and passwords containing the person's name or e-mail name. Maximum 72 bytes.
- Sign-in throttling moved from in-memory per-account counters to a per-address limiter plus the persistent account lockout.
- The account-menu button's accessible name now includes the visible name and role.
- Colours: secondary text (`ink-3`) and the success green are darker, to meet WCAG AA contrast.
- GPS simulator writes each tick in one transaction and caches route geometry: about 3× faster per tick.
- Maintenance alerts load only the columns they need: about 3× faster, and the dashboard is about 2× faster on the 1,000-record dataset.
- Service functions for vehicles, drivers, fuel, maintenance and deliveries can run inside a caller's transaction (used by import). Their behaviour is unchanged.
- Sign-out no longer races with requests that fail with 401 meanwhile, which used to redirect to `/login?next=…`.

### Fixed (Windows installation and start-up, before the first public commit)
- **`npm run dev` on a busy port left a zombie server.** The simulator and jobs started before `listen`, and the `EADDRINUSE` error was swallowed as an uncaught exception, so the process kept running jobs and kept Prisma's engine DLL loaded. Start-up now checks the port first, names the process holding it (and whether it is LogiTrack), prints PowerShell commands and an alternative-port command, and exits with code 1. The simulator and jobs start only after a successful `listen`. A per-database lock prevents two servers (and two simulators) on one database. Shutdown stops all jobs and releases the lock.
- **`npm run setup` failed with `EPERM ... query_engine-windows.dll.node`** whenever a LogiTrack process held the engine. The new `scripts/setup.mjs` detects running LogiTrack servers before generating and explains what to stop. It retries transient download and lock errors, runs migrations only after a successful generate, and seeds **only an empty database**: it previously reseeded every time, replacing existing records.
- `HOSTNAME_BIND` is now honoured: the server listens on `localhost` by default, as documented, instead of all interfaces.

### Changed (dependencies and configuration)
- `npm audit`: 10 findings (7 moderate, 3 high) → **0**. `typescript-eslint` 8.73.0 (in range) and a scoped override `deepmerge-ts` 8.0.2 for `@prisma/config`, without a Prisma major upgrade. See `docs/DEPENDENCY_AUDIT.md`.
- Prisma configuration moved from the deprecated `package.json#prisma` to `prisma.config.ts` (which loads `.env` through the app's loader).
- CI runs the checks on Windows as well as Linux and fails on high-severity advisories.
- New docs: `docs/WINDOWS.md`, `docs/INTERVIEW_GUIDE.md`, `docs/DEPENDENCY_AUDIT.md`.
- Portfolio presentation: README rewritten (badges, screenshots, architecture, security, measured performance, Windows-first setup); `docs/ARCHITECTURE.md` has six Mermaid diagrams of the real implementation (system, data model, delivery lifecycle, live tracking, authentication, CSV import), all checked with the Mermaid parser; `docs/INTERVIEW_GUIDE.md` answers 18 design questions with source references.
- Screenshots: re-captured from the running app and published as optimised WebP in `docs/assets/screenshots` (2.3 MB instead of 6.4 MB of PNG). Only the five images the landing page embeds stay in `public/screenshots`. `npm run screenshots` does both.
- Guided tour: new **Import and export** step for roles that can import, and an **Operations** step (Diagnostics, Backup & Restore) for the Super Admin.

### Security
- See `docs/SECURITY_HARDENING.md` for the controls, the tests and the known limitations. LogiTrack has not been independently audited.

## [2.0.0] - 2026-11-16

### Added
- Public landing page, demo experience (role cards, one-click sign-in, guided tour, demo banner, demo reset, simulation restart).
- Explainable intelligence: delivery risk, fleet utilisation, fuel efficiency, maintenance recommendations, driver trends, period comparison with written explanations.
- Analytics overviews and comparison periods. Portfolio documentation and a screenshot collection.

### Security
- Self-conducted security review: 11 findings fixed, each with a regression test (`docs/SECURITY.md`).

## [1.0.0] - 2026-11-15

### Added
- First release: authentication and role-based access (4 roles), dashboard, vehicles, drivers, deliveries with an enforced status workflow, live tracking with simulated GPS over Socket.IO, route planning and optimisation, fuel and maintenance management, analytics, driver performance, reports, notifications, activity log, user management and settings. Vitest and Playwright test suites.

[3.0.0]: #300---2026-11-19
[2.0.0]: #200---2026-11-16
[1.0.0]: #100---2026-11-15
