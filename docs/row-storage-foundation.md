> Historical foundation notes: consumer migration is now implemented. See
> [current operations](row-storage-operations.md) for activation and recovery.

# Row storage foundation: steps 1–3

Implemented on `codex/row-storage-foundation`. This is the schema, conversion,
repository, and API foundation from the [migration plan](row-based-data-plan.md).
At that milestone, the dashboard, DAKboard, CSV exports, notifications, and
revision API still used the original store. The later cutover moved all consumers
to rows. The following describes the foundation milestone, not current deployment
instructions; use [operations](row-storage-operations.md) for current procedures.

## Inventory and conversion

The converter validates the entire source snapshot, preserves original item
IDs and per-item completion IDs, and compares scheduling and selection behavior
on explicitly supplied calendar dates. Invalid input or a behavior difference
stops conversion. It checks recurring/snoozed due dates, annual dates, dashboard
windows, both DAKboard columns, archived state, and due-today selection.

Migration rules that need to remain explicit:

- A `lastCompleted` date absent from history becomes a completion with
  `source = legacy_last_completed`. Its deterministic ID avoids existing IDs;
  the inventory reports every synthetic record. Existing history dates and IDs
  are never replaced. History CSVs will gain these records when consumers move.
- Fixed-date interval fields have no scheduling effect and are omitted from
  rows, with a report warning. The eventual CSV adapter must deliberately handle
  these previously populated but irrelevant columns. Other ignored legacy date
  or snooze fields are reported as well.
- `annual_anchor_date` preserves the old ordinary annual-event start year and
  rollover behavior. It is separate from the February 28 fallback used by
  birthdays/anniversaries. Converting that legacy behavior is not part of import.
- `import_position` preserves the source array position for tied-date ordering.
  Consumers must use it as a tie-breaker when they move to rows.
- Original calendar creation dates remain in `created_on`. Unknown historical
  creation/entry times remain NULL. The source snapshot timestamp supplies a
  reproducible baseline timestamp, including for imported archive state; it is
  not claimed to be the actual time a legacy item was archived.
- All destination flags default to enabled. Archive state remains independent.

Private source JSON has the shape `{ "items": [...], "revision": 1,
"updatedAt": "...UTC timestamp..." }`. The example revision is illustrative.
Keep snapshots and generated reports under ignored `work/`, never in Git.
The scripts restrict outputs to that directory and create private reports.

```bash
npm run rows -- inventory --snapshot work/row-storage/production-snapshot.json \
  --date 2026-09-04 --timezone UTC

npm run rows -- rehearse --snapshot work/row-storage/production-snapshot.json \
  --output work/row-storage-rehearsal --date 2026-09-04 --timezone UTC
```

`inventory` does not open a database. `rehearse` creates a separate local
Miniflare D1 database, applies migrations there, and imports bounded chunks.
It has no remote execution option. The timezone sets the installation default;
comparison dates are explicit calendar dates, not UTC instants.

Each chunk records a checksum in the same transaction as its rows and audit
baseline. Rerunning the same manifest resumes interrupted chunks without
duplicates. A different source cannot overwrite an existing import. Final
verification compares every stored event/completion value with the manifest.
Changing converter versions requires a fresh local rehearsal directory.

## Schema and activation gate

Migration `0005_eager_cobalt_man.sql` is additive. It creates events, completions,
mutation receipts, row audit history, migration tracking, and singleton settings.
It leaves the existing household and revision tables intact.

New installations of this migration start with `storage_mode = 'legacy'` and
`import_state = 'empty'`. Successful import sets `import_state = 'ready'` but
leaves `storage_mode = 'legacy'`. New row HTTP endpoints return 503 until both
`storage_mode = 'rows'` and `import_state = 'ready'` are present. Database triggers
also enforce this gate on mutations.

Tests explicitly activate rows only in their disposable database. At this
milestone, production activation was deferred because old consumers would
continue writing the JSON store, creating two divergent sources of truth. Steps
4 and 5 subsequently moved the consumers and completed the coordinated cutover.

