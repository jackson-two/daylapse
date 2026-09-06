# Row-based household storage plan

Status: implemented, with production cutover tracked in the
[row-storage operations guide](row-storage-operations.md). This document records
the design and acceptance criteria. The app now uses row storage; the legacy JSON
is retained only for recovery. The initial release keeps bounded snapshot polling
rather than switching the browser to incremental change-feed polling. The feed
is available for API consumers. Large household restores use a prepared SQL file
and Cloudflare's atomic bulk-import maintenance window.

## Recommendation

Keep Cloudflare Workers, D1, and Drizzle. Replace the live household JSON
document with relational tables: one row per tracked item and one row per
completion. Use explicit display and notification preferences on each item.
Keep the installation scoped to one household; multi-tenant accounts and a
different database provider are outside this migration.

An “event” here means a tracked definition, such as “Replace air filter” or
“Birthday.” A recurring definition stays one row across years of use. Its
completions are separate rows. Do not pre-create an unlimited series of future
occurrences.

Before migration, `lib/household-state.ts` replaced the entire item array
on every write. The revision trigger then copied that array, including all
completion history. Unrelated edits shared a conflict boundary, history grew
inside every snapshot, and the display API read the full household document.
The completed row migration addresses these problems without changing hosting.
The model below records the original proposal; [Data model](data-model.md) also
covers the subsequently added weekday holiday schedules.

## Proposed model

### `events`: one row per tracked item

| Columns | Purpose |
| --- | --- |
| `id` (text primary key) | Preserve the existing item ID. |
| `title`, `verb`, `category`, `notes` | Existing descriptive fields. Keep category as text initially. |
| `kind` | `task`, `event`, `birthday`, `anniversary`, or `holiday`; identifies what the item represents. |
| `schedule_type` | `interval`, `fixed_date`, `annual_date`, or `holiday_rule`; identifies how its due date is calculated. |
| `interval_value`, `interval_unit`, `anchor_date` | For interval schedules: positive interval and date to use when there is no active completion. |
| `target_date` | A calendar date for a one-time event. |
| `month`, `day` | For annual dates; retain February 29 as February 29. |
| `holiday_key` | The supported named holiday rule; continue calculating dates in the shared date library. |
| `snoozed_until` | Optional date override for an interval task. |
| `highlight_within_days` | Current `reminderDays` highlighting threshold; it is not the notification schedule. |
| `show_on_dashboard` | Whether the item is eligible for the main timeline. |
| `dashboard_window_days` | Optional upcoming-date window. NULL means no window. |
| `show_on_display` | Whether the item is eligible for the DAKboard response. |
| `notify_due_today` | Whether to include this item in a device's due-today summary. |
| `archived_at`, `deleted_at` | Separate lifecycle states; both suppress timeline, display, and notifications. Deletion is initially recoverable. |
| `created_on` | Original calendar creation date, retained for existing countdown behavior. |
| `created_at`, `updated_at` | UTC record timestamps. Legacy creation time is unknown: keep `created_at` nullable rather than inventing a time. |
| `version` | Positive integer incremented whenever this item or its scheduling history changes. |

The schedule columns belong on this table initially: each item has exactly one
simple schedule, and database CHECK constraints can rule out conflicting
combinations. A separate schedule table is warranted only if an item eventually
supports multiple schedules.

### `completions`: one row per recorded completion

| Columns | Purpose |
| --- | --- |
| `event_id`, `id` | Composite primary key. Existing completion IDs are only guaranteed unique within their item. |
| `completed_on` | Calendar date on which the work occurred, independent of when it was entered. |
| `recorded_at`, `updated_at` | UTC entry timestamps; allow unknown legacy entry times. |
| `source` | `recorded` or `legacy_last_completed`, so migration-created records are distinguishable. |
| `voided_at` | Correct or remove a completion without destroying its recovery history. |

Use a foreign key to `events.id`. Do not cascade away historical rows when an
item is archived or soft-deleted. Multiple completions on the same date are
allowed because the current app permits them.

`last_completed` is computed as the latest non-voided `completed_on`, using an
index on `(event_id, completed_on DESC)` restricted to active completions. It
is not a second editable value on `events`. Editing “last completed” changes
the corresponding completion row. Backdated entries never move the latest
completion backward; removing the latest record reveals the previous one.

### Supporting tables

| Table | Purpose |
| --- | --- |
| `installation_settings` | Singleton containing storage schema version, default timezone, and migration state. This is not a multi-household account system. |
| `mutations` | Unique client mutation ID, request fingerprint, committed change sequence, and response receipt. Allows safe retries after an ambiguous network failure. |
| `changes` | Ordered, append-only audit entries grouped by mutation. Store entity identity, operation, and before/after images of each affected row, not the whole household. |
| `migration_runs` | Source revision, conversion version, validation totals/checksums, and cutover status. Makes imports repeatable and auditable. |
| `display_access_keys` | Retain current hashed, revocable keys. Keys authorize the limited display API only. |
| `push_subscriptions` | Retain the existing subscriptions, device timezone/time preference, leases, and daily send tracking. |

