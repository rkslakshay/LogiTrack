# Backup and restore

LogiTrack keeps all its data in one SQLite file (`prisma/dev.db` by default, `/data/logitrack.db` in Docker). This guide covers making, checking and restoring backups of that file, from the app and from the command line.

## What a backup is

- **How it is made:** SQLite's own `VACUUM INTO`, which writes a consistent copy of the live database while the app keeps running. The file is never copied byte-for-byte while it is in use.
- **How it is checked:** every new backup is opened with a separate connection and checked with `PRAGMA integrity_check` and `PRAGMA foreign_key_check`, and its tables are counted. It only appears under its final name once it has passed. Failed backups are deleted and reported as errors.
- **What sits next to it:** a manifest `<file>.json` with the creation time, reason, who made it, the SHA-256 checksum, the app version, the latest database migration and the row counts.
- **Where it lives:** `BACKUP_DIR`, or by default a `backups/` folder next to the database (`prisma/backups/`, or `/data/backups` in Docker). Never under `public/`.
- **File names:** `logitrack-YYYYMMDD-HHMMSS-<reason>.db`. Reasons: `manual`, `scheduled`, `cli`, `pre-restore`, `pre-migrate`, `imported`. Only names in this format are accepted anywhere, so a request cannot reach other files (no path traversal).

> **Protect your backups.** A backup contains every account's bcrypt password hash, the encrypted two-factor secrets and all operational data. Files are created owner-only (`0600`, folder `0700`) on Linux and macOS. On Windows they inherit the folder's permissions. Store copies somewhere private.
>
> **Keep the app secret with the backups.** Two-factor secrets are encrypted with a key derived from `APP_SECRET`, or from `app-secret.key` next to the database when `APP_SECRET` is not set. If you restore onto a machine with a different key, people with two-factor authentication sign in with a recovery code, or an administrator resets their two-factor.

## In the app (Super Admin only)

**System → Backup & Restore** lists every backup, including ones made from the command line.

| Action | What happens |
| --- | --- |
| **Back up now** | Creates and verifies a backup (limit: 20 an hour per user). |
| **Check database** | Runs the integrity and foreign-key checks on the live database. |
| **Verify again** | Re-runs the checks on a backup and compares its SHA-256 with the manifest, which detects a modified or damaged file. |
| **Download** | Downloads the file (`Cache-Control: no-store`; recorded in the activity log and the server log). |
| **Delete** | Asks for your password (and a two-factor code if you use one). Cannot be undone. |
| **Restore this backup** | Asks you to type `RESTORE` and enter your password (and code). See below. |

### What a restore does

1. Verifies the backup again. A backup that fails is refused.
2. Checks that the backup has **exactly the same database migrations** as the running app. A backup from another version is refused: restore it with the version that made it, then upgrade.
3. Takes a verified **safety backup** of the current data (`pre-restore`), so the restore can itself be undone.
4. Pauses the GPS simulator and replaces every table in **one SQLite transaction** (`BEGIN IMMEDIATE`). Either everything is restored or nothing changes. Foreign keys are checked before committing.
5. Does **not** restore sessions, sign-in challenges or password-reset links. Everyone, including you, is signed out and live connections are dropped. You are sent to the sign-in page. Sign in with an account that exists in the restored data.
6. Writes an activity-log entry that names the backup and the safety backup.

## Automatic backups

The server makes a verified backup every `BACKUP_INTERVAL_HOURS` (default 24; first run 10 minutes after start-up) and keeps the newest `BACKUP_KEEP` scheduled backups (default 7). Manual, command-line and safety backups are never removed automatically. Set `BACKUP_INTERVAL_HOURS=0` to turn this off. Status and the last run are on **System → Diagnostics → Background jobs**.

## Command line

Run these from the project folder. They use the same code as the app and read `.env`.

```bash
npm run db:backup                         # create and verify a backup
npm run db:backups                        # list backups with their verification status
npm run db:verify -- logitrack-20261119-002650-manual.db
npm run db:check                          # integrity check of the live database
npm run db:restore -- logitrack-20261119-002650-manual.db
npm run db:restore -- D:\copies\some-backup.db    # any SQLite file: copied into the backup folder first
```

`db:restore` shows the backup's row counts and asks you to type `RESTORE`. In a script, add `--yes`. Stop the application server first if you can: a restore while it runs works, but people are signed out mid-task.

In Docker:

```bash
docker compose exec logitrack npx tsx scripts/db.ts backup
docker compose exec logitrack npx tsx scripts/db.ts list
docker compose exec -it logitrack npx tsx scripts/db.ts restore logitrack-20261119-002650-manual.db
```

The container also makes a `pre-migrate` backup automatically before it applies new migrations on start-up.

## Recovering from a bad state

| Situation | What to do |
| --- | --- |
| Restored the wrong backup | Restore the `pre-restore` safety backup created just before. |
| `db:check` reports problems | Stop the server, then restore the newest backup that verifies. |
| Lost the only Super Admin password | `npm run auth:reset-link -- admin@example.com` prints a one-time reset link. |
| Super Admin lost their authenticator and recovery codes | `npm run auth:reset-mfa -- admin@example.com` |
| Account locked after failed sign-ins | `npm run auth:unlock -- user@example.com`, or wait 15 minutes |

## Tested behaviour

`tests/integration/backup.test.ts` covers: creating and verifying a backup, the manifest and checksum, a full restore that brings back the earlier data and removes later changes, sessions cleared after a restore, the safety backup holding the replaced data, refusal of a backup with a different schema (data unchanged), tamper detection through the checksum, rejection of invalid names and path traversal, deletion, and pruning of scheduled backups. `tests/e2e/v3.spec.ts` creates a backup and runs the integrity check through the UI.

## Limitations

- Backups are stored on the same machine as the database unless you set `BACKUP_DIR` to another disk or copy them off yourself. There is no built-in off-site copy, because that would need a paid or external service.
- Backups are not encrypted at rest. Protect the folder (or the Docker volume) and any downloaded copies.
- Restoring across schema versions is deliberately not supported in the app.
