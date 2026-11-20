# REST API

All endpoints live under `/api` and are implemented as Next.js Route Handlers in `src/app/api`. Each handler is wrapped by `route()` from `src/lib/api.ts`, which applies, in order: same-origin check → authentication → permission check → JSON body validation (Zod) → handler → error mapping.

## Conventions

**Authentication.** Session cookie `lt_session` (HttpOnly), set by `POST /api/auth/login`. There are no API keys.

**Success** responses are wrapped: `{ "data": … }`. CSV exports return the file directly.

**Errors** share one shape:

```json
{ "error": { "code": "VALIDATION", "message": "Please correct the highlighted fields.", "fieldErrors": { "odometer": "Cannot be negative" } } }
```

| Status | `code` | When |
| --- | --- | --- |
| 400 | `BAD_REQUEST` | Malformed request or a missing required reason |
| 401 | `UNAUTHORIZED` / `INVALID_CREDENTIALS` | Not signed in / wrong email or password |
| 403 | `FORBIDDEN` / `ACCOUNT_DISABLED` | Role lacks the permission, cross-origin write, or disabled account |
| 404 | `NOT_FOUND` | Record does not exist, or is outside the caller's data scope |
| 409 | `CONFLICT` | Business rule violated (unavailable driver, invalid status transition, duplicate value…) |
| 422 | `VALIDATION` | Body failed schema validation (`fieldErrors` lists each field) |
| 429 | `RATE_LIMITED` | Too many failed logins |
| 500 | `INTERNAL` | Unexpected error (details are logged on the server only) |

**Lists** accept `page`, `pageSize` (max 200), `q` (search), `sort`, `dir` (`asc` / `desc`), and where relevant `from` / `to` (`yyyy-MM-dd`). They return:

```json
{ "data": { "items": [], "total": 94, "page": 1, "pageSize": 10, "pageCount": 10 } }
```

Sort columns are whitelisted per endpoint; unknown values fall back to the default order.

**Money** is exchanged in rupees in request bodies (`pricePerLitre`, `cost`) and returned in paise (`…Paise` fields).

## Permissions

`SA` Super Admin · `FM` Fleet Manager · `DI` Dispatcher · `DR` Driver. The matrix is defined in `src/lib/permissions.ts`.

## Endpoints

### Authentication and profile

| Method | Path | Access | Description |
| --- | --- | --- | --- |
| POST | `/api/auth/login` | public | Body `{ email, password }`. Sets the session cookie and returns the user and `redirectTo`, or `{ mfaRequired: true }` with a 5-minute challenge cookie when two-factor is on. 429 with `Retry-After` when rate-limited or locked. |
| POST | `/api/auth/mfa` | challenge cookie | Body `{ code }` or `{ recoveryCode }`. Completes a two-factor sign-in. |
| POST | `/api/auth/password-reset` | public (token) | Body `{ token, newPassword, confirmPassword }`. Uses a one-time reset link. |
| POST | `/api/auth/logout` | any | Ends the session. |
| GET | `/api/auth/me` | signed in | Current user. |
| PUT | `/api/profile` | signed in | Body `{ name, phone }`. |
| POST | `/api/profile/password` | signed in | Body `{ currentPassword, newPassword, confirmPassword }`. Signs out other devices. |
| GET | `/api/profile/mfa` | signed in | `{ enabled, enabledAt, recoveryCodesRemaining }`. Never contains the secret. |
| POST | `/api/profile/mfa` | signed in | Body `{ password }`. Starts enrolment: returns the QR code (SVG), `otpauth` URI and manual key, the only time a secret is returned. |
| POST | `/api/profile/mfa/enable` | signed in | Body `{ code }`. Activates two-factor and returns 10 recovery codes (shown once). |
| POST | `/api/profile/mfa/disable` | signed in | Body `{ password, code | recoveryCode }`. |
| POST | `/api/profile/mfa/recovery-codes` | signed in | Body `{ password, code }`. Replaces the recovery codes. |
| GET | `/api/profile/sessions` | signed in | Signed-in devices (`current` marks this one). |
| DELETE | `/api/profile/sessions` | signed in | Signs out every other session. |
| DELETE | `/api/profile/sessions/:id` | signed in | Signs out one session. |