Keep the existing `household_state` and `household_state_revisions` tables as
read-only legacy recovery sources during transition. Do not convert every old
snapshot into current rows or delete old revisions at cutover.

The change log may use JSON for bounded row images. It is an audit/recovery
record; current items and completion history are still ordinary queryable rows.
Do not record push keys, display tokens, or secret values in that audit log.

## Visibility semantics

Store user intent, then calculate whether an item is visible now. A single
`is_displayed` flag would blur several independent decisions.

| State or preference | Main timeline | DAKboard | Due-today push |
| --- | --- | --- | --- |
| Active and enabled for the destination | Eligible, subject to its date window | Eligible, subject to the display's item limit | Eligible when due today and device alerts are enabled |
| `show_on_dashboard = false` | Hidden | Unaffected | Unaffected |
| `show_on_display = false` | Unaffected | Hidden | Unaffected |
| `notify_due_today = false` | Unaffected | Unaffected | Excluded |
| Archived or deleted | Hidden | Hidden | Excluded |

An authenticated **Manage items** view must still list items hidden from either
screen. Otherwise users could hide an item and have no way to find it again.
Archive and restore remain explicit actions distinct from these checkboxes.

Migration defaults preserve current behavior: all three destination flags are
true; lifecycle state still suppresses archived items. Named celebrations get
their existing dashboard visibility window or the current 60-day default.
Ordinary tasks/events have no new window imposed on them. DAKboard initially
retains its existing 10-per-column limit, sorting, and layout.

Enforce `show_on_display` on the server. The display endpoint must return only
eligible items and a small allowlist of fields required to render them: title,
verb, display category, calculated dates/status, and bounded cycle summaries.
Do not send notes, full completion history, archived items, or hidden items and
rely on the browser to hide them. Existing keys can keep working; their response
becomes narrower.

Per-board visibility, ordering, and themes can later move to `displays` plus an
`event_display_preferences` join table. Multiple individually configured boards
are not needed for the first migration.

## Scheduling and dates

Keep one shared date-calculation module for the dashboard, display, CSV export,
and notification job. Change its input model, not its business rules during the
storage migration.

- Interval task: latest active completion, or `anchor_date`, plus its interval;
  an active snooze overrides that date.
- One-time event: `target_date`, including remaining overdue after that date.
- Annual event: next occurrence of `month` and `day`; retain the current
  February 28 fallback for February 29 in non-leap years.
- Named holiday: calculate using its named rule and requested calendar year.

Do not persist `is_due_today`, `days_remaining`, or a permanently authoritative
`next_due_date`. They depend on the date, schedule, completions, and snooze.
Start by calculating due dates from compact rows and an indexed latest-completion
query. Load detailed history only for a detail view or history export. A
rebuildable next-due-date cache is a later optimization if measured demand
justifies it; the migration must not depend on a midnight cache refresh.

Store calendar dates separately from UTC timestamps. Preserve the existing
device-timezone behavior in the first release, passing a validated timezone/date
context explicitly through calculations. Notification timing remains device
local. The installation timezone supplies a default for unattended administrative
operations. Making every screen follow a single household timezone would be a
separate, visible behavior change, not an implicit migration side effect.

## Writes, reads, and synchronization

Replace household-wide replacement with item-level operations:

| Operation | Proposed API |
| --- | --- |
| Create an item | `POST /api/events` |
| Edit fields, visibility, archive, or snooze | `PATCH /api/events/:id` with expected item version |
| Recoverably delete an item | `DELETE /api/events/:id` with expected item version |
| Record a completion | `POST /api/events/:id/completions` |
| Correct or void a completion | `PATCH` / `DELETE /api/events/:id/completions/:completionId` |
| Read history | Paginated `GET /api/events/:id/completions` |
| Read changes | `GET /api/changes?after=…` for authenticated clients |
| Read the DAKboard | Existing key-protected `/api/display/items`, returning the new limited display payload |

Every write carries a stable mutation ID. Return the previous receipt for an
identical committed retry; reject reuse of the ID with a different request.
Completion operations also check/update the parent item version, so a schedule
edit cannot silently race with completion or snooze changes. A stale write gets
409 with enough current item state to reconcile it. Two different items no
longer conflict merely because they belong to the same household.

Use atomic D1 batches for the mutation receipt, version guard, changed rows,
and audit entries. A failed version precondition must abort the whole batch,
using a tested database guard that raises an error; an UPDATE affecting zero
rows by itself does not make subsequent statements roll back. Confirm accepted
writes from returned rows, not trigger-inclusive affected-row counts.

Continue to serialize pending operations per item, preserve unsaved drafts,
and avoid replacing them during refresh. Use the change sequence as a polling
cursor and export revision, not as the expected version for every item edit.
If a cursor expires after retention cleanup, request a fresh snapshot and
reconcile pending edits. Display clients keep simple 60-second snapshot polling
and the older-browser-compatible timeout helper.

