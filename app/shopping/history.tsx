"use client";
import { useEffect, useState } from "react";
import type { ShopRecord } from "@/lib/purchasing/schema";
import { find, money, unitMoney, n, request, s, type Snapshot } from "./model";
type Page = {
  records: ShopRecord[];
  nextCursor: string | null;
  revision: number;
};
type Filters = {
  itemId: string;
  productId: string;
  storeId: string;
  locationId: string;
  tripId: string;
  from: string;
  to: string;
};
export function History({
  snapshot,
  initialItem = "",
  correct,
  reverse,
  add,
  disabled,
}: {
  snapshot: Snapshot;
  initialItem?: string;
  correct: (r: ShopRecord) => void;
  reverse: (r: ShopRecord) => void;
  add: (itemId: string) => Promise<boolean>;
  disabled: boolean;
}) {
  const [kind, setKind] = useState<"history" | "prices">("history"),
    [filters, setFilters] = useState<Filters>({
      itemId: initialItem,
      productId: "",
      storeId: "",
      locationId: "",
      tripId: "",
      from: "",
      to: "",
    });
  const [records, setRecords] = useState<ShopRecord[]>([]),
    [summary, setSummary] = useState<Record<string, unknown> | null>(null),
    [cursor, setCursor] = useState<string | null>(null),
    [revision, setRevision] = useState<number>();
  const [retryCount, setRetryCount] = useState(0);
  const [error, setError] = useState(""),
    [loading, setLoading] = useState(false),
    [includeReversed, setIncludeReversed] = useState(false);
  const query = {
    view: kind,
    includeReversed,
    ...Object.fromEntries(
      Object.entries(filters)
        .filter(([, v]) => v)
        .map(([key, value]) => [
          key,
          key === "from"
            ? new Date(`${value}T00:00:00`).toISOString()
            : key === "to"
              ? new Date(`${value}T23:59:59.999`).toISOString()
              : value,
        ]),
    ),
  };
  const signature = JSON.stringify(query);
  useEffect(() => {
    let alive = true;
    Promise.resolve().then(async () => {
      if (!alive) return;
      setLoading(true);
      setError("");
      try {
        const body = JSON.parse(signature);
        const page = await request<Page>("/query", body);
        const stats = await request("/query", {
          ...body,
          view: body.view === "prices" ? "priceSummary" : "summary",
          revision: page.revision,
        });
        if (alive) {
          setRecords(page.records);
          setCursor(page.nextCursor);
          setRevision(page.revision);
          setSummary(stats);
        }
      } catch (e) {
        if (alive)
          setError(e instanceof Error ? e.message : "History could not load.");
      } finally {
        if (alive) setLoading(false);
      }
    });
    return () => {
      alive = false;
    };
  }, [signature, snapshot.revision, retryCount]);
  const more = async () => {
    setLoading(true);
    try {
      const page = await request<Page>("/query", {
        ...query,
        after: cursor,
        revision,
      });
      setRecords((r) => [...r, ...page.records]);
      setCursor(page.nextCursor);
    } catch (e) {
      setError(e instanceof Error ? e.message : "History could not load.");
    } finally {
      setLoading(false);
    }
  };
  const replay = async () => {
    setLoading(true);
    setError("");
    try {
      let after = "",
        pinned: number | undefined;
      const ids = new Set<string>();
      do {
        const page = await request<Page>("/query", {
          ...query,
          view: "history",
          tripId: filters.tripId,
          after,
          revision: pinned,
        });
        pinned = page.revision;
        for (const r of page.records) ids.add(String(r.itemId));
        after = page.nextCursor ?? "";
      } while (after);
      for (const id of ids)
        if (!(await add(id)))
          throw new Error(
            "Stopped after an unconfirmed addition. Retry the saved change; earlier additions are retained.",
          );
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not add this trip.");
    } finally {
      setLoading(false);
    }
  };
  const totals = summary?.totals as Record<string, unknown>[] | undefined;
  const priceStats = summary?.records as Record<string, unknown>[] | undefined;
  return (
    <section aria-label="Purchasing history">
      <div className="shopping-section-heading">
        <h2>History & prices</h2>
        <select
          aria-label="History type"
          value={kind}
          onChange={(e) => setKind(e.target.value as typeof kind)}
        >
          <option value="history">Purchasing outcomes</option>
          <option value="prices">Price observations</option>
        </select>
      </div>
      <div className="shopping-filters">
        {(
          [
            ["itemId", "Item", snapshot.items],
            ["productId", "Product", snapshot.products],
            ["storeId", "Retailer", snapshot.stores],
            ["locationId", "Location", snapshot.locations],
          ] as const
        ).map(([key, label, rows]) => (
          <label key={key}>
            {label}
            <select
              value={filters[key]}
              onChange={(e) =>
                setFilters({ ...filters, [key]: e.target.value })
              }
            >
              <option value="">All {label.toLowerCase()}s</option>
              {rows.map((r) => (
                <option key={r.id} value={r.id}>
                  {s(r, "name")}
                </option>
              ))}
            </select>
          </label>
        ))}
        <label>
          From
          <input
            type="date"
            value={filters.from}
            onChange={(e) => setFilters({ ...filters, from: e.target.value })}
          />
        </label>
        <label>
          Through
          <input
            type="date"
            value={filters.to}
            onChange={(e) => setFilters({ ...filters, to: e.target.value })}
          />
        </label>
        <label>
          Trip identifier
          <input
            value={filters.tripId}
            onChange={(e) => setFilters({ ...filters, tripId: e.target.value })}
          />
        </label>
      </div>
      {kind === "history" && (
        <label className="shopping-check">
          <input
            type="checkbox"
            checked={includeReversed}
            onChange={(e) => setIncludeReversed(e.target.checked)}
          />{" "}
          Include reversed outcomes
        </label>
      )}
      {error && (
        <p role="alert">
          {error}{" "}
          <button onClick={() => setRetryCount((n) => n + 1)}>Retry</button>
        </p>
      )}
      {loading && <p role="status">Loading history…</p>}
      {totals && kind === "history" && (
        <div className="shopping-summary">
          {totals.map((r) => (
            <p key={s(r, "currency")}>
              <strong>{money(r.spending, s(r, "currency"))}</strong> recorded
              spending · {n(r, "packages")} packages ·{" "}
              {n(r, "unknownPricePurchases")} purchases with unknown prices ·{" "}
              {n(r, "outOfStock")} out of stock · {n(r, "skipped")} skipped
            </p>
          ))}
          {summary?.latestPurchase ? (
            <p>
              Last purchase:{" "}
              {new Date(
                s(summary.latestPurchase as ShopRecord, "occurredAt"),
              ).toLocaleString()}{" "}
              · {historyPlace(summary.latestPurchase as ShopRecord)}
            </p>
          ) : (
            <p>No purchases match these filters.</p>
          )}
        </div>
      )}
      {kind === "prices" && priceStats && (
        <div className="shopping-summary">
          {priceStats.map((r, i) => (
            <p key={i}>
              {s(
                find(
                  snapshot.stores,
                  find(snapshot.offerings, r.offeringId)?.storeId,
                ),
                "name",
              )}{" "}
              · {n(r, "packageQuantity")} {s(r, "packageUnit")} · average{" "}
              {money(r.averagePackagePrice, s(r, "currency"))} · range{" "}
              {money(r.lowestPackagePrice, s(r, "currency"))}–
              {money(r.highestPackagePrice, s(r, "currency"))} · change{" "}
              {money(r.priceChange, s(r, "currency"))} (
              {new Date(s(r, "firstObservedAt")).toLocaleDateString()}–
              {new Date(s(r, "lastObservedAt")).toLocaleDateString()}) ·{" "}
              {n(r, "observations")} observations
              {r.averageUnitPrice
                ? ` · average ${unitMoney(r.averageUnitPrice as { amount: number; unit: string }, s(r, "currency"))}`
                : ""}
            </p>
          ))}
          <p>
            Compare only matching currencies and units. Observations may include
            promotions or unverified research.
          </p>
        </div>
      )}
      {filters.tripId && kind === "history" && (
        <button disabled={disabled || loading} onClick={replay}>
          Add items from this trip again
        </button>
      )}
      {!loading && !records.length && !error && (
        <p className="shopping-muted">No records match these filters.</p>
      )}
      <div className="shopping-history">
        {records.map((r) => {
          const snapshotData = JSON.parse(s(r, "snapshotJson") || "{}");
          return (
            <article key={r.id}>
              <div>
                <strong>{s(snapshotData.item, "name")}</strong>
                <span>
                  {s(snapshotData.store, "name")}{" "}
                  {snapshotData.location
                    ? `· ${s(snapshotData.location, "name")}`
                    : ""}
                </span>
                <span>
                  {s(snapshotData.product, "name")} ·{" "}
                  {n(snapshotData.product, "packageQuantity")}{" "}
                  {s(snapshotData.product, "packageUnit")}
                </span>
              </div>
              {kind === "history" ? (
                <>
                  <p>
                    {s(r, "kind").replaceAll("_", " ")}
                    {r.reversedAt ? " · Reversed" : ""} ·{" "}
                    {new Date(s(r, "occurredAt")).toLocaleString()}
                    {r.kind === "purchased"
                      ? ` · ${n(r, "quantity")} packages · ${money(r.totalPrice, s(r, "currency"))} total`
                      : ""}
                  </p>
                  <p>{s(r, "notes")}</p>
                  {r.correctionReason ? (
                    <p>Correction: {s(r, "correctionReason")}</p>
                  ) : null}
                  <div className="shopping-actions">
                    <button
                      disabled={disabled}
                      onClick={() => add(s(r, "itemId"))}
                    >
                      Add item again
                    </button>
                    {!r.reversedAt && (
                      <>
                        <button disabled={disabled} onClick={() => correct(r)}>
                          Correct
                        </button>
                        <button disabled={disabled} onClick={() => reverse(r)}>
                          Undo / restore list
                        </button>
                      </>
                    )}
                  </div>
                </>
              ) : (
                <>
                  <p>
                    {money(r.amount, s(r, "currency"))} / package ·{" "}
                    {new Date(s(r, "observedAt")).toLocaleString()} ·{" "}
                    {r.verified ? "Verified by recorder" : "Needs verification"}
                  </p>
                  <p>
                    {s(r, "source")} · {s(r, "conditions")}{" "}
                    {r.expiresAt
                      ? `· Expires ${new Date(s(r, "expiresAt")).toLocaleString()}`
                      : ""}
                  </p>
                  {r.sourceUrl && (
                    <a
                      href={s(r, "sourceUrl")}
                      target="_blank"
                      rel="noreferrer"
                    >
                      Source
                    </a>
                  )}
                  <p>
                    {s(r, "reference")} {s(r, "notes")}
                  </p>
                </>
              )}
            </article>
          );
        })}
      </div>
      {cursor && (
        <button disabled={loading} onClick={more}>
          Load more
        </button>
      )}
    </section>
  );
}
function historyPlace(record: ShopRecord) {
  const snapshot = JSON.parse(s(record, "snapshotJson") || "{}");
  return [s(snapshot.store, "name"), s(snapshot.location, "name")]
    .filter(Boolean)
    .join(" · ");
}