### Vehicles

| Method | Path | Access | Description |
| --- | --- | --- | --- |
| GET | `/api/vehicles` | SA FM DI | List. Filters: `type`, `status`, `fuelType`. |
| POST | `/api/vehicles` | SA FM | Create. |
| GET | `/api/vehicles/options` | SA FM DI | Compact list for dropdowns. |
| GET | `/api/vehicles/:id` | SA FM DI | Detail with deliveries, fuel, service history, audit trail and statistics. |
| PUT | `/api/vehicles/:id` | SA FM | Update. `status` may be `AVAILABLE`, `MAINTENANCE` or `INACTIVE`. |
| DELETE | `/api/vehicles/:id` | SA FM | Remove from the fleet (soft delete). 409 if it has active deliveries. |
| PUT | `/api/vehicles/:id/driver` | SA FM | Body `{ driverId \| null }`. Assign or release the regular driver. |

Vehicle body: `registrationNumber`, `name`, `type`, `manufacturer`, `model`, `year`, `fuelType`, `fuelCapacity`, `odometer`, `status`, `insuranceExpiry`, `registrationExpiry`, `assignedDriverId?`, `lastLat?`, `lastLng?`.

### Drivers

| Method | Path | Access | Description |
| --- | --- | --- | --- |
| GET | `/api/drivers` | SA FM DI | List with computed statistics. Filters: `status`, `assigned` (`yes` / `no`). |
| POST | `/api/drivers` | SA FM | Create. Optional `loginPassword` also creates a `DRIVER` login. |
| GET | `/api/drivers/options` | SA FM DI | Compact list for dropdowns. |
| GET | `/api/drivers/:id` | SA FM DI | Profile, statistics, delivery history. |
| PUT | `/api/drivers/:id` | SA FM | Update. |
| DELETE | `/api/drivers/:id` | SA FM | Deactivate (soft delete), release vehicle, disable login. |

Driver body: `fullName`, `email`, `phone`, `address`, `licenseNumber`, `licenseExpiry`, `joiningDate`, `status`, `assignedVehicleId?`, `loginPassword?`.

### Deliveries

| Method | Path | Access | Description |
| --- | --- | --- | --- |
| GET | `/api/deliveries` | SA FM DI DR | List. Filters: `status` (comma-separated), `scope` (`active` / `closed`), `priority`, `driverId`, `vehicleId`, `from`, `to`. **Drivers only ever receive their own deliveries.** |
| POST | `/api/deliveries` | SA FM DI | Create; optionally assign with `driverId` + `vehicleId`. |
| GET | `/api/deliveries/:id` | SA FM DI DR | Detail with route geometry, event history, `nextStatuses` and `canAssign` for the caller. |
| PUT | `/api/deliveries/:id` | SA FM DI | Update details. Locations are locked after pickup; closed deliveries cannot be edited. |
| DELETE | `/api/deliveries/:id` | SA FM DI | Only `PENDING` or `CANCELLED` deliveries. |
| POST | `/api/deliveries/:id/assign` | SA FM DI | Body `{ driverId, vehicleId }`. Assign or reassign. 409 when a resource is unavailable. |
| DELETE | `/api/deliveries/:id/assign` | SA FM DI | Unassign (back to `PENDING`). |
| POST | `/api/deliveries/:id/status` | SA FM DI DR | Body `{ status, note? }`. Validated against the state machine. `note` is required for `DELAYED`, `FAILED`, `CANCELLED`. Drivers: own deliveries only, cannot cancel. |
| POST | `/api/deliveries/:id/issue` | SA FM DI DR | Body `{ note }`. Records an issue and notifies dispatch. |

