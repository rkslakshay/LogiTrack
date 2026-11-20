# Deployment

LogiTrack runs as **one Node.js process** (Next.js pages and API, Socket.IO, GPS simulator and background jobs) with **one SQLite file**. It needs no external services, accounts or API keys. Everything below is free.

## Option 1: npm (development and simple installs)

Requirements: Node.js 20.12 or newer (22 LTS recommended).

```bash
npm install
cp .env.example .env          # Windows: copy .env.example .env
npm run setup                 # generate Prisma client, apply migrations, load demo data
npm run dev                   # http://localhost:3000
```

Production mode on the same machine:

```bash
npm run build
npm start                     # NODE_ENV=production, same single process
```

On Windows PowerShell, use `Copy-Item` instead of `cp`. If port 3000 is taken, LogiTrack says which process holds it and exits: start it with `$env:PORT=3001; npm run dev`, or set `PORT` in `.env`. Windows details: [WINDOWS.md](WINDOWS.md).

`npm run setup` is safe to repeat: it applies migrations and loads demo data only into an empty database. Use `npm run db:seed` to rebuild the demo data on purpose.

## Option 2: Docker (optional)

```bash
docker compose up --build -d
docker compose logs -f
```

Open http://localhost:3000 (change the host port with `LOGITRACK_PORT=8080`).

What the container does:

- Data lives in the named volume `logitrack-data`, mounted at `/data`: the database `/data/logitrack.db`, backups in `/data/backups`, and the generated `app-secret.key`. Rebuilding or recreating the container keeps it.
- On start, `docker/entrypoint.sh` checks for pending migrations. If there are any and a database exists, it takes a `pre-migrate` backup, then runs `prisma migrate deploy`.
- With `SEED_DEMO_DATA=true` (the compose default) the demo fleet is loaded **only into an empty database**. Existing data is never overwritten. Set `SEED_DEMO_DATA=false DEMO_MODE=false` for a clean instance. Then create the first Super Admin by temporarily seeding, or by inserting one with `npx prisma studio`.
- The healthcheck calls `/api/health` every 30 seconds.
- `tini` forwards `SIGTERM`. The server stops the simulator, closes websockets and disconnects from the database. `docker compose down` waits up to 15 s.
- The process runs as the unprivileged `node` user.

> **Validation status:** the Dockerfile, compose file and entrypoint were written for 3.0, and `docker compose config` validates. The image has **not** been built or run on the development machine, because Docker Desktop could not start there (WSL is not installed). Treat the Docker path as untested until you have built it once. CI does not build the image.

## Configuration reference

See `.env.example` for every variable with comments. The important ones for a real deployment:

| Variable | Recommended | Why |
| --- | --- | --- |
| `DEMO_MODE` | `false` | Removes the demo banner, one-click demo logins and "Reset demo data". |
| `APP_SECRET` | 32+ random characters | Encrypts two-factor secrets. Generate with `node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"`. Back it up with the database. |
| `COOKIE_SECURE` | `true` behind HTTPS | Secure + `__Host-` cookies. **Also set it when running `npm run build`** to get HSTS from the app, or let the proxy send HSTS. |
| `TRUST_PROXY` | `true` only behind your own reverse proxy | Uses `X-Forwarded-For` for rate limiting. Never enable it when clients can reach the app directly. |
| `HOSTNAME_BIND` | `0.0.0.0` in containers | The address to listen on (default `localhost`). |
| `BACKUP_DIR` | another disk, if you have one | Where backups go. |
| `BACKUP_INTERVAL_HOURS` / `BACKUP_KEEP` | `24` / `7` | Automatic backups. |
| `ROUTING_PROVIDER` | `local` | `osrm` uses the free public OSRM demo server for road geometry (light use only). |
| `LOG_FORMAT` | `json` | One JSON object per line for log tools (default in production). |

## HTTPS

LogiTrack does not terminate TLS itself. Put a free reverse proxy in front, for example [Caddy](https://caddyserver.com/) (automatic Let's Encrypt certificates):

```
fleet.example.com {
    reverse_proxy 127.0.0.1:3000
}
```

Then set `COOKIE_SECURE=true` and `TRUST_PROXY=true`, and rebuild. Websockets work through Caddy and nginx without extra settings beyond the usual `Upgrade` headers (nginx: `proxy_set_header Upgrade $http_upgrade; proxy_set_header Connection "upgrade";`).

## Operations

| Task | How |
| --- | --- |
| Health | `GET /api/health` → `{"status":"ok","version":"3.0.0","database":"ok"}` (503 when the database is unreachable) |
| Diagnostics | **System → Diagnostics** (Super Admin): database integrity, websocket and simulator status, background jobs, memory, recent warnings and errors |
| Backups | [BACKUP_RESTORE.md](BACKUP_RESTORE.md) |
| Logs | stdout/stderr. JSON in production. Secrets and e-mail addresses are removed before logging. |
| Upgrades | Take a backup (`npm run db:backup`), update the code, `npm install`, `npm run db:deploy`, `npm run build`, restart. Docker does the backup and migration automatically. |
| Account recovery | `npm run auth:reset-link -- <email>`, `auth:reset-mfa`, `auth:unlock` |

## Limits of this architecture

- **Single process, single machine.** Rate limits, the simulator and Socket.IO rooms live in memory. Running several instances behind a load balancer is not supported, and a per-database lock (`<database>.server.lock`) refuses a second server on the same database file.
- **SQLite** handles this application's load comfortably (see [PERFORMANCE_REPORT.md](PERFORMANCE_REPORT.md)), but allows one writer at a time. Long imports hold the write lock while they run.
- The free OpenStreetMap tile servers and the public OSRM demo are shared community resources with usage policies. For heavy use, host your own (also free) or use `ROUTING_PROVIDER=local`.
