# Performance report (LogiTrack 3.0)

Every number here was **measured** on the machine described below, on 19 Nov 2026, with the scripts in `scripts/`. Nothing is extrapolated. These are results from one developer laptop, not a capacity guarantee. Re-run the scripts on your own hardware before relying on them.

## Environment

| | |
| --- | --- |
| Machine | Laptop, 13th Gen Intel Core i7-1360P (16 logical cores), 15.6 GB RAM, Windows 11 (10.0.26300), local SSD |
| Runtime | Node.js 24.19.0, production build (`next build`), `NODE_ENV=production`, single process (`server.ts`) |
| Database | SQLite (WAL mode) through Prisma 6, file `prisma/perf.db` |
| Client | Benchmark client on the same machine (no network latency included) |
| Other load | Normal desktop use. No other benchmarks running. |

## Synthetic dataset

`npm run perf:seed` builds a reproducible dataset (fixed random seed) in its **own** file, `prisma/perf.db`. It refuses to write to any file not named `perf*.db`, so development and demo data are never touched.

| Records | Count |
| --- | --- |
| Vehicles | 100 (40 on a live delivery) |
| Drivers | 100 |
| Deliveries | 1,000 over 180 days (40 in transit) |
| Delivery events | 5,000 |
| Fuel records | 2,000 |
| Maintenance records | 1,000 |

## How to reproduce

```bash
npm run perf:seed                     # build prisma/perf.db
npm run build
npm run perf:start                    # production server on :3200 using perf.db (simulator paused)
npm run perf:bench -- http://localhost:3200       # API, concurrency, websockets, memory → perf-results/*.json
npx tsx scripts/perf-map.ts http://localhost:3200      # map rendering in a real browser (PW_CHANNEL=msedge for Edge)
npx tsx scripts/perf-import.ts http://localhost:3200 1000
npm run perf:profile                  # service functions timed directly, without HTTP
```

`perf:bench` sends two warm-up requests per endpoint and then 20 measured requests one after another. It reports the median, the 95th percentile and the response size.

## Bottlenecks found and fixed

| Area | Cause | Fix | Before | After |
| --- | --- | --- | --- | --- |
| GPS simulator tick (40 moving vehicles) | One SQLite transaction (commit) per vehicle per tick, plus re-parsing every route's JSON geometry and re-measuring its length on every tick | All positions of a tick written in **one** transaction; parsed geometry and route length cached per delivery (cache pruned when a delivery stops moving) | 90.8 ms median per tick | **31.0 ms** |
| Maintenance alerts (used by the dashboard, maintenance page and reminder job) | Loaded every maintenance record with all columns and a joined vehicle per record | Select only the 8 columns the reminder rules use, and load each vehicle once into a map | 19.4–27.6 ms | **7.9 ms** |
| Dashboard service (`getDashboard`) | Mostly the maintenance alerts above | (same) | 38.0–43.7 ms | **21.5 ms** |

Measured with `npm run perf:profile` (service calls without HTTP, median of 10; the simulator median of 5). The "before" ranges are from two separate profiling runs.

Investigated and **left as is**, because the measurements did not justify a change:
- **Indexes:** every list filter and sort used by the API already has an index (status, scheduledAt, driverId, vehicleId, priority, closedAt, (vehicleId, date) for fuel, (vehicleId, serviceDate) for maintenance, (deliveryId, createdAt) for events). Paginated lists answer in about 15 ms whatever the page or filter.
- **Pagination:** all list endpoints are paginated on the server (page size capped at 200).
- **Fuel intelligence** (10.8 ms service time, 150 KB response) and **analytics** (24–31 ms): no N+1 queries, and fast enough.
- **Caching:** not added. Every endpoint is already below 50 ms median except the CSV downloads. A cache would add invalidation risk to data that changes all the time.

## Results after the fixes

### API (single client, 20 requests each)

