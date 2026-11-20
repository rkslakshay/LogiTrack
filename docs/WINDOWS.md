# Running LogiTrack on Windows

LogiTrack is developed and tested on Windows 11 with PowerShell. Every command below is PowerShell. They also work in `cmd.exe`, except where a separate `cmd.exe` line is given.

## First-time setup

Requirements: [Node.js](https://nodejs.org/) 20.12 or newer (22 LTS recommended) and Git. Nothing else: no database server, no Docker, no accounts.

```powershell
git clone https://github.com/rkslakshay/LogiTrack.git
cd LogiTrack
npm install
Copy-Item .env.example .env      # optional: the defaults work without a .env
npm run setup
npm run dev
```

Open the address printed by `npm run dev` (normally http://localhost:3000) and use a demo account from the README.

### What `npm run setup` does

`npm run setup` (`scripts/setup.mjs`) is safe to run again at any time:

1. Stops with an explanation if a LogiTrack server from this folder is running (see [EPERM when generating the Prisma Client](#eperm-when-generating-the-prisma-client) below).
2. Generates the Prisma Client. On the first run this downloads Prisma's engines (about 20 MB, once). Network hiccups and short file locks are retried. If generation fails, setup stops: nothing after it runs.
3. Applies database migrations (`prisma migrate deploy`). This never deletes data.
4. Loads the demo data **only if the database has no users**. An existing database is left alone.

| You want to… | Command |
| --- | --- |
| Start the app (every day) | `npm run dev` |
| Set up a fresh clone, or after pulling new migrations | `npm run setup` |
| Rebuild the demo data on purpose (replaces records) | `npm run db:seed` |
| Back up before anything risky | `npm run db:backup` |

## Everyday commands

| Task | Command |
| --- | --- |
| Install dependencies | `npm install` |
| Generate the Prisma Client only | `npx prisma generate` |
| Create or upgrade the database | `npm run setup` (or `npm run db:deploy` for migrations only) |
| Load demo data into an empty database | `npm run setup` |
| Start the development server | `npm run dev` |
| Start on another port | `$env:PORT=3001; npm run dev` (cmd.exe: `set PORT=3001 && npm run dev`) |
| Type checks | `npm run typecheck` |
| Lint | `npm run lint` |
| Unit and integration tests | `npm test` |
| End-to-end tests (Edge) | `$env:PW_CHANNEL="msedge"; npm run test:e2e` (stop `npm run dev` first) |
| Production build and start | `npm run build` then `npm start` |

The PowerShell `$env:NAME=value` setting lasts until you close that terminal. To make it permanent for the project, put it in `.env` (e.g. `PORT=3001`).

## Troubleshooting

### EPERM when generating the Prisma Client

The error reads: `EPERM: operation not permitted, rename '...\query_engine-windows.dll.node.tmp...'`

**Cause.** Windows does not allow a loaded DLL to be replaced. Prisma's query engine is a DLL (`node_modules\.prisma\client\query_engine-windows.dll.node`) that every running LogiTrack process keeps open. When `prisma generate` (part of `npm run setup` and `npm run build`) tries to replace it while a server is running, Windows refuses.

On the development machine the holder was a LogiTrack dev server whose start-up had failed on a busy port. Before 3.0.0's start-up fix, such a process did not exit: it stayed alive with the simulator and background jobs running and the DLL loaded. That bug is fixed (see the next section). A server that is genuinely running has the same effect.

**Fix.**
1. `npm run setup` now checks for this first and lists the LogiTrack processes (PID and command line) that must stop.
2. Stop them with Ctrl+C in their terminal, or after checking the PID:
   ```powershell
   Get-CimInstance Win32_Process -Filter "Name='node.exe'" | Where-Object { $_.CommandLine -like "*LogiTrack*server.ts*" } | Select-Object ProcessId, CommandLine
   Stop-Process -Id <PID>
   ```
   Only stop processes whose command line points at your LogiTrack folder.
3. Run `npm run setup` again.

You do **not** need to delete `node_modules`. Antivirus software can also hold a freshly downloaded file for a moment, which is why setup retries a few times. Never disable your antivirus for this.

### Port already in use (EADDRINUSE)

The old error read: `Error: listen EADDRINUSE: address already in use :::3000`

**Cause.** Another program already listens on the port. On the development machine it was a different project's `next start -p 3000`.

**What LogiTrack does now.** Before starting anything it checks the port (on all interfaces and on the configured host). If the port is taken it prints the listening process's PID and command line, says whether it looks like LogiTrack, prints the commands below, and exits with code 1. It never picks another port silently and never stops another program.

```text
LogiTrack could not start: port 3000 is already in use.

  Listening process: PID 35536
  Command: "node" "E:\TaskFlow\node_modules\.bin\..\next\dist\bin\next" start -p 3000

  This is a different program. Leave it running and start LogiTrack on another port.

  Start LogiTrack on another port:
    PowerShell:   $env:PORT=3001; npm run dev
```

Inspect a port yourself:

```powershell
Get-NetTCPConnection -LocalPort 3000 -State Listen
Get-Process -Id <OwningProcess>
```

### "Another LogiTrack server is already running against this database"

Only one server may use a database file, otherwise the GPS simulator and the background jobs would run twice. The running server is named (PID and port). Use it, or stop it first. To run a second, independent copy, give it its own database and port:

```powershell
$env:DATABASE_URL="file:./second.db"; $env:PORT=3002; npm run setup; npm run dev
```

The lock (`prisma\<database>.server.lock`) is released on a normal shutdown, and a lock left by a crashed process is replaced automatically.

### npm allow-scripts warnings for Prisma

The warning lists `@prisma/client`, `@prisma/engines` and `prisma`.

Newer npm versions can block packages' install scripts unless you approve them (`allow-scripts` in your user `.npmrc`). LogiTrack does **not** need these three approved:

| Package | Script | What it does | Needed? |
| --- | --- | --- | --- |
| `prisma` | `preinstall` | Checks the Node.js version | No: `npm run setup` checks the Node version itself |
| `@prisma/engines` | `postinstall` | Downloads the Prisma engines | No: `prisma generate` downloads missing engines on its first run (verified with a clean install with all scripts disabled) |
| `@prisma/client` | `postinstall` | Runs `prisma generate` | No: `npm run setup` runs `prisma generate` explicitly |

Leaving them unapproved means no package code runs during `npm install`, and the same work happens in a step you can see. The warning is harmless. If you prefer to approve them anyway, use npm's own mechanism (`npm approve-scripts prisma @prisma/engines @prisma/client`) after reading the scripts in `node_modules`. CI installs with `--ignore-scripts` for the same reason.

### Playwright cannot find a browser

Use the Edge that ships with Windows: `$env:PW_CHANNEL="msedge"; npm run test:e2e`. Or install Playwright's Chromium once: `npx playwright install chromium`.

### The terminal shows `npm warn allow-scripts .npmrc allow-scripts setting is being ignored`

This comes from your user-level npm configuration, not from LogiTrack. It is harmless.
