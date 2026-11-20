# Interview guide

How to explain LogiTrack in a technical interview: a 60-second introduction, a demo script, and project-specific answers to the questions that usually follow. Each answer describes the actual code, points to the files, and is honest about the trade-offs.

LogiTrack is a portfolio project. It has no production users, customers or deployments. Say so if asked.

## 60-second introduction

> "LogiTrack is a fleet and logistics management system I built in TypeScript. A dispatcher creates deliveries and assigns a driver and a vehicle; drivers move their deliveries through an enforced workflow; vehicles move on a live map; and a route planner orders multi-stop trips.
>
> It's Next.js 16 and React 19 on the front end, REST route handlers over a service layer on the back end, Prisma with SQLite for data, and Socket.IO for live updates. Positions come from a GPS simulator I wrote, because there's no tracking hardware. Four roles with permissions enforced on the server, down to individual records.
>
> The parts I'm proudest of are the ones that are easy to get wrong:
> - **Concurrency:** two dispatchers can't book the same driver, because assignments are guarded writes.
> - **CSV import:** it runs every row through the same business rules as the forms, inside a transaction, so it can never half-apply.
> - **Backups:** they're verified before they count, and a restore is a single transaction.
>
> I also measured performance on a synthetic dataset of a thousand deliveries and fixed the two bottlenecks I found, and it has optional two-factor authentication, a Content Security Policy, 322 unit and integration tests, an end-to-end suite with an accessibility scan, and CI on Windows and Linux. Everything runs locally with no paid services."

## Five-minute demo

1. **Landing → Try the demo** (`/login`): sign in as **Dispatcher** with one click.
2. **Deliveries**: open a pending delivery, **Assign** a driver and vehicle (both become unavailable), then step through **Update status**. Point out the event history, and that an invalid transition is not offered at all.
3. **Live Tracking**: markers move every 2 s over a websocket. Everything is labelled as simulated.
4. **Route Planning**: tick three deliveries, **Optimise route**, and compare *as entered*, *nearest neighbour* and *+ 2-opt*.
5. Sign in as **Super Admin**:
   - **Import & Export**: upload a CSV with one bad row, show the row-level error, skip it and import the rest.
   - **Diagnostics**: the simulator's tick count and duration, the jobs, database integrity.
   - **Backup & Restore**: back up now.
   - **Settings → Security**: two-factor set-up.

## Questions and answers

### Why Next.js and TypeScript?
- **What:** one TypeScript codebase for pages (`src/app/(app)/**`), the API (`src/app/api/**/route.ts`) and background code (`server.ts`, `src/server/**`). Zod schemas in `src/lib/validation.ts` are shared by forms and the API, so "valid" has one definition.
- **Why:** server components let every page check permissions on the server before rendering (`requirePageUser` in `src/lib/auth-server.ts`). TypeScript catches contract drift between the API and the UI at compile time. Strict mode is on.
- **Trade-off:** Socket.IO and the simulator need a long-lived process, so LogiTrack runs a **custom server** (`server.ts`) instead of `next start`. That rules out serverless hosting such as Vercel functions, which is acceptable for an app that runs on one machine. Next.js dev-mode compiles each route on first visit, which is slow the first time.

### Why SQLite and Prisma?
- **What:** `prisma/schema.prisma` (17 models), migrations in `prisma/migrations`, one client in `src/lib/db.ts`, WAL mode switched on at start-up.
- **Why:** zero setup and zero cost (the whole project must run free and locally), one file to back up, and fast enough: list endpoints answer in about 15 ms on 1,000 deliveries (`docs/PERFORMANCE_REPORT.md`). Prisma gives typed queries and migrations and keeps PostgreSQL a provider change away.
- **Trade-off:** SQLite has one writer at a time, and long imports hold the write lock. No `FOR UPDATE` row locks, which is one reason the code uses guarded `updateMany` writes instead. Money is stored as integer paise to avoid float errors.

### How is authentication implemented?
- **What:** `src/server/services/account.ts` (`beginLogin`, `completeMfaLogin`), `src/lib/auth.ts` (sessions), `src/lib/auth-server.ts` (cookies), `src/app/api/auth/*`.
  - Passwords are bcrypt hashes.
  - On success a random 256-bit token goes into an `HttpOnly`, `SameSite=Lax` cookie; the database stores only its **SHA-256**, so a stolen database can't be replayed.
  - Unknown e-mail and wrong password give the same response and the same bcrypt cost (`verifyPasswordOrDummy`), so accounts can't be enumerated.
