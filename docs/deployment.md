# Deployment runbook for people and AI agents

Each installation serves one household on Cloudflare Workers, D1, and Access.
Start with a fresh repository checkout. Use separate checkouts for simultaneous
local development and deployment, since both generate build output.

## Prerequisites and inputs

Use Node.js 22.13+ and `npm ci`. The owner needs a Cloudflare account with Workers,
D1, and Zero Trust Access. Review the selected plan before purchasing anything.
Collect the account ID, a new Worker name, a new database name, family hostname,
IANA timezone, and approved household emails. Ask whether notifications and a
wall display are wanted; defaults are disabled. Keep emails and tokens private.

The family hostname may be a custom domain managed in this account or the exact
`<worker-name>.<account-subdomain>.workers.dev` address. Get the account subdomain
from Cloudflare. The optional display requires a separate custom hostname.

Authenticate with `npx wrangler login`, or supply `CLOUDFLARE_API_TOKEN` through a
private environment. `npx wrangler whoami` identifies the account. Deployment needs
Workers and D1 permissions; custom domains also need appropriate zone access.
Managing Access applications/policies needs separate permissions that Wrangler
OAuth may lack. Use the owner's authenticated dashboard when necessary. Never
broaden an existing app's policy to make a new installation work.

## Configure and provision

```bash
npm ci
npm run setup -- init
```

`init` creates ignored `installation.json` without overwriting an existing file.
Fill its Worker/account/database names and settings. Keep `localDevelopment`
false, set the IANA timezone (for example `UTC`), and leave `displayHostname` empty
when unused. No application-source edits are necessary.

Leave the zero database ID until creating a new database:

```bash
npm run setup -- provision-db --remote
```

This creates a new database and records its ID. If an ID is already recorded,
it makes no changes. Choose a different name on collision; never adopt another
household's database. After an uncertain result, inspect Cloudflare and private
`work/setup/provision.jsonc` before retrying because the database may exist already.
For an intentional upgrade, preserve that installation's existing settings and ID.

## Configure household sign-in

In Cloudflare One, open **Access controls → Applications**. Create a new
self-hosted application covering the entire family hostname, including all paths.
Create an Allow policy for the owner's specified household emails with an
appropriate identity provider, such as one-time email codes. All admitted members
can edit everything. Avoid Everyone or Bypass policies.

Copy the Access **team domain** (hostname only) and this application's **AUD tag**
into `settings.accessTeamDomain` and `settings.accessAudience`. The AUD is not the
application UUID. Never reuse another app's audience. The Worker independently
verifies the signed Access JWT, issuer, audience, and expiry for private requests.

The display hostname must load without interactive Access login; its key and
route allowlist protect the limited view. Inspect inherited account policies
before enabling it; never weaken an account-wide policy automatically.

References: [Access configuration](https://developers.cloudflare.com/workers/configuration/cloudflare-access/)
and [JWT verification](https://developers.cloudflare.com/cloudflare-one/access-controls/applications/http-apps/authorization-cookie/validating-json/).
JWT verification also works with framework static-asset routing, where the newer
`ctx.access` interface may be unavailable.

## Validate and initialize

```bash
npm run setup -- check
npm run setup -- migrate --remote
npm run setup -- init-db --remote
```

`check` validates settings and generates ignored `wrangler.deploy.jsonc` without
remote changes. It rejects placeholders, missing Access settings, duplicate hosts,
invalid timezones, and local mode. Routes include only selected custom domains.
`workers.dev` is enabled only when selected as the family hostname; previews stay
disabled. `migrate` applies pending migrations to the selected database.

`init-db` activates rows only in a truly empty database. Success prints `ready:
true` and the stored timezone. Repeating it preserves data and timezone; it is
not a timezone-change command. If it refuses, inspect the database instead of
removing guards. See [operations](row-storage-operations.md) for legacy migration.
For local development use `check --local`, `migrate --local`, and `init-db --local`;
these use the checked-in configuration and never the remote database.

## Optional notifications

When `settings.notifications` is false, no cron is deployed or push secrets
required. To enable, set it true and use the owner's real contact address:

```bash
npm run notifications:keys -- mailto:you@example.com
npm run setup -- check
npx wrangler secret bulk .dev.vars --config wrangler.deploy.jsonc
```

The generator creates a private `.dev.vars` and refuses to overwrite it. Preserve
`VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY`, and `VAPID_SUBJECT` across upgrades. If the
file exists, inspect/merge privately without printing values. Never rotate keys
to troubleshoot an ordinary deployment. Initial secret upload may ask to create
the new Worker; verify the selected name is this installation's new Worker.
Enable notifications and **Send a test** on an actual device after deployment.

## Build and deploy

```bash
npm run lint
npx tsc --noEmit
npm test
npm run deploy:check
npm run deploy
npm run smoke
```

`deploy:check` builds with deployment settings and runs Wrangler's dry run.
`deploy` validates and rebuilds, then explicitly uploads that build. Neither
applies migrations or initializes storage. Do not run bare `vinext deploy` or
deploy the local config. Use a separate checkout for concurrent build work.

Smoke checks are read-only and print statuses, not household contents. Without
`DAYLAPSE_ACCESS_JWT` supplied privately in the environment, authenticated behavior
is explicitly reported as untested. Complete browser sign-in to verify the UI;
never paste tokens into chat. A successful upload is not proof of working login.

## Optional display

Set `displayHostname`, regenerate config, and redeploy. Then:

```bash
npm run setup -- display-create --remote --label "Kitchen display"
npm run setup -- display-list --remote
npm run setup -- display-revoke --remote --id 1
```

Creation prints the ID and a private file path in ignored `work/display-keys/`.
The file holds the URL; only its hash goes to D1. Open the private URL on the
display. Each create call adds a key; it does not rotate another. List before
revoking and use the actual ID. Revocation can be repeated. An uncertain create
can leave a URL file for recovery; inspect the database before retrying.
Local commands work with `--local`; their URL assumes Vite port 5173, which you
can adjust to the actual printed port.

## Acceptance and upgrade checks

- Anonymous family pages/APIs redirect to Access or return 401/403, with no data.
  Unknown and preview hosts cannot reach private APIs.
- Sign in as an approved member. Create and complete a synthetic item; another
  authorized browser/member sees and edits it. Check conflict handling.
- Reapply migrations, rerun initialization, and redeploy. Saved data must survive.
- If enabled, missing/revoked display keys return 401, private APIs on the display
  host return 404, and a valid key reveals only the limited display view.
- If enabled, verify test and scheduled push on a real device. Mobile keyboard
  and older display-browser behavior also require device testing.
- Rehearse backup recovery in an isolated database before trusting real data.
  Never restore experimentally over an existing household.

Report the new URL, resource names, completed checks, untested manual checks,
and enabled recurring triggers. Leave unrelated resources untouched.

## Troubleshooting

401 after sign-in: verify this application's AUD, team domain, hostname, and
session expiry. 503 configuration errors: run `setup check`. Inactive storage:
apply migrations and run the guarded initializer; inspect any existing legacy
rows if it refuses. Local 403: use loopback HTTP, never a public tunnel.

Permission errors: check account and product scope. Wrangler OAuth may not manage
Access. Local socket failures need loopback permission. Neither justifies
weakening production authentication or deleting data.
