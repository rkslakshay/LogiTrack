# LogiTrack build progress

Status legend: Not Started · In Progress · Implemented · Tested · **Completed** (implemented, covered by automated tests and verified in the running app).

Last updated: 20 Nov 2026 · Version 3.0.0 (portfolio completion done, awaiting review and the first commit)

## Summary

| | |
| --- | --- |
| Modules | 13 operational modules + landing page, demo experience, 6 intelligence engines; 3.0 adds account security, backup and restore, diagnostics, and import/export |
| Pages | 27 page routes (4 new in 3.0: Backup & Restore, Diagnostics, Import & Export, public Reset password) |
| REST endpoints | 76 route files |
| Database | 17 Prisma models, 3 migrations, deterministic demo-data generator, synthetic performance dataset |
| Automated tests | **369 passing**: 322 Vitest (unit, integration, component) + 47 Playwright end-to-end |
| Static checks | `tsc --noEmit` clean · `eslint` 0 findings · `next build` succeeds |
| Cost | ₹0: no paid services, API keys or accounts |

---

## Portfolio completion (20 Nov 2026, version stays 3.0.0)

| Area | Work | Status |
| --- | --- | --- |
| Repository state | Verified: 334 files staged (unchanged), `origin` → empty `rkslakshay/LogiTrack`, no commits. All new work is unstaged on top, clearly separable. | **Verified** |
| Demo review | Playwright walkthrough as all four roles (`scripts/review-walkthrough.ts`): 26 role pages load without console, server or UI errors, and 13 forbidden pages redirect away (run against a freshly started server). Guided tour gained an **Import and export** step (staff who can import) and an **Operations** step (Super Admin). Demo guide updated (setup, reset scope, tour, 3.0 features). | **Completed** |
| Screenshots | 22 screenshots re-captured from the running app on freshly seeded data, published as WebP in `docs/assets/screenshots` (6.4 MB → 2.2 MB). The 5 landing-page images stay in `public/screenshots`; 17 README-only PNGs removed from `public/`. `npm run screenshots` = capture + `scripts/optimize-screenshots.mjs`. | **Completed** |
| README | Rewritten: badges, screenshot gallery, purpose, features by module, stack, architecture, data model, auth, route optimisation, simulated GPS, CSV import, analytics, security, measured performance, Windows setup (first-time vs daily vs reset), demo accounts, commands, testing, limitations, future work, documentation index. 119 relative links and images checked, all resolve. | **Completed** |
| Architecture | `docs/ARCHITECTURE.md`: frontend, API organisation, error handling and observability sections; six required diagrams (system, data model with all 17 models, delivery lifecycle, live tracking sequence, authentication sequence, CSV import flow). All 11 Mermaid diagrams in the docs pass the Mermaid 11 parser (one real syntax error found and fixed). | **Completed** |
| Interview guide | 60-second introduction, demo script, 18 project-specific answers with source references and trade-offs | **Completed** |
| Clean install | Verified in an isolated copy of exactly the files Git would include (no `.env`, no databases): `npm ci` (0 vulnerabilities) → `npm run setup` (generate, migrate, seed) → `npm run dev` on port 3300 → health, sign-in, role check (403 on backups for a Dispatcher), sign-out → typecheck, lint, 321/321 Vitest. | **Verified** |
| New advisory | GHSA-7589-6fvf-x4pw (`effect` ≤3.22.0 via `@prisma/config`, 3 high) published after the last audit. Fixed with the existing scoped override (`effect` 3.22.5); npm's suggested Prisma downgrade rejected. Prisma CLI re-verified. | **0 vulnerabilities** |
| Start-up diagnostics | Found during the smoke test: on this machine `Get-NetTCPConnection` took 6.5 s, so the port-owner lookup timed out and the message did not name the process. Switched to `netstat -ano` (instant), with a unit test for the parser. | **Fixed** |

### Verification (this run, 20 Nov 2026)

