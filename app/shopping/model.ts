"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import type { ShopRecord } from "@/lib/purchasing/schema";
export type Snapshot = {
  revision: number;
  items: ShopRecord[];
  products: ShopRecord[];
  stores: ShopRecord[];
  locations: ShopRecord[];
  offerings: ShopRecord[];
  entries: ShopRecord[];
  plans: ShopRecord[];
  prices: ShopRecord[];
  outcomes: ShopRecord[];
};
export type Pending = Record<string, unknown> & { mutationId: string };
const key = "daylapse.shopping.pending.v1";
export async function request<T = Record<string, unknown>>(
  path: string,
  body?: unknown,
) {
  const response = await fetch(`/api/shopping${path}`, {
    method: body === undefined ? "GET" : "POST",
    headers: { "Content-Type": "application/json" },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    signal: AbortSignal.timeout(20000),
  });
  if (!response.headers.get("content-type")?.includes("application/json"))
    throw new Error(
      "Sign in again, then retry. Your pending edit is still saved on this device.",
    );
  const result = (await response.json()) as Record<string, unknown>;
  if (!response.ok)
    throw Object.assign(
      new Error(String(result.error ?? "Could not load shopping.")),
      {
        status: response.status,
        current: result.current,
        issues: result.issues,
      },
    );
  return result as T;
}
export function usePurchasing() {
  const [snapshot, setSnapshot] = useState<Snapshot | null>(null),
    [pending, setPending] = useState<Pending | null>(null);
  const [error, setError] = useState(""),
    [conflict, setConflict] = useState<unknown>(null),
    [busy, setBusy] = useState(false);
  const inFlight = useRef(false),
    pendingRef = useRef<Pending | null>(null);
  const reload = useCallback(async () => {
    const next = (await request("")) as Snapshot;
    setSnapshot(next);
    return next;
  }, []);
  useEffect(() => {
    let alive = true;
    Promise.resolve().then(async () => {
      try {
        const saved = localStorage.getItem(key);
        if (saved) {
          const command = JSON.parse(saved);
          pendingRef.current = command;
          if (alive) setPending(command);
        }
        const next = (await request("")) as Snapshot;
        if (alive) setSnapshot(next);
      } catch (e) {
        if (alive)
          setError(
            e instanceof Error ? e.message : "Shopping could not load. Retry.",
          );
      }
    });
    const refresh = () => {
      if (!inFlight.current && !pendingRef.current)
        reload()
          .then(() => {
            if (alive) setError("");
          })
          .catch((e) => {
            if (alive) setError(e.message);
          });
    };
    const timer = setInterval(refresh, 30000);
    window.addEventListener("focus", refresh);
    window.addEventListener("online", refresh);
    const warn = (event: BeforeUnloadEvent) => {
      if (pendingRef.current) {
        event.preventDefault();
      }
    };
    window.addEventListener("beforeunload", warn);
    return () => {
      alive = false;
      clearInterval(timer);
      window.removeEventListener("focus", refresh);
      window.removeEventListener("online", refresh);
      window.removeEventListener("beforeunload", warn);
    };
  }, [reload]);
  const execute = async (command: Pending) => {
    if (inFlight.current) return false;
    inFlight.current = true;
    setBusy(true);
    setError("");
    setConflict(null);
    try {
      // Persist the exact request BEFORE sending. A lost response can be replayed.
      localStorage.setItem(key, JSON.stringify(command));
      pendingRef.current = command;
      setPending(command);
      await request("/command", command);
      await reload();
      localStorage.removeItem(key);
      pendingRef.current = null;
      setPending(null);
      return true;
    } catch (e) {
      const failure = e as Error & {
        current?: unknown;
        issues?: { path: unknown[]; message: string }[];
      };
      setError(
        failure.message +
          (failure.issues
            ? ` ${failure.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; ")}`
            : ""),
      );
      setConflict(failure.current ?? null);
      return false;
    } finally {
      inFlight.current = false;
      setBusy(false);
    }
  };
  const act = async (command: Record<string, unknown>) => {
    if (pendingRef.current) {
      setError("Resolve or retry the saved pending change first.");
      return false;
    }
    return execute({ ...command, mutationId: crypto.randomUUID() });
  };
  const discard = () => {
    if (
      inFlight.current ||
      !window.confirm(
        "Stop retrying this request? A timed-out write may already be saved on the server. Its local request will be discarded; refresh to check the current data.",
      )
    )
      return;
    localStorage.removeItem(key);
    pendingRef.current = null;
    setPending(null);
    setConflict(null);
    setError("");
    reload().catch((e) => setError(e.message));
  };
  return {
    snapshot,
    pending,
    error,
    conflict,
    busy,
    act,
    retry: () =>
      pendingRef.current
        ? execute(pendingRef.current)
        : reload()
            .then(() => {
              setError("");
              return true;
            })
            .catch((e) => {
              setError(e.message);
              return false;
            }),
    discard,
    reload,
  };
}
export const s = (r: Record<string, unknown> | undefined, key: string) =>
  String(r?.[key] ?? "");