- **Why sessions, not JWTs:** revocation is immediate (delete the row). A single-server app gains nothing from stateless tokens.
- **Trade-off:** a database lookup per request (a small cost here). `lastSeenAt` is written at most once a minute to keep reads cheap.

### How are sessions managed?
- **What:** `src/lib/auth.ts`.
  - **Limits:** 7-day absolute expiry (`SESSION_TTL_DAYS`), a 12-hour idle timeout (`SESSION_IDLE_MINUTES`), at most 10 sessions per user (the oldest are removed).
  - **Signed-in devices:** users can see them and sign them out (Settings → Security, `src/app/api/profile/sessions`).
  - **Revocation:** sessions are deleted on logout, password change or reset, role change, deactivation, two-factor changes and database restore. `onSessionsRevoked` then disconnects the affected websockets (`server.ts`), and a one-minute re-check catches plain expiry.
  - **Clean-up:** expired rows are purged hourly by the `credential-cleanup` job.
- **Trade-off:** the idle timeout is enforced when the session is next used, not by a timer.

### How are role permissions enforced?
- **What:** one matrix in `src/lib/permissions.ts`, shared by server and client. It is enforced in four layers:
  1. `src/proxy.ts`: redirects requests without a session cookie (convenience only).
  2. `requirePageUser(permission)`: on every page.
  3. `route({ permission })` in `src/lib/api.ts`: on every endpoint.
  4. **Data scoping inside services:** a driver's delivery queries are ANDed with their own driver ID (`scopeFor` in `src/server/services/deliveries.ts`), and someone else's delivery returns 404, not 403, so its existence isn't leaked.
- **Why:** route checks alone miss insecure direct object references (IDOR). The client only uses the matrix to hide buttons; the server is authoritative.
- **Evidence:** `tests/integration/security.test.ts`, plus `tests/e2e/v3.spec.ts`, which hits 25 endpoints anonymously and checks that every non-admin role gets 403 from backups and diagnostics.

### How does the delivery lifecycle work?
- **What:** `allowedTransitions()` in `src/lib/domain/delivery-status.ts` is a pure state machine: Pending → Assigned → Picked Up → In Transit → Delivered, plus Delayed, Failed and Cancelled. Delayed resumes from wherever it was interrupted (it depends on whether the goods were picked up). `changeDeliveryStatus()` in `src/server/services/deliveries.ts` applies it in one transaction, with every side effect:
  - timestamps and a `DeliveryEvent`;
  - releasing the driver and vehicle on a terminal state;
  - the odometer and the vehicle's final position;
  - the audit log, notifications and a realtime broadcast.
- **Who:** drivers can only move their own deliveries and cannot cancel. The reminder sweep automatically marks overdue deliveries as Delayed. The simulator completes a delivery on arrival through the **same function**.
- **Diagram:** `docs/ARCHITECTURE.md#delivery-lifecycle`.

### How is double booking of drivers and vehicles prevented?
- **What:** `assignMany()` in `src/server/services/deliveries.ts` claims the crew with conditional updates: `driver.updateMany({ where: { id, status: "AVAILABLE" }, data: { status: "ON_DELIVERY" } })`, and the same for the vehicle. If `count !== 1`, someone else got there first, and the whole transaction aborts with a 409. Status transitions are guarded the same way (`where: { id, status: from }`), so the same transition sent twice applies once.
- **Why:** checking availability and then writing is a race; the guard makes check-and-write one atomic statement. It works on SQLite, which has no row locks.
- **Evidence:** `tests/integration/security.test.ts` → "never double-books a driver/vehicle when two assignments race" runs two assignments in parallel and asserts that exactly one wins.

### How does route optimisation work?
- **What:** `src/lib/geo.ts`:
  - Haversine distances, multiplied by `ROAD_CIRCUITY = 1.3` when offline.
  - `nearestNeighborOrder()` builds the route from the start, choosing only stops whose precedence is satisfied (a drop-off after its pickup).
  - 2-opt then reverses segments while the route gets shorter **and** precedence still holds.
  - The UI compares *as entered*, *nearest neighbour* and *+ 2-opt*.
  - `src/lib/routing.ts` optionally asks the public OSRM demo server for real road geometry and falls back to the local estimate on any failure.
- **Why:** explainable, fast for up to 25 stops, and fully offline.
- **Trade-off:** it is a heuristic, not an optimal solver, and has no vehicle capacity or time windows. A real vehicle-routing solver (for example OR-Tools) would be the next step.