| Check | Result |
| --- | --- |
| `npm install` / `npm audit` | up to date / **0 vulnerabilities** |
| `prisma generate`, `validate`, `migrate status` | OK |
| TypeScript / ESLint | 0 errors / 0 findings |
| Vitest | **322 passed** (17 files) |
| Playwright (Edge) | **47 passed** |
| Production build | succeeds, 0 warnings |
| Start-up: busy port 3000 (another project) | names PID and command, exit 1, nothing started |
| Start-up: port 3001 | ready, simulator started once |
| Second server: same port / same database | identifies the running LogiTrack / refused by the database lock |

## Release preparation: Windows reliability and GitHub readiness (version stays 3.0.0)

Completed 19 Nov 2026, before the first public commit. Details: [docs/WINDOWS.md](docs/WINDOWS.md), [docs/DEPENDENCY_AUDIT.md](docs/DEPENDENCY_AUDIT.md), CHANGELOG 3.0.0 "Fixed".

| Area | Finding (with evidence) | Fix | Status |
| --- | --- | --- | --- |
| GitHub | `git ls-remote` shows `rkslakshay/LogiTrack` exists and is **empty** (no branches). The local repository had no commits. | `origin` remote added. Nothing pulled, committed or pushed. | **Ready for the first commit (awaiting approval)** |
| `EPERM ... query_engine-windows.dll.node` | A LogiTrack dev server (PID 25028) whose start-up had failed was still alive, with the DLL loaded (`Get-Process -Id 25028).Modules`) and no listening port. `prisma generate` succeeded once it was stopped. | `scripts/setup.mjs`: detects running LogiTrack servers first, retries transient lock and download errors, explains failures, migrates only after a successful generate, and seeds only an empty database | **Completed, verified** |
| `EADDRINUSE :3000` | Port 3000 is held by another project (`E:\TaskFlow`, `next start -p 3000`). LogiTrack started the simulator before `listen`, and the error was swallowed as an uncaught exception, leaving the zombie described above. | `src/server/startup.ts` + `server.ts`: port check before anything starts (with process details and PowerShell commands, exit 1); listen as a promise; simulator and jobs only after listening; per-database instance lock; shutdown stops jobs and releases the lock. `HOSTNAME_BIND` is now honoured (default `localhost`). | **Completed, verified** |
| npm lifecycle scripts | `prisma` preinstall, `@prisma/engines` and `@prisma/client` postinstall are blocked by the user-level `allow-scripts`. A clean `npm ci --ignore-scripts` + `prisma generate` downloads the engines and generates the client. | Not approved: not required, and documented | **Decided** |
| npm audit | 10 findings (7 moderate, 3 high) from GHSA-g3hv-75wg-m249 (minimatch, dev) and GHSA-ggr8-5vv4-36mx (deepmerge-ts, Prisma CLI) | `typescript-eslint` 8.73.0 (in range); scoped `overrides` for `deepmerge-ts` 8.0.2. No Prisma major upgrade, no `--force`. | **0 vulnerabilities** |
| Prisma deprecation | `package.json#prisma` deprecated | `prisma.config.ts` (schema, migrations, seed; loads `.env` via `src/server/env.ts`) | **Completed, verified** |
| CI | Linux only | Matrix on Linux and Windows; `npm audit --audit-level=high` | **Updated (not yet run on GitHub)** |
| Docs | | New: `docs/WINDOWS.md`, `docs/INTERVIEW_GUIDE.md`, `docs/DEPENDENCY_AUDIT.md`. Updated: README (Windows quick start, route optimisation, import/export, performance, demo-only credentials), CONTRIBUTING, CHANGELOG, SECURITY.md, DEPLOYMENT, ARCHITECTURE | **Completed** |

### Verification

