# Contributing to LogiTrack

Thanks for your interest in improving LogiTrack. This guide explains how to set up the project, how the code is organised and what a good change looks like.

## Ground rules

- **Zero cost.** LogiTrack must run locally with no paid service, API key, account or credit card. Do not add dependencies or integrations that break this. If a feature normally needs a paid API, build a local alternative with an optional free enhancement and a fallback (see `src/lib/routing.ts`).
- **No fake functionality.** Every control must do what it says, against the real database. No hard-coded numbers in charts or dashboards.
- **Be honest in the UI.** Simulated data is labelled as simulated; estimates are labelled as estimates.

## Setup

```powershell
npm install
Copy-Item .env.example .env   # macOS/Linux: cp .env.example .env
npm run setup                 # safe to repeat; never reseeds an existing database
npm run dev                   # busy port? $env:PORT=3001; npm run dev
```

LogiTrack is developed on Windows. Keep npm scripts cross-platform: no `rm -rf`, `cp` or `VAR=x` in `package.json` (use Node scripts or `cross-env`). Windows troubleshooting: [docs/WINDOWS.md](docs/WINDOWS.md).

Requirements: Node.js 20.12+. See the [README](README.md#getting-started-on-windows) for details and [demo accounts](README.md#demo-accounts).

## Where things go

| You are changing… | Put it in… |
| --- | --- |
| A business rule (who may do what, what happens when) | `src/server/services/<module>.ts` |
| Pure logic with no database access (calculations, state machines) | `src/lib/domain/` or `src/lib/geo.ts`, with unit tests |
| Request / form validation | `src/lib/validation.ts` (one schema, used by both the API and the form) |
| A new endpoint | `src/app/api/<path>/route.ts`, using `route()` from `src/lib/api.ts` |
| A permission | `src/lib/permissions.ts` |
| A page | `src/app/(app)/<page>/page.tsx` (server guard) + a `*-view.tsx` client component |
| A reusable UI element | `src/components/ui` (primitive) or `src/components/app` (app-level) |
| The data model | `prisma/schema.prisma`, then `npm run db:migrate`, then update `prisma/seed.ts` and `docs/DATABASE.md` |

### Adding an endpoint

```ts
// src/app/api/widgets/route.ts
import { parseListQuery, route } from "@/lib/api";
import { widgetSchema } from "@/lib/validation";
import { createWidget, listWidgets } from "@/server/services/widgets";

export const GET = route({ permission: "widgets:read" }, ({ query }) => listWidgets(parseListQuery(query)));
export const POST = route({ permission: "widgets:write", body: widgetSchema }, ({ user, body }) => createWidget(user, body));
```

`route()` handles authentication, the permission check, CSRF, body validation and error responses. Handlers should stay this small; put the logic in a service. Throw `ApiError` helpers from `src/lib/errors.ts` (`notFound`, `conflict`, `forbidden`, `badRequest`) for expected failures.

### Service checklist

- Wrap multi-step writes in `prisma.$transaction`.
- Call `logActivity` for anything a manager would want in the audit trail.
- Send notifications through `notifyUsers` / `notifyRoles` (use a `dedupeKey` for recurring reminders).
- Scope reads to what the acting user may see. Never rely on the client to filter.
- Keep network calls (for example route lookups) outside transactions.

### UI conventions

- Use the design tokens in `src/app/globals.css` (`text-ink`, `bg-surface`, `border-line`, `text-primary`…) instead of raw colours.
- Statuses are shown with `StatusBadge`, so a status looks the same everywhere.
- Tables use `DataTable` + `useListState` (server-side search, filters, sorting, pagination).
- Create / edit forms use `FormDialog` with a field config and the shared Zod schema.
- Destructive actions go through `ConfirmDialog`.
- Every list needs loading, empty and error states.
- Check the page at phone, tablet and desktop widths.

## Quality checks

Run these before opening a pull request:

```bash
npm run typecheck
npm run lint
npm test
npm run test:e2e      # stop `npm run dev` first; see README for browser options
npm run build
```

The same steps run in GitHub Actions on every push and pull request (`.github/workflows/ci.yml`), on Linux and Windows.

**Flaky tests fail CI.** CI retries a failed Playwright test once (for its trace), but a test that only passes on the retry fails the run (`failOnFlakyTests`). Fix the cause rather than adding waits. Anything that depends on the clock must allow for it explicitly: see `tests/e2e/clock-drift.ts` for how risk explanations are compared.

**Dependency updates.** Dependabot proposes grouped minor and patch updates weekly; majors for Prisma, TypeScript, ESLint, `@types/node` and Next.js are planned migrations and are not proposed automatically. The policy and its reasons are in [docs/DEPENDENCY_AUDIT.md](docs/DEPENDENCY_AUDIT.md#dependabot-policy).

Expectations:

- New pure logic comes with unit tests; new service behaviour with integration tests in `tests/integration`.
- A change to a user workflow updates or adds a Playwright test in `tests/e2e`.
- Tests use their own databases (`prisma/test.db`, `prisma/e2e.db`) and must never depend on `dev.db` or on network access.
- Dependencies: keep `npm audit` at 0 high or critical findings (CI enforces it). Never use `npm audit fix --force` without reviewing the changes. Document any `overrides` in `docs/DEPENDENCY_AUDIT.md`.

## Versioning and releases

LogiTrack follows [Semantic Versioning](https://semver.org/):

- **Major** (3.0.0 → 4.0.0): breaking changes, such as a migration that cannot be rolled back, a removed endpoint, or a changed import format or permission.
- **Minor** (3.0.0 → 3.1.0): new features that keep existing data, APIs and CSV formats working.
- **Patch** (3.0.0 → 3.0.1): fixes only.

For every release: update `CHANGELOG.md` (Keep a Changelog format) and `docs/RELEASE_NOTES.md`, bump `version` in `package.json` (the app reads it for the diagnostics page and backup manifests), run the release checklist in `docs/RELEASE_NOTES.md`, then tag `vX.Y.Z`. Database changes always ship as new Prisma migrations; never edit a migration that has been released.

## Commits and pull requests

- Keep pull requests focused on one change.
- Write commit messages in the imperative mood and say why: `Block assigning drivers with an expired licence`.
- Describe how you tested the change and include a screenshot for UI changes. To refresh the README images, run `npm run screenshots`: it captures the real app on freshly seeded data and publishes WebP files to `docs/assets/screenshots` (and the landing-page images to `public/screenshots`). Never edit screenshots by hand.
- Update `README.md`, `docs/API.md` and `docs/DATABASE.md` when behaviour, endpoints or the schema change.

## Reporting bugs

Include what you did, what you expected, what happened, and the role you were signed in as. Console and server output help. Please do not include real personal data: the seed data is fictional and should stay that way.