## APIs available for integration

All endpoints require the existing family-host Cloudflare Access protection.
Application checks allow the configured family hostname and local development;
the DAKboard host is rejected even if a forwarded hostname claims otherwise.
Mutation requests also require the matching `Origin` and JSON content type.
Updating the family hostname in another installation requires updating this
allowlist. The APIs do not introduce a separate user/login system.

| Endpoint | Contract |
| --- | --- |
| `GET /api/events` | ID-keyset pagination; `after`, `limit` (1–100), `includeDeleted=true`. Includes archived/hidden items for management and an indexed latest completion. |
| `POST /api/events` | `{ mutationId, event: { id, title, kind, scheduleType, createdOn, ... } }`; returns 201 with event, version, and audit sequence. |
| `GET /api/events/:id` | Current record, including a deletion marker and computed latest completion. |
| `PATCH /api/events/:id` | `{ mutationId, expectedVersion, patch: { ... } }`; omitted values remain unchanged. Full resulting schedule is validated. |
| `DELETE /api/events/:id` | `{ mutationId, expectedVersion }`; records a recoverable deletion. |
| `POST /api/events/:id/restore` | Same version envelope; omit `sequence` to undo deletion, or supply a committed sequence to restore item fields and history. |
| `GET /api/events/:id/completions` | ID-keyset pagination with `after`, `limit`, and `includeVoided=true`. Pagination order is ID, not completion date. |
| `POST /api/events/:id/completions` | `{ mutationId, expectedVersion, completion: { id, completedOn } }`. |
| `PATCH /api/events/:id/completions/:completionId` | `{ mutationId, expectedVersion, completedOn }`; corrects the record. |
| `DELETE /api/events/:id/completions/:completionId` | Version envelope; voids the record without erasing its audit history. |
| `GET /api/events/:id/revisions` | Imported baseline and paginated committed item mutations; `after` is a sequence. |
| `GET /api/events/:id/revisions/:sequence` | Reconstructs that item at a committed revision. |
| `GET /api/changes` | Paginated committed mutation summaries after a sequence; never splits a mutation across cursors. Clients fetch affected items, including deletion markers. |

Field names use camelCase in JSON. The schedule types are `interval`,
`fixed_date`, `annual_date`, and `holiday_rule`. New annual dates without a
legacy anchor follow the celebration date policy. The later consumer migration enabled all display flags; migration 0007 also
added `weekday_rule`. See the [current data model](data-model.md).

## Write safety and recovery

An operation checks a single event version. A completion changes its parent's
version too. Independent items can save concurrently; stale same-item requests
receive 409 and the current record. Stable mutation IDs and request fingerprints
allow identical retries to replay the original receipt. Reusing an ID with
different contents receives 409.

A database precondition trigger raises an error for stale versions. The D1
batch then rolls back the receipt, item/completion rows, and audit changes
together. Returned rows/receipts confirm success; affected-row metadata is not
used as proof of a successful write.

Audit rows and completed receipts cannot be edited or deleted through ordinary
SQL statements. Item restore reads the immutable baseline and latest row images
at the selected commit, then writes a new version and audit sequence. Voided
completion IDs remain reserved; create a new ID for a new completion.

Historical reads/restores are bounded to 2,000 completion identities per item,
and a restore's change payload must fit below 750 KB. Larger operations return
413 before writes. Full-household and large staged restore workflows, retention,
CSV generation, notification queries, and client synchronization are later
consumer/cutover work. No audit retention cleanup is enabled in this foundation.

## Validation

`tests/row-storage.test.ts` uses real disposable D1 instances to cover conversion,
interrupted import recovery, constraints, foreign keys, indexed queries,
concurrent edits, repeated requests, responses lost after commit, forced audit
failure, soft deletion, historical restore, and HTTP access/input boundaries.
The existing application and DAKboard compatibility suite continues to run.

```bash
node --import tsx --test tests/row-storage.test.ts
npm test
npx tsc --noEmit
npm run lint
```
