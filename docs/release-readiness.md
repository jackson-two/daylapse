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
- Build, lint, TypeScript, and 81 automated tests passed.
- The production dependency audit reports zero known vulnerabilities at the time
  of this check; development-tool dependencies are outside that audit scope.
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
- Live birthday settings retained disabled visibility/notification flags and a
  zero-day dashboard window after reload; the birthday was omitted from the
  dashboard. An anniversary retained its blank, unlimited dashboard window.
- With synthetic records present, repeating the remote migration check, guarded
  initializer, and deployment preserved all three records and task completion
  history. No pending schema migrations existed for this rehearsal. The synthetic
  records were subsequently archived through the app, leaving a clean dashboard.
- A different household member's login and optional physical-device checks still
  require completion. Notifications and the display remain disabled in the test
  installation.
