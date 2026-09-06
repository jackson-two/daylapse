import { z } from "zod";
import { householdItemsSchema, type TrackedItem } from "./household-schema";
import { normalizeStoredItem } from "./item-mutations";
import { createRequestTimeout } from "./request-timeout";

const snapshotSchema = z.object({ items: householdItemsSchema, revision: z.number().int().min(0) });
const savedSchema = z.object({ revision: z.number().int().min(1), items: householdItemsSchema.optional() });
type SavedSnapshot = z.infer<typeof snapshotSchema>;
export type SyncStatus = "loading" | "saved" | "saving" | "error" | "conflict";
export type SyncSnapshot = {
  items: TrackedItem[]; revision: number; ready: boolean; status: SyncStatus;
  message: string; conflicts: string[]; dirty: boolean; refreshing: boolean;
};
function equal(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (!a || !b || typeof a !== "object" || typeof b !== "object") return false;
  if (Array.isArray(a) || Array.isArray(b)) {
    return Array.isArray(a) && Array.isArray(b) && a.length === b.length && a.every((value, index) => equal(value, b[index]));
  }
  const left = a as Record<string, unknown>, right = b as Record<string, unknown>;
  const keys = Object.keys(left).filter((key) => left[key] !== undefined);
  return keys.length === Object.keys(right).filter((key) => right[key] !== undefined).length
    && keys.every((key) => equal(left[key], right[key]));
}

export function mergeHouseholdItems(base: TrackedItem[], local: TrackedItem[], remote: TrackedItem[], choice?: "local" | "remote") {
  const before = new Map(base.map((item) => [item.id, item]));
  const mine = new Map(local.map((item) => [item.id, item]));
  const theirs = new Map(remote.map((item) => [item.id, item]));
  const ids = new Set([...remote.map((item) => item.id), ...local.map((item) => item.id), ...before.keys()]);
  const items: TrackedItem[] = [];
  const conflicts: string[] = [];
  for (const id of ids) {
    const b = before.get(id), l = mine.get(id), r = theirs.get(id);
    let picked: TrackedItem | undefined;
    if (equal(l, b)) picked = r;
    else if (equal(r, b) || equal(l, r)) picked = l;
    else {
      conflicts.push(l?.title ?? r?.title ?? b?.title ?? id);
      picked = choice === "remote" ? r : l;
    }
    if (picked) items.push(picked);
  }
  return { items, conflicts };
}

/** Owns the save queue so React rerenders cannot start overlapping writes. */
export class HouseholdSync {
  private state: SyncSnapshot = { items: [], revision: 0, ready: false, status: "loading", message: "", conflicts: [], dirty: false, refreshing: false };
  private base: TrackedItem[] = [];
  private listeners = new Set<() => void>();
  private timer?: ReturnType<typeof setTimeout>;
  private writing = false;
  private reading = false;
  private generation = 0;
  private active = false;
  private readOnly = false;
  private apiUrl = "/api/items";
  private draftOpen = false;

