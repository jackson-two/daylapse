# Daylapse

A shared household dashboard for recurring chores, maintenance, important dates,
birthdays, anniversaries, and holidays. Each household runs its own installation
on **Cloudflare Workers and D1**.

## Sharing model

The owner manages membership through Cloudflare Access. Approved members share
all items, completion history, and recovery tools. Everyone admitted can edit;
there are no per-person roles or private lists. The owner controls infrastructure,
membership, and display credentials.

Optional Web Push sends due-today reminders. An optional wall display gets a
limited, read-only view through a revocable key. Both can be disabled.

## Deploy with an AI agent

Give an agent this repository and this prompt:

> Read AGENTS.md and docs/deployment.md. Help me deploy a new Daylapse household
> on my Cloudflare account. Use the supported setup commands, ask for missing
> account and household preferences, keep configuration and credentials private,
> and verify the finished app. Preserve all existing applications and databases.
> Report passing checks and remaining manual steps.

The agent needs a terminal, Node.js 22.13+, npm, and authorized Cloudflare access.
Some account/Access setup may require the owner's browser login. The complete
[deployment guide](docs/deployment.md) also works for people deploying manually.

Settings live in ignored `installation.json`, which generates ignored
`wrangler.deploy.jsonc`. No application-code hostname edits are needed. The
checked-in `wrangler.jsonc` is for local development only.

## Try locally

```bash
npm ci
npm run setup -- check --local
npm run setup -- migrate --local
npm run setup -- init-db --local
npm run dev
```

Open Vite's printed loopback URL. Local development accepts loopback HTTP only;
it needs no Cloudflare login, Access credentials, or notification keys. Use
synthetic data. Initialization never resets a populated database.

## Documentation

- [Deployment and AI runbook](docs/deployment.md)
- [User guide](docs/user-guide.md)
- [Operations and recovery](docs/row-storage-operations.md)
- [Data model](docs/data-model.md)
- [Contributing](CONTRIBUTING.md)
- [Security](SECURITY.md)
- [Release readiness](docs/release-readiness.md)

## Scope and limitations

Cloudflare Workers, D1, and Access are the supported platform, with one household
per installation. The React UI uses a Next.js-compatible App Router compiled
with vinext, and Drizzle manages SQL migrations.

Shared data refreshes periodically and conflicting edits are handled explicitly.
The app requires connectivity to load/save; its service worker provides push,
not offline editing. Optional DAKboard support is a web page, not a native API
integration. Device/browser behavior requires real-device verification.

Cloudflare usage and any purchased domain may incur costs. Review current
[Workers](https://developers.cloudflare.com/workers/platform/pricing/),
[D1](https://developers.cloudflare.com/d1/platform/pricing/), and
[Access](https://www.cloudflare.com/plans/zero-trust-services/) plans.

## Development checks

```bash
npm run lint
npx tsc --noEmit
npm test
```

Tests use disposable local databases and fake push services; they need loopback
ports. CI runs without deployment credentials.

## Release status

This is an early preview, licensed under the [MIT License](LICENSE). Core
household flows have been tested on an isolated Cloudflare installation.
Notifications and wall-display support are experimental pending real-device
validation. See [release readiness](docs/release-readiness.md) for completed and
outstanding checks.

No original household data, credentials, or private Git history are included.

Security reports use GitHub private vulnerability reporting; see
[the security policy](SECURITY.md) for instructions and availability.
