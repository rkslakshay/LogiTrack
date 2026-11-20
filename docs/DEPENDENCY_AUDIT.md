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

## Dependabot policy

Configured in `.github/dependabot.yml` (since 20 Nov 2026):

| Rule | Why |
| --- | --- |
| Patch and minor npm updates: weekly, **one grouped PR** | Low risk, easy to review; CI (Linux, Windows, Playwright, `npm audit`) must be green before a person merges. |
| `prisma` and `@prisma/*` are **always updated together** (own group) | The client must match the CLI that generates it. PR #5 bumped only `@prisma/client` and could not generate. |
| **No automatic major versions** for `prisma`, `@prisma/*`, `typescript`, `eslint`, `@types/node`, `next`, `eslint-config-next` | Each needs a planned migration or is blocked by a peer: Prisma 7 changes the generator and config; TypeScript 7 is not supported by `typescript-eslint` (≤ 6.0); ESLint 10 is outside the declared peer range of `eslint-plugin-react`, `jsx-a11y` and `import`; `@types/node` follows the Node.js LTS line LogiTrack supports (the engines field says ≥ 20.12, CI runs 22), not the newest Node; Next.js majors are deliberate upgrades together with its ESLint config. |
| Every other package, majors included, is still proposed | One PR each, for review. |
| GitHub Actions: monthly, **one grouped PR** | Actions are reviewed together. |
| Security | GitHub's documentation says `ignore` rules also apply to security updates. So the ignore list is deliberately short and per-package (not `*`). A security fix that exists only in a new major of one of these packages is caught by `npm audit --audit-level=high` in CI (and by Dependabot alerts once they are enabled, see below) and is then handled by hand. Security updates for every other package are unaffected. |

Merging, closing or dismissing Dependabot PRs is always a human decision.

**Repository settings (checked 21 Nov 2026):** *Dependabot alerts* and *Dependabot security updates* are currently **off** for `rkslakshay/LogiTrack` (the API reports alerts as not enabled and `automated-security-fixes: enabled=false`). They are free for public repositories and are switched on by the owner under **Settings → Code security**. Until then, the active safeguard is the `npm audit --audit-level=high` step in CI, which runs on every push and pull request; the weekly version updates from `dependabot.yml` run regardless.

## Dependabot PRs opened on the first push (20 Nov 2026)

Reviewed individually from the PR diffs and their CI runs. **None was merged or closed**; that decision belongs to the repository owner.

| PR | Change | Type | CI | Security relevance | Breaking-change risk | Recommendation |
| --- | --- | --- | --- | --- | --- | --- |
| #1 | `actions/upload-artifact` 4 → 7 | major (action) | ✅ all 3 jobs | none (no advisory) | low: inputs used (`name`, `path`, `retention-days`) unchanged; v7 runs on Node 24 | **Superseded by the local workflow update** (same versions). Close after that change is pushed, or merge either one. |
| #2 | `actions/setup-node` 4 → 7 | major (action) | ✅ | none | low: `node-version` and `cache` unchanged; Node 24 runtime | **Superseded by the local workflow update.** |
| #3 | `actions/checkout` 4 → 7 | major (action) | ✅ | none | low; Node 24 runtime | **Superseded by the local workflow update.** |
| #4 | minor/patch group: `react` + `react-dom` 19.3.0 → 19.3.1, `tailwindcss` + `@tailwindcss/turbopack` 4.3.3 → 4.3.5, `lucide-react` ^1.73.0 → ^1.74.0, `@testing-library/user-event` ^14.6.10 → ^14.6.12 | patch + minor | ✅ all 3 jobs | none (`npm audit` was already 0) | low | **Appropriate to merge** after a quick look at the changelogs. |
| #5 | `@prisma/client` 6.19.3 → 7.10.1 (CLI left at 6.19.3) | major | ❌ Linux and Windows: `prisma generate` fails (`Cannot find module …/query_engine_bg.sqlite.wasm-base64.js`); Playwright skipped | none | high: client/CLI mismatch; Prisma 7 is a planned migration | **Do not merge.** Close; the new config no longer proposes Prisma majors. |
| #6 | `eslint` ^9 → ^10 (9.39.5 → 10.15.0) | major | ✅ (lint ran) | none | medium: `eslint-plugin-react` 7.37.5, `eslint-plugin-jsx-a11y` 6.10.2 and `eslint-plugin-import` 2.32.0 declare ESLint ≤ 9 peers; passing today is not supported compatibility | **Do not merge yet.** Revisit when `eslint-config-next`'s plugins support ESLint 10. |
| #7 | `typescript` ^5 → ^7 (5.9.3 → 7.0.2) | major | ❌ Linux and Windows: ESLint crashes, "typescript-eslint does not support TS 7.0" (it supports `>=4.8.4 <6.1.0`); Playwright skipped | none | high | **Do not merge.** |
| #8 | `@types/node` ^24.19.2 → ^26.6.6 | major (types only) | ✅ | none | medium: types for Node 26 would let code use APIs that do not exist on the Node versions LogiTrack supports and CI runs (22) | **Do not merge.** Stay on the 24.x line (Node 24 LTS). |
