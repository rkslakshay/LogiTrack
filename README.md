<div align="center">

# LogiTrack

**A full-stack fleet and logistics management system: vehicles, drivers, deliveries, live tracking, route optimisation, fuel, maintenance and analytics, with explainable rule-based insights.**

[![CI](https://github.com/rkslakshay/LogiTrack/actions/workflows/ci.yml/badge.svg)](https://github.com/rkslakshay/LogiTrack/actions/workflows/ci.yml)
![Version](https://img.shields.io/badge/version-3.0.0-2563eb)
![License: MIT](https://img.shields.io/badge/license-MIT-16a34a)
![Next.js 16](https://img.shields.io/badge/Next.js-16-000000?logo=nextdotjs)
![React 19](https://img.shields.io/badge/React-19-149eca?logo=react&logoColor=white)
![TypeScript 5](https://img.shields.io/badge/TypeScript-5-3178c6?logo=typescript&logoColor=white)
![Prisma 6](https://img.shields.io/badge/Prisma-6-2d3748?logo=prisma)
![SQLite](https://img.shields.io/badge/SQLite-WAL-003b57?logo=sqlite&logoColor=white)
![Socket.IO 4](https://img.shields.io/badge/Socket.IO-4-010101?logo=socketdotio)
![Tailwind CSS 4](https://img.shields.io/badge/Tailwind_CSS-4-06b6d4?logo=tailwindcss&logoColor=white)
![Tests](https://img.shields.io/badge/tests-329_Vitest_%2B_47_Playwright-16a34a)

![LogiTrack dashboard](docs/assets/screenshots/dashboard.webp)

</div>

LogiTrack is a portfolio project that shows how a real operations system fits together: a Next.js front end, a typed REST API over a service layer, a relational database with migrations, session authentication with role-based access, a realtime channel, a GPS simulator, a route optimiser, and a set of explainable rule engines. Version 3 added what running it responsibly needs: optional two-factor authentication, a Content Security Policy, verified backups, structured logging, CSV import, measured performance, accessibility checks and CI.

It runs entirely on your own machine with **no API keys, no paid services and no accounts**. It is not a commercial service: it has no customers or production deployments. The demo uses generated sample data, and vehicle positions come from a built-in simulator, not tracking hardware.

---

## Contents

1. [Screenshots](#screenshots)
2. [What it is for](#what-it-is-for)
3. [Features by module](#features-by-module)
4. [Technology stack](#technology-stack)
5. [Architecture](#architecture)
6. [Database design](#database-design)
7. [Authentication and authorisation](#authentication-and-authorisation)
8. [Route optimisation](#route-optimisation)
9. [Live tracking and simulated GPS](#live-tracking-and-simulated-gps)
10. [CSV import and export](#csv-import-and-export)
11. [Analytics, intelligence and reporting](#analytics-intelligence-and-reporting)
12. [Security](#security)
13. [Performance](#performance)
14. [Getting started on Windows](#getting-started-on-windows)
15. [Demo accounts](#demo-accounts)
16. [Development commands](#development-commands)
17. [Testing](#testing)
18. [Known limitations](#known-limitations)
19. [Future improvements](#future-improvements)
20. [Documentation](#documentation)

## Screenshots

Every image is captured from the running application by `npm run screenshots` (Playwright on freshly seeded sample data), then optimised to WebP by `scripts/optimize-screenshots.mjs`. None are mock-ups.

| | |
| --- | --- |
| ![Landing page](docs/assets/screenshots/landing.webp) **Landing page** | ![Demo login](docs/assets/screenshots/login.webp) **Demo access by role** |
| ![Dashboard](docs/assets/screenshots/dashboard.webp) **Dashboard** | ![Guided tour](docs/assets/screenshots/tour.webp) **Guided tour** |
| ![Vehicles](docs/assets/screenshots/vehicles.webp) **Vehicles** | ![Drivers](docs/assets/screenshots/drivers.webp) **Drivers** |
| ![Deliveries](docs/assets/screenshots/deliveries.webp) **Deliveries with risk levels** | ![Delivery detail](docs/assets/screenshots/delivery-detail.webp) **Delivery detail, route and history** |
| ![Live tracking](docs/assets/screenshots/tracking.webp) **Live tracking (simulated GPS)** | ![Route planning](docs/assets/screenshots/routes.webp) **Route optimisation** |
| ![Fuel](docs/assets/screenshots/fuel.webp) **Fuel management** | ![Maintenance](docs/assets/screenshots/maintenance.webp) **Maintenance and recommendations** |
| ![Analytics](docs/assets/screenshots/analytics.webp) **Analytics with period comparison** | ![Fleet utilisation](docs/assets/screenshots/analytics-fleet.webp) **Fleet utilisation intelligence** |
| ![Fuel efficiency](docs/assets/screenshots/analytics-fuel.webp) **Fuel efficiency intelligence** | ![Driver performance](docs/assets/screenshots/performance.webp) **Driver performance** |
| ![Import](docs/assets/screenshots/import-export.webp) **CSV import with row-level checks** | ![Security settings](docs/assets/screenshots/security-settings.webp) **Two-factor and sessions** |
| ![Backup and restore](docs/assets/screenshots/backups.webp) **Backup & Restore** | ![Diagnostics](docs/assets/screenshots/diagnostics.webp) **Diagnostics** |
| ![Driver portal](docs/assets/screenshots/driver-portal.webp) **Driver portal** | Full landing page: [`landing-full.webp`](docs/assets/screenshots/landing-full.webp) |

## What it is for

LogiTrack models the daily work of a small delivery fleet, the kind run by a regional distributor or a third-party logistics operator. Four roles share one system:

- A **dispatcher** creates deliveries, assigns a driver and vehicle, plans multi-stop routes and watches trips on the map.
- A **driver** sees only their own deliveries and moves each one through the workflow.
- A **fleet manager** looks after vehicles, fuel, maintenance and costs.
- A **Super Admin** manages users, settings, backups and system health.

The interesting engineering is the parts that are easy to get wrong:
- business rules that must hold under concurrency (no driver booked twice);
- authorisation that holds per record, not just per page;
- imports that can never half-apply;
- backups that are verified before they count;
- numbers that are always computed from records, never stored or invented.

## Features by module

| Module | What it does |
| --- | --- |
| **Dashboard** | 12 live KPIs, delivery performance, monthly trends, fuel spend, vehicle status, fleet utilisation, top drivers, deliveries at risk, maintenance and expiry alerts, recent activity. Date-range filter. Cost figures are hidden from roles without access. |
| **Vehicles** | Create, edit and deactivate; search, filters, sorting, pagination; driver assignment; availability rules (a vehicle on a delivery or under maintenance cannot take new work); per-vehicle delivery, fuel and service history. |
| **Drivers** | Profiles with licence validity warnings, a regular vehicle, an optional login account, and statistics computed from their own records. |
| **Deliveries** | Create, assign and reassign. An enforced status workflow (Pending → Assigned → Picked Up → In Transit → Delivered, plus Delayed, Failed and Cancelled). Driver and vehicle availability updated automatically. Full event history, delay detection, risk level. |
| **Live tracking** | Leaflet + OpenStreetMap with markers moving every 2 s over Socket.IO, a route overlay, vehicle details, search and filters, and simulation pause, resume and restart. |
| **Route planning** | Point-to-point estimates, and a multi-stop pickup-and-delivery optimiser that compares three stop orders. Saved routes can be assigned to a driver and vehicle. |
| **Fuel** | Fill records with tank-capacity and odometer-order validation, spend, fill-to-fill mileage, cost per km, monthly trends, efficiency flags. |
| **Maintenance** | Schedule, start, complete and cancel jobs. Reminders by date and odometer, automatic vehicle status, recommendations from service intervals. |
| **Analytics** | Reliability, cost, fleet, fuel, maintenance and driver views; comparison with the previous period or last year, with plain-language explanations of what changed. |
| **Driver performance** | A documented score, leaderboard, 30-day trend and fleet benchmark. A driver sees only their own numbers. |
| **Reports** | Eight CSV reports (deliveries, vehicle performance, driver performance, fuel, fuel efficiency, maintenance, activity, analytics) with an on-screen preview. |
| **Import & Export** | CSV import for vehicles, drivers, deliveries, fuel and maintenance with a full dry run, and exports in the same format ([details](#csv-import-and-export)). |
| **Notifications** | Persisted, categorised, de-duplicated and pushed in real time. |
| **Activity log** | An audit trail of every important change, with filters and export. |
| **Users and settings** | Account administration (roles, deactivation, unlock, two-factor reset, one-time password reset links) and system configuration. |
| **Account security** | Optional TOTP two-factor with recovery codes, a list of signed-in devices, and password changes. |
| **Backup & Restore** | Verified backups (manual, scheduled, command line), integrity checks, a transactional restore with a safety backup. Super Admin only. |
| **Diagnostics** | Application, database, websocket, simulator and background-job health, memory and recent errors. Super Admin only. Public `/api/health`. |
| **Demo experience** | A landing page, role cards with one-click sign-in, a guided tour adapted to each role, a sample-data banner and a two-second demo reset. |

Every number in the product is calculated from database records. There are no hard-coded figures and no placeholder charts.

## Technology stack

| Layer | Technology | Why |
| --- | --- | --- |
| Framework | **Next.js 16** (App Router), **React 19**, **TypeScript** (strict) | Server-rendered pages and API route handlers in one typed codebase. |
| UI | Tailwind CSS 4, Radix UI primitives, Lucide icons, Recharts, Leaflet + React Leaflet | Accessible primitives without a paid component kit. |
| API | Next.js route handlers wrapped by `route()` (`src/lib/api.ts`), **Zod** validation | One place for auth, permission, CSRF, validation, rate limits and error mapping. |
| Data | **Prisma 6** + **SQLite** (WAL), migrations, a deterministic seed generator | Zero setup, a single file to back up, typed queries. |
| Realtime | **Socket.IO 4** in the same process | Rooms per user and for staff, with cookie authentication and an origin check. |
| Auth | bcrypt (`bcryptjs`), database sessions, TOTP (`otpauth`), QR codes (`uqr`), AES-256-GCM (Node `crypto`) | Revocable sessions; no third-party identity provider. |
| Routing | Haversine, nearest neighbour and 2-opt (`src/lib/geo.ts`); optional public OSRM with fallback | Works fully offline. |
| Quality | Vitest, React Testing Library, Playwright, axe-core, ESLint, GitHub Actions (Linux and Windows) | Unit, integration, end-to-end and accessibility checks. |
| Operations | Structured JSON logs, a job registry, `VACUUM INTO` backups, optional Docker | Operable without paid services. |

## Architecture

One Node.js process (`server.ts`) serves the Next.js pages, the REST API, the Socket.IO channel, the GPS simulator and the background jobs on a single port.

```mermaid
flowchart LR
  Browser["Browser<br/>React pages · fetch · socket.io-client · Leaflet"]
  subgraph Server["Node.js process (server.ts)"]
    Proxy["src/proxy.ts<br/>session gate · CSP nonce"]
    API["Route handlers (76)<br/>route(): same-origin · auth · permission · Zod · rate limit · errors"]
    Services["Services (src/server/services)<br/>business rules · transactions · audit · notifications"]
    Domain["Pure domain logic (src/lib/domain, geo.ts)<br/>state machine · risk · fuel · scoring · optimiser"]
    IO["Socket.IO<br/>cookie auth · origin check · rooms"]
    Jobs["GPS simulator + job registry<br/>reminders · credential cleanup · scheduled backups"]
  end
  DB[("SQLite via Prisma")]
  Browser -->|HTTP| Proxy --> API --> Services --> Domain
  Services --> DB
  Jobs --> Services
  Services -->|events| IO -->|websocket| Browser
```

- **Thin route handlers, rich services.** A handler declares its permission and Zod schema and calls one service function. The same services are used by the API, the simulator, CSV import, the seed generator and the tests.
- **Pure domain logic.** Every calculation is a function with no I/O, unit-tested with plain objects.
- **One validation schema per entity**, shared by the form (instant feedback) and the API (authoritative).
- **Safe start-up.** The server checks the port and claims a per-database lock before anything starts, starts the simulator and jobs only after it is listening, and stops them all on shutdown. Two servers can never drive one database.

Full detail with six diagrams (system, data model, delivery lifecycle, tracking data flow, authentication, CSV import): [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md).

## Database design

17 Prisma models on SQLite, 3 migrations.

```mermaid
erDiagram
  User ||--o{ Session : has
  User ||--o| Driver : "login for"
  User ||--o{ Notification : receives
  User ||--o{ ActivityLog : performs
  User ||--o{ MfaRecoveryCode : "recovery codes"
  Driver |o--o| Vehicle : "regular vehicle"
  Driver ||--o{ Delivery : drives
  Vehicle ||--o{ Delivery : carries
  Vehicle ||--o{ FuelRecord : refuelled
  Vehicle ||--o{ MaintenanceRecord : serviced
  Delivery ||--o{ DeliveryEvent : history
  Route ||--o{ RouteStop : stops
  Route ||--o{ Delivery : groups
```

The diagram leaves out `AuthChallenge`, `PasswordResetToken`, `Setting` and `Counter` for space; the full model is in [docs/DATABASE.md](docs/DATABASE.md).

- **Money** is stored as integer paise, distances in km, coordinates as decimal degrees.
- Vehicles, drivers and users are **soft-deleted**, so history keeps valid references.
- Derived figures (scores, mileage, utilisation, risk, dashboard numbers) are **never stored**; they are computed from records.
- Assignments and status transitions are **guarded writes** (`updateMany ... where status = expected`), so concurrent requests cannot double-book a driver or apply a transition twice.

## Authentication and authorisation

- **Sessions, not JWTs.** A 256-bit random token in an `HttpOnly`, `SameSite=Lax` cookie (`__Host-` prefix and `Secure` over HTTPS). Only its SHA-256 is stored.
  - Sessions last at most 7 days, end after 12 idle hours, and are capped at 10 per user.
  - They are revoked on logout, password change, role change, deactivation and restore. Open websockets are dropped at the same moment.
- **Optional two-factor (TOTP):**
  - enrolment by QR code, confirmed by a first valid code;
  - replay protection (each 30-second time step is accepted once);
  - secrets encrypted with AES-256-GCM;
  - 10 single-use recovery codes stored as bcrypt hashes.
- **Brute-force protection:** per-address rate limits, plus a persistent account lockout after 10 consecutive failures (15 minutes).
- **No e-mail needed:** a Super Admin creates one-time password reset links (valid 60 minutes, single use, token hashed). A CLI covers lost-admin cases.
- **Role-based access** from one permission matrix (`src/lib/permissions.ts`), enforced on the server for every page and API route. Services also scope data: a driver's queries are always restricted to their own deliveries.

| Role | Can do |
| --- | --- |
| Super Admin | Everything, including users, settings, backups, diagnostics and the audit log |
| Fleet Manager | Vehicles, drivers, deliveries, fuel, maintenance, analytics, reports, import/export |
| Dispatcher | Deliveries, assignment, route planning, live map, delivery import/export |
| Driver | Own deliveries and status updates, own performance |

## Route optimisation

Route Planning orders a multi-stop pickup-and-delivery trip and compares three options side by side: the stops **as entered**, **nearest neighbour**, and **nearest neighbour + 2-opt**.

1. Distances use the Haversine formula. Offline they are multiplied by a road circuity factor of 1.3 (`ROAD_CIRCUITY` in `src/lib/geo.ts`). With `ROUTING_PROVIDER=osrm`, the public OSRM demo server supplies real road geometry, falling back to the local estimate automatically.
2. **Nearest neighbour** builds the route from the start point, always taking the closest stop whose prerequisite is met: a drop-off only becomes eligible once its pickup has been visited.
3. **2-opt** then reverses segments of the route whenever that makes it shorter **and** every pickup still comes before its drop-off.

It is a heuristic, not an optimal vehicle-routing solver. It does not model vehicle capacity or time windows.

## Live tracking and simulated GPS

**All vehicle positions are simulated, and the interface says so.** No hardware GPS is connected.

1. Every 2 seconds the simulator (`src/server/simulator.ts`) finds deliveries that are in transit.
2. Each vehicle advances along its delivery's route polyline by the distance it would cover at the configured average speed, multiplied by the simulation speed.
3. All positions of a tick are written in **one** database transaction, then broadcast over Socket.IO to staff and to the assigned driver. Markers move without a page refresh.
4. On arrival the delivery is completed through the same service function a person would use, so the driver and vehicle become available again.

In demo mode the simulator only advances while someone is connected, so the sample trips are still on the road when a demonstration starts. Controls on the Live Tracking page: **Pause**, **Resume** and **Restart trips**.

## CSV import and export

**Insights → Import & Export** imports vehicles, drivers, deliveries, fuel and maintenance records:

1. **Download a template.** The import needs the template's columns; their order does not matter, and unknown columns are listed and ignored.
2. **Check file:** every row goes through the same Zod schema **and the same service insert function** as the form, inside one database transaction with a `SAVEPOINT` per row. The whole check is then rolled back, so nothing is saved. Each line is reported as ready, error or duplicate (within the file or against the database), with the reason per column.
3. **Import:** the file is validated again on the server and saved in one transaction. By default, if any row has a problem, **nothing is imported**. You can choose to skip problem rows, and they stay listed.

Passwords are never imported. Deliveries arrive as Pending and are assigned in the app. Exports use the same columns, so files round-trip. Details: [docs/IMPORT_EXPORT.md](docs/IMPORT_EXPORT.md).

## Analytics, intelligence and reporting

LogiTrack does not use an AI service. Its "intelligence" is a set of transparent rules applied to your own records, each returning its reasoning in plain language. It is pure, unit-tested code in `src/lib/domain`, with every formula written down in [docs/FEATURES.md](docs/FEATURES.md).

| Engine | Answers | Example output |
| --- | --- | --- |
| **Delivery risk** | Which open deliveries will probably be late? | *High risk: "Projected to arrive 20 min after the expected time"* |
| **Fleet utilisation** | Which vehicles are under-used, and by how much? | *"Used on 2 of 30 available days (6.7%); the fleet average is 15.8%."* |
| **Fuel efficiency** | Where is mileage poor, falling, or unmeasurable? | *"Mileage fell 27% on the last two fills (11.1 km/L, previously 15.2 km/L)."* |
| **Maintenance recommendations** | When will each vehicle next need a routine service? | *"9,700 km since the last routine service … reached in roughly 15 days."* |
| **Driver performance** | How is each driver doing, and is it changing? | Score, fleet benchmark, 30-day trend, or "Not enough data" |
| **Period comparison** | What changed since last period, and why? | *"On-time delivery dropped from 100% to 58.3%: 5 of 12 deliveries were late …"* |

Reports export eight CSV files for any date range, with a UTF-8 BOM so Excel shows `₹` correctly, and protection against spreadsheet formula injection.

## Security

| Control | Implementation |
| --- | --- |
| Content Security Policy | Per-request nonce, `strict-dynamic`, `object-src 'none'`, `frame-ancestors 'none'`; violations reported to `/api/csp-report` |
| Headers | `X-Frame-Options: DENY`, `nosniff`, Referrer-Policy, Permissions-Policy, COOP/CORP; `no-store` on API responses |
| CSRF | Same-origin check on every state-changing request and websocket handshake, plus `SameSite=Lax` |
| Input | Zod on every body (unknown fields dropped), whitelisted sort columns, parameterised queries |
| Data exposure | Password hashes, two-factor secrets and token hashes are never selected into responses (asserted by tests) |
| Sensitive actions | Turning two-factor off, deleting a backup and restoring require the password (plus a code with two-factor on); a restore also requires typing `RESTORE` |
| Logging | Structured JSON; secret-like fields redacted, e-mail addresses masked; request IDs |
| Dependencies | `npm audit`: **0 vulnerabilities** ([how](docs/DEPENDENCY_AUDIT.md)); CI fails on high-severity advisories |

The security reviews (2.0: 11 findings fixed, each with a regression test; 3.0: hardening) were carried out by the developer. **LogiTrack has not been independently audited and holds no certification.** Details and known gaps: [docs/SECURITY_HARDENING.md](docs/SECURITY_HARDENING.md) · [docs/SECURITY.md](docs/SECURITY.md) · reporting: [SECURITY.md](SECURITY.md).

## Performance

Measured on one laptop (Intel i7-1360P, 16 GB, Windows 11), using a production build and a synthetic dataset: 100 vehicles, 100 drivers, 1,000 deliveries, 5,000 delivery events, 2,000 fuel records and 1,000 maintenance records.

| Measurement | Result |
| --- | --- |
| Most list endpoints (median) | about 15 ms |
| Dashboard (median, single client) | 32 ms |
| Dashboard, 10 concurrent clients | 49 requests/s |
| Simulator tick, 40 moving vehicles | **31 ms** (91 ms before batching its writes) |
| 50 websocket clients | 833 position events/s, p95 latency 67 ms |
| Live map with 100 vehicles | all markers drawn in 511 ms |
| CSV import, 1,000 deliveries | check 2.9 s, import 2.1 s |

These are single-run numbers from one machine, not a capacity guarantee. The method, the full table, the two bottlenecks fixed and the limits of these numbers are in [docs/PERFORMANCE_REPORT.md](docs/PERFORMANCE_REPORT.md). Reproduce with `npm run perf:seed`, `npm run perf:start` and `npm run perf:bench`, which use a separate `perf.db`.

## Getting started on Windows

Requirements: **Node.js 20.12+** (22 LTS recommended) and Git. No database server, Docker or accounts. Developed and tested on Windows 11 with PowerShell; it also runs on macOS and Linux.

**First-time setup**

```powershell
git clone https://github.com/rkslakshay/LogiTrack.git
cd LogiTrack
npm install
Copy-Item .env.example .env   # optional; the defaults work without it (macOS/Linux: cp)
npm run setup
```

`npm run setup` generates the Prisma Client (downloading Prisma's engines once), applies the migrations, and loads demo data **only if the database is empty**. It is safe to run again, and it never resets existing data.

**Start the app (every day)**

```powershell
npm run dev
```

Open the address it prints (normally <http://localhost:3000>) and sign in with a demo account.

If the port is taken, LogiTrack names the program holding it and exits, without stopping anything. Start on another port:

```powershell
$env:PORT=3001; npm run dev
```

| Situation | Command |
| --- | --- |
| First time, or after pulling new migrations | `npm run setup` |
| Normal start | `npm run dev` (production: `npm run build`, then `npm start`) |
| Reset the demo data (replaces records; staff can also use **Reset demo data** in the app) | `npm run db:seed` |
| Back up first | `npm run db:backup` |
| Reset the whole database (deletes everything, then reseeds) | `npm run db:reset`. Only when you mean it; back up first. |

Troubleshooting (`EPERM ... query_engine-windows.dll.node`, `EADDRINUSE`, npm `allow-scripts` warnings, Playwright browsers): **[docs/WINDOWS.md](docs/WINDOWS.md)**. Docker is optional and has not yet been validated at runtime: see [docs/DEPLOYMENT.md](docs/DEPLOYMENT.md).

## Demo accounts

> **Demo-only credentials.** These accounts exist only in the locally generated sample data and are published here on purpose. Never use them, or `DEMO_MODE=true`, on an instance that holds real data.

| Role | Email | Password | Sees |
| --- | --- | --- | --- |
| Super Admin | `admin@logitrack.in` | `Admin@123` | Everything, including users, backups and diagnostics |
| Fleet Manager | `manager@logitrack.in` | `Manager@123` | Fleet, drivers, fuel, maintenance, analytics, reports, import/export |
| Dispatcher | `dispatcher@logitrack.in` | `Dispatch@123` | Deliveries, assignment, route planning, live map |
| Driver | `driver@logitrack.in` | `Driver@123` | Own deliveries and performance |

The login page has one-click buttons for each role. After signing in, a short **guided tour** that adapts to the role is offered (never forced) and is always available from the account menu. **Reset demo data** in the banner rebuilds the sample data from a fixed seed in about two seconds; demo logins keep working. A five-minute walkthrough: [docs/DEMO_GUIDE.md](docs/DEMO_GUIDE.md).

## Development commands

| Task | Command |
| --- | --- |
| Install dependencies | `npm install` |
| Generate the Prisma Client | `npx prisma generate` (included in `npm run setup`) |
| Apply migrations only | `npm run db:deploy` |
| Create a migration after editing `schema.prisma` | `npm run db:migrate` |
| Browse the database | `npm run db:studio` |
| Development server | `npm run dev` |
| Type checks / lint | `npm run typecheck` / `npm run lint` |
| Unit and integration tests | `npm test` |
| End-to-end tests | `$env:PW_CHANNEL="msedge"; npm run test:e2e` |
| Production build / start | `npm run build` / `npm start` |
| Backups | `npm run db:backup`, `db:backups`, `db:verify`, `db:check`, `db:restore` ([guide](docs/BACKUP_RESTORE.md)) |
| Account recovery | `npm run auth:reset-link`, `auth:reset-mfa`, `auth:unlock` (pass the e-mail after `--`) |
| Performance tools | `npm run perf:seed`, `perf:start`, `perf:bench`, `perf:profile` |
| Re-capture screenshots | `npm run screenshots` |
| Smoke-test a running server | `npx tsx scripts/review-walkthrough.ts http://localhost:3000` (every page for every role, plus forbidden pages) · `node scripts/smoke-2fa.mjs http://localhost:3000` (two-factor flow on the demo dispatcher) |

Configuration lives in `.env` (see `.env.example`; every value has a working default): `PORT`, `DATABASE_URL`, `DEMO_MODE`, `ROUTING_PROVIDER`, `SIMULATOR_AUTOSTART`, `SESSION_TTL_DAYS`, `SESSION_IDLE_MINUTES`, `COOKIE_SECURE`, `APP_SECRET`, `TRUST_PROXY`, `BACKUP_*`, `LOG_*`.

## Testing

```powershell
npm run typecheck
npm run lint
npm test                                        # Vitest
$env:PW_CHANNEL="msedge"; npm run test:e2e      # Playwright (stop npm run dev first)
npm run build
```

| Suite | Tests | Covers |
| --- | --- | --- |
| Vitest | **329** (18 files) | **Unit:** geo maths and the optimiser, delivery state machine, fuel maths, scoring, reminders, permissions, CSV, every Zod schema, intelligence rules, password policy, encryption, rate limiting, log redaction, CSP, start-up checks. **Integration** (real services against a throwaway SQLite database): auth and sessions, lockout, two-factor with replay, recovery codes, reset links, fleet CRUD, assignment races, every status transition, fuel, maintenance, routes, simulator, analytics, reports, demo reset, backup/verify/restore, diagnostics, CSV import and export, security regressions (IDOR, mass assignment, revocation). **Component:** data table, pagination, filters, form fields, badges. |
| Playwright | **47** | Landing and demo access, guided tour, navigation and permissions for all four roles, websocket security, five end-to-end workflows (fleet setup, dispatch, GPS simulation to completion, fuel, maintenance), CSP and headers, an access-control inventory of 25 endpoints, backups and diagnostics UI, CSV import, **axe accessibility scan of 20 pages** |

Tests never touch your data: Vitest uses `prisma/test.db` and Playwright `prisma/e2e.db`, both rebuilt from migrations on every run. GitHub Actions runs the checks on **Linux and Windows**, plus `npm audit --audit-level=high` and the Playwright suite (`.github/workflows/ci.yml`).

## Known limitations

- **Simulated GPS.** Positions come from the simulator. A vehicle carrying several in-transit deliveries is animated along one leg at a time.
- **Rule-based intelligence.** Deliberately simple and explainable. Thresholds are sensible defaults, not values tuned on a real fleet.
- **Route estimates.** Without OSRM, distances are straight-line × 1.3. The optimiser is a heuristic with no capacity or time windows.
- **No address search.** Locations come from about 50 built-in Indian logistics hubs, a map click or typed coordinates.
- **Single process and SQLite.** Rate limits, the simulator and Socket.IO rooms live in one process. SQLite allows one writer at a time. No horizontal scaling.
- **Security.** Self-reviewed only. No HTTPS by default (put a reverse proxy in front). Two-factor is optional for every role. Rate limits reset on restart.
- **No e-mail.** Password resets use links an administrator hands over (by design: no external service).
- **Backups** are stored on the same machine and are not encrypted.
- **Import** creates records only (no updates) and has no column-mapping screen.
- **Docker** is configured but has not been built or run on the development machine (WSL is not installed there).
- **Demo data ages.** Time-based details follow the clock: reset the demo before showing it.

## Future improvements

- PostgreSQL (+ PostGIS) and a Redis adapter for Socket.IO and rate limits, so the API, simulator and jobs can scale out.
- Real telematics ingestion (MQTT or device webhooks) alongside the simulator.
- Capacity- and time-window-aware optimisation; a self-hosted OSRM or Valhalla.
- Proof of delivery (photo, signature, OTP) and customer tracking links.
- A driver PWA with an offline queue, and push notifications.
- Enforced two-factor for administrators, SSO, and encrypted off-site backups to storage the user controls.
- Update-in-place imports with column mapping.

## Documentation

| Document | Contents |
| --- | --- |
| [docs/WINDOWS.md](docs/WINDOWS.md) | Windows setup, commands and troubleshooting |
| [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) | Components, request flow, six Mermaid diagrams |
| [docs/INTERVIEW_GUIDE.md](docs/INTERVIEW_GUIDE.md) | Explaining the design and its trade-offs, with source references |
| [docs/DATABASE.md](docs/DATABASE.md) · [docs/API.md](docs/API.md) | Data model · every endpoint and realtime event |
| [docs/FEATURES.md](docs/FEATURES.md) | Features and every formula |
| [docs/SECURITY_HARDENING.md](docs/SECURITY_HARDENING.md) · [docs/SECURITY.md](docs/SECURITY.md) | Security controls, reviews, limitations |
| [docs/BACKUP_RESTORE.md](docs/BACKUP_RESTORE.md) · [docs/IMPORT_EXPORT.md](docs/IMPORT_EXPORT.md) | Operating guides |
| [docs/PERFORMANCE_REPORT.md](docs/PERFORMANCE_REPORT.md) · [docs/DEPENDENCY_AUDIT.md](docs/DEPENDENCY_AUDIT.md) | Measurements · `npm audit` record |
| [docs/DEPLOYMENT.md](docs/DEPLOYMENT.md) · [docs/DEMO_GUIDE.md](docs/DEMO_GUIDE.md) | Running it for others · demonstrating it |
| [CHANGELOG.md](CHANGELOG.md) · [docs/RELEASE_NOTES.md](docs/RELEASE_NOTES.md) · [BUILD_PROGRESS.md](BUILD_PROGRESS.md) | History |
| [CONTRIBUTING.md](CONTRIBUTING.md) · [SECURITY.md](SECURITY.md) · [LICENSE](LICENSE) · [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md) | Project policies |

---

MIT licensed. Map data © [OpenStreetMap](https://www.openstreetmap.org/copyright) contributors.
