# LogiTrack 3.0.0 release notes

**Release date:** 19 Nov 2026 · **Type:** major (new database migration, new permissions, changed password policy)

LogiTrack 3.0 is about running the application responsibly, not about new fleet features: account security, data safety, operability, data import, measured performance, accessibility and release engineering. Everything still runs locally at zero cost.

## Highlights

| Area | What is new | Where |
| --- | --- | --- |
| Account security | Optional two-factor authentication with recovery codes; password reset links that need no e-mail; account lockout; idle sessions; device list | Settings → Security; User Management |
| Web hardening | Nonce-based Content Security Policy, isolation headers, `no-store` API responses | everywhere |
| Data safety | Verified backups, scheduled backups, transactional restore with a safety backup | System → Backup & Restore; `npm run db:*` |
| Operations | Structured logs, health endpoint, diagnostics page, background-job status | System → Diagnostics; `/api/health` |
| Data import | CSV import with preview, row-level errors, duplicates, all-or-nothing commits | Insights → Import & Export |
| Performance | Measured on 100 vehicles / 1,000 deliveries; simulator ≈3× faster, dashboard ≈2× faster | `docs/PERFORMANCE_REPORT.md` |
| Accessibility | WCAG AA contrast, keyboard access to tables and scroll areas, skip link; axe in CI | e2e `v3.spec.ts` |
| Engineering | CI workflow, licence, changelog, security policy, optional Docker | repository root |

## Upgrading from 2.x

1. Back up: `npm run db:backup` (or copy `prisma/dev.db`).
2. Update the code, then `npm install`.
3. `npm run db:deploy` applies the `v3_account_security` migration. It only adds columns and tables. Existing users, sessions and data are kept.
4. `npm run build && npm start` (or `npm run dev`).
5. Optional: set `APP_SECRET` in `.env` (see `.env.example`). Otherwise one is generated into `prisma/app-secret.key` on first use of two-factor. Keep it with your backups.

Behaviour changes to know about:
- New passwords must not be common (`password1`, `admin123`, …) or contain the person's name or e-mail name. Existing passwords keep working until they are changed. The demo passwords are unchanged.
- After 10 consecutive failed sign-ins an account is locked for 15 minutes.
- Sessions end after 12 hours without activity (`SESSION_IDLE_MINUTES`).
- Backups and diagnostics are Super Admin only (new permissions `system:backup` and `system:diagnostics`).
- The secondary text and success colours are slightly darker (contrast).

## Verification for this release

| Check | Result |
| --- | --- |
| TypeScript (`tsc --noEmit`) | 0 errors |
| ESLint | 0 errors, 0 warnings |
| Vitest | **322 passed** (17 files) |
| Playwright | **47 passed** (32 existing + 15 new), Microsoft Edge |
| Production build (`next build`) | succeeds |
| axe (WCAG 2.1 A/AA, serious and critical) | 0 violations on 20 pages |
| Performance | see `PERFORMANCE_REPORT.md` |
| Docker | configuration written, `docker compose config` valid. **Image not built or run** (Docker Desktop could not start on the development machine) |

## Release checklist

Use this for 3.0.0 and later releases.

- [x] `npm run typecheck`, `npm run lint`, `npm test`, `npm run test:e2e`, `npm run build` all pass
- [x] New features have unit/integration tests; new workflows have Playwright tests
- [x] Accessibility scan (axe, in `tests/e2e/v3.spec.ts`) passes
- [x] Database changes ship as new migrations; `npm run db:deploy` works on an existing 2.x database (data kept)
- [x] Backup → restore round trip verified (`tests/integration/backup.test.ts`)
- [x] No secrets, databases, backups or `.env` files tracked (`git status --ignored` checked)
- [x] `package.json` version bumped; `CHANGELOG.md` and these notes updated
- [x] README, `BUILD_PROGRESS.md`, `docs/*` updated; screenshots re-captured where pages changed
- [x] Performance figures measured, not estimated (`PERFORMANCE_REPORT.md`)
- [ ] Docker image built and started at least once (`docker compose up --build`), healthcheck healthy. **Pending**
- [ ] CI run green on GitHub (requires pushing the repository). **Pending, needs your permission**
- [ ] Tag `v3.0.0` and publish a release. **Not done: publishing needs your permission**

## Known limitations

See the "Known limitations" sections of `README.md`, `SECURITY_HARDENING.md`, `BACKUP_RESTORE.md`, `IMPORT_EXPORT.md`, `DEPLOYMENT.md` and `PERFORMANCE_REPORT.md`. The main ones: single process and SQLite (no horizontal scaling); in-memory rate limits; no e-mail delivery by design; backups not encrypted and stored locally; Docker not validated at runtime; no independent security audit.
