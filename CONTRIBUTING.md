# Contributing to Daylapse

Daylapse supports Cloudflare Workers, D1, and Access with one household per
installation. All household members share editing rights. Please keep changes
within this scope and describe the user-visible problem they solve.

## Local setup and checks

Follow the README's local commands. Use Node.js 22.13+ and `npm ci`. Tests require
loopback ports for disposable workerd/D1 instances; they do not need Cloudflare
credentials. Use synthetic data and keep `work/` private.

```bash
npm run lint
npx tsc --noEmit
npm test
npm run privacy:check
```

Keep both lockfiles consistent when changing dependencies. Wrangler 4.129.0 and
the Cloudflare Vite plugin 1.54.4 share workerd 1.20260903.1. Miniflare and esbuild
are explicit test dependencies. Tests read compatibility settings from the local
`wrangler.jsonc`; an unsupported runtime date must fail rather than silently use
older behavior. Regenerate binding types using `npx wrangler types`. Optional
push secrets are separately typed in `env.d.ts`.

## Repository map

- `app/`: household UI, display, routes, styles, and PWA metadata.
- `worker/index.ts`, `lib/worker-request.ts`, `lib/access-policy.ts`: request
  authentication before static assets and the framework, plus scheduled
  notifications. Preserve fail-closed access checks.
- `lib/installation.ts`, `scripts/installation-config.ts`, `scripts/setup.ts`:
  configuration validation and the supported setup workflow.
- `lib/row-*`: validation, persistence, audit history, recovery, and synchronization.
- `lib/item-dates.ts`, `lib/holiday-rules.ts`: shared calendar rules.
- `lib/notification-*`, `lib/due-notifications.ts`, `public/sw.js`: Web Push.
- `db/`, `drizzle/`: schema, migrations, and migration metadata.
- `tests/`: scheduling, sync, authentication, installation, and D1 integrity.

## Change guidelines

Private endpoints run behind the Worker access policy. Do not add production
bypasses or trust identity headers without JWT verification. Keep display data
limited and display routes read-only. Add behavior tests for auth/setup changes,
including missing configuration, forged tokens, and repeated operations.

Keep date rules shared by dashboard, display, CSV, and notifications. New fields
must survive validation, storage, exports, and recovery. Never edit applied SQL
migrations; add one and test with populated data and preserved audit history.

Mobile keyboard and notification behavior need real-device checks. Preserve
pinch-to-zoom. Do not treat mocks as proof of a delivered phone notification.

For deployment and upgrades, use [the runbook](docs/deployment.md) and
[operations](docs/row-storage-operations.md). A build does not apply migrations.
Keep owner settings in ignored `installation.json`; never edit source hostnames
or put household data, credentials, or private URLs into a PR.

Include the problem, resulting behavior, and relevant validation in pull requests.
Security issues should follow [SECURITY.md](SECURITY.md), not a public issue.
Contributions are provided under the project's [MIT License](LICENSE).