| Check | Result |
| --- | --- |
| `npm install` | up to date, **0 vulnerabilities** |
| `npm run setup` on the existing database | generated, "already up to date", data kept (7 users) |
| `npm run setup` on a new database file | generated, migrated, demo data loaded |
| `npm run setup` while a server runs | refused, listing the LogiTrack PIDs |
| Start on busy port 3000 | clear message naming `E:\TaskFlow`, exit 1, nothing started |
| Start on port 3001 | ready; simulator started once |
| Second server, same port | message identifies the running LogiTrack (PID), exit 1 |
| Second server, other port, same database | refused by the instance lock, exit 1 |
| Ctrl+C | simulator paused, jobs stopped, lock released, port freed, no process left |
| Restart after a hard kill | stale lock replaced automatically |
| TypeScript / ESLint | 0 errors / 0 findings |
| Vitest | **321 passed** (17 files; 6 new start-up tests) |
| Playwright (Edge) | **47 passed** (Edge). One test had a sign-out navigation race (2 of 3 repeats failed); fixed with the pattern its sibling test already used, then 5/5 repeats and the full suite passed |
| Production build | succeeds with 0 warnings (2 pre-existing Turbopack file-tracing warnings in backup.ts resolved) |

### Pending (needs the owner)

1. Approve the first commit and the push to `origin/main` (nothing has been committed or pushed).
2. After pushing, check that CI is green on both Linux and Windows.
3. Docker runtime validation (WSL is not installed on this machine).

---

## Version 3.0: production engineering and release readiness

Completed 19 Nov 2026. Release notes: [docs/RELEASE_NOTES.md](docs/RELEASE_NOTES.md) · changes: [CHANGELOG.md](CHANGELOG.md).

| Phase | Scope | Status |
| --- | --- | --- |
| 0 | Audit of the in-progress 3.0 work; regressions fixed (e2e login rate limit, logout race, lint errors) | **Completed** |
| 1 | Security hardening: CSP with nonces, headers, password policy, per-address rate limits, persistent lockout, idle sessions, session cap, optional TOTP two-factor with recovery codes, e-mail-free reset links, re-authentication | **Completed** (unit, integration and e2e tests, plus a live two-factor run) |
| 2 | Database reliability: verified backups, scheduled backups with retention, transactional restore with a safety backup, integrity checks, UI and CLI | **Completed** (integration tests incl. restore, schema mismatch and tamper detection; e2e) |
| 3 | CSV import (5 types) with preview, row errors, duplicates and transactions; import-format exports; analytics report | **Completed** (13 integration tests, e2e import through the UI) |
| 4 | CI workflow, Dependabot, `.gitignore`, `.gitattributes`, CONTRIBUTING (versioning), CHANGELOG, SECURITY.md, MIT licence with third-party notices, local git repository | **Completed**. Not pushed; CI not yet run on GitHub |
| 5 | Docker: Dockerfile, compose, `.dockerignore`, entrypoint with pre-migration backup and optional seeding | **Configured, not validated**: Docker Desktop cannot start on this machine (WSL not installed). `docker compose config` passes. |
| 6 | Performance: synthetic dataset, benchmark tools, measured results, 2 bottlenecks fixed | **Completed**: [docs/PERFORMANCE_REPORT.md](docs/PERFORMANCE_REPORT.md) |
| 7 | Observability: structured redacted logging, request IDs, job registry, `/api/health`, Diagnostics page | **Completed** |
| 8 | Accessibility: axe on 20 pages, contrast, keyboard access, skip link, dialog semantics | **Completed** (0 serious or critical violations) |
| 9 | Release docs, README, version 3.0.0, screenshots | **Completed** |

### Verification (final run, 19 Nov 2026)

| Check | Command | Result |
| --- | --- | --- |
| TypeScript | `npm run typecheck` | 0 errors |
| ESLint | `npm run lint` | 0 errors, 0 warnings |
| Vitest | `npm test` | 315 passed, 16 files |
| Playwright | `PW_CHANNEL=msedge npm run test:e2e` | 47 passed (32 existing + 15 new, incl. axe on 20 pages), Microsoft Edge |
| Build | `npm run build` | succeeds |

### Main files added or changed in 3.0