CSV generation and notification queries must read this same authoritative
model. Keep both existing CSV formats and their next-due-date semantics; add
visibility columns to the item export. An export must have a consistent revision
boundary: use one bounded database read batch initially; if exports become
paginated, reconstruct them at a pinned audit sequence rather than mixing rows
from different revisions.

## Recovery

Preserve item-level and full-household recovery. Legacy snapshots remain
viewable; restoring one converts it through the same importer and creates new
row changes. For new revisions, reconstruct the requested state from the
cutover baseline plus the ordered row audit records. Restore is a new mutation,
never an overwrite of the audit log.

Normal item writes are small. A full-household restore may not be: preflight it
against D1 limits and use a controlled write-maintenance window for a chunked,
staged restore if it cannot fit in one atomic batch. Do not expose partly
restored state to readers or notifications. Keep recovery baselines/checkpoints
before pruning any audit entries, and test recovery before defining retention.

## Implementation sequence

1. **Inventory and freeze behavior.** Validate a private production snapshot;
   count items/history and compare current due dates, snoozes, annual dates,
   archive state, CSV rows, and display selections. Inspect contradictory
   `type`/`source`/`annual` combinations and duplicate history identities. Record
   intended mappings and require explicit review of behavior differences.

2. **Add the schema and converter.** Create additive migrations, CHECK
   constraints, foreign keys, and indexes. Build a dry-run, repeatable converter
   preserving item IDs, completion IDs, and original calendar dates. If legacy
   `lastCompleted` has no matching history date, create one completion with
   `source = legacy_last_completed`; do not duplicate a date already represented.
   If history has a later date, keep it authoritative as the current app does.
   Retain valid older history and report invalid or ambiguous rows instead of
   silently dropping them. Map legacy annual ordinary events deliberately,
   checking leap-day behavior before cutover.

3. **Build the row repository and mutation API.** Implement item versioning,
   idempotency, atomic audit writes, archive/delete/restore, and completion
   operations. Use an isolated D1 database for migration, concurrency, and
   recovery tests. Add indexes for active destination filters, active completion
   dates, and ordered audit reads; verify actual query plans.

4. **Move the consumers.** Update the client save queue, add the visibility and
   due-today controls plus Manage items, narrow the display response, and update
   CSV, notifications, and revision recovery. Remove the normal full-household
   save path from the new client. Keep display polling/browser compatibility.

5. **Rehearse and cut over.** Run the converter and old/new behavior comparisons
   on the isolated copy first. For production, take a backup/recovery bookmark,
   pause writes and notification processing, convert the latest frozen revision
   in bounded chunks, and verify all totals and calculated behavior. Switch reads
   and writes to rows only after verification passes, then resume notifications.
   Return a clear reload-required response to obsolete full-household PUTs;
   never accept an old tab overwriting the new model. Refresh the DAKboard to
   load its matching response parser.

6. **Verify and retire compatibility paths.** Test real phone and DAKboard
   reads, visibility, saves, exports, and due-today delivery. Verify that hidden
   items and private fields are absent from the display response. Keep legacy
   tables and migration reports during a defined observation period, then remove
   unused old write code. Decide retention separately from rollout.

Avoid ongoing dual writes to JSON and rows. Before new writes are enabled,
rollback can simply return to the frozen original store. After row-based writes
begin, rollback must preserve them through a tested reverse export under a
write pause, or use a compatible previous application version that still reads
rows. Switching back to the frozen JSON document would lose new changes.

## Acceptance criteria and scope

- Item and completion counts match, with separately reported synthetic legacy
  completions. IDs, notes, archives, snoozes, dates, and old revisions survive.
- Old and new due dates match for the same timezone/date context, including
  leap day, month ends, annual rollover, and backdated completions.
- Independent item edits succeed concurrently. Same-item conflicts, repeated
  requests, and interrupted responses do not overwrite or duplicate data.
- A failure anywhere in a mutation leaves no partial completion, audit entry,
  version increment, or receipt.
- Dashboard hiding, display hiding, and notification opt-out are independent.
  Hidden items remain manageable. Display payloads enforce visibility/privacy.
- History loads and exports are bounded/paginated as appropriate; a normal edit
  never transfers or snapshots the entire household or its completion history.
- Migration, legacy/new revision restore, and post-cutover rollback are tested.
- The DAKboard loads and refreshes with `AbortSignal.timeout` unavailable.

Estimated effort: roughly 6–10 focused development days for the complete
transition, including UI/API changes, recovery, migration rehearsal, and device
verification. This is a planning estimate, not a commitment; legacy data anomalies
and full-household restore sizing are the largest uncertainties.

Defer multi-household tenancy, multiple independent display configurations,
unlimited recurrence rules, general calendar integrations, materialized future
occurrences, and a different database engine. They are not prerequisites for
making this application's data model sustainable.

## Cloudflare implementation references

- [D1 database methods and atomic batches](https://developers.cloudflare.com/d1/worker-api/d1-database/)
- [D1 foreign-key behavior](https://developers.cloudflare.com/d1/sql-api/foreign-keys/)
- [D1 limits to check for imports, exports, and restores](https://developers.cloudflare.com/d1/platform/limits/)