### How does simulated GPS tracking work?
- **What:** `src/server/simulator.ts`. Every 2 s it loads the deliveries in transit, one active leg per vehicle, and advances each vehicle along its route polyline by `averageSpeed × elapsed × simulationSpeed`.
  - **Writes:** all positions of the tick go in **one** transaction, then out as `vehicle:location` events to staff and to the assigned driver.
  - **Arrival:** at 100% progress it calls `changeDeliveryStatus(DELIVERED)`.
  - **Demo gate:** in demo mode it idles while nobody is connected, so the sample trips don't finish overnight.
  - **Diagnostics:** tick counts, failures and durations appear on the Diagnostics page.
- **Performance work:** profiling showed 91 ms per tick for 40 vehicles, from one SQLite commit per vehicle and re-parsing each route's JSON every tick. Batching the writes and caching parsed geometry brought it to **31 ms** (`docs/PERFORMANCE_REPORT.md`).
- **Trade-off:** it is a simulation and is labelled as one everywhere. A vehicle with several in-transit deliveries is animated along one leg at a time.

### How are WebSockets used?
- **What:** Socket.IO is attached to the same HTTP server (`server.ts`).
  - **Handshake:** it must come from the app's own origin (WebSockets are not covered by CORS) and carry a valid session cookie.
  - **Rooms:** staff join `staff`; everyone joins `user:<id>`, so a driver only ever receives their own events.
  - **Publishing:** services publish through `emitStaff` and `emitUsers` (`src/lib/realtime.ts`).
  - **Client:** one shared connection in `src/components/app/providers.tsx`, with views subscribing through `useSocketEvent`.
  - **Events:** `vehicle:location`, `delivery:updated`, `notification:new`, `simulator:state`, `demo:reset`.
- **Measured:** 50 clients received 833 events/s with a p95 latency of 67 ms.
- **Trade-off:** rooms live in memory, so a second server process would need the Socket.IO Redis adapter.

### How does CSV import prevent partial writes?
- **What:** `runImport()` in `src/server/services/imports.ts` (diagram: `docs/ARCHITECTURE.md#csv-import-workflow`).
  1. Parse: RFC 4180 parser in `src/lib/csv.ts`, header mapping and required columns.
  2. One interactive transaction for the whole file.
  3. Per row: the entity's **Zod schema**, a duplicate check (in the file and in the database), then the **same `insert*()` service function** the form uses, inside a `SAVEPOINT`. A row that breaks a business rule (tank capacity, odometer order, uniqueness) is rolled back to its savepoint and reported, without affecting the others.
  4. **Preview:** "Check file" throws at the end, so nothing is ever saved.
  5. **Commit:** re-parses and re-validates the file from scratch. It rolls everything back if any row fails, unless the user explicitly chose to skip problem rows.
- **Why:** re-implementing validation for imports always drifts from the forms. Reusing the service functions means an import can't create what the UI would refuse.
- **Trade-off:** one transaction holds SQLite's write lock for the whole file (2.1 s for 1,000 deliveries). Imports only create records; they don't update.

### How do database backup and restore work?
- **What:** `src/server/services/backup.ts`.
  - **Backup:** `VACUUM INTO` writes a consistent snapshot while the app keeps running. The copy is opened with a **separate connection** and checked with `PRAGMA integrity_check` and `foreign_key_check`; only then is it renamed to its final name, with a manifest (SHA-256, row counts, latest migration).
  - **Restore:** checks the backup again, requires identical migrations, and takes a safety backup. It then runs on a dedicated single-connection client: `ATTACH` the backup, `BEGIN IMMEDIATE`, replace every table, check foreign keys, `COMMIT`. All or nothing.
  - **Never restored:** sessions, two-factor challenges and reset links, so revoked credentials can't come back. Everyone is signed out.
- **Safety:** restoring requires the password, a two-factor code if enabled, and typing `RESTORE`. Backup names are validated against a strict pattern (no path traversal).
- **Trade-off:** backups sit on the same machine and are not encrypted. Restoring across schema versions is deliberately refused.
- **Evidence:** `tests/integration/backup.test.ts` covers restore, a schema mismatch, tamper detection and traversal.