- Security: `src/proxy.ts`, `next.config.ts`, `src/lib/{auth,auth-server,crypto,password-policy,rate-limit,logger,db-path,version}.ts`, `src/server/services/account.ts`, `src/app/api/auth/*`, `src/app/api/profile/{mfa,sessions}`, `src/app/api/users/[id]/{reset-link,unlock,mfa}`, `src/app/api/csp-report`, `src/app/login/mfa-step.tsx`, `src/app/reset-password/*`, `src/app/(app)/settings/security-settings.tsx`, `src/components/app/{password-strength,reauth-dialog}.tsx`, migration `20261118182922_v3_account_security`.
- Operations: `server.ts` (logger, job registry, scheduled backups, graceful shutdown), `src/server/jobs.ts`, `src/server/services/{backup,diagnostics}.ts`, `src/app/api/{health,diagnostics,backups}`, `src/app/(app)/{backups,diagnostics}`, `scripts/{db,auth}.ts`.
- Import/export: `src/lib/csv.ts` (parser), `src/server/services/imports.ts`, `src/app/api/data/*`, `src/app/(app)/import-export/*`, `insert*` functions in the vehicle, driver, fuel, maintenance and delivery services, `analytics` report.
- Performance: `src/server/simulator.ts` (batched tick and geometry cache), `src/server/services/maintenance.ts` (maintenanceAlerts), `scripts/perf-*.ts`.
- Accessibility: `src/app/globals.css` (contrast; Tailwind no longer scans `prisma/`), `src/components/app/{shell,data-table}.tsx`, scroll regions in fuel, analytics and intelligence views, notifications.
- Tests: `tests/unit/hardening.test.ts`, `tests/integration/{account-security,backup,imports}.test.ts`, `tests/e2e/v3.spec.ts`, `tests/e2e/v3.shots.ts`.
- Repository: `.github/`, `Dockerfile`, `docker-compose.yml`, `docker/entrypoint.sh`, `.dockerignore`, `.gitattributes`, `LICENSE`, `THIRD_PARTY_NOTICES.md`, `CHANGELOG.md`, `SECURITY.md`, `docs/{RELEASE_NOTES,DEPLOYMENT,BACKUP_RESTORE,SECURITY_HARDENING,PERFORMANCE_REPORT,IMPORT_EXPORT}.md`.

### Pending (needs the owner's action or permission)

1. **Docker runtime validation.** Install WSL 2 (`wsl --install`, admin rights and a restart), start Docker Desktop, then `docker compose up --build` and check `docker compose ps` shows the container healthy.
2. **First commit and CI.** The local repository has no commits yet. Push to GitHub to run `.github/workflows/ci.yml`; Playwright in CI uses the bundled Chromium and has not been run outside this machine.
3. **Tag and publish v3.0.0** once CI passes.

### Commands used during 3.0

`npm run typecheck`, `npm run lint`, `npx vitest run`, `PW_CHANNEL=msedge npx playwright test`, `npm run build`, `npm run perf:seed`, `npm run perf:start`, `npm run perf:bench -- http://localhost:3200`, `npx tsx scripts/perf-map.ts`, `npx tsx scripts/perf-import.ts`, `npm run perf:profile`, `npx cross-env SHOTS=1 playwright test tests/e2e/v3.shots.ts`, `npm run db:check`, `npm run db:backup`, `docker compose config`.

---


## Version 2.0: product polish, intelligence and portfolio readiness

| Phase | Scope | Status |
| --- | --- | --- |
| 1 | Public landing page | Completed |
| 2 | Demo experience: role login, guided tour, demo banner, reset, simulation controls | Completed |
| 3 | Intelligence: delivery risk, fleet utilisation, fuel efficiency, maintenance recommendations, driver trends | Completed |
| 4 | Analytics: overviews, comparison periods, explanations | Completed |
| 5 | Security and reliability audit | Completed (11 findings fixed, each with a regression test) |
| 6 | Performance and engineering quality | Completed |
| 7 | UI/UX refinement | Completed |
| 8 | Documentation and screenshots | Completed |
| 9 | Testing and acceptance | Completed |

