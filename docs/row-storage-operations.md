# Row-storage operations

This guide covers new installations, upgrades, and legacy data migration.

Daylapse remains a single-household Cloudflare Workers + D1 application. No
provider abstraction or multi-household accounts are required.

## Current contracts

- `GET /api/events/snapshot`: one consistent read batch containing up to 500
  items (including hidden/archived/deleted), six recent completions each, full
  completion counts, item versions, and a change sequence.
- Existing item/completion endpoints in [foundation notes](row-storage-foundation.md)
  remain available; the current schema also supports `weekday_rule` as described
  in [Data model](data-model.md). `POST /api/events/:id/edit` atomically applies field changes
  and a sparse `edits: [{id, completedOn}]` completion delta (null voids a record).
  Creation uses version zero plus `event`; updates use `expectedVersion` plus
  `patch`. Every command includes a stable `mutationId`.
- `GET /api/events/export?kind=items|history&timeZone=UTC` generates
  CSV from one consistent database batch. The filename pins the change sequence.
  Export limits: 500 items and 20,000 active completions; larger datasets return
  413 rather than silently truncating. Use paginated APIs or a D1 SQL export.
- `GET /api/events/:id/completions?limit=100&after=ID` loads history by ID cursor.
  Polling remains bounded snapshots; `/api/changes` is available to other clients.
- DAKboard accepts the same display key and polls every minute using the older
  browser-compatible timeout helper. The server limits and filters rows and
  allows only rendering fields. It excludes notes and completion histories.
- Notification scheduling reads active rows with `notify_due_today=1` and uses
  each device's timezone/time preference. Existing VAPID keys, subscriptions,
  delivery leases, and daily deduplication remain intact.

## Initialization and migration

For a new installation, use the [deployment runbook](deployment.md). Supported
commands are `npm run setup -- migrate --local` and `npm run setup -- init-db
--local`, or their explicit `--remote` counterparts. Remote commands validate
`installation.json` and generate `wrangler.deploy.jsonc`. The SQL below describes
the guarded initializer and legacy recovery procedures.

### Existing installations already using rows

Apply all pending migrations, currently through `0007_condemned_captain_flint.sql`,
before deploying the corresponding Worker. Do **not** rerun `snapshot`, `import`,
`activate`, or `verify` from `row-cutover.ts` for an ordinary upgrade. Those commands
compare against the original frozen baseline; legitimate later edits differ from
it. Migration 0007 extends schedule constraints and preserves event/completion
rows, versions, receipts, and audit images. It does not import the legacy JSON.

Record a D1 Time Travel bookmark before schema changes. Run validation, apply the
migration, deploy, and check the family and display views. For 0007, compare event,
completion, and audit-row counts before/after and run `PRAGMA foreign_key_check`.
A SQL export is optional extra protection and contains sensitive household data;
create one only in an approved private location with restricted permissions.

### New empty installations

Apply **all** migrations first. They intentionally leave row storage inactive.
For a genuinely empty database, initialize the single settings row with the SQL
below, replacing the timezone with the installation's IANA timezone. Run it via
`wrangler d1 execute <database> --local --file <file>` for development; use
`--remote` only when intentionally initializing the deployed database.

```sql
UPDATE installation_settings
SET import_state = 'ready', storage_mode = 'rows',
    default_time_zone = 'UTC'
WHERE id = 1 AND storage_mode = 'legacy' AND import_state = 'empty'
  AND NOT EXISTS (SELECT 1 FROM events)
  AND NOT EXISTS (SELECT 1 FROM completions)
  AND NOT EXISTS (SELECT 1 FROM changes)
  AND NOT EXISTS (SELECT 1 FROM mutations)
  AND NOT EXISTS (SELECT 1 FROM migration_runs)
  AND NOT EXISTS (SELECT 1 FROM household_state)
  AND NOT EXISTS (SELECT 1 FROM household_state_revisions);
SELECT storage_mode, import_state, default_time_zone
FROM installation_settings WHERE id = 1;
```

Verify the result is `rows` / `ready` with the intended timezone before starting
the app. If it remains inactive, inspect the existing data and use the legacy
migration process if appropriate; do not remove the guards or clear tables.
This initializer is intentionally a no-op on an initialized or nonempty database.

### Historical JSON-to-row migration

The following procedure applies only to installations still using the legacy JSON
store. Installations already using rows must not repeat it. Apply all current migrations.
Prepare a private JSON file with `{items, revision, updatedAt}`; for an
empty installation use an empty item array, revision zero, and a UTC timestamp.
Run `npm run rows -- rehearse --snapshot <file> --output work/rehearsal
--timezone UTC`. Reports and databases must stay under ignored
`work/`. The converter rejects behavior changes and preserves original IDs,
calendar dates, notes, history, annual anchors, and display tie order. It creates
explicitly marked `legacy_last_completed` records only when needed.

