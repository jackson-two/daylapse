# Using Daylapse

## Data safety

The API never substitutes demo data when a read fails. Items live in `events`;
completion dates live in `completions`. Normal writes carry an item version and a
stable mutation ID. D1 atomically validates the version, updates affected rows,
and records their audit history. Independent items can save concurrently; a
stale edit to the same item gets HTTP 409.

The browser serializes saves and keeps unconfirmed edits in memory. **Retry
sync** reuses mutation IDs after an uncertain response, preventing duplicate
completions. Conflicting edits require a choice. Keep the tab open until it says
**Synced**; pending edits are not an offline backup.

Saved data refreshes every minute and when returning to the tab. Refresh does
not replace pending edits or an open draft. Initial reads contain at most six
recent completions per item; full history loads in pages of 100 from the detail
panel. Next due dates use the latest active completion, including older history
that was not sent to the browser.

**Manage items**, in the Daylapse menu, lists hidden, archived, and deleted items. Each item independently
controls dashboard visibility, DAKboard visibility, and inclusion in due-today
notifications. Archiving or deleting suppresses all three destinations. Deletion
is recoverable. The optional dashboard window limits how far ahead it appears;
celebrations default to 60 days.

The old household JSON and its revisions are retained as read-only recovery
copies. Old `/api/items` requests return HTTP 410 with a reload instruction;
database triggers also block obsolete Workers from writing the frozen store.
Item recovery and full-household recovery create new audited changes, preserving
previous history. See the [row-storage operations guide](row-storage-operations.md)
for recovery endpoints, staged restores, and rollback precautions.

Display keys remain hashed and revocable. They grant access only to the limited
read-only display response. Keep private display URLs out of Git.

## CSV downloads

Open the Daylapse menu and choose **Download items CSV** or **Download history
CSV** once changes are synced. Each download reads the latest saved household
rows in one consistent read batch and includes archived and soft-deleted items.
The filename records its date and revision.
The items file includes next due dates calculated using the same rules as the
dashboard, with the reporting date and device timezone recorded in the file.
The items CSV includes all three visibility/notification flags and deletion state.
The history file contains one row per active completion, linked by item ID.

Exports use UTF-8 CSV with spreadsheet-safe text. Voided completions and older
audit revisions require the recovery APIs or a database backup. Device-local
preferences are not included in a D1 backup; notification subscription settings
are stored in D1, with a preference copy in browser storage. Downloads are
available in the family app, not the DAKboard display.

## Due-today notifications

The Notifications screen connects each browser/device to Web Push. A Cloudflare
Cron Trigger runs every five minutes and sends one summary per subscribed device
per local day, at or after its selected delivery time. It includes saved,
unarchived, undeleted items with **Include in due-today notifications** enabled
whose calculated due date is today: recurring tasks, fixed
events, birthdays, anniversaries, and holidays. No due items means no message.
Overdue reminders and advance reminders are not implemented.

The device's IANA timezone is stored with the subscription and updated when the
Notifications screen is opened in a different timezone. The default delivery
time is 08:00. If an item becomes due after today's summary was already sent, it
does not trigger a second daily summary. Delivery depends on the push service,
connectivity, and device notification/Focus settings.

