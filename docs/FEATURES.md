# Features and formulas

What LogiTrack does, module by module, and exactly how every derived number is calculated. Nothing here is a black box: each rule is a pure function in `src/lib/domain`, covered by unit tests, and all inputs come from stored records.

## Contents

- [Product experience](#product-experience)
- [Operational modules](#operational-modules)
- [Delivery risk detection](#delivery-risk-detection)
- [Fleet utilisation](#fleet-utilisation)
- [Fuel efficiency](#fuel-efficiency)
- [Maintenance: scheduled work vs. recommendations](#maintenance-scheduled-work-vs-recommendations)
- [Driver performance](#driver-performance)
- [Analytics and period comparison](#analytics-and-period-comparison)
- [Route planning](#route-planning)
- [GPS simulation](#gps-simulation)

---

## Product experience

| Feature | Notes |
| --- | --- |
| Landing page (`/`) | Public. Describes the platform using real screenshots of the running app. No invented customers or claims. |
| Demo access (`/login`) | One card per role explaining what that role can do, with one-click sign-in. Shown only in demo mode. |
| Guided tour | Seven steps for staff (dashboard, fleet, drivers, deliveries, live tracking, route planning, analytics), two for drivers. Offered once in the sidebar, never forced, skippable at any step, restartable from the account menu. The page behind the tour card stays fully usable. |
| Demo banner | Every signed-in page states that the data is sample data and that movement is simulated, and shows how old the dataset is. |
| Reset demo data | Staff roles can rebuild the sample dataset in about two seconds. Demo accounts keep their IDs, so the person who resets stays signed in. |
| Simulation controls | Pause, resume, and (demo mode) restart: rewind the trips on the road to their starting points. |

## Operational modules

| Module | Highlights |
| --- | --- |
| Authentication | bcrypt, database sessions, HttpOnly cookie, throttling, profile and password management. |
| Dashboard | 12 KPIs, 6 charts, deliveries at risk, alerts, activity. Date-range filter. |
| Vehicles | CRUD, search, filters, sorting, pagination, driver assignment, history. |
| Drivers | CRUD, vehicle assignment, optional login, licence warnings, computed statistics. |
| Deliveries | Enforced state machine, assignment rules, event history, delay detection, risk level. |
| Live tracking | Leaflet map, realtime markers, selection, filters, route overlay. |
| Route planning | Point-to-point estimates, multi-stop optimiser, saved routes. |
| Fuel | Records with validation, spend, mileage, cost per km, intelligence flags. |
| Maintenance | Scheduling, completion, reminders, system recommendations. |
| Analytics | Reliability, cost, fleet, fuel, maintenance and driver views with period comparison. |
| Driver performance | Score, leaderboard, trends, fleet benchmark, individual profiles. |
| Reports | Eight CSV exports with preview (including analytics). Import-format exports are on Import & Export. |
| Notifications | Persisted, categorised, realtime, de-duplicated. |
| Activity log | Audit trail with filters and export. |
| Users and settings | Account administration and system configuration. |

---

## Delivery risk detection

**Purpose.** Tell a dispatcher which open deliveries are likely to miss their expected time, and why. Source: `src/lib/domain/risk.ts`.

**Step 1: project an arrival time (ETA).**

| Delivery state | ETA |
| --- | --- |
| In transit (or delayed after pickup) | now + travel(remaining distance) |
| Picked up, not yet moving | now + 10 min loading + travel(distance) |
| Assigned | max(now, scheduled) + 20 min pickup + travel(distance) |
| Pending, no crew | max(now, scheduled) + 45 min dispatch + travel(distance) |

```
remaining distance = distance × (1 − progress)
travel(km)         = km ÷ average speed × 60 × history factor ÷ time scale      (minutes)
```

- **Average speed** is the system setting (default 40 km/h).
- **History factor** = median of (actual duration ÷ estimated duration) over the driver's last 10 delivered jobs, or the fleet's last 60 when the driver has fewer than 3. Clamped to 0.7–2.0 so a few unusual trips cannot dominate. With no history it is 1.
- **Time scale** is the simulation speed: the simulator moves vehicles faster than real time, so projected travel is divided by it. With real telemetry it would be 1.

**Step 2:** `slack = expected time − ETA` (minutes).

**Step 3: apply the rules.** The highest level triggered wins; every triggered rule adds its reason.

| Level | Rule |
| --- | --- |
| High | Status is Delayed |
| High | slack < 0 (projected to arrive late) |
| High | Pending and the scheduled start passed more than 60 min ago |
| Medium | slack < max(15 min, 15% of the trip's travel time) |
| Medium | Pending and the scheduled start has passed |
| Medium | Assigned and pickup is more than 30 min overdue |
| Medium | Driver was on time for under 60% of at least 5 recent deliveries |
| Low | None of the above |

Closed deliveries (delivered, failed, cancelled) have no risk. The assessment is advisory: computing it never changes a delivery.

**Example.** In transit, 20 km left of 40 km, 40 km/h, expected in 10 minutes, time scale 1: ETA = now + 30 min, slack = −20 min → **High**: "Projected to arrive 20 min after the expected time".

---

## Fleet utilisation

Source: `src/lib/domain/utilization.ts`. Per vehicle, for the selected period:

```
period days     = days in the period the vehicle existed, up to today
downtime days   = days covered by maintenance (in progress: service date → today;
                  completed: service date → completion date)
available days  = period days − downtime days
active days     = distinct days with at least one delivery that was worked
                  (assigned or later; pending and cancelled do not count)
utilisation     = active days ÷ available days
idle            = 1 − utilisation
```

Fleet figures (operational vehicles only; inactive vehicles are excluded):

| Figure | Definition |
| --- | --- |
| Vehicle utilisation | Mean of the per-vehicle utilisation |
| Idle time | 1 − vehicle utilisation |
| Active vehicles | Share of vehicles used at least once in the period |
| Maintenance downtime | Sum of downtime days, also as a share of all vehicle-days |
| Average distance per vehicle | Delivered distance ÷ operational vehicles |
| Usage trend | Vehicles with at least one delivery, per week |

**Under-utilised** = available for at least 14 days **and** either not used at all, or utilisation below 15% and below half the fleet average. Each flagged vehicle gets an explanation built from its own numbers, for example: *"Used on 2 of 30 available days (6.7%); the fleet average is 15.8%. Last delivery 2 days ago."* A vehicle that joined the fleet less than 14 days ago is never flagged.

---

## Fuel efficiency

Source: `src/lib/domain/fuel-intel.ts`.

**Mileage is fill-to-fill.** For two consecutive fills of the same vehicle:

```
interval km/L  = (odometer at this fill − odometer at the previous fill) ÷ litres added at this fill
vehicle km/L   = Σ interval km ÷ Σ interval litres
cost per km    = Σ interval cost ÷ Σ interval km
```

An interval is used only if the odometer increased and the quantity is positive. **When there is not enough evidence the result is blank, with a flag saying why.** Nothing is estimated.

| Flag | Condition | Needs |
| --- | --- | --- |
| Insufficient data | Fewer than two fills, or odometers that do not increase | – |
| Mileage drop | Last two intervals at least 15% below the earlier ones (critical at 25%) | 4+ intervals |
| Poor mileage | Below 80% of the median of comparable vehicles | 3+ intervals, 2+ peers |
| High cost | Cost per km above 125% of the peer median | 3+ intervals, 2+ peers |
| Suspect record | One interval under half or over double the vehicle's own median | 4+ intervals |
| Stale records | No fill for over 45 days while the vehicle completed deliveries | – |

**Comparable vehicles** share vehicle type and fuel type. A truck is never judged against a motorbike. Electric vehicles are listed separately and not analysed. The analysis always looks back at least 180 days, because judging mileage needs several fills.

---

## Maintenance: scheduled work vs. recommendations

The product keeps two things visibly apart:

| | Scheduled and due | Recommended services |
| --- | --- | --- |
| Origin | A person booked a job, or set a follow-up on a completed job | Calculated by the system |
| Label in the UI | Plain | "System-generated" |
| Stored | Yes (`MaintenanceRecord`) | No: computed on demand |
| Becomes real when | Already real | Someone presses Schedule and saves |

**Reminders for scheduled work** (`domain/reminders.ts`): a scheduled job is due on its service date (due soon inside the reminder window, overdue after it). A completed job with a next-service date or odometer produces a follow-up reminder by whichever comes first.

**Recommendations** (`domain/maintenance-intel.ts`) answer "when will this vehicle next need a routine service?":

```
km remaining   = interval km − (odometer now − odometer at last routine service)
days by usage  = km remaining ÷ average km per day
days by time   = interval days − days since last routine service
due in         = min(days by usage, days by time)
```

- **Routine service** = general service or oil change.
- **Average km per day** comes from odometer readings in the last 90 days of fuel records; if there are none, from delivered distance over 60 days.
- **Intervals** (defaults by vehicle class, tunable in code): two-wheeler 4,000 km / 120 days; van, pickup, mini truck 10,000 km / 180 days; truck 20,000 km / 180 days; container 25,000 km / 180 days. These are typical class defaults, not manufacturer data for a specific model.
- Urgency: overdue (≤ 0 days), within 30 days, within 60 days. Beyond 60 days nothing is shown.
- No recommendation is made when a routine job is already scheduled or in progress, or when a person has already planned the follow-up. With no routine service on record, a baseline service is recommended.

---

## Driver performance

Source: `src/lib/domain/performance.ts`, from closed delivery records only.

```
success rate     = delivered ÷ (delivered + failed)
on-time rate     = delivered on or before the expected time ÷ delivered
completion rate  = delivered ÷ (delivered + failed + cancelled)
avg duration     = mean(delivered time − pickup time) over delivered jobs
experience       = min(1, delivered ÷ 15)

score = 100 × (0.45 × success rate + 0.40 × on-time rate + 0.15 × experience)
```

- Cancelled deliveries are excluded from the score: cancelling is a business decision, not a driver outcome. Completion rate is shown for context only.
- **Not rated** below 3 closed deliveries in the period: no score and no rank.
- **30-day trend** = on-time rate in the last 30 days minus the 30 days before, reported only when each window has at least 3 delivered jobs. Within ±5 points it is "steady". Otherwise the UI says "Not enough data".
- **Fleet benchmark**: the same rates computed over all drivers for the same period, shown beside every individual figure.

---

## Analytics and period comparison

Source: `src/server/services/analytics.ts`, `src/lib/domain/compare.ts`.

| Metric | Definition (deliveries scheduled in the period) |
| --- | --- |
| Success rate | delivered ÷ (delivered + failed) |
| On-time rate | on-time ÷ delivered |
| Average duration | mean pickup-to-delivery time |
| Fleet utilisation | vehicles used ÷ operational vehicles |
| Cost per delivery | (fuel spend + completed maintenance spend) ÷ delivered |
| Deliveries per driver | delivered ÷ drivers who worked |

**Comparison periods**

- *Previous period*: the period of the same length immediately before.
- *Same period last year*: the same dates one year earlier.
- Presets include this week, this month and this year (to date), so "this month vs. previous period" compares like with like.

```
change = current − previous
change % = change ÷ |previous|          (blank when the previous value is zero or missing)
```

Percentages (success, on-time, utilisation) are compared in **points**, amounts and counts in **percent**.

**Explanations.** A sentence is generated only for a change that clears a threshold, and only from the two periods' own numbers:

| Topic | Threshold | Detail added |
| --- | --- | --- |
| Delivery volume | ±10% and at least 3 deliveries | – |
| On-time rate | ±5 points, 5+ delivered in each period | Late counts; names a driver responsible for 40%+ of the late deliveries |
| Success rate | ±5 points | Failed counts |
| Fuel spend | ±15% and ₹1,000 | Compared with the change in distance: follows the workload, or cost per km moved |
| Maintenance spend | ±20% and ₹1,000 | Largest job type |
| Cost per delivery | ±15% | – |
| Fleet utilisation | ±10 points | Vehicles used |

If the comparison period has no deliveries, the page says so instead of inventing a change. If nothing clears a threshold, it says that too.

---

## Route planning

- **Distance**: Haversine great-circle distance × 1.3 road-circuity factor.
- **Time**: distance ÷ average speed, plus 10 minutes per stop.
- **Multi-stop optimisation**: each delivery contributes a pickup and a drop-off. Nearest-neighbour builds a route in which a drop-off only becomes eligible after its pickup; 2-opt then reverses segments while that shortens the route and keeps every pickup first. Three options are shown side by side.
- **Optional**: with `ROUTING_PROVIDER=osrm` real road geometry is requested from the public OSRM demo server, with silent fallback to the local estimate.

Routes are planning estimates, not navigation instructions.

## GPS simulation

Every position in LogiTrack comes from the built-in simulator and is labelled as simulated. Each tick (2 s):

```
step km   = average speed × (elapsed seconds × simulation speed) ÷ 3600
progress += step km ÷ route length
position  = point at `progress` along the route polyline
```

On arrival the delivery is completed through the normal service function (configurable). In demo mode the engine idles while no client is connected, so sample trips are still on the road when a demonstration starts.
