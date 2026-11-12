# Household purchasing and shopping

Shopping is a separate section reached from the dashboard. It shares the household's
Cloudflare Access membership. All admitted people can manage the shared catalog,
retailers, list and history. No real retailer prices are bundled.

## Everyday use

1. Open **Shopping → Catalog → New item**. A catalog item is a reusable need such
   as AA Batteries, not a particular retailer's package.
2. Open **Products & retailers**, add branded products and package sizes, then
   associate them with retailers. Create retailers and optional branches under
   **Retailers**. Preference order uses lower numbers first; offering preference
   takes precedence over the product's general preference.
3. **Add to list** reuses the catalog and its relationships. Adding twice leaves
   one active household entry. Completing or removing it does not delete it.
4. Choose **All Stores** or a retailer and optional branch. Horizontal cards show
   retailer color, observed price, package size, planned quantity and price age.
   Unknown, expired and unverified observations are explicitly labeled.
5. Tap a retailer card to expand it. Choose a product/package and adjust packages
   with +/−, including zero. Quantities at different retailers are alternatives:
   changing Fry's to three packages does not change Costco's one package.
6. **Purchased** opens confirmation of actual quantity, paid price, branch and
   time. Blank prices mean unknown. A discounted total can be recorded with the
   package price blank. **Still need more** keeps the item active; otherwise a
   purchase completes it. **Out of Stock** and **Skipped** record distinct outcomes
   and leave other retailers available. They never complete the item.

Only one retailer card expands at a time. Tapping it again collapses it; another
card switches the expansion. An expanded panel that has been visible collapses
when it moves entirely outside the viewport. List notes, priority and ordering
are separate from permanent catalog notes.

## Management and history

Catalog, products, retailers, branches and offerings can be edited, archived and
restored. Archived parents hide their options from the active list. Restore the
parent before using its children. Product/item and offering/product/store/branch
associations are stable: archive the old association and create a new one to move
it. Duplicate items can be deliberately merged. The source remains an archived
alias; products and active plans move to the surviving item, while original
purchase snapshots remain intact. A merge cannot be undone with a single button.

**History & prices** filters by item, product, retailer, branch, date and trip.
Results are paginated, newest observation or outcome first. History offers
**Add item again**, **Correct**, and **Undo / restore list**. Corrections append a
replacement and mark the prior outcome reversed; they do not erase it. Turn on
**Include reversed outcomes** to inspect the correction trail. Spending and
package totals always exclude reversed outcomes. Re-adding a trip collects its
matching items into the same active list without duplicates.

Spending uses actual paid prices and separates currencies. Unknown-price purchases
are counted separately. Price summaries show average, range, first-to-latest
change and comparable unit prices, grouped by offering, branch, currency and
package size. Mass and volume conversions are separate; can counts are not
converted to fluid ounces without volume metadata. Observations retain sources,
conditions, verification status and expiry. A new price never changes an old
purchase. Changing package size makes old observations historical, not a price
for the new package. There is no retailer crawler or automatic scheduled research.

## Saved changes and conflicts

The UI saves the exact request locally before sending it and blocks additional
writes until that request is confirmed. A timeout, sign-in page or failed reload
keeps it pending. **Retry saved change** reuses its durable mutation ID, preventing
an uncertain purchase from being duplicated. A failed read retains the last
loaded collection. Data refreshes every 30 seconds and on focus/reconnection.

A conflict shows the latest server record and retains the pending draft. Download
**Save pending draft** if useful, compare the values, then deliberately discard
the local request and re-enter a reconciled change using the refreshed record.
Discarding a request does not undo a write that already reached the server.
Do not clear browser storage while an unconfirmed change is valuable. This is
pending-write recovery, not a full offline editor or cross-device draft backup.

## Interfaces and limits

The responsive web app is this public repository's iPhone/Home Screen experience.
There is no native iOS/CloudKit/TestFlight project here. The read-only DAKboard
continues to show tasks and dates, without purchasing data or editing controls.
Trusted agents use the [purchasing MCP](purchasing-mcp.md) and the same domain rules.

Interactive snapshots are bounded at 500 records per catalog/entity collection,
5,000 plans, 1,000 latest price/branch combinations and 5,000 latest outcomes.
Exceeding a bound produces an explicit error rather than a truncated list. History,
price history and audit exports use pages of at most 100. Summary groups are
bounded at 500; narrow filters if needed. These are household-scale limits, not
an enterprise inventory system. Product images/logos are stored as optional HTTPS
references; the compact list emphasizes text and retailer colors.

## Implementation and preservation

`db/purchasing.ts` and additive migrations 0008/0009 define separate normalized
shopping tables. `lib/purchasing/schema.ts` owns validation and unit conversion;
`service.ts` owns all domain operations. UI, authenticated JSON routes and MCP use
that service. `app/shopping/` contains the list, management, history, forms and
pending-request recovery. The existing dashboard only gains navigation.

| Tables | Meaning |
| --- | --- |
| shopping_items / products | Persistent generic catalog and branded packages |
| shopping_stores / locations / offerings | Chains, branches and product associations |
| shopping_entries / plans | Shared list lifecycle and independent offering quantities |
| shopping_outcomes | Purchases, unavailable and skipped observations with historical snapshots |
| shopping_prices | Append-only attributable price observations and package snapshots |
| shopping_receipts / audit / state | Durable retries, before/after audit, transaction revision |
| shopping_rate_limits | Bounded request counter per authenticated actor |

Money is integer minor currency units, with an explicit currency. Record IDs are
stable; versions detect stale edits. Each mutation reads a purchasing revision,
then atomically writes a guarded receipt, related records and audit entries in a
D1 batch. The revision guard serializes household writes; unrelated simultaneous
edits can replan, while stale entity versions return conflicts. A repeated ID with
another command or actor is rejected. Receipts and audit are retained. Price rows
are immutable; outcome triggers permit reversal metadata but reject payload
rewrites/deletion. Foreign keys preserve references. Latest-observation indexes
avoid repeated full-history sorting.

Task/event/completion tables, their receipts and recovery history, notifications,
and display keys are not changed. Existing clients remain compatible. Shopping
requires the existing row-storage installation to be ready. It does not perform
legacy cutover or reinitialize a populated database.

## Verification and release

Run the standard checks in CONTRIBUTING.md. Purchasing tests exercise independent
quantities, duplicate/racing purchases, audit rollback, immutable snapshots,
corrections, archive/restore, merges, chronological paging, price summaries,
full MCP operations, signed-token validation, permissions, request bounds and
populated upgrade preservation. Fixtures contain synthetic data only.

Mobile browser checks do not prove physical iPhone keyboard/Home Screen behavior.
Live Cloudflare Access service-token configuration and third-party connector
compatibility require owner-side validation after setup. No live database or
installed app is changed by these tests.

For release, follow [deployment](deployment.md). Review the exact selected
Worker/database and privately retain a current D1 export. With authorization,
apply pending migrations using `npm run setup -- migrate --remote`, then
`npm run deploy` (which rebuilds). Do not rerun initialization or legacy cutover
for this upgrade. An older Worker can coexist with the additive tables; preserve
those tables and their records if rolling back application code. Database restore
is a separate reviewed recovery action, never a routine rollback step. Verify
household sign-in, anonymous denial, enabled display/notifications, and shopping
reads after publishing. Use an isolated installation for write smoke tests.