Enable notifications with the optional setup steps in the [deployment runbook](deployment.md#optional-notifications). Keep the installation's keys across upgrades.

On iPhone/iPad, add Daylapse to the Home Screen and open that installed app, then
choose **Enable notifications**. **Send a test** exercises the server-to-device
push path. **Save preferences** persists the due-today toggle and delivery time;
**Disconnect this device** removes its subscription. Test sends are limited to
one per minute per device. The installation allows up to 100 registered devices.

Daily delivery uses an atomic D1 lease to prevent overlapping cron runs from
sending the same summary. Successful sends record the local date. Transient
failures retry on a later run; expired subscriptions are removed. Web Push cannot
guarantee exactly-once delivery across network failures, so messages also carry
a stable daily notification tag to replace duplicate visible notifications.
Subscription endpoints and encryption keys stay in D1 and are not logged.

### Troubleshooting notifications

**Connected** means the browser subscription is registered; it does not prove a
notification was delivered. A successful **Send a test** means the push service
accepted the request. Check the device's notification/Focus settings if nothing
appears. Tests have a separate one-minute cooldown and do not consume the daily
scheduled summary. To test scheduling, use a saved item actually due today, enable
its notification flag, save a future delivery time, and allow the next five-minute
cron check after that time. A device that already received today's summary will
not receive another merely because the delivery time changed.

For a server failure, inspect the test endpoint response and Worker logs without
logging subscription endpoints, keys, or authentication headers. The previous
"Connected but no test arrives" failure was caused by `redirect: "error"` being
rejected in the deployed Workers runtime before sending. The sender now uses
`redirect: "manual"`; its workerd regression test ensures redirects are not
followed. A new deployment does not require reconnecting an existing subscription.

## Authentication

The intended production setup uses two hostnames:

- `daylapse.example.com` is protected by Cloudflare Access. Approved family
  email addresses receive a one-time code from Cloudflare; Daylapse does not
  store passwords. The approved email list is managed in Cloudflare Access, outside this repository.
- `display.daylapse.example.com/display?display_key=…` is a dedicated
  read-only display URL. It does not show an interactive login screen, which
  keeps it compatible with the Raspberry Pi display.

## DAKboard display: requirements and limitations

DAKboard loads Daylapse as a web page at `/display?display_key=…` on the dedicated
display hostname. It has its own display layout, but shares the household data
and date calculations with the main app. It is not a native DAKboard integration.

### Browser compatibility

The display requires JavaScript, browser support for modules, `fetch`, and
`AbortController`, plus network access to the display hostname. Compatibility
depends on the browser installed on the display device, not just whether the
same URL works on a phone or laptop.

Some older Raspberry Pi browser APIs have compatibility fallbacks, including
`Object.hasOwn`, `structuredClone`, and `crypto.randomUUID`. Data loading uses
`AbortController` with a timer, so it does **not** require `AbortSignal.timeout`.
The latter previously caused the display to report a data-loading error before
sending any request.

These fallbacks do not guarantee support for every DAKboard OS or browser
version. No exact minimum browser version has been validated on physical
devices. Regression tests cover loading and refreshing without
`AbortSignal.timeout`; they do not replace testing on the actual display.

### Display behavior

- **Read-only:** no editing, completion entry, snoozing, CSV downloads, revision
  recovery, or notification setup. Use the family app for these actions.
- **Limited item list:** up to 10 unarchived recurring items in **Household** and
  10 unarchived fixed dates in **Events**, ordered by calculated due date. There
  is no pagination or automatic rotation through additional items. The Events
  column does not use the family dashboard's celebration visibility window.
- **Layout:** dark-purple theme, with two columns above 760 CSS pixels and one
  column at narrower widths. Scrollbars are hidden. Content can extend below the
  visible area; there is no automatic scrolling or scaling to fit every item.
- **Refresh:** saved data is checked every 60 seconds and on focus, visibility,
  or connectivity changes. This is polling, not an instant live feed. Suspended
  browsers may delay refreshes. Date calculations use the display device's clock
  and timezone, so both must be correct.
- **Connectivity:** after a successful load, a failed refresh keeps the last
  loaded items on screen and shows a warning while retrying. There is no durable
  offline copy; a reload or restart needs a successful server read.
- **Updates:** data refreshes do not replace the running application code.
  Reload the DAKboard page after a deployment to pick up browser fixes.

### Access and troubleshooting

Use HTTPS and the complete private display URL, including `display_key`. The
dedicated hostname must serve the display without an interactive Cloudflare
Access login; keep the family hostname protected. The hostnames come from the private installation settings; no source edits are needed.

The server returns only active items with **Show on DAKboard** enabled, capped
at ten per column. Notes, completion history, archived/deleted items, and items
hidden from the display are excluded from the response. Titles and scheduling
fields are still accessible to anyone holding the display URL. Keep it private
and revoke its key if exposed.

For a loading or data error, first reload the page, then check connectivity and
that the configured URL still contains an active display key. The display API
returns HTTP 401 for a missing, invalid, or revoked key. If it still fails, check
the device browser and Worker logs; an unsupported browser API can fail before
any server request appears. The startup message **“Daylapse could not start in
this browser”** is a watchdog warning, not a definitive browser diagnosis: a slow
startup can also trigger it. Do not reset household data to troubleshoot a
display-loading problem.

## Holiday schedules

The Holidays list shows days until each holiday (or “Today”), days since its
previous occurrence, and the next date. Custom holidays can use a month/day or an
Nth weekday of a month, with a live next-date preview in the create/edit form.

“After the first full week” starts counting matching weekdays after the first
complete week entirely within that month. Weeks default to Sunday–Saturday;
Monday–Sunday is also selectable. For example, the first Sunday after the first
full Sunday–Saturday week of September 2026 is September 13.
If the selected occurrence does not exist in a year, that year is skipped; the
date never spills into another month. Fifth occurrences are available without
the full-week option; up to fourth occurrences are available with it where they can fit in the month.

These rules are shared by the dashboard, DAKboard, CSV exports, and due-today
notifications. CSV weekday numbers use Sunday = 0 through Saturday = 6, and
`week_starts_on` uses Sunday = 0 or Monday = 1. Apply migration `0007` before
deploying the application update. It preserves events, completions, and revision
history while extending the schedule constraints. Existing installations should
apply migrations normally; do not rerun the legacy row import/cutover.

## iPhone and iPad behavior

The installed Home Screen app uses the same web UI as the browser. Touch-device
form controls use at least 16px text to avoid small-field focus zoom. Opening Add
or Edit does not automatically focus a field on any device. Panel sizing follows
the visible viewport when the keyboard appears; it no longer forces a delayed
second scroll. Screen navigation on touch devices avoids smooth scrolling, and
closing the panel dismisses the focused form control. Button taps suppress
accidental double-tap zoom while pinch-to-zoom remains available.

These changes target unwanted zoom, not the device's accessibility magnification.
The app does not lock orientation; use the phone's Portrait Orientation Lock if
needed. Physical iPhone verification is still needed for the latest zoom fix.
If a menu still selects a field immediately, fully close and reopen Daylapse to
load the deployed JavaScript before troubleshooting further. There is no need to
delete/reinstall the app or reconnect notifications for an ordinary deployment.

The service worker handles push and notification clicks. It does not cache pages
or provide offline editing. A saved Home Screen icon is not an offline data copy.