The operator helpers in `scripts/remote-d1.ts` and `scripts/row-cutover.ts` use
`installation.json` and the existing Wrangler OAuth login (or `CLOUDFLARE_API_TOKEN`).
They never print credentials. Update the installation timezone/comparison dates
in the cutover helper for a new installation. Use the guarded initializer above for new empty installations. The app never
silently initializes or replaces an existing database.

For an existing installation, pause household writes and take a full SQL backup
and Time Travel bookmark before proceeding:

```bash
npx wrangler d1 export DB --config wrangler.deploy.jsonc --remote --output work/cutover/before-cutover.sql --skip-confirmation
npx wrangler d1 time-travel info DB --config wrangler.deploy.jsonc --json > work/cutover/bookmark.json
node --import tsx scripts/row-cutover.ts snapshot
# Rehearse this fresh snapshot locally and run tests before these writes:
npx wrangler d1 migrations apply DB --config wrangler.deploy.jsonc --remote
node --import tsx scripts/row-cutover.ts import
node --import tsx scripts/row-cutover.ts activate
npm run deploy
node --import tsx scripts/row-cutover.ts verify
```

The importer checks the source revision inside the transaction that freezes old
writes. It resumes by chunk checksum and verifies every imported value before
marking the baseline ready. Activation rechecks exact row checksums and date
behavior. No ongoing dual writes are performed. Deploy the row consumer Worker
before import if notification processing must be paused: its cron skips inactive
row storage. Old app tabs receive a reload-required response. Refresh family
browsers and the DAKboard after deployment.

Keep the frozen JSON, old revisions, SQL backup, migration manifest, and audit
baseline for at least 30 days of observation. No automatic deletion or audit
retention pruning is enabled. Backups contain private data and must stay ignored
with restricted file permissions.

## Recovery

Legacy revisions remain readable at `/api/items/revisions` and
`/api/items/revisions/:revision`; their old POST route is retired. Row revisions
are listed per item at `/api/events/:id/revisions`. Item restore uses the normal
versioned restore API and increments the current item version.

`GET /api/recovery?sequence=N` reconstructs a whole-household row revision.
`GET /api/recovery?legacyRevision=N` converts an old snapshot for review.
After reviewing the desired state, POST to `/api/recovery`:

```json
{"source":{"legacyRevision":62},"expectedSequence":65,"mutationId":"a-new-stable-UUID"}
```

Use `{"sequence":N}` instead for a row revision. This atomically creates new
versions, restores the desired records, soft-deletes items absent from the
snapshot, voids absent completions, and appends an immutable audit trail. A global
sequence guard rejects intervening writes. Retrying the same ID/body returns the
original receipt. API restores are capped at 750 KB of audit images and 20,000
entities; no partial state is exposed when the limit is exceeded.

For larger restores, the operator prepares a staged SQL file without writing:

```bash
node --import tsx scripts/prepare-row-restore.ts --legacy 62 --expected CURRENT_SEQUENCE
# Or --sequence ROW_REVISION instead of --legacy.
```

Review `work/recovery/manifest.json` and the private SQL. Take a fresh full D1
export and bookmark. Apply with `wrangler d1 execute ... --remote --file
work/recovery/restore.sql --yes`. Cloudflare's bulk-import path provides a database
maintenance window, executes the small statements as one import, and returns the
database to its original state if import fails. The leading sequence guard also
rejects changes since preparation. Resume readers/cron after completion; retry
a failed import using the same file. The helper supports up to 100,000 entities
and 50 MB of audit images and rejects larger jobs before writing. Preserve the
before-export and manifest until verification passes. Never run the generated
statements as independent HTTP requests.

## Rollback

Before any row mutations exist, the frozen JSON remains the original data copy.
Prefer rolling forward with a compatible row-reading Worker. After row writes
start, deploying an old JSON-reading Worker would hide or lose those changes.
Never simply point back to the frozen JSON.

Under a write pause, `node --import tsx scripts/row-cutover.ts reverse-export`
creates both a full row backup (including flags, deletion state and voided
history) and a UI-shaped snapshot of current active/archived items.
Keep both. The legacy application cannot represent the new flags, deletion state, or custom
`weekdayRule` schedules. A reverse export containing those rules is not accepted
by the old application without an explicit conversion;
a reverse export is an emergency data-preservation step, not a lossless feature
rollback. Use the row-compatible deployment or restore the full D1 backup with
its matching Worker for recovery. Tests verify both legacy and row revision
restore, lost-response retries, and all-or-nothing staged SQL recovery.
