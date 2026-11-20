# Demo guide

How to show LogiTrack to someone in five minutes, and how to keep the demo environment predictable.

## Before you start (one minute)

```powershell
npm run setup   # first time only (safe to repeat; never resets existing data)
npm run dev     # if port 3000 is busy: $env:PORT=3001; npm run dev
```

1. Open the address `npm run dev` prints (normally <http://localhost:3000>).
2. Sign in as **Fleet Manager** and press **Reset demo data** in the bar at the top (or run `npm run db:seed` before starting the server). This rebuilds the sample dataset relative to the current time, so trips are on the road, reminders are current and risk levels are fresh.
3. Sign out. You are ready.

The reset takes about two seconds and can be repeated at any time, including in the middle of a demo. It rebuilds vehicles, drivers, deliveries, fuel, maintenance, notifications and the activity log from a fixed seed, and resets the demo accounts' passwords, lockouts and two-factor settings. Demo logins keep working. Backups on disk are not touched.

## Demo accounts

| Role | Email | Password | Lands on |
| --- | --- | --- | --- |
| Super Admin | `admin@logitrack.in` | `Admin@123` | Dashboard |
| Fleet Manager | `manager@logitrack.in` | `Manager@123` | Dashboard |
| Dispatcher | `dispatcher@logitrack.in` | `Dispatch@123` | Dashboard |
| Driver | `driver@logitrack.in` | `Driver@123` | My Deliveries |

The login page has a one-click button for each. These accounts exist only in the sample data and always survive a reset.

## Five-minute demonstration script

Speaker notes are in *italics*. Each step names what to click and the point to make.

**1. Landing page (20 seconds)** — open `/`.
*"LogiTrack is a fleet and logistics management platform I built end to end: front end, REST API, database, realtime and tests. Everything on this page is a screenshot of the running app."* Click **Explore the live demo**.

**2. Roles (20 seconds)** — on the login page, point at the four cards.
*"Four roles see four different applications. Access is enforced on the server for every page and API call, not just hidden in the UI."* Click **Sign in as Dispatcher**.

**3. Dashboard (40 seconds)**
*"Every number here is computed from the database when the page loads."* Point at **Deliveries at risk**.
*"This is a rule-based risk engine. It projects an arrival time for each open delivery from its progress, distance and past delivery times, and tells you why something is flagged. No AI service: the rules are documented and unit-tested."*

**4. Live tracking (50 seconds)** — click **Live Tracking**, select a moving truck.
*"Vehicles move in real time over a websocket. The positions come from a GPS simulator I wrote that follows each delivery's route; it is clearly labelled as simulated."* Press **Pause simulation**, then **Resume**.

**5. A delivery, end to end (60 seconds)** — **Deliveries → Create delivery**. Pick a pickup and a destination; note the distance and time estimate. Assign an available driver (their vehicle is selected automatically) and create it. Open it, then **Update status → Picked Up → In Transit**.
*"The workflow is a state machine: you cannot skip steps, and you cannot assign a driver or vehicle that is busy. Assignment is safe under concurrency: two dispatchers cannot double-book the same driver."* Show the **Delivery history** timeline, then switch to Live Tracking to see the new vehicle moving.

**6. Route optimisation (30 seconds)** — **Route Planning**, tick two or three pending deliveries, **Optimise route**.
*"Nearest-neighbour then 2-opt, with the constraint that every pickup comes before its drop-off. It compares three options side by side."*

**7. Analytics (50 seconds)** — sign out, **Sign in as Fleet Manager**, open **Analytics**.
*"This month against the previous period, with the changes explained in words from the underlying records."* Open **Fleet efficiency**: *"Utilisation per vehicle, with maintenance downtime excluded, and an explanation for each under-used vehicle."* Open **Fuel efficiency**: *"It detects a mileage drop on one vehicle and refuses to calculate mileage where there is only one fuel record."*

**8. Driver view (20 seconds)** — sign out, **Sign in as Driver**.
*"A driver sees only their own deliveries. The API returns 404 for anyone else's, even with the ID."*

**9. Close (10 seconds)**
*"322 unit and integration tests against a real database, and 47 browser tests for the main workflows, the security boundaries and an accessibility scan, running in CI on Windows and Linux. It runs entirely on free, open-source software."*

### If you have ten minutes

- **Maintenance**: scheduled work on the left, **Recommended services** (system-generated, clearly labelled) on the right. Press **Schedule** on a recommendation to show it only pre-fills a form.
- **Driver Performance**: the documented score formula, the fleet benchmark, and "Not rated" for drivers without enough history.
- **Reports**: preview and export any of eight CSV reports, including analytics.
- **Import & Export** (Fleet Manager or Super Admin): download the vehicles template, add a row with a wrong year, press **Check file** to show the row-level error, then tick *Skip the rows with problems* and import.
- **Settings → Security** (any role): set up two-factor with an authenticator app and show the one-time recovery codes. A demo reset turns it off again for the demo accounts.
- **Backup & Restore** and **Diagnostics** (Super Admin): create a verified backup, run the integrity check, and show the simulator's tick count and the background jobs.
- **Activity Logs** (Super Admin): the audit trail, including the demo reset you did earlier.
- **Product tour**: account menu → **Product tour**.

## The guided tour

A two-minute tour is offered in the sidebar the first time someone signs in (and from **Take the tour** in the demo bar, or the account menu at any time). It visits only the modules the signed-in role can use, saying what each is for and what to try: the dashboard, fleet, drivers, deliveries, live tracking, route planning, analytics and import/export for staff (a Dispatcher sees 7 steps, a Fleet Manager 8), plus an operations step (Diagnostics and Backup & Restore) for the Super Admin. Drivers get a two-step tour of their own deliveries and performance. It can be skipped at any step and never blocks the page.

## Keeping the demo stable

**Predictable data.** The generator uses a fixed random seed, so every reset produces the same vehicles, drivers, customers and scenarios; only the dates move with the clock. A test (`tests/integration/demo.test.ts`) asserts that two resets produce identical data.

**Trips do not finish behind your back.** In demo mode the simulator only advances while at least one browser is connected. Leave the server running overnight and the trucks are where you left them.

**How long trips last.** At the default 10× speed: the two intercity trips (Mumbai → Pune, Delhi → Jaipur) run for roughly 20–35 minutes, the two city trips for 5–10 minutes. Seeing a short trip complete, with its notification, is a good demo moment.

**Controls**

| Action | Where | Who |
| --- | --- | --- |
| Pause / resume simulation | Live Tracking, top right | Admin, Fleet Manager, Dispatcher |
| Restart trips (rewind to the start) | Live Tracking, top right | Admin, Fleet Manager, Dispatcher |
| Change simulation speed | Settings → System | Super Admin |
| Reset demo data | Bar at the top of every page | Admin, Fleet Manager, Dispatcher |
| Reset from the terminal | `npm run db:seed` (stop the server first) | – |

**What the sample data is built to show**

| Scenario | Where to see it |
| --- | --- |
| A delivery that cannot make its window (high risk) | Dashboard → Deliveries at risk |
| A thin buffer (medium risk) and an overdue unassigned job | Deliveries → Active |
| A delayed delivery | Deliveries, Notifications |
| Vehicles on the road, parked, in the workshop and inactive | Live Tracking, Vehicles |
| Under-utilised vehicles | Analytics → Fleet efficiency |
| A mileage drop, a poor performer, a single fuel record, an electric vehicle | Analytics → Fuel efficiency, Fuel Management |
| Overdue and due-soon services, an expiring and an expired insurance policy, an expiring licence | Maintenance, Dashboard |
| A system service recommendation | Maintenance → Recommended services |
| Drivers improving, slipping and not yet rated | Driver Performance |
| A saved multi-stop route | Route Planning → Saved routes |

**Time-based details change with the clock.** Risk levels, "expires in N days" and reminders are computed from the current time. An hour after a reset, the high-risk trip will have been flagged as delayed automatically (which is itself correct behaviour). Reset just before a demo for the cleanest picture; the bar at the top shows how old the dataset is.

## Turning demo mode off

Set `DEMO_MODE=false` in `.env` and restart. The banner, the demo credentials on the login page, the reset action and the restart action disappear, and the simulator runs continuously. Nothing else about the application changes.

## Troubleshooting

| Symptom | Fix |
| --- | --- |
| Nothing is moving on the map | Check the simulator is running (Live Tracking, top right). If every trip has finished, **Reset demo data**. |
| Port 3000 is in use | Set `PORT=3001` in `.env`. |
| Map tiles are grey | No internet connection: the map needs OpenStreetMap tiles. Everything else works offline. |
| Routes are dashed lines | Road geometry is unavailable (offline or `ROUTING_PROVIDER=local`); the offline estimate is in use. |
| Logged out after a reset from the terminal | Expected only if the server was stopped; demo accounts keep their sessions across in-app resets. |