### How is two-factor authentication implemented?
- **What:** `src/server/services/account.ts` + `src/lib/crypto.ts`.
  - **TOTP** (RFC 6238, `otpauth`), set up by QR code (`uqr`). The secret stays *pending* until the user proves it works with a valid code.
  - **Encryption:** secrets are stored with **AES-256-GCM**, using a key derived (HKDF) from `APP_SECRET` (or a generated key file). They are never returned again.
  - **Replay protection:** the accepted time step is stored, and a guarded update makes it single-use, even for two simultaneous requests.
  - **Recovery codes:** 10 single-use codes stored as bcrypt hashes.
  - **Sign-in:** password → a 5-minute challenge cookie (5 attempts) → code → session.
  - **Sensitive changes:** turning it off or regenerating codes needs the password **and** a code.
- **Trade-off:** it is optional for every role. There's no SMS or e-mail factor, by design: no external services.

### How does the application handle errors?
- **What:** services throw `ApiError` (`src/lib/errors.ts`). `errorResponse()` in `src/lib/api.ts` maps everything to one shape, `{ error: { code, message, fieldErrors } }`:
  - Zod → 422 with per-field messages; Prisma unique violation → 409; not found → 404; rate limits → 429 with `Retry-After`;
  - anything else → 500 with a **request ID** and no internals. The stack trace goes to the structured log (`src/lib/logger.ts`), which redacts secrets and masks e-mail addresses.
  - Warnings and errors also feed the Diagnostics page. Pages have an error boundary (`src/app/(app)/error.tsx`).
- **Start-up errors are handled too.** A busy port gets a diagnostic that names the process holding it, and exits. That fixed a real bug where a failed start left a zombie process holding Prisma's DLL on Windows (`src/server/startup.ts`, `docs/WINDOWS.md`).

### What performance bottlenecks were identified?
- **Method:** a synthetic dataset in a separate database (`npm run perf:seed`: 100 vehicles, 1,000 deliveries, 5,000 events, 2,000 fuel, 1,000 maintenance), a production build, and a benchmark (`scripts/perf-bench.ts`) plus a service profiler (`scripts/perf-profile.ts`).
- **Found:**
  1. The simulator tick: one commit per vehicle plus a JSON re-parse of each route.
  2. `maintenanceAlerts()`: loaded every maintenance record with all columns and a joined vehicle per record. That was most of the dashboard's time.
- **Not a problem (measured):** pagination, indexes, analytics and intelligence queries.

### What optimisations were implemented?
| Change | Before | After |
| --- | --- | --- |
| Simulator: one transaction per tick + cached geometry | 91 ms per tick (40 vehicles) | 31 ms |
| `maintenanceAlerts`: 8 columns, vehicles loaded once into a map | 19–28 ms | 7.9 ms |
| Dashboard service (because of the above) | 38–44 ms | 21.5 ms |

No caching layer was added, because every endpoint was already fast and caching would add invalidation bugs.

### What are the architectural limitations?
- **One process:** the simulator, jobs, rate limits and Socket.IO rooms are in-process. Running two servers on one database is actively prevented by a per-database lock (`src/server/startup.ts`).
- **SQLite:** a single writer.
- **Simulated GPS** and heuristic routing.
- **Security self-reviewed**, not independently audited.
- **No e-mail delivery.**
- **Local backups** only.
- **Docker** is configured but not yet validated at runtime.

All of this is written down in the README and `docs/SECURITY_HARDENING.md`.

### How would it scale to a larger fleet?
1. **Database:** move to PostgreSQL (Prisma provider change, then review the raw-SQL backup code, which is SQLite-specific). Add PostGIS for spatial queries; row locks would complement the guarded writes.
2. **Separate the workloads:** run the API as stateless instances. Move the simulator, or real telematics ingestion, and the job registry into a worker, with leader election so each job runs once.
3. **Realtime:** use the Socket.IO Redis adapter so rooms span instances. Throttle and aggregate position events per client viewport instead of broadcasting every vehicle.
4. **Rate limits and sessions:** keep rate limits in Redis. Sessions stay in the database, which is already fine across instances.
5. **Data volume:** add server-side aggregation tables or materialised views for analytics over long periods, an archive for old delivery events, and background jobs for large imports.

The service layer and the domain modules would not need to change. That separation is the main thing the current design gets right.

## Numbers worth remembering

76 API route files · 17 Prisma models · 4 roles · 322 Vitest + 47 Playwright tests · CI on Windows and Linux · simulator tick 31 ms for 40 vehicles · dashboard 32 ms median on 1,000 deliveries · 1,000-row import checked in 2.9 s and saved in 2.1 s · axe: 0 serious or critical issues on 20 pages · `npm audit`: 0 vulnerabilities.
