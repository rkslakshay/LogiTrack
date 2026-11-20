# Security policy

## Supported versions

| Version | Supported |
| --- | --- |
| 3.0.x | Yes |
| 2.x and earlier | No: upgrade to 3.0 (migrations run automatically; take a backup first) |

## Reporting a vulnerability

Please do **not** open a public issue for a security problem. Use the repository host's private vulnerability reporting (on GitHub: **Security → Report a vulnerability**) and include:

- what is affected and how to reproduce it,
- the version or commit,
- the impact you expect.

This is a portfolio project maintained on a best-effort basis: there is no bug bounty and no guaranteed response time.

## What to know before deploying

LogiTrack has had a self-conducted security review with automated regression tests. It has **not** had an independent penetration test and holds no security certification. Read these first:

- [docs/SECURITY_HARDENING.md](docs/SECURITY_HARDENING.md): controls added in 3.0, configuration and known limitations
- [docs/SECURITY.md](docs/SECURITY.md): the security model and the 2.0 review findings
- [docs/DEPLOYMENT.md](docs/DEPLOYMENT.md): HTTPS, secrets and backups for a real deployment
- [docs/DEPENDENCY_AUDIT.md](docs/DEPENDENCY_AUDIT.md): `npm audit` findings and how they were resolved (0 open)

The demo accounts in the README are public on purpose and exist only in generated sample data. Run real deployments with `DEMO_MODE=false` and your own accounts.