  constructor(private request: typeof fetch = (...args) => fetch(...args), private debounceMs = 350, private saveRows?: (items: TrackedItem[], base: TrackedItem[], revision: number, signal: AbortSignal) => Promise<Response>) {}
  getSnapshot = () => this.state;
  subscribe = (listener: () => void) => { this.listeners.add(listener); return () => { this.listeners.delete(listener); }; };
  setDraftOpen(open: boolean) { this.draftOpen = open; }
  private publish(patch: Partial<SyncSnapshot>) {
    this.state = { ...this.state, ...patch };
    this.state.dirty = !equal(this.state.items, this.base);
    this.listeners.forEach((listener) => listener());
  }
  start(apiUrl = "/api/items", readOnly = false) {
    this.active = true;
    this.apiUrl = apiUrl;
    this.readOnly = readOnly;
    void this.refresh();
  }
  stop() {
    this.active = false;
    this.generation++;
    this.reading = false;
    this.writing = false;
    clearTimeout(this.timer);
  }
  setItems = (update: TrackedItem[] | ((items: TrackedItem[]) => TrackedItem[])) => {
    if (!this.state.ready || this.readOnly) return;
    const items = typeof update === "function" ? update(this.state.items) : update;
    const blocked = this.state.status === "error" || this.state.status === "conflict";
    this.publish({ items, ...(!blocked ? { status: equal(items, this.base) && !this.writing ? "saved" : "saving" } : {}) });
    if (!blocked) this.schedule();
  };
  private schedule() {
    clearTimeout(this.timer);
    if (!this.active || this.writing || this.reading || this.readOnly || !this.state.dirty) return;
    this.timer = setTimeout(() => { void this.flush(); }, this.debounceMs);
  }
  private async read() {
    const timeout = createRequestTimeout();
    try {
      const response = await this.request(this.apiUrl, { cache: "no-store", signal: timeout.signal });
      if (!response.ok) throw new Error("Could not refresh saved data. Your edits are still here.");
      const snapshot = snapshotSchema.parse(await response.json());
      return { ...snapshot, items: snapshot.items.map(normalizeStoredItem) };
    } finally { timeout.clear(); }
  }
  async refresh() {
    if (!this.active || this.writing || this.reading || this.draftOpen || this.state.dirty || this.state.status === "conflict") return;
    this.reading = true;
    const generation = this.generation;
    const startedRevision = this.state.revision;
    try {
      const remote = await this.read();
      if (!this.active || generation !== this.generation || this.draftOpen || this.state.dirty || this.state.revision !== startedRevision) return;
      this.accept(remote);
    } catch {
      if (this.active && generation === this.generation && !this.state.dirty) {
        this.publish({ status: "error", message: this.state.ready ? "Could not refresh saved data. Try again when connected." : "Your household data could not be loaded. Nothing has been changed or replaced." });
      }
    } finally {
      if (generation === this.generation) {
        this.reading = false;
        if (this.state.status === "saving") this.schedule();
      }
    }
  }
  private accept(remote: SavedSnapshot) {
    this.base = remote.items;
    this.publish({ items: remote.items, revision: remote.revision, ready: true, status: "saved", message: "", conflicts: [] });
  }
  async flush() {
    if (!this.active || this.writing || this.reading || this.readOnly || !this.state.dirty || this.state.status === "error" || this.state.status === "conflict") return;
    clearTimeout(this.timer);
    this.writing = true;
    const generation = this.generation;
    const items = this.state.items;
    const expectedRevision = this.state.revision;
    this.publish({ status: "saving", message: "" });
    const timeout = createRequestTimeout();
    try {
      const response = this.saveRows ? await this.saveRows(items, this.base, expectedRevision, timeout.signal) : await this.request("/api/items", {
        method: "PUT", headers: { "content-type": "application/json" },
        body: JSON.stringify({ items, expectedRevision }), signal: timeout.signal,
      });
      if (!this.active || generation !== this.generation) return;
      if (response.status === 409) {
        this.publish({ status: "conflict", message: "Saved data changed. Your edits are still here. Retry sync to combine changes." });
        return;
      }
      if (!response.ok) {
        this.publish({ status: "error", message: response.status === 413 ? "This household is too large to save. Remove some history or notes, then retry sync." : response.status === 422 ? "Some changes are invalid. Check the edited dates and fields, then retry sync." : "Changes could not be saved. Your edits are still here. Retry sync when connected." });
        return;
      }
      const saved = savedSchema.parse(await response.json());
      if (!this.active || generation !== this.generation) return;
      this.base = saved.items ?? items;
      this.publish({ revision: saved.revision, status: equal(this.state.items, this.base) ? "saved" : "saving", message: "", conflicts: [] });
    } catch {
      if (this.active && generation === this.generation) this.publish({ status: "error", message: "The save could not be confirmed. Your edits are still here. Retry sync to check the saved copy." });
    } finally {
      timeout.clear();
      if (generation === this.generation) {
        this.writing = false;
        if (this.state.status === "saving") this.schedule();
      }
    }
  }
  async retry(choice?: "local" | "remote") {
    if (!this.active || this.writing || this.reading) return;
    clearTimeout(this.timer);
    if (this.saveRows && this.state.status === "error" && this.state.dirty && !choice) {
      this.publish({ status: "saving" });
      await this.flush();
      return;
    }
    this.reading = true;
    const generation = this.generation;
    this.publish({ refreshing: true });
    try {
      const remote = await this.read();
      if (!this.active || generation !== this.generation) return;
      if (!this.state.dirty) { this.accept(remote); return; }
      const merged = mergeHouseholdItems(this.base, this.state.items, remote.items, choice);
      if (merged.conflicts.length && !choice) {
        this.publish({ status: "conflict", message: "These items were changed here and on another device. Choose which edits to keep for these items; other changes will be combined.", conflicts: merged.conflicts });
        return;
      }
      this.base = remote.items;
      this.publish({ items: merged.items, revision: remote.revision, status: equal(merged.items, remote.items) ? "saved" : "saving", message: "", conflicts: [] });
    } catch {
      if (this.active && generation === this.generation) this.publish({ status: "error", message: "Could not check saved data. Your edits are still here. Try again when connected." });
    } finally {
      if (generation === this.generation) {
        this.reading = false;
        this.publish({ refreshing: false });
        if (this.state.status === "saving") this.schedule();
      }
    }
  }
}
