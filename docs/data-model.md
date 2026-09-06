# Current data model

Daylapse stores one household per Cloudflare D1 database. The authoritative
schema is [db/schema.ts](../db/schema.ts), applied through the SQL in
[drizzle](../drizzle). Request/record validation lives in
[row-schema.ts](../lib/row-schema.ts). JSON field names are camelCase; database
columns are snake_case. This describes the schema through migration 0007.

## Tables

| Table | Responsibility |
| --- | --- |
| `events` | One tracked definition per row; descriptive fields, schedule, visibility, lifecycle, and item version. Future occurrences are calculated, not stored as extra rows. |
| `completions` | One completion per row, with composite key `(event_id, id)`. Correction and voiding retain identity; active records determine the latest completion. |
| `mutations` | Stable request IDs, expected versions, fingerprints, and completed receipts for idempotent retries. |
| `changes` | Immutable before/after event and completion images, grouped by mutation or initial import. The sequence is an audit cursor, not an event version. |
| `installation_settings` | Singleton timezone, row-storage activation state, and original import state. `schema_version` is not the migration counter; consult `d1_migrations` for applied SQL. |
| `migration_runs`, `migration_chunks` | Resumable legacy import manifests, checksums, and baseline boundaries. Not used for everyday updates. |
| `push_subscriptions` | Per-device endpoint, encryption keys, VAPID identity, timezone, delivery preferences, leases, daily deduplication, and test cooldown. Treat as private data. |
| `display_access_keys` | Hashed, revocable credentials for the read-only DAKboard response. Plain tokens are not stored. |
| `household_state`, `household_state_revisions` | Frozen legacy JSON and recovery history. Never the current writable source. |

## Event schedules

All dates are calendar dates. Record/audit timestamps are UTC instants. Schedule
validation rejects conflicting fields in both the API and database.

| `schedule_type` | Required schedule fields | Date behavior |
| --- | --- | --- |
| `interval` | `kind=task`, `interval_value`, `interval_unit`, `anchor_date` | Latest active completion plus interval, or anchor plus interval when no completion exists. `snoozed_until` overrides the result. Month/year addition clamps to the month's last day. |
| `fixed_date` | `kind=event`, `target_date` | One date, which remains overdue after it passes. |
| `annual_date` | `month`, `day` | Next annual occurrence, including today. February 29 celebrations fall on February 28 in non-leap years. Imported ordinary annual events may retain `annual_anchor_date` and their original rollover behavior. |
| `holiday_rule` | `kind=holiday`, `holiday_key` | A supported built-in holiday calculated by the shared date library. |
| `weekday_rule` | `kind=holiday`, `month`, `weekday`, `occurrence`, `after_full_week`, `week_starts_on` | Nth weekday within a selected month, optionally counted after its first complete week. |

For `weekday_rule`, weekdays are Sunday=0 through Saturday=6, month is 1–12,
and occurrence is 1–5. With `after_full_week=1`, the first complete week entirely
inside the month must finish before counting matching weekdays. `week_starts_on`
is Sunday=0 or Monday=1. Impossible combinations are rejected; missing occurrences
in a particular year skip that year rather than spilling into another month.

Example: first Sunday after the first full Sunday–Saturday week of September:

```json
{
  "kind": "holiday",
  "scheduleType": "weekday_rule",
  "month": 9,
  "weekday": 0,
  "occurrence": 1,
  "afterFullWeek": true,
  "weekStartsOn": 0
}
```

This schedule occurs on September 13 in 2026. `day`, `holidayKey`, target/anchor
dates, and interval fields must be null for this schedule. Other schedule types
keep `weekday` and `occurrence` null, `afterFullWeek=false`, and `weekStartsOn=0`.
The UI adapter represents this as a `weekdayRule` object on `TrackedItem`;
that object is an adapter format, not another JSON household storage column.

## Visibility and lifecycle

`show_on_dashboard`, `show_on_display`, and `notify_due_today` are independent.
`archived_at` or `deleted_at` suppresses all three destinations. A nullable
`dashboard_window_days` controls the upcoming dashboard window; it does not
limit DAKboard or notification eligibility. `highlight_within_days` controls
visual urgency, not advance push notifications. Neither visibility nor a date
calculation changes the stored schedule.

Creation dates and imported order are preserved separately in `created_on` and
`import_position`. Unknown historical creation timestamps remain null.
Every event mutation, including a completion change, increments its version.
Recovery writes new versions and audit rows; it never edits old audit images.

## Shared consumers

[item-dates.ts](../lib/item-dates.ts) supplies next dates to the dashboard,
holiday lists, DAKboard, CSV exports, and due-today notifications. Row reads use
[row-consumers.ts](../lib/row-consumers.ts); the display response strips notes and
history. CSV exports are reports, not full backups: they omit audit revisions,
voided completions, subscriptions, and access keys.

See [operations](row-storage-operations.md) for API contracts, limits, migration,
and recovery. Never deploy a pre-0007 Worker against new weekday-rule items;
its validators cannot interpret that schedule type.