Delivery body: `customerName`, `customerPhone`, `pickupAddress`, `destinationAddress`, `pickupLat`, `pickupLng`, `destLat`, `destLng`, `scheduledAt`, `expectedAt`, `priority`, `notes?`, `driverId?`, `vehicleId?`.

### Tracking and simulator

| Method | Path | Access | Description |
| --- | --- | --- | --- |
| GET | `/api/tracking` | SA FM DI | Fleet snapshot: every vehicle with its position, driver and current delivery, plus simulator state. |
| GET | `/api/simulator` | SA FM DI | Simulator state. |
| POST | `/api/simulator` | SA FM DI | Body `{ action: "start" \| "pause" \| "restart" }`. `restart` rewinds the trips on the road to their starting points and is only available in demo mode (403 otherwise). |

### Routes

| Method | Path | Access | Description |
| --- | --- | --- | --- |
| GET | `/api/routes` | SA FM DI | Saved routes. Filter: `status`. |
| POST | `/api/routes` | SA FM DI | Save a route; optionally assign a crew to all its deliveries. |
| POST | `/api/routes/preview` | SA FM DI | Body `{ start: { label, lat, lng }, deliveryIds[], strategy }`. Returns the three options and the selected stop order, geometry, distance and time. Saves nothing. |
| POST | `/api/routes/point` | SA FM DI | Body `{ from: { lat, lng }, to: { lat, lng } }`. Point-to-point estimate. |
| GET | `/api/routes/:id` | SA FM DI | Route with stops and deliveries. |
| DELETE | `/api/routes/:id` | SA FM DI | Delete; deliveries return to pending. 409 while in progress. |
| POST | `/api/routes/:id/assign` | SA FM DI | Body `{ driverId, vehicleId }`. |

`strategy`: `original`, `nearestNeighbor`, `optimized`.

### Fuel

| Method | Path | Access | Description |
| --- | --- | --- | --- |
| GET | `/api/fuel` | SA FM | List. Filters: `vehicleId`, `from`, `to`. |
| POST | `/api/fuel` | SA FM | Body `{ vehicleId, date, quantityL, pricePerLitre, odometer, station, notes? }`. |
| GET | `/api/fuel/summary` | SA FM | Totals, mileage, cost per km, per-vehicle analysis and monthly spend for the same filters. |
| PUT | `/api/fuel/:id` | SA FM | Update. |
| DELETE | `/api/fuel/:id` | SA FM | Delete. |

### Maintenance and reminders

| Method | Path | Access | Description |
| --- | --- | --- | --- |
| GET | `/api/maintenance` | SA FM | List. Filters: `vehicleId`, `status`, `type`, `from`, `to`. |
| POST | `/api/maintenance` | SA FM | Schedule. |
| GET | `/api/maintenance/alerts` | SA FM | Due-soon and overdue services, and insurance / registration / licence expiries. |
| PUT | `/api/maintenance/:id` | SA FM | Update. |
| DELETE | `/api/maintenance/:id` | SA FM | Delete (not allowed for completed work). |
| POST | `/api/maintenance/:id/start` | SA FM | Vehicle becomes `MAINTENANCE`. 409 if it is on a delivery. |
| POST | `/api/maintenance/:id/complete` | SA FM | Body `{ cost, odometer?, nextServiceDate?, nextServiceOdometer? }`. |
| POST | `/api/maintenance/:id/cancel` | SA FM | Cancel an open job. |
| POST | `/api/reminders/run` | SA FM | Run the reminder engine now (it also runs every 5 minutes). |

### Notifications

| Method | Path | Access | Description |
| --- | --- | --- | --- |
| GET | `/api/notifications` | signed in | Own notifications. Filters: `category`, `unread=true`. Includes the unread count. |
| GET | `/api/notifications/count` | signed in | `{ unread }`. |
| POST | `/api/notifications/read-all` | signed in | Mark all as read. |
| PATCH | `/api/notifications/:id` | signed in | Body `{ isRead }`. |
| DELETE | `/api/notifications/:id` | signed in | Dismiss. |

