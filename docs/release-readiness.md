# Release readiness

This file tracks the first public release. Do not interpret local tests as live
or physical-device verification.

Implemented:

- Sanitized source import without the original Git history, data, or credentials.
- Explicit Cloudflare-only, single-household sharing model.
- Private installation settings, validated generated deployment configuration,
  and optional notifications/display.
- JWT verification before private pages/APIs and restricted display routes.
- Scripts for provisioning, migrations, guarded initialization, display keys,
  deployment dry runs, deployment, and read-only smoke checks.
- AI deployment runbook, agent instructions, security guidance, and contribution
  templates. CI checks source without deploying or needing account credentials.
- Regression tests for authentication (including real workerd key retrieval),
  configuration, and repeatable initialization.
- Updated affected runtime dependencies; production dependency audit is clean.
- MIT License with Jackson Two LLC as the copyright holder and a security policy
  using GitHub private vulnerability reporting without a public contact email.

Required before public release:

- Keep private vulnerability reporting and secret scanning enabled, and require
  passing CI checks on the main branch.
- Record fresh-install and upgrade validation, including authenticated household
  sharing, using only synthetic data. Keep private infrastructure IDs out of here.
- Verify any advertised notification and wall-display behavior on real devices.
- Rehearse recovery using a backup in a separate disposable database.
- Add synthetic screenshots and tag the first version with release notes.

The first release should explain its support scope and known limitations. Do not
claim offline editing, per-person permissions, or native DAKboard integration.

## Verification performed during preparation

- The public repository is [jackson-two/daylapse](https://github.com/jackson-two/daylapse).
  Private vulnerability reporting is enabled, and **Report a vulnerability**
  is visible on the public Security page. The maintainer's personal account has
  administrator access through organization ownership. Secret scanning and push
  protection are enabled.
- Build, lint, TypeScript, and 82 automated tests passed for the dashboard/mobile
  update. Simulator checks covered touch-keyboard entry, item creation, and
  enabled annual dates more than 60 days away. Physical-device checks remain open.
- The production dependency audit reports zero known vulnerabilities at the time
  of this check; development-tool dependencies are outside that audit scope.
  The September 30 cleanup patches Next.js and Miniflare's undici dependency.
  The full audit still reports four moderate findings in Drizzle Kit's legacy
  esbuild dependency chain; these are below CI's high-severity threshold.
- Documented local setup initialized a fresh D1 database and preserved it on a
  second initialization. A synthetic task and completion round-tripped through
  the running app's HTTP API. The display omitted private notes/history.
- Display-key creation, listing, and repeated revocation were exercised locally.
- Browser checks against the local built Worker confirmed birthday visibility
  and notification settings persist after creation and reload, and an
  anniversary's cleared dashboard limit survives editing and reload. Regression
  tests cover both celebration types and their destination filters.
- Static assets are served explicitly after access checks so Worker-first
  routing does not leave the app stuck loading its JavaScript.
- A local SQL export restored into a separate SQLite database with item,
  completion, audit history, and foreign-key integrity preserved. Remote Time
  Travel recovery remains a separate operational check.
- An independent Cloudflare test Worker, D1 database, and owner-only Access
  application were created. Deployment and a subsequent redeployment succeeded;
  anonymous private-route checks redirected to Access. Infrastructure details
  remain in ignored local files.
- The latest celebration-settings and static-asset fixes were deployed to the
  isolated Cloudflare test installation. Pending-migration checks and repeated
  guarded initialization succeeded; all five anonymous private-route checks
  redirected to Access. The original Worker's deployed versions were unchanged,
  and the test Worker remained bound to its separate database.
- Signed-in Cloudflare browser checks confirmed task creation, completion, and
  persistence after reload. A second tab using the same approved owner's session
  saved an edit that the first tab saw after reload. This verifies separate
  clients; admission of a different household member remains untested.
- During the earlier deployment rehearsal, birthday settings retained disabled
  visibility/notification flags and a zero-day dashboard window after reload;
  the birthday was omitted from the
  dashboard. An anniversary retained its blank, unlimited dashboard window.
  The subsequent dashboard update preserves these stored values but ignores
  annual-date windows; enabled annual dates now appear year-round. This update
  has not been deployed as part of the repository cleanup.
- With synthetic records present, repeating the remote migration check, guarded
  initializer, and deployment preserved all three records and task completion
  history. No pending schema migrations existed for this rehearsal. The synthetic
  records were subsequently archived through the app, leaving a clean dashboard.
- A different household member's login and optional physical-device checks still
  require completion. Notifications and the display remain disabled in the test
  installation.

## Purchasing feature verification

The purchasing implementation is tested locally with synthetic data, including
MCP operations and populated upgrade preservation. It is not a claim of a live
household release. Owner-authorized migration/deployment and live Access
service-token checks remain release steps. Physical iPhone Home Screen behavior
and vendor-specific connector compatibility require device/client validation.
The public repository has no native iOS or TestFlight build. See
[purchasing](purchasing.md) and [agent setup](purchasing-mcp.md).

Local feature validation: 91 passing tests (including 9 purchasing suites), lint,
TypeScript, privacy check, binding regeneration and clean npm install. Built Worker
HTTP checks verify shopping rendering, MCP initialization/discovery/schema/list
queries and foreign-origin denial. Responsive browser checks cover independent
quantities, one-card expansion, offscreen collapse, purchase/undo, unavailable and
skipped outcomes, catalog creation and store filters. These use synthetic data.

The November dependency audit passes the high-severity gate after compatible
React/Next/Vite/Zod and transitive security updates. Fourteen moderate findings
remain in existing development/image tooling; no major framework/toolchain upgrade
is included. npm and pnpm overrides are aligned; pnpm's overrides now live in
pnpm-workspace.yaml because current pnpm ignores that field in package.json.

## Purchasing MCP discoverability (November 13, 2026)

MCP version 1.1.0 adds field descriptions, generated create/partial-update and
response schemas, entity joins, every query view, operation-specific version
rules, retry/retention guidance, price provenance and executable synthetic recipes.
Service validation errors now include `invalid_input` plus field paths. Generic
partial-save input remains compatible; omitted saved values are preserved.

Validation: clean locked dependency install, lint, TypeScript, privacy scan,
production build and all 93 standard tests passed. Eleven purchasing tests include
MCP discovery, all six published recipes, every query response, exact retries,
conflicts, validation paths, paging, authentication and uncertain commits. The
high-severity dependency audit passes; 14 existing moderate findings remain.
Deployment packaging passed the supported dry run. No database migration, business
rule, authentication/configuration, native or display change is included.

Publishing and authenticated live discovery are separate installation-specific
steps. Deploy through the existing installation runbook, preserving its settings;
refresh client discovery after publication. An installation with purchasing MCP
disabled remains disabled. Do not change access policy or client permissions as
part of this metadata update. No production write is required for verification.
