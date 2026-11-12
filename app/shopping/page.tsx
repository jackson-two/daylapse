"use client";
import { useEffect, useRef, useState, type CSSProperties } from "react";
import Link from "next/link";
import {
  priceStatus,
  unitPrice,
  type EntityName,
  type ShopRecord,
} from "@/lib/purchasing/schema";
import { EntityEditor, Modal, PriceEditor, PurchaseEditor } from "./editors";
import { History } from "./history";
import {
  active,
  find,
  money,
  unitMoney,
  n,
  offeringLabel,
  s,
  shownPrice,
  usePurchasing,
  type Snapshot,
} from "./model";
import "./shopping.css";
type Edit = {
  entity: EntityName;
  record?: ShopRecord;
  initial?: Record<string, unknown>;
};
type Purchase = { entry: ShopRecord; offering: ShopRecord; prior?: ShopRecord };
export default function Shopping() {
  const model = usePurchasing(),
    { snapshot, busy, pending, act } = model;
  const [tab, setTab] = useState("list"),
    [search, setSearch] = useState(""),
    [storeId, setStore] = useState(""),
    [locationId, setLocation] = useState("");
  const [expanded, setExpanded] = useState<{
      entryId: string;
      storeId: string;
      offeringId: string;
    } | null>(null),
    [edit, setEdit] = useState<Edit | null>(null),
    [selectedItem, setSelectedItem] = useState<string | null>(null);
  const [listEdit, setListEdit] = useState<ShopRecord | null>(null);
  const [price, setPrice] = useState<ShopRecord | null>(null),
    [purchase, setPurchase] = useState<Purchase | null>(null),
    [undo, setUndo] = useState<ShopRecord | null>(null),
    [merge, setMerge] = useState<ShopRecord | null>(null),
    [historyItem, setHistoryItem] = useState("");
  const blocked = busy || !!pending;
  useEffect(() => {
    const theme = localStorage.getItem("daylapse.theme");
    if (
      theme &&
      [
        "light",
        "dark",
        "forest",
        "clay",
        "purple",
        "dark-purple",
        "edgy",
      ].includes(theme)
    )
      document.documentElement.dataset.theme = theme;
  }, []);
  const save = async (command: Record<string, unknown>) => {
    const ok = await act(command);
    if (!ok)
      throw new Error(
        "Save not confirmed. Close the editor and use Retry saved change. Your exact request is preserved on this device.",
      );
    return ok;
  };
  const add = async (id: string) => {
    const item = find(snapshot!.items, id);
    const resolved = s(item, "mergedIntoId") || id;
    const entry = snapshot!.entries
      .filter((r) => r.itemId === resolved)
      .sort(
        (a, b) =>
          Number(b.status === "active") - Number(a.status === "active") ||
          b.createdAt.localeCompare(a.createdAt),
      )[0];
    return act({
      operation: "list",
      itemId: resolved,
      action: "add",
      expectedVersion: entry?.version ?? 0,
    });
  };
  const archive = async (entity: EntityName, row: ShopRecord) => {
    if (
      !row.archivedAt &&
      !window.confirm(
        `Archive ${s(row, "name") || entity.slice(0, -1)}? Its history will be kept. Restore it later from this screen.`,
      )
    )
      return;
    await act({
      operation: "archive",
      entity,
      id: row.id,
      expectedVersion: row.version,
      archived: !row.archivedAt,
    });
  };
  const changeStore = (id: string) => {
    setStore(id);
    setLocation(
      snapshot?.locations.find(
        (l) => l.storeId === id && l.preferred && active(l),
      )?.id ?? "",
    );
    setExpanded(null);
  };
  const editorButtons = (entity: EntityName, row: ShopRecord) => (
    <div className="shopping-actions">
      <button
        disabled={blocked}
        onClick={() => setEdit({ entity, record: row })}
      >
        Edit
      </button>
      <button
        disabled={blocked || !!row.mergedIntoId}
        onClick={() => archive(entity, row)}
      >
        {row.archivedAt ? "Restore" : "Archive"}
      </button>
    </div>
  );
  const item =
    snapshot && selectedItem ? find(snapshot.items, selectedItem) : undefined;
  const itemProducts =
    snapshot?.products.filter((p) => p.itemId === selectedItem) ?? [];
  const itemOffers =
    snapshot?.offerings.filter((o) =>
      itemProducts.some((p) => p.id === o.productId),
    ) ?? [];
  const offers = snapshot
    ? usableOffers(snapshot).filter(
        (o) =>
          (!storeId || o.storeId === storeId) &&
          (!locationId || !o.locationId || o.locationId === locationId),
      )
    : [];
  const entries =
    snapshot?.entries
      .filter(
        (e) =>
          e.status === "active" &&
          snapshot.items.some(
            (i) =>
              i.id === e.itemId &&
              active(i) &&
              s(i, "name").toLowerCase().includes(search.toLowerCase()),
          ) &&
          (!storeId ||
            offers.some(
              (o) => find(snapshot.products, o.productId)?.itemId === e.itemId,
            )),
      )
      .sort(
        (a, b) =>
          n(b, "priority") - n(a, "priority") ||
          n(a, "sortPosition") - n(b, "sortPosition") ||
          a.createdAt.localeCompare(b.createdAt),
      ) ?? [];
  return (
    <main className="shopping-shell">
      <header className="shopping-top">
        <Link href="/" className="brand">
          <span className="brand-mark" />
          Daylapse
        </Link>
        <h1>Shopping</h1>
        <span role="status">
          {busy
            ? "Saving…"
            : pending
              ? "Change pending"
              : snapshot
                ? "Synced"
                : "Loading…"}
        </span>
      </header>
      <nav className="shopping-tabs" aria-label="Shopping sections">
        {[
          ["list", "Shopping list"],
          ["catalog", "Catalog"],
          ["stores", "Retailers"],
          ["history", "History & prices"],
        ].map(([id, label]) => (
          <button
            key={id}
            aria-current={tab === id ? "page" : undefined}
            onClick={() => {
              setTab(id);
              setExpanded(null);
            }}
          >
            {label}
          </button>
        ))}
      </nav>
      {(model.error || pending) && (
        <aside className="shopping-error" role="alert">
          <p>
            {model.error ||
              "A saved change needs confirmation. Retry uses the same request, so a purchase will not be duplicated."}
          </p>
          {model.conflict != null && (
            <details>
              <summary>
                Latest conflicting record — your draft is still saved
              </summary>
              <pre>{JSON.stringify(model.conflict, null, 2)}</pre>
            </details>
          )}
          <button disabled={busy} onClick={model.retry}>
            {pending ? "Retry saved change" : "Retry loading"}
          </button>
          {pending && (
            <>
              <button disabled={busy} onClick={model.discard}>
                Discard local request and reload
              </button>
              <button
                onClick={() => {
                  const blob = new Blob([JSON.stringify(pending, null, 2)], {
                    type: "application/json",
                  });
                  const url = URL.createObjectURL(blob),
                    a = document.createElement("a");
                  a.href = url;
                  a.download = "shopping-pending-change.json";
                  a.click();
                  URL.revokeObjectURL(url);
                }}
              >
                Save pending draft
              </button>
            </>
          )}
          <a href="/shopping">Sign in / reload</a>
        </aside>
      )}
      {!snapshot ? (
        <p role="status">
          {model.error
            ? "Your shopping data has not loaded. No empty list has been substituted."
            : "Loading your household shopping…"}
        </p>
      ) : (
        <>
          {tab === "list" && (
            <>
              <div className="shopping-toolbar">
                <label className="shopping-search">
                  Find an item
                  <input
                    type="search"
                    value={search}
                    onChange={(e) => setSearch(e.target.value)}
                    placeholder="Search shopping or add from catalog"
                  />
                </label>
                <button
                  className="primary-action"
                  disabled={blocked}
                  onClick={() => {
                    setTab("catalog");
                    setSelectedItem(null);
                  }}
                >
                  + Add item
                </button>
              </div>
              <div
                className="shopping-store-tabs"
                aria-label="Filter by retailer"
              >
                <button aria-pressed={!storeId} onClick={() => changeStore("")}>
                  All Stores
                </button>
                {snapshot.stores.filter(active).map((r) => (
                  <button
                    key={r.id}
                    aria-pressed={storeId === r.id}
                    style={{ "--store-color": s(r, "color") } as CSSProperties}
                    onClick={() => changeStore(r.id)}
                  >
                    <span className="store-dot" />
                    {s(r, "name")}
                  </button>
                ))}
              </div>
              {storeId && (
                <label className="shopping-branch">
                  Branch
                  <select
                    value={locationId}
                    onChange={(e) => {
                      setLocation(e.target.value);
                      setExpanded(null);
                    }}
                  >
                    <option value="">All branches / chain offers</option>
                    {snapshot.locations
                      .filter((l) => l.storeId === storeId && active(l))
                      .map((l) => (
                        <option key={l.id} value={l.id}>
                          {s(l, "name")}
                          {l.preferred ? " (preferred)" : ""}
                        </option>
                      ))}
                  </select>
                </label>
              )}
              <p className="shopping-muted">
                {entries.length} pending · Quantities are packages. Retailer
                quantities are alternatives.
              </p>
              <div className="shopping-list">
                {entries.map((entry) => {
                  const catalog = find(snapshot.items, entry.itemId)!;
                  const eligible = offers.filter(
                    (o) =>
                      find(snapshot.products, o.productId)?.itemId ===
                      catalog.id,
                  );
                  const retailers = snapshot.stores.filter((r) =>
                    eligible.some((o) => o.storeId === r.id),
                  );
                  const open =
                    expanded?.entryId === entry.id
                      ? find(eligible, expanded.offeringId)
                      : undefined;
                  return (
                    <article className="shopping-item" key={entry.id}>
                      <div className="shopping-item-heading">
                        <button
                          className="shopping-item-name"
                          onClick={() => {
                            setSelectedItem(catalog.id);
                            setTab("catalog");
                          }}
                        >
                          {s(catalog, "name")}
                        </button>
                        <button
                          disabled={blocked}
                          onClick={() => setListEdit(entry)}
                        >
                          List notes
                        </button>
                        <button
                          className="shopping-remove"
                          disabled={blocked}
                          aria-label={`Remove ${s(catalog, "name")} from list`}
                          onClick={() =>
                            act({
                              operation: "list",
                              action: "remove",
                              itemId: catalog.id,
                              expectedVersion: entry.version,
                            })
                          }
                        >
                          Remove
                        </button>
                      </div>
                      {entry.notes ? <p>{s(entry, "notes")}</p> : null}
                      <div className="shopping-microcards">
                        {retailers.map((retailer) => {
                          const choices = eligible
                            .filter((o) => o.storeId === retailer.id)
                            .sort(
                              (a, b) =>
                                n(a, "preference") - n(b, "preference") ||
                                n(
                                  find(snapshot.products, a.productId),
                                  "preference",
                                ) -
                                  n(
                                    find(snapshot.products, b.productId),
                                    "preference",
                                  ) ||
                                a.id.localeCompare(b.id),
                            );
                          const offer =
                            expanded?.entryId === entry.id &&
                            expanded.storeId === retailer.id
                              ? (find(choices, expanded.offeringId) ??
                                choices[0])
                              : choices[0];
                          const product = find(
                              snapshot.products,
                              offer.productId,
                            ),
                            price = shownPrice(snapshot, offer, locationId),
                            plan = snapshot.plans.find(
                              (p) =>
                                p.entryId === entry.id &&
                                p.offeringId === offer.id,
                            );
                          const status = snapshot.outcomes
                            .filter(
                              (o) =>
                                o.entryId === entry.id &&
                                o.offeringId === offer.id,
                            )
                            .sort((a, b) =>
                              s(b, "occurredAt").localeCompare(
                                s(a, "occurredAt"),
                              ),
                            )[0];
                          const isOpen = open?.id === offer.id;
                          return (
                            <button
                              key={retailer.id}
                              className="shopping-microcard"
                              style={
                                {
                                  "--store-color": s(retailer, "color"),
                                } as CSSProperties
                              }
                              aria-expanded={isOpen}
                              aria-controls={
                                isOpen ? "expanded-shopping-offer" : undefined
                              }
                              aria-label={`${s(retailer, "name")}, ${s(catalog, "name")}, ${money(price?.amount, s(price, "currency") || "USD")}, ${n(product, "packageQuantity")} ${s(product, "packageUnit")}`}
                              onClick={() =>
                                setExpanded(
                                  isOpen
                                    ? null
                                    : {
                                        entryId: entry.id,
                                        storeId: retailer.id,
                                        offeringId: offer.id,
                                      },
                                )
                              }
                            >
                              <strong>
                                <span className="store-dot" />
                                {s(retailer, "name")}
                              </strong>
                              <b>
                                {money(
                                  price?.amount,
                                  s(price, "currency") || "USD",
                                )}
                              </b>
                              <span>
                                {n(product, "packageQuantity")}{" "}
                                {s(product, "packageUnit")} · Qty{" "}
                                {plan ? n(plan, "quantity") : 1}
                              </span>
                              <small>{priceStatus(price)}</small>
                              {status && (
                                <small>
                                  {status.kind === "out_of_stock"
                                    ? "Unavailable"
                                    : status.kind === "purchased" ? "Purchased" : "Skipped"}{" "}
                                  ·{" "}
                                  {new Date(
                                    s(status, "occurredAt"),
                                  ).toLocaleDateString()}
                                </small>
                              )}
                            </button>
                          );
                        })}
                      </div>
                      {!retailers.length && (
                        <button
                          disabled={blocked}
                          onClick={() => {
                            setSelectedItem(catalog.id);
                            setTab("catalog");
                          }}
                        >
                          Add a product and retailer option
                        </button>
                      )}
                      {open && (
                        <Expanded
                          entry={entry}
                          offering={open}
                          snapshot={snapshot}
                          locationId={locationId}
                          choices={eligible.filter(
                            (o) => o.storeId === open.storeId,
                          )}
                          disabled={blocked}
                          close={() => setExpanded(null)}
                          select={(id) =>
                            setExpanded({
                              entryId: entry.id,
                              storeId: s(open, "storeId"),
                              offeringId: id,
                            })
                          }
                          setQuantity={(quantity) =>
                            act({
                              operation: "quantity",
                              entryId: entry.id,
                              offeringId: open.id,
                              quantity,
                              expectedVersion: entry.version,
                            })
                          }
                          purchase={() =>
                            setPurchase({ entry, offering: open })
                          }
                          outcome={async (kind) => {
                            const ok = await act({
                              operation: "outcome",
                              expectedVersion: entry.version,
                              data: {
                                entryId: entry.id,
                                offeringId: open.id,
                                locationId:
                                  locationId || open.locationId || null,
                                kind,
                                occurredAt: new Date().toISOString(),
                              },
                            });
                            if (ok) setExpanded(null);
                          }}
                          edit={() =>
                            setEdit({ entity: "offerings", record: open })
                          }
                          price={() => setPrice(open)}
                        />
                      )}
                    </article>
                  );
                })}
              </div>
              {!entries.length && (
                <p className="shopping-empty">
                  Nothing pending for this view. Add an item from your catalog.
                </p>
              )}
            </>
          )}
          {tab === "catalog" && (
            <section>
              <div className="shopping-section-heading">
                <h2>Persistent catalog</h2>
                <button
                  className="primary-action"
                  disabled={blocked}
                  onClick={() => setEdit({ entity: "items" })}
                >
                  New item
                </button>
              </div>
              <input
                className="shopping-wide-search"
                aria-label="Search catalog"
                type="search"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Search name or category"
              />
              <div className="shopping-catalog">
                {snapshot.items
                  .filter((r) =>
                    (s(r, "name") + s(r, "category"))
                      .toLowerCase()
                      .includes(search.toLowerCase()),
                  )
                  .map((r) => (
                    <article key={r.id}>
                      <button
                        className="shopping-item-name"
                        onClick={() => setSelectedItem(r.id)}
                      >
                        {s(r, "name")}
                      </button>
                      <small>
                        {s(r, "category")}
                        {r.archivedAt ? " · Archived" : ""}
                        {r.mergedIntoId ? " · Merged" : ""}
                      </small>
                      <div className="shopping-actions">
                        <button
                          disabled={blocked || !active(r)}
                          onClick={() => add(r.id)}
                        >
                          {snapshot.entries.some(
                            (e) => e.itemId === r.id && e.status === "active",
                          )
                            ? "On list"
                            : "Add to list"}
                        </button>
                        <button onClick={() => setSelectedItem(r.id)}>
                          Products & retailers
                        </button>
                      </div>
                    </article>
                  ))}
              </div>
              {item && (
                <section className="shopping-management">
                  <div className="shopping-section-heading">
                    <h2>{s(item, "name")}</h2>
                    <button onClick={() => setSelectedItem(null)}>
                      Close details
                    </button>
                  </div>
                  <p>{s(item, "notes")}</p>
                  {editorButtons("items", item)}
                  <div className="shopping-actions">
                    <button
                      disabled={blocked || !active(item)}
                      onClick={() => setMerge(item)}
                    >
                      Merge duplicate
                    </button>
                    <button
                      onClick={() => {
                        setHistoryItem(item.id);
                        setTab("history");
                      }}
                    >
                      View history & prices
                    </button>
                  </div>
                  <div className="shopping-section-heading">
                    <h3>Products & package sizes</h3>
                    <button
                      disabled={blocked || !active(item)}
                      onClick={() =>
                        setEdit({
                          entity: "products",
                          initial: { itemId: item.id },
                        })
                      }
                    >
                      Add product
                    </button>
                  </div>
                  {itemProducts.map((p) => (
                    <article className="shopping-record" key={p.id}>
                      <strong>
                        {s(p, "brand")} {s(p, "name")}
                      </strong>
                      <p>
                        {n(p, "packageQuantity")} {s(p, "packageUnit")} per
                        package · Preference {n(p, "preference")}
                        {p.archivedAt ? " · Archived" : ""}
                      </p>
                      {editorButtons("products", p)}
                    </article>
                  ))}
                  <div className="shopping-section-heading">
                    <h3>Retailer offerings</h3>
                    <button
                      disabled={blocked || !itemProducts.some(active)}
                      onClick={() =>
                        setEdit({
                          entity: "offerings",
                          initial: { itemId: item.id },
                        })
                      }
                    >
                      Associate retailer
                    </button>
                  </div>
                  {itemOffers.map((o) => (
                    <article className="shopping-record" key={o.id}>
                      <strong>{offeringLabel(snapshot, o)}</strong>
                      <p>
                        {o.archivedAt ? "Archived" : "Available option"} ·
                        Preference {n(o, "preference")}
                      </p>
                      {editorButtons("offerings", o)}
                      <button
                        disabled={blocked || !active(o)}
                        onClick={() => setPrice(o)}
                      >
                        Record price
                      </button>
                    </article>
                  ))}
                </section>
              )}
            </section>
          )}
          {tab === "stores" && (
            <section>
              <div className="shopping-section-heading">
                <h2>Retailers & locations</h2>
                <button
                  className="primary-action"
                  disabled={blocked}
                  onClick={() => setEdit({ entity: "stores" })}
                >
                  Add retailer
                </button>
              </div>
              {snapshot.stores.map((r) => (
                <article className="shopping-management" key={r.id}>
                  <h3
                    style={{ "--store-color": s(r, "color") } as CSSProperties}
                  >
                    <span className="store-dot" />
                    {s(r, "name")}
                    {r.archivedAt ? " · Archived" : ""}
                  </h3>
                  {editorButtons("stores", r)}
                  <p>{s(r, "notes")}</p>
                  {r.website ? (
                    <a href={s(r, "website")} target="_blank" rel="noreferrer">
                      Retailer website
                    </a>
                  ) : null}
                  <h4>Locations</h4>
                  {snapshot.locations
                    .filter((l) => l.storeId === r.id)
                    .map((l) => (
                      <article className="shopping-record" key={l.id}>
                        <strong>
                          {s(l, "name")}
                          {l.preferred ? " · Preferred" : ""}
                          {l.archivedAt ? " · Archived" : ""}
                        </strong>
                        <p>
                          {[
                            s(l, "address"),
                            s(l, "city"),
                            s(l, "region"),
                            s(l, "postalCode"),
                          ]
                            .filter(Boolean)
                            .join(", ")}
                        </p>
                        {editorButtons("locations", l)}
                      </article>
                    ))}
                  <button
                    disabled={blocked || !active(r)}
                    onClick={() =>
                      setEdit({
                        entity: "locations",
                        initial: { storeId: r.id },
                      })
                    }
                  >
                    Add location
                  </button>
                </article>
              ))}
            </section>
          )}
          {tab === "history" && (
            <History
              key={historyItem}
              snapshot={snapshot}
              initialItem={historyItem}
              disabled={blocked}
              add={add}
              correct={(prior) => {
                const entry = find(snapshot.entries, prior.entryId),
                  offering = find(snapshot.offerings, prior.offeringId);
                if (entry && offering) setPurchase({ entry, offering, prior });
              }}
              reverse={setUndo}
            />
          )}
          {listEdit && (
            <Modal
              title="Shopping item details"
              close={() => setListEdit(null)}
              busy={busy}
            >
              <form
                onSubmit={async (e) => {
                  e.preventDefault();
                  const f = new FormData(e.currentTarget);
                  if (
                    await act({
                      operation: "list",
                      action: "update",
                      itemId: listEdit.itemId,
                      expectedVersion: listEdit.version,
                      notes: f.get("notes"),
                      priority: Number(f.get("priority")),
                      sortPosition: Number(f.get("sortPosition")),
                    })
                  )
                    setListEdit(null);
                }}
              >
                <label>
                  List notes
                  <textarea
                    name="notes"
                    defaultValue={s(listEdit, "notes")}
                    maxLength={2000}
                  />
                </label>
                <label>
                  Priority
                  <select
                    name="priority"
                    defaultValue={n(listEdit, "priority")}
                  >
                    <option value="0">Normal</option>
                    <option value="1">Soon</option>
                    <option value="2">Important</option>
                    <option value="3">Urgent</option>
                  </select>
                </label>
                <label>
                  Order within priority
                  <input
                    type="number"
                    name="sortPosition"
                    min="0"
                    max="100000"
                    step="1"
                    defaultValue={n(listEdit, "sortPosition")}
                  />
                </label>
                <footer>
                  <button className="primary-action" disabled={blocked}>
                    Save details
                  </button>
                </footer>
              </form>
            </Modal>
          )}
          {edit && (
            <EntityEditor
              entity={edit.entity}
              record={edit.record}
              initial={edit.initial}
              snapshot={snapshot}
              disabled={busy}
              close={() => setEdit(null)}
              save={(data) =>
                save({
                  operation: "save",
                  entity: edit.entity,
                  id: edit.record?.id ?? crypto.randomUUID(),
                  expectedVersion: edit.record?.version ?? 0,
                  data,
                })
              }
            />
          )}
          {price && (
            <PriceEditor
              offering={price}
              snapshot={snapshot}
              disabled={busy}
              close={() => setPrice(null)}
              save={(data) =>
                save({
                  operation: "price",
                  expectedVersion: price.version,
                  data,
                })
              }
            />
          )}
          {purchase && (
            <PurchaseEditor
              {...purchase}
              initialLocationId={locationId}
              snapshot={snapshot}
              quantity={
                n(
                  snapshot.plans.find(
                    (p) =>
                      p.entryId === purchase.entry.id &&
                      p.offeringId === purchase.offering.id,
                  ),
                  "quantity",
                ) || 1
              }
              price={shownPrice(snapshot, purchase.offering, locationId)}
              disabled={busy}
              close={() => setPurchase(null)}
              save={async (data, reason) => {
                const ok = await save(
                  purchase.prior
                    ? {
                        operation: "correct",
                        id: purchase.prior.id,
                        expectedVersion: purchase.prior.version,
                        entryVersion: purchase.entry.version,
                        reason,
                        replacement: data,
                        reactivate: !!data.keepOnList,
                      }
                    : {
                        operation: "outcome",
                        expectedVersion: purchase.entry.version,
                        data,
                      },
                );
                if (ok) setExpanded(null);
                return ok;
              }}
            />
          )}
          {undo && (
            <Modal title="Undo outcome" close={() => setUndo(null)} busy={busy}>
              <form
                onSubmit={async (e) => {
                  e.preventDefault();
                  const data = new FormData(e.currentTarget),
                    entry = find(snapshot.entries, undo.entryId);
                  if (
                    entry &&
                    (await act({
                      operation: "correct",
                      id: undo.id,
                      expectedVersion: undo.version,
                      entryVersion: entry.version,
                      reason: data.get("reason"),
                      replacement: null,
                      reactivate: data.get("reactivate") === "on",
                    }))
                  )
                    setUndo(null);
                }}
              >
                <p>
                  The original record remains in history, marked reversed.
                  Recorded prices are not changed.
                </p>
                <label>
                  Reason
                  <input name="reason" required maxLength={160} />
                </label>
                <label className="shopping-check">
                  <input type="checkbox" name="reactivate" defaultChecked /> Put
                  the item back on the active list
                </label>
                <footer>
                  <button className="primary-action" disabled={blocked}>
                    Reverse outcome
                  </button>
                </footer>
              </form>
            </Modal>
          )}
          {merge && (
            <Modal
              title="Merge duplicate catalog item"
              close={() => setMerge(null)}
              busy={busy}
            >
              <form
                onSubmit={async (e) => {
                  e.preventDefault();
                  const target = find(
                    snapshot.items,
                    new FormData(e.currentTarget).get("target"),
                  );
                  if (
                    target &&
                    (await act({
                      operation: "merge",
                      id: merge.id,
                      expectedVersion: merge.version,
                      targetId: target.id,
                      targetVersion: target.version,
                    }))
                  ) {
                    setMerge(null);
                    setSelectedItem(target.id);
                  }
                }}
              >
                <p>
                  Move {s(merge, "name")}’s products and active list options
                  into the surviving item. Original purchase snapshots remain
                  unchanged. The duplicate stays archived as a historical
                  reference.
                </p>
                <label>
                  Keep this item
                  <select name="target" required>
                    <option value="">Choose surviving item…</option>
                    {snapshot.items
                      .filter((i) => active(i) && i.id !== merge.id)
                      .map((i) => (
                        <option key={i.id} value={i.id}>
                          {s(i, "name")}
                        </option>
                      ))}
                  </select>
                </label>
                <footer>
                  <button className="primary-action" disabled={blocked}>
                    Merge into selected item
                  </button>
                </footer>
              </form>
            </Modal>
          )}
        </>
      )}
    </main>
  );
}
function usableOffers(snapshot: Snapshot) {
  return snapshot.offerings.filter(
    (o) =>
      active(o) &&
      snapshot.products.some((p) => p.id === o.productId && active(p)) &&
      snapshot.stores.some((s) => s.id === o.storeId && active(s)) &&
      (!o.locationId ||
        snapshot.locations.some((l) => l.id === o.locationId && active(l))),
  );
}
function Expanded({
  entry,
  offering,
  snapshot,
  locationId,
  choices,
  disabled,
  close,
  select,
  setQuantity,
  purchase,
  outcome,
  edit,
  price,
}: {
  entry: ShopRecord;
  offering: ShopRecord;
  snapshot: Snapshot;
  locationId: string;
  choices: ShopRecord[];
  disabled: boolean;
  close: () => void;
  select: (id: string) => void;
  setQuantity: (n: number) => Promise<boolean>;
  purchase: () => void;
  outcome: (kind: string) => Promise<void>;
  edit: () => void;
  price: () => void;
}) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    let seen = false;
    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting) seen = true;
        else if (seen) close();
      },
      { threshold: 0 },
    );
    if (ref.current) observer.observe(ref.current);
    return () => observer.disconnect();
  }, [close]);
  const product = find(snapshot.products, offering.productId),
    store = find(snapshot.stores, offering.storeId),
    item = find(snapshot.items, product?.itemId),
    observed = shownPrice(snapshot, offering, locationId);
  const plan = snapshot.plans.find(
      (p) => p.entryId === entry.id && p.offeringId === offering.id,
    ),
    quantity = plan ? n(plan, "quantity") : 1;
  const perUnit =
    observed && product
      ? unitPrice(
          n(observed, "amount"),
          n(product, "packageQuantity"),
          s(product, "packageUnit"),
        )
      : null;
  return (
    <div
      id="expanded-shopping-offer"
      ref={ref}
      className="shopping-expanded"
      style={{ "--store-color": s(store, "color") } as CSSProperties}
    >
      <div className="shopping-section-heading">
        <h3>
          {s(item, "name")} · {s(store, "name")}
        </h3>
        <button aria-label="Collapse offering" onClick={close}>
          ×
        </button>
      </div>
      <label>
        Product / package
        <select value={offering.id} onChange={(e) => select(e.target.value)}>
          {choices.map((o) => (
            <option key={o.id} value={o.id}>
              {offeringLabel(snapshot, o)}
            </option>
          ))}
        </select>
      </label>
      <p>
        <strong>
          {money(observed?.amount, s(observed, "currency") || "USD")}
        </strong>{" "}
        / package · {priceStatus(observed)}
        {perUnit ? ` · ${unitMoney(perUnit, s(observed, "currency"))}` : ""}
      </p>
      {observed?.conditions ? <p>{s(observed, "conditions")}</p> : null}
      {offering.notes ? <p>{s(offering, "notes")}</p> : null}
      <div className="shopping-quantity">
        <span>Planned packages</span>
        <button
          disabled={disabled || quantity === 0}
          aria-label="Decrease packages"
          onClick={() => setQuantity(quantity - 1)}
        >
          −
        </button>
        <output aria-live="polite">{quantity}</output>
        <button
          disabled={disabled || quantity >= 10000}
          aria-label="Increase packages"
          onClick={() => setQuantity(quantity + 1)}
        >
          +
        </button>
      </div>
      <div className="shopping-outcomes">
        <button
          className="primary-action"
          disabled={disabled}
          onClick={purchase}
        >
          Purchased
        </button>
        <button disabled={disabled} onClick={() => outcome("out_of_stock")}>
          Out of Stock
        </button>
        <button disabled={disabled} onClick={() => outcome("skipped")}>
          Skipped
        </button>
      </div>
      <div className="shopping-actions">
        <button disabled={disabled} onClick={price}>
          Update observed price
        </button>
        <button disabled={disabled} onClick={edit}>
          Edit offering / notes
        </button>
      </div>
    </div>
  );
}