### Phase 1: landing page — Completed
- **Files:** `src/app/page.tsx`, `src/components/marketing/*`, `src/proxy.ts` (root path made public), `src/app/globals.css`.
- **Delivered:** hero, platform capabilities, four product previews (tracking, deliveries, routes, analytics) using real screenshots, intelligence section, roles, technology highlights, honest "about this project" note, login and demo calls to action. Responsive; subtle scroll reveals that respect reduced-motion.
- **Not included by design:** testimonials, customer logos or business claims.
- **Tests:** `product.spec.ts` (content, images load, no invented claims, mobile overflow, signed-in call to action).

### Phase 2: demo experience — Completed
- **Files:** `src/app/login/*`, `src/components/app/tour.tsx`, `demo-banner.tsx`, `providers.tsx`, `shell.tsx`, `src/server/demo/{index,seed}.ts`, `src/app/api/demo/*`, `src/app/api/simulator`, `src/server/simulator.ts`, `server.ts`, `prisma/seed.ts`.
- **Delivered:**
  - Demo access cards for the four roles with what each can do and one-click sign-in.
  - Guided tour (7 steps for staff, 2 for drivers): offered once, never forced, skippable, restartable; the page stays usable behind it.
  - Demo banner on every signed-in page with the age of the dataset.
  - **Reset demo data** in about two seconds through the real backend; demo accounts keep their IDs and sessions.
  - Simulation **pause / resume / restart trips**.
  - **Viewer-gated simulation** in demo mode: trips advance only while a browser is connected, so they do not complete unexpectedly.
  - Deterministic generator: every reset yields identical data (asserted by a test).
  - `DEMO_MODE=false` removes all of the above without touching business behaviour.
- **Sample data changes:** denser, more varied history (316 deliveries) and scenarios for every intelligence rule.
- **Tests:** `tests/integration/demo.test.ts` (8), `product.spec.ts` (demo login, tour, restart, reset).

### Phase 3: logistics intelligence — Completed
- **Files:** `src/lib/domain/{risk,utilization,fuel-intel,maintenance-intel,compare,performance}.ts`, `src/server/services/intelligence.ts`, `src/app/api/intelligence/{risk,fleet,fuel,maintenance}`, `src/components/app/intelligence.tsx`, `trend.tsx`.
- **Delivered:**
  - **Delivery risk**: projected arrival, slack and Low / Medium / High with reasons; on the dashboard, the deliveries list and the delivery page.
  - **Fleet utilisation**: utilisation, idle, active share, maintenance downtime, average distance, weekly trend, under-utilised vehicles with explanations.
  - **Fuel efficiency**: fill-to-fill mileage, mileage drop, poor mileage and high cost against comparable vehicles, suspect and stale records, explicit "not enough data".
  - **Maintenance recommendations**: next routine service from odometer, history and usage; labelled system-generated and kept apart from scheduled work.
  - **Driver performance**: completion rate, 30-day trend, fleet benchmark, no ranking without sufficient data.
- **All formulas documented** in `docs/FEATURES.md` and shown in the app where relevant.
- **Tests:** `tests/unit/intelligence.test.ts` (44), `tests/integration/intelligence.test.ts` (13).

### Phase 4: analytics — Completed
- **Files:** `src/server/services/analytics.ts`, `src/app/(app)/analytics/{analytics-view,analytics-tabs}.tsx`, `src/components/app/range-picker.tsx`, `page.tsx` (delta badges).
- **Delivered:** five tabs (Overview, Fleet efficiency, Fuel efficiency, Maintenance, Drivers); delivery reliability, operational cost, fleet efficiency and driver productivity overviews; maintenance cost analysis; fuel efficiency comparison; calendar presets (this week / month / year); comparison with the previous period or the same period last year; change badges; **written explanations of significant changes** built from the records.
- **Tests:** comparison and explanation integration tests; `product.spec.ts` checks on-screen figures against the API.