| Endpoint | Median | p95 | Response |
| --- | --- | --- | --- |
| `GET /api/dashboard` | 32.3 ms | 57.8 ms | 11 KB |
| `GET /api/vehicles` (page 1) | 15.4 ms | 20.1 ms | 15 KB |
| `GET /api/vehicles` (page 5, search) | 14.9 ms | 18.6 ms | 15 KB |
| `GET /api/drivers` | 15.1 ms | 18.9 ms | 16 KB |
| `GET /api/deliveries` (page 1) | 15.4 ms | 16.5 ms | 24 KB |
| `GET /api/deliveries` (page 10, status filter) | 15.8 ms | 16.6 ms | 22 KB |
| `GET /api/deliveries` (date range + text search) | 16.3 ms | 22.8 ms | 22 KB |
| `GET /api/deliveries` as a driver (own only) | 15.4 ms | | |
| `GET /api/tracking` (100 vehicles) | 15.2 ms | 34.0 ms | 109 KB |
| `GET /api/analytics` (90 days) | 23.8 ms | 38.3 ms | 50 KB |
| `GET /api/analytics` (180 days, with comparison) | 31.3 ms | 35.2 ms | 53 KB |
| `GET /api/performance` (90 days) | 17.5 ms | 32.3 ms | 56 KB |
| `GET /api/fuel` | 15.2 ms | 17.3 ms | 10 KB |
| `GET /api/fuel/summary` (90 days) | 31.8 ms | 42.3 ms | 31 KB |
| `GET /api/maintenance` | 14.2 ms | 18.3 ms | 12 KB |
| `GET /api/intelligence/fleet` | 15.5 ms | 20.4 ms | 40 KB |
| `GET /api/intelligence/fuel` | 48.0 ms | 63.4 ms | 150 KB |
| `GET /api/notifications` | 14.8 ms | 17.2 ms | 8 KB |
| `GET /api/activity` | 15.7 ms | 16.9 ms | 6 KB |
| `GET /api/reports/deliveries` (180 days, CSV) | 89.3 ms | 110.5 ms | 173 KB |
| `GET /api/data/deliveries/export` (1,000 rows, CSV) | 45.9 ms | 54.6 ms | 179 KB |

The flat ~15 ms floor is the same for very different queries, so it is mostly fixed per-request cost (session lookup, Next.js routing, the local HTTP round trip on Windows) rather than database time.

### Concurrency (10 clients × 10 requests at the same time)

| Endpoint | Before fixes | After fixes |
| --- | --- | --- |
| `/api/dashboard` | median 259 ms, p95 342 ms, 37.9 req/s | median **194 ms**, p95 257 ms, **48.9 req/s** |
| `/api/deliveries` page 1 | median 44 ms, p95 53 ms, 227 req/s | median 32 ms, p95 65 ms, 284 req/s |

Node.js runs JavaScript on one thread, so simultaneous dashboard requests queue behind each other. Fifty dashboard loads per second is far beyond what a fleet team of tens of people generates.

### Realtime (Socket.IO) and simulator

Fan-out of `vehicle:location` events, 40 moving vehicles, 2-second ticks, 20 seconds per run, measured in isolation (`ONLY=sockets`):

| Connected clients | Ticks | Events received | Events/s | Server tick duration | Delivery latency median / p95 |
| --- | --- | --- | --- | --- | --- |
| 1 | 9 | 360 | 18 | 42 ms | 29 / 72 ms |
| 10 | 9 | 3,500 | 175 | 67 ms | 46 / 55 ms |
| 50 | 9 | 16,650 | 833 | 101 ms | 44 / 67 ms |

Latency is measured from the position's timestamp (taken before the database write) to arrival at the client, so it includes the tick's database transaction. Every expected event arrived. No messages were lost.

**Observed anomaly (not explained):** when the socket test ran straight after the concurrent-HTTP phase of the full benchmark, the simulator completed only 5 ticks in 20 seconds instead of 9–10, and the client-side p95 latency rose to 5.6 s in one run. Run on their own, the cadence and latency are normal (table above). It may be garbage collection or a SQLite checkpoint after the burst of requests, or the single benchmark process handling 50 sockets right after 200 HTTP requests. It has not been investigated further.

### Map rendering

`scripts/perf-map.ts`, Microsoft Edge (Chromium), 1440×900, admin user, Live Tracking page with **100 vehicles** on the map:

| Metric | Value |
| --- | --- |
| Navigation to all 100 markers drawn (median of 5) | **511 ms** (max 584 ms) |
| Page JavaScript heap afterwards | 39.3 MB |

### Import

`scripts/perf-import.ts`, 1,000 new deliveries (165 KB CSV) through the API:

| Step | Time |
| --- | --- |
| Check file (full validation and dry run in a rolled-back transaction) | 2.85 s |
| Import (validated again and saved in one transaction) | 2.13 s |

### Memory (server process)

| Moment | Resident set | JS heap used |
| --- | --- | --- |
| After start and login | 225 MB | 85 MB |
| Right after the concurrent-request phase | 609–619 MB | |
| End of the run | 283–285 MB | 85 MB |

The heap returned to its starting size, with no sign of a leak over a run. Resident memory peaks during request bursts and is released afterwards. Most of the baseline is Next.js and React server rendering. A development server (`npm run dev`) uses much more (about 1 GB observed) because it holds the compiler and source maps.

## Limitations

- One machine and one run per configuration. Expect run-to-run variation of around ±20% on a laptop.
- Client and server shared the machine, so the client's CPU use affects the server.
- No network latency, TLS or reverse proxy in the path.
- Browser rendering was measured for the tracking map only, in Chromium (Edge).
- The dataset is synthetic. Real data distributions (long notes, very long routes) could behave differently.
- SQLite allows one writer at a time. Write-heavy workloads (many simultaneous imports) were not load-tested.