### Insights

| Method | Path | Access | Description |
| --- | --- | --- | --- |
| GET | `/api/dashboard` | SA FM DI | KPIs, charts and lists. `from` / `to` (default: last 30 days). Cost figures are `null` for roles without access. |
| GET | `/api/analytics` | SA FM | Summary, timeline, status distribution, per-vehicle and per-driver tables, maintenance cost by type and driver productivity (default: last 90 days). Add `compare=previous` or `compare=year` to also receive `comparison` (the other period's summary), `deltas` (`{ current, previous, change, pct }` per metric) and `insights` (plain-language explanations of significant changes). |
| GET | `/api/performance` | SA FM | Driver leaderboard and scoring parameters. |
| GET | `/api/performance/:driverId` | SA FM, DR (own) | Individual performance. `me` resolves to the signed-in driver. |
| GET | `/api/reports/:type` | SA FM | CSV download. Types: `deliveries`, `vehicles`, `drivers`, `fuel`, `fuel-efficiency`, `maintenance`, `activity`, `analytics` (3.0). `?format=json` returns headers, row count and a preview. |

Report types: `deliveries`, `vehicles`, `drivers`, `fuel`, `fuel-efficiency`, `maintenance`, `activity`.

`/api/performance` rows also carry `trend` (on-time rate in the last 30 days against the 30 days before; `direction` is `null` when either window has fewer than 3 delivered jobs) and the response includes `fleet` benchmarks.

### Intelligence

Read-only, rule-based analysis. Nothing is stored; every response is computed from current records. Formulas: [FEATURES.md](FEATURES.md).

| Method | Path | Access | Description |
| --- | --- | --- | --- |
| GET | `/api/intelligence/risk` | SA FM DI | Every open delivery with `risk: { level, reasons[], etaAt, slackMinutes, remainingKm }`, riskiest first, plus counts per level and the rule thresholds. |
| GET | `/api/intelligence/fleet` | SA FM | `from` / `to` (default 30 days). Fleet utilisation, idle share, active-vehicle share, maintenance downtime, average distance per vehicle, weekly usage trend, and per-vehicle rows with `underutilized` and a plain-language `explanation`. |
| GET | `/api/intelligence/fuel` | SA FM | Per-vehicle mileage, cost per km, recent change, peer median, `confidence` and `flags[]` (`INSUFFICIENT_DATA`, `MILEAGE_DROP`, `POOR_MILEAGE`, `HIGH_COST`, `SUSPECT_RECORD`, `STALE_RECORDS`), monthly price and efficiency trend, and the electric vehicles left out. Always analyses at least the 180 days before `to`. |
| GET | `/api/intelligence/maintenance` | SA FM | System-generated routine-service recommendations: `urgency` (`OVERDUE`, `SOON`, `PLANNED`), `basis` (`NO_HISTORY`, `ODOMETER`, `TIME`), `dueInDays`, `projectedDate`, `reason`. Separate from scheduled maintenance. |

The same `risk` object is included on each open delivery returned by `GET /api/deliveries` and `GET /api/deliveries/:id` (`null` once the delivery is closed).

### Demo

| Method | Path | Access | Description |
| --- | --- | --- | --- |
| GET | `/api/demo` | signed in | `{ enabled, seededAt, simulator }`. |
| POST | `/api/demo/reset` | SA FM DI | Rebuilds the sample dataset (about two seconds). Demo accounts keep their IDs and sessions. 403 when `DEMO_MODE=false`. Emits `demo:reset`. |

### System

| Method | Path | Access | Description |
| --- | --- | --- | --- |
| GET | `/api/activity` | SA FM | Audit log. Filters: `entityType`, `action`, `userId`, `from`, `to`. |
| GET | `/api/users` | SA | Users. Filters: `role`, `active` (`yes` / `no`). |
| POST | `/api/users` | SA | Body `{ name, email, phone?, role, password, isActive }`. |
| PUT | `/api/users/:id` | SA | Update; optional `password` resets it. |
| DELETE | `/api/users/:id` | SA | Deactivate. |
| GET | `/api/settings` | signed in | System settings. |
| PUT | `/api/settings` | SA | Update system settings. |
| POST | `/api/users/:id/reset-link` | SA | One-time password reset link (60 min). |
| POST | `/api/users/:id/unlock` | SA | Lifts a sign-in lockout. |
| DELETE | `/api/users/:id/mfa` | SA | Removes another user's two-factor (signs them out). |

### Operations (3.0)

| Method | Path | Access | Description |
| --- | --- | --- | --- |
| GET | `/api/health` | public | `{ status, version, database, responseMs }`; 503 when the database is unreachable. |
| GET | `/api/diagnostics` | SA | Application, database, realtime, simulator, jobs, backups and recent warnings and errors. |
| GET | `/api/backups` | SA | Backups with verification status and counts. |
| POST | `/api/backups` | SA | Create and verify a backup (20 an hour). |
| POST | `/api/backups/integrity` | SA | Integrity check of the live database. |
| GET | `/api/backups/:name` | SA | Download (logged, `no-store`). |
| DELETE | `/api/backups/:name` | SA | Body `{ password, code? }`. |
| POST | `/api/backups/:name/verify` | SA | Re-verify, including the checksum. |
| POST | `/api/backups/:name/restore` | SA | Body `{ password, code?, confirm: "RESTORE" }`. Signs everyone out. |
| POST | `/api/csp-report` | public | CSP violation reports from browsers (rate-limited, logged only). |

### Import and export (3.0)

| Method | Path | Access | Description |
| --- | --- | --- | --- |
| GET | `/api/data` | signed in | Supported columns per type and what the caller may import or export. |
| GET | `/api/data/:type/template` | read or write permission of the type | CSV template. Types: `vehicles`, `drivers`, `deliveries`, `fuel`, `maintenance`. |
| GET | `/api/data/:type/export` | read permission of the type | CSV in the import format. `q`, `status`, `from`, `to`, `ids`. |
| POST | `/api/data/:type/import` | write permission of the type | Body `{ csv, fileName?, commit, skipInvalid }`. `commit: false` is a dry run. Returns per-row results and a summary. See [IMPORT_EXPORT.md](IMPORT_EXPORT.md). |

## Realtime (Socket.IO)

Path `/socket.io`. The handshake must come from the app's own origin and carry a valid session cookie; anything else is refused. Staff sockets join the fleet room; every socket joins its own user room, so drivers receive only events addressed to them. A socket is disconnected as soon as its session is revoked (logout, deactivation, password or role change).

| Event | Payload | Audience |
| --- | --- | --- |
| `vehicle:location` | `{ vehicleId, deliveryId, lat, lng, heading, progress, at, simulated: true }` | Staff, and the driver of that delivery |
| `delivery:updated` | `{ id, code, status, driverId, vehicleId }` | Staff, and the assigned driver |
| `notification:new` | `{ id, title, message, severity, category }` | The recipient |
| `simulator:state` | `{ running, tickMs, speed, averageSpeedKmh, movingVehicles, lastTickAt, waitingForViewers }` | Staff |
| `demo:reset` | `{ at }` | Everyone connected (pages reload onto the fresh dataset) |

## Example

```bash
# Sign in and keep the cookie
curl -c cookies.txt -H "Content-Type: application/json" \
  -d '{"email":"dispatcher@logitrack.in","password":"Dispatch@123"}' \
  http://localhost:3000/api/auth/login

# Active deliveries, most urgent first
curl -b cookies.txt "http://localhost:3000/api/deliveries?scope=active&sort=expectedAt&dir=asc"
```