### Phase 5: security and reliability audit — Completed
Full write-up: `docs/SECURITY.md`.

| # | Finding | Fix |
| --- | --- | --- |
| 1 | Driver could list other drivers' deliveries via a filter | Access scope ANDed into every query (found in v1 testing) |
| 2 | Websocket kept receiving fleet data after logout or deactivation | Sockets disconnected on revocation; periodic re-check |
| 3 | Cross-site websocket handshakes not rejected | Origin check on the handshake |
| 4 | Double-booking race on assignment | Conditional (atomic) claims |
| 5 | Duplicate status transition under concurrency | Conditional update on the previous status |
| 6 | Open redirect after login (`/\host`) | Strict same-site path validation |
| 7 | Delivery service spread its input into the update | Explicit column whitelist |
| 8 | Login timing revealed whether an account exists | Dummy hash comparison |
| 9 | Throttle bypass by rotating the address header | Per-account counter |
| 10 | No defensive response headers | Headers added, `X-Powered-By` removed |
| 11 | Unbounded login-attempt map | Capped |

- **Tests:** `tests/integration/security.test.ts` (20), `tests/e2e/security.spec.ts` (6).
- **Not claimed:** independent testing or certification. Residual risks are listed in `docs/SECURITY.md`.

### Phase 6: performance and engineering quality — Completed
| Change | Benefit |
| --- | --- |
| Marker icons cached by appearance (`leaflet-map.tsx`) | Leaflet no longer rebuilds every marker's DOM on each update; moving markers keep their element and CSS transition |
| Location events batched per animation frame (`tracking-view.tsx`) | One render per simulator tick instead of one per moving vehicle |
| Indexes on `Delivery.closedAt` and `Delivery.routeId` (migration) | Dashboard, analytics and route queries filter on indexed columns |
| `useQuery` derives loading state instead of setting it in effects | Fewer renders per request; no stale data shown when the resource changes |
| Intelligence tabs load on first open | Analytics opens with one request, not five |
| Simulator idles without viewers (demo mode) | No database writes every two seconds on an unattended server |

Reviewed and left as is: list endpoints are server-paginated; analytics aggregate in memory over the selected period, which is appropriate at fleet scale (documented as a limitation for very large datasets); sockets are cleaned up on unmount; there is no polling.

### Phase 7: UI/UX refinement — Completed
- Table and dashboard **loading skeletons** replace spinners.
- KPI labels wrap instead of truncating; large distances drop the decimal.
- Toasts moved to the bottom-right so they never cover page actions.
- Deliveries table reflowed so the risk column fits at laptop width.
- Distinct colours for adjacent delivery statuses in charts.
- Consistent "System-generated" tag for anything produced by a rule.
- Hydration-safe relative times in the demo banner.
- Checked at 375 px, tablet and 1440 px; no horizontal overflow on any page.

### Phase 8: documentation and screenshots — Completed
- **Docs:** `README.md`, `docs/ARCHITECTURE.md` (Mermaid system and sequence diagrams), `docs/DATABASE.md` (Mermaid ER and state diagrams), `docs/API.md`, `docs/SECURITY.md`, `docs/DEMO_GUIDE.md` (five-minute demonstration script), `docs/FEATURES.md` (every formula).
- **Screenshots:** 18 images in `public/screenshots`, captured from the running app by `npm run screenshots`: landing (viewport and full page), login, dashboard, vehicles, drivers, deliveries, delivery detail, tracking, routes, analytics (overview, fleet, fuel), performance, fuel, maintenance, driver portal, guided tour.

### Phase 9: testing and acceptance — Completed

| Suite | Result |
| --- | --- |
| `npm run typecheck` | Clean |
| `npm run lint` | 0 findings |
| `npm test` | 12 files, 260 tests, all passing |
| `npm run test:e2e` | 4 specs, 32 tests, all passing |
| `npm run build` | Succeeds |

No existing test was deleted or weakened. Two existing-test-adjacent fixes were to my own new tests (a threshold expectation and two selector/timing issues).

