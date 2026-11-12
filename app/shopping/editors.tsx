"use client";
import { useEffect, useRef, useState, type ReactNode } from "react";
import {
  fields,
  units,
  type EntityName,
  type ShopRecord,
} from "@/lib/purchasing/schema";
import {
  active,
  find,
  fractionDigits,
  minor,
  n,
  offeringLabel,
  s,
  type Snapshot,
} from "./model";
export function Modal({
  title,
  children,
  close,
  busy = false,
}: {
  title: string;
  children: ReactNode;
  close: () => void;
  busy?: boolean;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const dialog = ref.current;
    dialog?.showModal();
    return () => dialog?.close();
  }, []);
  return (
    <dialog
      ref={ref}
      className="shopping-dialog"
      aria-label={title}
      onCancel={(e) => {
        e.preventDefault();
        if (!busy) close();
      }}
    >
      <header>
        <h2>{title}</h2>
        <button
          type="button"
          disabled={busy}
          onClick={close}
          aria-label="Close editor"
        >
          ×
        </button>
      </header>
      {children}
    </dialog>
  );
}
const labels: Record<string, string> = {
  itemId: "Catalog item",
  productId: "Product",
  storeId: "Retailer",
  locationId: "Location (optional)",
  name: "Name",
  category: "Category",
  notes: "Notes",
  imageUrl: "Image URL (optional)",
  defaultUnit: "Default unit",
  brand: "Brand",
  packageQuantity: "Units per package",
  packageUnit: "Unit",
  upc: "UPC / GTIN",
  sku: "SKU",
  preference: "Preference order (lower first)",
  color: "Retailer color",
  logoUrl: "Logo URL (optional)",
  website: "Website",
  address: "Street address",
  city: "City",
  region: "State / region",
  postalCode: "Postal code",
  latitude: "Latitude (optional)",
  longitude: "Longitude (optional)",
  storeIdentifier: "Store identifier",
  preferred: "Preferred branch",
  url: "Product URL",
};
const numberFields = new Set([
  "packageQuantity",
  "preference",
  "latitude",
  "longitude",
]);
export function EntityEditor({
  entity,
  record,
  initial = {},
  snapshot,
  save,
  close,
  disabled,
}: {
  entity: EntityName;
  record?: ShopRecord;
  initial?: Record<string, unknown>;
  snapshot: Snapshot;
  save: (data: Record<string, unknown>) => Promise<boolean>;
  close: () => void;
  disabled: boolean;
}) {
  const [error, setError] = useState("");
  const [values, setValues] = useState<Record<string, unknown>>({
    ...record,
    ...initial,
  });
  const parentKeys =
    entity === "products"
      ? ["itemId"]
      : entity === "locations"
        ? ["storeId"]
        : entity === "offerings"
          ? ["productId", "storeId", "locationId"]
          : [];
  const controls = Object.keys(fields[entity].shape);
  return (
    <Modal
      title={`${record ? "Edit" : "Add"} ${entity === "items" ? "catalog item" : entity === "stores" ? "retailer" : entity.slice(0, -1)}`}
      close={close}
      busy={disabled}
    >
      <form
        onSubmit={async (e) => {
          e.preventDefault();
          setError("");
          try {
            const data = fields[entity].parse(
              Object.fromEntries(
                controls
                  .map((key) => [
                    key,
                    values[key] === "" &&
                    ["locationId", "latitude", "longitude"].includes(key)
                      ? null
                      : values[key],
                  ])
                  .filter(([, v]) => v !== undefined),
              ),
            );
            if (await save(data)) close();
          } catch (e) {
            setError(e instanceof Error ? e.message : "Check the fields.");
          }
        }}
      >
        <div className="shopping-form-grid">
          {controls.map((key) => {
            const value = values[key];
            const change = (v: unknown) =>
              setValues((old) => ({
                ...old,
                [key]: v,
                ...(key === "storeId" ? { locationId: null } : {}),
              }));
            const ref =
              key === "itemId"
                ? snapshot.items
                : key === "productId"
                  ? snapshot.products.filter(
                      (p) => !initial.itemId || p.itemId === initial.itemId,
                    )
                  : key === "storeId"
                    ? snapshot.stores
                    : key === "locationId"
                      ? snapshot.locations.filter(
                          (l) => l.storeId === values.storeId,
                        )
                      : null;
            return (
              <label key={key}>
                {labels[key] ?? key}
                {ref ? (
                  <select
                    required={key !== "locationId"}
                    value={String(value ?? "")}
                    disabled={!!record && parentKeys.includes(key)}
                    onChange={(e) => change(e.target.value || null)}
                  >
                    <option value="">
                      {key === "locationId"
                        ? "Any branch / chain-level"
                        : "Choose…"}
                    </option>
                    {ref
                      .filter((r) => active(r) || r.id === value)
                      .map((r) => (
                        <option key={r.id} value={r.id}>
                          {s(r, "name")}
                        </option>
                      ))}
                  </select>
                ) : key === "packageUnit" ? (
                  <select
                    required
                    value={String(value ?? "")}
                    onChange={(e) => change(e.target.value)}
                  >
                    <option value="">Choose unit…</option>
                    {units.map((u) => (
                      <option key={u}>{u}</option>
                    ))}
                  </select>
                ) : key === "preferred" ? (
                  <input
                    type="checkbox"
                    checked={!!value}
                    onChange={(e) => change(e.target.checked)}
                  />
                ) : key === "notes" ? (
                  <textarea
                    value={String(value ?? "")}
                    maxLength={2000}
                    onChange={(e) => change(e.target.value)}
                  />
                ) : (
                  <input
                    value={String(
                      value ??
                        (key === "color"
                          ? "#657b70"
                          : key === "preference"
                            ? 0
                            : ""),
                    )}
                    required={["name", "packageQuantity"].includes(key)}
                    type={
                      key === "color"
                        ? "color"
                        : numberFields.has(key)
                          ? "number"
                          : /Url$|website|^url$/.test(key)
                            ? "url"
                            : "text"
                    }
                    step={key === "preference" ? 1 : "any"}
                    inputMode={numberFields.has(key) ? "decimal" : undefined}
                    onChange={(e) =>
                      change(
                        numberFields.has(key)
                          ? e.target.value === ""
                            ? null
                            : Number(e.target.value)
                          : e.target.value,
                      )
                    }
                  />
                )}
              </label>
            );
          })}
        </div>
        {error && <p role="alert">{error}</p>}
        <footer>
          <button type="button" onClick={close} disabled={disabled}>
            Cancel
          </button>
          <button className="primary-action" disabled={disabled}>
            Save
          </button>
        </footer>
      </form>
    </Modal>
  );
}
export function PriceEditor({
  offering,
  snapshot,
  save,
  close,
  disabled,
}: {
  offering: ShopRecord;
  snapshot: Snapshot;
  save: (data: Record<string, unknown>) => Promise<boolean>;
  close: () => void;
  disabled: boolean;
}) {
  const [error, setError] = useState("");
  return (
    <Modal title="Record an observed price" close={close} busy={disabled}>
      <p>{offeringLabel(snapshot, offering)}</p>
      <form
        onSubmit={async (e) => {
          e.preventDefault();
          setError("");
          const f = new FormData(e.currentTarget);
          try {
            const data = {
              offeringId: offering.id,
              locationId: f.get("locationId") || null,
              amount: minor(String(f.get("amount")), String(f.get("currency"))),
              currency: f.get("currency"),
              observedAt: new Date(String(f.get("observedAt"))).toISOString(),
              source: f.get("source"),
              sourceUrl: f.get("sourceUrl"),
              reference: f.get("reference"),
              verified: f.get("verified") === "on",
              conditions: f.get("conditions"),
              expiresAt: f.get("expiresAt")
                ? new Date(String(f.get("expiresAt"))).toISOString()
                : null,
              notes: f.get("notes"),
            };
            if (await save(data)) close();
          } catch (e) {
            setError(e instanceof Error ? e.message : "Check the price.");
          }
        }}
      >
        <div className="shopping-form-grid">
          <label>
            Package price
            <input
              required
              name="amount"
              type="number"
              step="any"
              min="0"
              inputMode="decimal"
            />
          </label>
          <label>
            Currency
            <input
              name="currency"
              defaultValue="USD"
              required
              pattern="[A-Z]{3}"
              maxLength={3}
            />
          </label>
          <label>
            Location
            <select name="locationId" defaultValue={s(offering, "locationId")}>
              <option value="">Chain-level / unknown</option>
              {snapshot.locations
                .filter(
                  (l) =>
                    l.storeId === offering.storeId &&
                    (!offering.locationId || l.id === offering.locationId),
                )
                .map((l) => (
                  <option key={l.id} value={l.id}>
                    {s(l, "name")}
                  </option>
                ))}
            </select>
          </label>
          <label>
            Observed at
            <input
              name="observedAt"
              type="datetime-local"
              required
              defaultValue={localTime()}
            />
          </label>
          <label>
            Source
            <select name="source">
              {[
                "manual",
                "retailer",
                "research",
                "receipt",
                "purchase",
                "import",
              ].map((v) => (
                <option key={v}>{v}</option>
              ))}
            </select>
          </label>
          <label>
            Source URL
            <input name="sourceUrl" type="url" placeholder="https://…" />
          </label>
          <label>
            Source reference
            <input name="reference" />
          </label>
          <label className="shopping-check">
            <input name="verified" type="checkbox" /> Product, size and price
            verified
          </label>
          <label>
            Promotion / membership conditions
            <input name="conditions" />
          </label>
          <label>
            Expires (optional)
            <input name="expiresAt" type="datetime-local" />
          </label>
          <label>
            Notes
            <textarea name="notes" />
          </label>
        </div>
        <p className="shopping-muted">
          This app records your observation. It does not verify retailer prices.
          Leave verification unchecked if the product, package or location is
          uncertain.
        </p>
        {error && <p role="alert">{error}</p>}
        <footer>
          <button className="primary-action" disabled={disabled}>
            Record price
          </button>
        </footer>
      </form>
    </Modal>
  );
}
export function localTime(value = new Date().toISOString()) {
  const date = new Date(value);
  return new Date(date.getTime() - date.getTimezoneOffset() * 60000)
    .toISOString()
    .slice(0, 16);
}
export function PurchaseEditor({
  entry,
  offering,
  snapshot,
  quantity,
  price,
  prior,
  initialLocationId = "",
  close,
  save,
  disabled,
}: {
  initialLocationId?: string;
  entry: ShopRecord;
  offering: ShopRecord;
  snapshot: Snapshot;
  quantity: number;
  price?: ShopRecord;
  prior?: ShopRecord;
  close: () => void;
  save: (data: Record<string, unknown>, reason: string) => Promise<boolean>;
  disabled: boolean;
}) {
  const [error, setError] = useState("");
  const [chosenId, setChosenId] = useState(offering.id);
  const chosen = find(snapshot.offerings, chosenId) ?? offering;
  const currency = s(prior, "currency") || s(price, "currency") || "USD";
  const offered = prior ? prior.packagePrice : price?.amount;
  return (
    <Modal
      title={prior ? "Correct shopping outcome" : "Record purchase"}
      close={close}
      busy={disabled}
    >
      <p>{offeringLabel(snapshot, offering)}</p>
      <form
        onSubmit={async (e) => {
          e.preventDefault();
          setError("");
          const f = new FormData(e.currentTarget);
          try {
            const kind = String(f.get("kind") || "purchased");
            const data = {
              entryId: entry.id,
              offeringId: f.get("offeringId") || offering.id,
              locationId: f.get("locationId") || null,
              kind,
              quantity: kind === "purchased" ? Number(f.get("quantity")) : 0,
              packagePrice:
                kind === "purchased"
                  ? minor(
                      String(f.get("packagePrice")),
                      String(f.get("currency")),
                    )
                  : null,
              totalPrice:
                kind === "purchased"
                  ? minor(
                      String(f.get("totalPrice")),
                      String(f.get("currency")),
                    )
                  : null,
              currency: f.get("currency"),
              occurredAt: new Date(String(f.get("occurredAt"))).toISOString(),
              notes: f.get("notes"),
              tripId: f.get("tripId") || null,
              keepOnList: f.get("keepOnList") === "on",
            };
            if (await save(data, String(f.get("reason") ?? ""))) close();
          } catch (e) {
            setError(e instanceof Error ? e.message : "Check the purchase.");
          }
        }}
      >
        {prior && (
          <>
            <label>
              Correction reason
              <input name="reason" required maxLength={160} />
            </label>
            <label>
              Outcome
              <select name="kind" defaultValue={s(prior, "kind")}>
                {["purchased", "out_of_stock", "skipped"].map((v) => (
                  <option key={v}>{v}</option>
                ))}
              </select>
            </label>
            <label>
              Offering
              <select
                name="offeringId"
                value={chosenId}
                onChange={(e) => setChosenId(e.target.value)}
              >
                {snapshot.offerings
                  .filter(
                    (o) =>
                      find(snapshot.products, o.productId)?.itemId ===
                      entry.itemId,
                  )
                  .map((o) => (
                    <option key={o.id} value={o.id}>
                      {offeringLabel(snapshot, o)}
                    </option>
                  ))}
              </select>
            </label>
          </>
        )}
        <div className="shopping-form-grid">
          <label>
            Packages actually purchased
            <input
              name="quantity"
              type="number"
              min="1"
              max="10000"
              step="1"
              inputMode="numeric"
              defaultValue={
                prior
                  ? Math.max(1, n(prior, "quantity"))
                  : Math.max(1, quantity)
              }
              required
            />
          </label>
          <label>
            Currency
            <input
              name="currency"
              defaultValue={currency}
              required
              pattern="[A-Z]{3}"
              maxLength={3}
            />
          </label>
          <label>
            Actual package price
            <input
              name="packagePrice"
              type="number"
              step="any"
              min="0"
              inputMode="decimal"
              defaultValue={
                offered == null
                  ? ""
                  : Number(offered) / 10 ** fractionDigits(currency)
              }
              placeholder="Unknown"
            />
          </label>
          <label>
            Total paid (optional)
            <input
              name="totalPrice"
              type="number"
              step="any"
              min="0"
              inputMode="decimal"
              defaultValue={
                prior?.totalPrice == null
                  ? ""
                  : Number(prior.totalPrice) / 10 ** fractionDigits(currency)
              }
              placeholder="Calculated from package price"
            />
          </label>
          <label>
            Location
            <select
              key={chosenId}
              name="locationId"
              defaultValue={
                (chosenId === offering.id ? s(prior, "locationId") : "") ||
                s(chosen, "locationId") ||
                (snapshot.locations.some(
                  (l) =>
                    l.id === initialLocationId && l.storeId === chosen.storeId,
                )
                  ? initialLocationId
                  : "") ||
                snapshot.locations.find(
                  (l) =>
                    l.storeId === chosen.storeId && l.preferred && active(l),
                )?.id ||
                ""
              }
            >
              <option value="">Not specified</option>
              {snapshot.locations
                .filter(
                  (l) =>
                    l.storeId === chosen.storeId &&
                    (!chosen.locationId || l.id === chosen.locationId),
                )
                .map((l) => (
                  <option key={l.id} value={l.id}>
                    {s(l, "name")}
                  </option>
                ))}
            </select>
          </label>
          <label>
            Purchased at
            <input
              type="datetime-local"
              name="occurredAt"
              required
              defaultValue={localTime(s(prior, "occurredAt") || undefined)}
            />
          </label>
          <label>
            Trip identifier (optional)
            <input
              name="tripId"
              defaultValue={s(prior, "tripId")}
              placeholder="e.g. weekly-2026-11-12"
              pattern="[a-zA-Z0-9_-]+"
            />
          </label>
          <label>
            Notes
            <textarea name="notes" defaultValue={s(prior, "notes")} />
          </label>
        </div>
        <label className="shopping-check">
          <input
            name="keepOnList"
            type="checkbox"
            defaultChecked={!!prior?.keepOnList}
          />{" "}
          Still need more — keep on list
        </label>
        <p className="shopping-muted">
          Confirm the price actually paid. Leave it blank if unknown. For a
          discounted total, clear the package price and enter the total.
        </p>
        {error && <p role="alert">{error}</p>}
        <footer>
          <button className="primary-action" disabled={disabled}>
            {prior ? "Save correction" : "Purchased"}
          </button>
        </footer>
      </form>
    </Modal>
  );
}