export const n = (r: Record<string, unknown> | undefined, key: string) =>
  Number(r?.[key] ?? 0);
export const find = (records: ShopRecord[], id: unknown) =>
  records.find((r) => r.id === id);
export const active = (r: ShopRecord) => !r.archivedAt && !r.mergedIntoId;
export function fractionDigits(currency: string) {
  try {
    return (
      new Intl.NumberFormat("en", {
        style: "currency",
        currency,
      }).resolvedOptions().maximumFractionDigits ?? 2
    );
  } catch {
    return 2;
  }
}
export function money(amount: unknown, currency = "USD") {
  return amount === null || amount === undefined
    ? "Unknown price"
    : new Intl.NumberFormat(undefined, { style: "currency", currency }).format(
        Number(amount) / 10 ** fractionDigits(currency),
      );
}
export function unitMoney(
  price: { amount: number; unit: string },
  currency: string,
) {
  const scale = ["g", "ml"].includes(price.unit) ? 100 : 1;
  return `${money(price.amount * scale, currency)} / ${scale === 1 ? "" : scale}${price.unit}`;
}
export function minor(value: string, currency: string) {
  if (!value.trim()) return null;
  const digits = fractionDigits(currency),
    scaled = Number(value) * 10 ** digits;
  if (
    !Number.isFinite(scaled) ||
    scaled < 0 ||
    Math.abs(scaled - Math.round(scaled)) > 0.000001
  )
    throw new Error(
      `Enter a valid ${currency} price with at most ${digits} decimals.`,
    );
  return Math.round(scaled);
}
export function shownPrice(
  snapshot: Snapshot,
  offering: ShopRecord,
  locationId = "",
) {
  const product = find(snapshot.products, offering.productId);
  return snapshot.prices
    .filter(
      (r) =>
        r.offeringId === offering.id &&
        (!r.locationId ||
          r.locationId === (locationId || offering.locationId)) &&
        r.packageQuantity === product?.packageQuantity &&
        r.packageUnit === product?.packageUnit,
    )
    .sort(
      (a, b) =>
        Number(!!b.locationId) - Number(!!a.locationId) ||
        s(b, "observedAt").localeCompare(s(a, "observedAt")) ||
        b.createdAt.localeCompare(a.createdAt),
    )[0];
}
export function offeringLabel(snapshot: Snapshot, offering: ShopRecord) {
  const product = find(snapshot.products, offering.productId),
    store = find(snapshot.stores, offering.storeId),
    location = find(snapshot.locations, offering.locationId);
  return `${s(store, "name")} · ${s(product, "name")} · ${n(product, "packageQuantity")} ${s(product, "packageUnit")}${location ? ` · ${s(location, "name")}` : ""}`;
}