**Defects found by the new tests and fixed**

| Found by | Defect | Fix |
| --- | --- | --- |
| Integration test | Delivery edits could write `status` if called outside the API schema | Column whitelist in the service |
| End-to-end run | Demo banner text differed between server render and hydration | Relative time rendered client-side only |
| Visual review | Risk column clipped at laptop width | Distance column moved to very wide screens |
| Data review | Sample history too sparse to show utilisation and trends | Denser, weighted history in the generator |

---

## Version 1.0: core platform (completed earlier)

| Phase | Scope | Status |
| --- | --- | --- |
| 1 Foundation | Project setup, schema, auth, RBAC, design system, app shell | Completed |
| 2 Core operations | Dashboard, vehicles, drivers, deliveries | Completed |
| 3 Logistics intelligence | Live tracking, GPS simulator, route planning and optimisation | Completed |
| 4 Operational management | Fuel, maintenance, notifications, activity logs | Completed |
| 5 Business intelligence | Analytics, driver performance, reports, CSV exports | Completed |
| 6 Quality and polish | Tests, bug fixes, security review, responsive design, documentation | Completed |

| Module | Key files | Tests |
| --- | --- | --- |
| 1 Authentication | `src/lib/auth*.ts`, `src/lib/api.ts`, `src/app/login`, `services/users.ts` | `auth.test.ts`, `roles.spec.ts` |
| 2 Dashboard | `services/analytics.ts`, `(app)/dashboard` | analytics integration tests |
| 3 Vehicles | `services/vehicles.ts`, `(app)/vehicles` | `fleet.test.ts`, Workflow A |
| 4 Drivers | `services/drivers.ts`, `(app)/drivers` | `fleet.test.ts`, Workflow A |
| 5 Deliveries | `services/deliveries.ts`, `domain/delivery-status.ts`, `(app)/deliveries` | `deliveries.test.ts`, Workflow B |
| 6 Live tracking | `server/simulator.ts`, `services/tracking.ts`, `(app)/tracking` | simulator tests, Workflow C |
| 7 Route planning | `lib/geo.ts`, `lib/routing.ts`, `services/routes.ts`, `(app)/routes` | `geo.test.ts`, route tests |
| 8 Fuel | `services/fuel.ts`, `domain/fuel.ts`, `(app)/fuel` | fuel tests, Workflow D |
| 9 Maintenance | `services/maintenance.ts`, `domain/reminders.ts`, `(app)/maintenance` | maintenance tests, Workflow E |
| 10 Analytics and reports | `services/analytics.ts`, `services/reports.ts`, `(app)/analytics`, `(app)/reports` | analytics and report tests |
| 11 Driver performance | `domain/performance.ts`, `services/performance.ts`, `(app)/performance` | scoring tests |
| 12 Notifications | `services/notifications.ts`, `(app)/notifications` | notification tests |
| 13 Activity logs | `services/activity.ts`, `(app)/activity` | asserted across modules |

All thirteen are **Completed** and unchanged in behaviour by version 2.0, apart from the additions listed above.

## Decisions worth knowing

- **Custom server.** Socket.IO and the simulator need a long-lived process, so `server.ts` hosts Next.js, Socket.IO and the background jobs on one port.
- **Rule engines, not ML.** Explainable, testable, free, and able to say "not enough data".
- **Demo mode is additive.** It adds a banner, logins, reset and a simulator gate; it never changes a business rule.
- **Demo accounts are stable.** The generator upserts them, so a reset does not sign anyone out.
- **Tests never reset a database.** Each suite builds its own throwaway file (`test.db`, `e2e.db`) from migrations.
- **Screenshots live in `public/screenshots`** so the landing page and the README use the same real images.

## Known limitations

See the README section of the same name, `docs/SECURITY_HARDENING.md` and `docs/RELEASE_NOTES.md`: simulated GPS, rule-based intelligence with default thresholds, estimated routes, gazetteer instead of geocoding, SQLite and a single process, self-audited security, and demo data that ages with the clock.
