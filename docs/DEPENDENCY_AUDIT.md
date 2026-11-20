# Dependency audit

`npm audit` results for LogiTrack and how each finding was handled. Re-run `npm audit` at any time. CI does not fail on advisories, but Dependabot (`.github/dependabot.yml`) opens weekly update pull requests.

## 19 Nov 2026: before

`npm audit` on Prisma 6.19.3, Next.js 16.4.6, eslint-config-next 16.4.6: **10 vulnerabilities (7 moderate, 3 high)**, coming from **two advisories**. npm counts every package on a vulnerable path, so one advisory produced several entries.

| # | Advisory | Vulnerable package (installed) | Dependency path | Severity | Direct? | Affects | Fixed in |
| --- | --- | --- | --- | --- | --- | --- | --- |
| 1 | [GHSA-g3hv-75wg-m249](https://github.com/advisories/GHSA-g3hv-75wg-m249): minimatch denial of service via glob-pattern amplification | `minimatch` 10.2.6 (range ≥7.0.0 <11.0.1) | `eslint-config-next` → `typescript-eslint` 8.72.2 → `@typescript-eslint/typescript-estree` → `minimatch` | moderate (reported 7 times: minimatch, typescript-estree, utils, type-utils, parser, eslint-plugin, typescript-eslint) | transitive | **Development only** (ESLint). Patterns come from the project's own lint configuration. | `minimatch` 11.0.1, via `typescript-eslint` 8.73.0 |
| 2 | [GHSA-ggr8-5vv4-36mx](https://github.com/advisories/GHSA-ggr8-5vv4-36mx): DeepmergeTS stack exhaustion when merging recursive object graphs | `deepmerge-ts` 7.1.5 (range <8.0.0) | `prisma` 6.19.3 → `@prisma/config` 6.19.3 → `deepmerge-ts` (pinned exactly to 7.1.5) | high (reported 3 times: deepmerge-ts, @prisma/config, prisma) | transitive (`prisma` is a direct devDependency) | **Prisma CLI only**: `prisma generate`, `migrate`, `db seed` (also used for migrations in the Docker image). Not loaded by the running web application, which uses `@prisma/client`. | `deepmerge-ts` 8.0.0. npm proposed Prisma **7.10.1** (a major upgrade). |

Neither advisory touches Next.js, React, `@prisma/client`, authentication, request handling, websockets, file upload or CSV parsing. LogiTrack's CSV parser is its own code (`src/lib/csv.ts`).

**Reachability.**
- #1 needs attacker-controlled glob patterns. ESLint only receives the project's own configuration.
- #2 needs a recursive (self-referencing) object passed to `deepmerge`. `@prisma/config` merges the project's own `prisma.config.ts` with defaults: trusted, non-recursive data.

Neither was practically exploitable here, but both were fixable without breaking anything, so both were fixed.

## Fixes applied

1. **minimatch:** `npm audit fix` (without `--force`) updated `typescript-eslint` from 8.72.2 to **8.73.0**, which is inside `eslint-config-next`'s `^8.56.0` range and depends on `minimatch` ^11.0.1 (installed 11.0.9). No `package.json` change was needed. Lint results are unchanged.
2. **deepmerge-ts:** a scoped npm override in `package.json`:
   ```json
   "overrides": { "@prisma/config": { "deepmerge-ts": "8.0.2", "effect": "3.22.5" } }
   ```
   (the `effect` entry was added on 20 Nov 2026, see below)
   It applies only to `@prisma/config`'s copy. The Prisma major-version upgrade that npm suggested was **not** taken: Prisma 7 changes the client generator and the configuration and is out of scope for a security patch. `deepmerge-ts` 8 keeps the same API (`deepmerge`) and supports Node ≥16.9. Verified with this override: `prisma validate`, `prisma generate` (loading `prisma.config.ts`, which is what `@prisma/config` merges), `prisma migrate status`, `prisma migrate deploy` and `prisma db seed` against a fresh database, `npm run setup`, and the full test suites.

**Remove the overrides** when upgrading to a Prisma release whose `@prisma/config` depends on `deepmerge-ts` ≥8 and `effect` ≥3.22.1.

## 20 Nov 2026: new advisory

A day later, `npm audit` reported **3 high** findings from one newly published advisory:

| Advisory | Vulnerable package (installed) | Path | Severity | Affects | Fixed in |
| --- | --- | --- | --- | --- | --- |
| [GHSA-7589-6fvf-x4pw](https://github.com/advisories/GHSA-7589-6fvf-x4pw): Effect ReDoS in `Schema.TemplateLiteral` compiled regex | `effect` 3.21.0 (range ≤3.22.0) | `prisma` 6.19.3 → `@prisma/config` 6.19.3 → `effect` (pinned exactly) | high (reported 3 times: effect, @prisma/config, prisma) | Prisma CLI only. `@prisma/config`'s bundle does not use `Schema.TemplateLiteral` (checked with a search of `node_modules/@prisma/config/dist`), so the vulnerable code is not reached. | `effect` 3.22.1 |

npm proposed **downgrading** Prisma to 6.12.0. That was rejected: downgrading to hide a finding is not a fix. Instead the same scoped override now also pins `effect` to **3.22.5** (same major version). Verified afterwards: `prisma validate`, `prisma generate`, `prisma migrate status`, `prisma migrate deploy` and `prisma db seed` on a fresh database, typecheck, lint, the full Vitest and Playwright suites, the production build, and `npm audit` → **0 vulnerabilities**.

New advisories appear all the time; CI runs `npm audit --audit-level=high` so they are noticed on the next push, and Dependabot proposes updates weekly.

## After

```text
npm audit
found 0 vulnerabilities
```

No advisory was suppressed, no package was downgraded, and `npm audit fix --force` was not used.
