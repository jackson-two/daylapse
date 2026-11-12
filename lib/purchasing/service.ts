import { z } from "zod";
import { canonical, digest } from "../row-converter";
import { RowRepository } from "../row-repository";
import { columns, type Table } from "./columns";
import {
  commandSchema,
  fields,
  querySchema,
  ShoppingError,
  scalar,
  numeric,
  unitPrice,
  type Command,
  type Context,
  type EntityName,
  type Query,
  type ShopRecord,
} from "./schema";

const snakeColumns = (table: Table) =>
  Object.entries(columns[table])
    .map(([key, col]) => `${col} AS "${key}"`)
    .join(",");
function decode(row: Record<string, unknown>): ShopRecord {
  for (const key of ["preferred", "verified", "keepOnList"])
    if (key in row) row[key] = !!row[key];
  return row as ShopRecord;
}
type Write = { table: Table; before: ShopRecord | null; after: ShopRecord };
export type MutationResult = { record: ShopRecord; revision: number };
export class PurchasingService {
  constructor(
    readonly db: D1Database,
    readonly context: Context,
  ) {}
  async ready() {
    await new RowRepository(this.db).requireEnabled();
  }
  async revision() {
    return Number(
      (
        await this.db
          .prepare("SELECT revision FROM shopping_state WHERE id=1")
          .first<{ revision: number }>()
      )?.revision ?? 0,
    );
  }
  async get(table: Table, id: string) {
    const row = await this.db
      .prepare(
        `SELECT ${snakeColumns(table)} FROM shopping_${table} WHERE id=?`,
      )
      .bind(id)
      .first<Record<string, unknown>>();
    return row ? decode(row) : null;
  }
  async rows(
    table: Table,
    where = "1",
    values: (string | number | null)[] = [],
    limit = 501,
    order = "id",
  ) {
    const result = await this.db
      .prepare(
        `SELECT ${snakeColumns(table)} FROM shopping_${table} WHERE ${where} ORDER BY ${order} LIMIT ?`,
      )
      .bind(...values, limit)
      .all<Record<string, unknown>>();
    return result.results.map(decode);
  }
  private async required(table: Table, id: string, active = true) {
    const row = await this.get(table, id);
    if (!row)
      throw new ShoppingError(
        404,
        "not_found",
        `${table} record no longer exists.`,
      );
    if (active && (row.archivedAt || row.mergedIntoId))
      throw new ShoppingError(
        409,
        "archived",
        "Restore this record before using it.",
        row,
      );
    return row;
  }
  private version(row: ShopRecord | null, version: number) {
    if ((row?.version ?? 0) !== version)
      throw new ShoppingError(
        409,
        "version_conflict",
        "This record changed. Keep your draft and compare with the latest version before saving.",
        row,
      );
  }
  private async receipt(
    id: string,
    hash: string,
  ): Promise<MutationResult | null> {
    const row = await this.db
      .prepare(
        "SELECT request_hash,response_json FROM shopping_receipts WHERE id=?",
      )
      .bind(id)
      .first<{ request_hash: string; response_json: string }>();
    if (!row) return null;
    if (row.request_hash !== hash)
      throw new ShoppingError(
        409,
        "mutation_id_reused",
        "Use a new mutation ID for a different operation.",
      );
    return JSON.parse(row.response_json);
  }
  async mutate(input: unknown): Promise<MutationResult> {
    if (this.context.permission !== "write")
      throw new ShoppingError(
        403,
        "read_only",
        "This agent has read-only purchasing access.",
      );
    const command = commandSchema.parse(input);
    await this.ready();
    const hash = await digest({
      command,
      actor: this.context.actor,
      source: this.context.source,
    });
    for (let attempt = 0; attempt < 3; attempt++) {
      const replay = await this.receipt(command.mutationId, hash);
      if (replay) return replay;
      const revision = await this.revision();
      try {
        const { writes, record } = await this.plan(command);
        const at = new Date().toISOString();
        const result = { record, revision: revision + 1 };
        if (JSON.stringify(writes).length > 500_000)
          throw new ShoppingError(
            413,
            "too_large",
            "This change is too large; no records were changed.",
          );
        const statements = [
          this.db
            .prepare(
              "INSERT INTO shopping_receipts (id,request_hash,expected_revision,response_json,actor,created_at) VALUES (?,?,?,?,?,?)",
            )
            .bind(
              command.mutationId,
              hash,
              revision,
              JSON.stringify(result),
              this.context.actor,
              at,
            ),
        ];
        for (const w of writes) {
          const entries = Object.entries(columns[w.table]);
          const values = entries.map(([key]) => {
            const value = w.after[key];
            return typeof value === "boolean"
              ? Number(value)
              : value === undefined
                ? null
                : (value as string | number | null);
          });
          statements.push(
            w.before
              ? this.db
                  .prepare(
                    `UPDATE shopping_${w.table} SET ${entries
                      .filter(([k]) => k !== "id")
                      .map(([, c]) => `${c}=?`)
                      .join(",")} WHERE id=?`,
                  )
                  .bind(
                    ...entries.flatMap(([k], i) =>
                      k === "id" ? [] : [values[i]],
                    ),
                    w.after.id,
                  )
              : this.db
                  .prepare(
                    `INSERT INTO shopping_${w.table} (${entries.map(([, c]) => c).join(",")}) VALUES (${entries.map(() => "?").join(",")})`,
                  )
                  .bind(...values),
          );
          statements.push(
            this.db
              .prepare(
                "INSERT INTO shopping_audit (mutation_id,entity,entity_id,before_json,after_json,created_at) VALUES (?,?,?,?,?,?)",
              )
              .bind(
                command.mutationId,
                w.table,
                w.after.id,
                w.before ? JSON.stringify(w.before) : null,
                JSON.stringify(w.after),
                at,
              ),
          );
        }
        await this.db.batch(statements);
        return result;
      } catch (error) {
        const replay = await this.receipt(command.mutationId, hash);
        if (replay) return replay;
        // Any intervening purchasing mutation invalidates the whole read/plan.
        // Replan unrelated edits, but keep the user's expected entity version.
        if ((await this.revision()) !== revision) continue;
        throw error;
      }
    }
    throw new ShoppingError(
      409,
      "busy",
      "Shopping changed while saving. Retry the same request.",
    );
  }
  private async plan(c: Command) {
    const writes: Write[] = [],
      at = new Date().toISOString();
    const save = (
      table: Table,
      before: ShopRecord | null,
      data: Record<string, unknown>,
      fixedId?: string,
    ) => {
      const existing =
        before &&
        writes.find((w) => w.table === table && w.after.id === before.id);
      const after = {
        ...before,
        ...data,
        id: fixedId ?? before?.id ?? crypto.randomUUID(),
        createdAt: before?.createdAt ?? at,
        updatedAt: at,
        archivedAt:
          data.archivedAt === undefined
            ? (before?.archivedAt ?? null)
            : data.archivedAt,
        version: (before?.version ?? 0) + 1,
      } as ShopRecord;
      if (existing) existing.after = { ...existing.after, ...data };
      else writes.push({ table, before, after });
      return existing?.after ?? after;
    };
    const activeEntry = async (itemId: string) =>
      (
        await this.rows(
          "entries",
          "item_id=? AND list_id='household'",
          [itemId],
          1,
          "CASE WHEN status='active' THEN 0 ELSE 1 END, created_at DESC,id DESC",
        )
      )[0] ?? null;
    const offerContext = async (
      offeringId: string,
      locationId: string | null,
      active = true,
    ) => {
      const offering = await this.required("offerings", offeringId, active);
      const product = await this.required(
        "products",
        scalar(offering, "productId"),
        active,
      );
      const item = await this.required(
        "items",
        scalar(product, "itemId"),
        active,
      );
      const store = await this.required(
        "stores",
        scalar(offering, "storeId"),
        active,
      );
      const location =
        locationId || offering.locationId
          ? await this.required(
              "locations",
              locationId ?? scalar(offering, "locationId"),
              active,
            )
          : null;
      if (
        (location && location.storeId !== store.id) ||
        (offering.locationId && location?.id !== offering.locationId)
      )
        throw new ShoppingError(
          422,
          "location_mismatch",
          "The location must belong to this retailer and match the offering.",
        );
      return { offering, product, item, store, location };
    };
    if (c.operation === "save" || c.operation === "archive") {
      const before = await this.get(c.entity, c.id);
      this.version(before, c.expectedVersion);
      if (c.operation === "archive" && !before)
        throw new ShoppingError(404, "not_found", "Record not found.");
      if (before?.mergedIntoId)
        throw new ShoppingError(
          409,
          "merged",
          "This item was merged; use the surviving item.",
          before,
        );
      const data =
        c.operation === "save"
          ? fields[c.entity].parse({
              ...(before &&
                Object.fromEntries(
                  Object.keys(fields[c.entity].shape).map((k) => [
                    k,
                    before[k],
                  ]),
                )),
              ...c.data,
            })
          : {};
      const merged: Record<string, unknown> = { ...before, ...data };
      // Moving identities between parents would rewrite the meaning of old offers.
      const parentKeys: Partial<Record<EntityName, string[]>> = {
        products: ["itemId"],
        locations: ["storeId"],
        offerings: ["productId", "storeId", "locationId"],
      };
      for (const key of parentKeys[c.entity] ?? [])
        if (before && canonical(before[key]) !== canonical(merged[key]))
          throw new ShoppingError(
            422,
            "immutable_relationship",
            "Archive this association and create a new one to change its product, retailer, or location.",
          );
      const restoring = c.operation === "archive" && !c.archived;
      if (c.operation === "save" || restoring) {
        if (merged.itemId) await this.required("items", String(merged.itemId));
        if (merged.storeId)
          await this.required("stores", String(merged.storeId));
        if (merged.productId) {
          const p = await this.required("products", String(merged.productId));
          await this.required("items", scalar(p, "itemId"));
        }
        if (merged.locationId) {
          const l = await this.required("locations", String(merged.locationId));
          if (l.storeId !== merged.storeId)
            throw new ShoppingError(
              422,
              "location_mismatch",
              "Choose a location belonging to this retailer.",
            );
        }
        if (["items", "stores"].includes(c.entity)) {
          const duplicate = await this.rows(
            c.entity,
            "lower(trim(name))=lower(trim(?)) AND id<>? AND archived_at IS NULL",
            [String(merged.name), c.id],
            1,
          );
          if (duplicate.length)
            throw new ShoppingError(
              409,
              "duplicate",
              "An active record already has this name. Select it or merge duplicate catalog items.",
              duplicate[0],
            );
        }
      }
      if (
        c.entity === "locations" &&
        merged.preferred &&
        (c.operation === "save" || restoring)
      ) {
        for (const prior of await this.rows(
          "locations",
          "store_id=? AND preferred=1 AND id<>?",
          [String(merged.storeId), c.id],
        ))
          save("locations", prior, { preferred: false });
      }
      const record = save(
        c.entity,
        before,
        {
          ...data,
          ...(c.entity === "items" && !before ? { mergedIntoId: null } : {}),
          ...(c.operation === "archive"
            ? { archivedAt: c.archived ? at : null }
            : {}),
        },
        c.id,
      );
      return { writes, record };
    }
    if (c.operation === "merge") {
      if (c.id === c.targetId)
        throw new ShoppingError(
          422,
          "same_item",
          "Choose two different catalog items.",
        );
      const source = await this.required("items", c.id),
        target = await this.required("items", c.targetId);
      this.version(source, c.expectedVersion);
      this.version(target, c.targetVersion);
      const products = await this.rows("products", "item_id=?", [source.id]);
      if (products.length > 500)
        throw new ShoppingError(
          413,
          "too_large",
          "Too many variants to merge at once.",
        );
      for (const p of products) save("products", p, { itemId: target.id });
      const from = await activeEntry(source.id),
        to = await activeEntry(target.id);
      if (from?.status === "active") {
        if (to?.status === "active") {
          const plans = await this.rows("plans", "entry_id=?", [from.id], 501);
          if (plans.length > 500)
            throw new ShoppingError(
              413,
              "too_large",
              "Too many options to merge at once.",
            );
          for (const p of plans) save("plans", p, { entryId: to.id });
          save("entries", from, { status: "removed", completedAt: at });
          save("entries", to, {});
        } else save("entries", from, { itemId: target.id });
      }
      save("items", source, { archivedAt: at, mergedIntoId: target.id });
      return { writes, record: save("items", target, {}) };
    }
    if (c.operation === "list") {
      const item = await this.required("items", c.itemId);
      const entry = await activeEntry(item.id);
      // Adding the already-active item is a safe no-op, even with version zero.
      if (c.action === "add" && entry?.status === "active")
        return { writes, record: entry };
      this.version(entry, c.expectedVersion);
      if (!entry && !["add", "reactivate"].includes(c.action))
        throw new ShoppingError(
          404,
          "not_listed",
          "The item has no shopping entry.",
        );
      const status =
        c.action === "update"
          ? entry!.status
          : ["add", "reactivate"].includes(c.action)
            ? "active"
            : c.action === "remove"
              ? "removed"
              : "completed";
      return {
        writes,
        record: save("entries", entry, {
          itemId: item.id,
          listId: "household",
          status,
          notes: c.notes ?? entry?.notes ?? "",
          priority: c.priority ?? entry?.priority ?? 0,
          sortPosition: c.sortPosition ?? entry?.sortPosition ?? 0,
          completedAt: status === "active" ? null : at,
        }),
      };
    }
    if (c.operation === "quantity") {
      const entry = await this.required("entries", c.entryId);
      this.version(entry, c.expectedVersion);
      const context = await offerContext(c.offeringId, null);
      if (entry.status !== "active" || context.item.id !== entry.itemId)
        throw new ShoppingError(
          422,
          "invalid_plan",
          "Choose an offering for this active item.",
        );
      const prior =
        (
          await this.rows(
            "plans",
            "entry_id=? AND offering_id=?",
            [entry.id, c.offeringId],
            1,
          )
        )[0] ?? null;
      save("plans", prior, {
        entryId: entry.id,
        offeringId: c.offeringId,
        quantity: c.quantity,
      });
      return { writes, record: save("entries", entry, {}) };
    }
    if (c.operation === "price") {
      const context = await offerContext(c.data.offeringId, c.data.locationId);
      this.version(context.offering, c.expectedVersion);
      if (Date.parse(c.data.observedAt) > Date.now() + 300000)
        throw new ShoppingError(
          422,
          "future_price",
          "Observed time cannot be in the future.",
        );
      if (
        c.data.expiresAt &&
        Date.parse(c.data.expiresAt) < Date.parse(c.data.observedAt)
      )
        throw new ShoppingError(
          422,
          "price_expiry",
          "Expiry must follow observation time.",
        );
      const record = save("prices", null, {
        ...c.data,
        locationId: context.location?.id ?? null,
        actor: this.context.actor,
        packageQuantity: context.product.packageQuantity,
        packageUnit: context.product.packageUnit,
        snapshotJson: JSON.stringify(context),
      });
      save("offerings", context.offering, {});
      return { writes, record };
    }
    let data: z.infer<typeof import("./schema").outcomeFields> | null;
    let old: ShopRecord | null = null;
    let entry: ShopRecord;
    if (c.operation === "correct") {
      old = await this.required("outcomes", c.id, false);
      this.version(old, c.expectedVersion);
      if (old.reversedAt)
        throw new ShoppingError(
          409,
          "already_reversed",
          "This outcome was already reversed.",
          old,
        );
      entry = await this.required("entries", scalar(old, "entryId"), false);
      this.version(entry, c.entryVersion);
      if (c.replacement && c.replacement.entryId !== entry.id)
        throw new ShoppingError(
          422,
          "correction_entry",
          "A correction must belong to the original shopping entry.",
        );
      save("outcomes", old, { reversedAt: at, correctionReason: c.reason });
      data = c.replacement;
      if (c.reactivate) {
        const active = await activeEntry(scalar(entry, "itemId"));
        if (active?.status === "active" && active.id !== entry.id)
          throw new ShoppingError(
            409,
            "active_entry_exists",
            "This item already has another active entry.",
            active,
          );
        await this.required("items", scalar(entry, "itemId"));
      }
    } else {
      data = c.data;
      entry = await this.required("entries", data.entryId);
      this.version(entry, c.expectedVersion);
      if (entry.status !== "active")
        throw new ShoppingError(
          409,
          "entry_inactive",
          "This item is no longer on the active list.",
          entry,
        );
    }
    if (!data)
      return {
        writes,
        record: save(
          "entries",
          entry,
          c.operation === "correct" && c.reactivate
            ? { status: "active", completedAt: null }
            : {},
        ),
      };
    const context = await offerContext(
      data.offeringId,
      data.locationId,
      c.operation !== "correct",
    );
    let entryItem = await this.required(
      "items",
      scalar(entry, "itemId"),
      false,
    );
    while (entryItem.mergedIntoId)
      entryItem = await this.required(
        "items",
        scalar(entryItem, "mergedIntoId"),
        false,
      );
    if (context.item.id !== entryItem.id)
      throw new ShoppingError(
        422,
        "item_mismatch",
        "The product must belong to this shopping item.",
      );
    if (Date.parse(data.occurredAt) > Date.now() + 300000)
      throw new ShoppingError(
        422,
        "future_outcome",
        "An outcome cannot be recorded in the future.",
      );
    const totalPrice =
      data.kind === "purchased"
        ? (data.totalPrice ??
          (data.packagePrice === null
            ? null
            : data.packagePrice * data.quantity))
        : null;
    if (totalPrice !== null && totalPrice > 1_000_000_000)
      throw new ShoppingError(
        422,
        "total_too_large",
        "Total price exceeds the supported limit.",
      );
    const record = save("outcomes", null, {
      ...data,
      totalPrice,
      itemId: context.item.id,
      productId: context.product.id,
      storeId: context.store.id,
      locationId: context.location?.id ?? null,
      source: this.context.source,
      actor: this.context.actor,
      snapshotJson: JSON.stringify(context),
      reversedAt: null,
      correctionOfId: old?.id ?? null,
      correctionReason: c.operation === "correct" ? c.reason : "",
    });
    const completed = data.kind === "purchased" && !data.keepOnList;
    save(
      "entries",
      entry,
      completed
        ? { status: "completed", completedAt: at }
        : c.operation === "correct" && c.reactivate
          ? { status: "active", completedAt: null }
          : {},
    );
    return { writes, record };
  }

  async query(input: unknown) {
    const q = querySchema.parse(input);
    await this.ready();
    const revision = await this.revision();
    if (q.revision !== undefined && q.revision !== revision)
      throw new ShoppingError(
        409,
        "page_changed",
        "Shopping changed while paging. Restart from the first page.",
      );
    const result = await this.read(q, revision);
    if ((await this.revision()) !== revision)
      throw new ShoppingError(
        409,
        "page_changed",
        "Shopping changed while reading. Retry the read.",
      );
    return result;
  }
  private async read(
    q: Query,
    revision: number,
  ): Promise<Record<string, unknown>> {
    if (q.view === "snapshot" || q.view === "item" || q.view === "list") {
      const result: Record<string, unknown> = { revision };
      for (const table of [
        "items",
        "products",
        "stores",
        "locations",
        "offerings",
        "entries",
        "plans",
      ] as const) {
        const rows = await this.rows(
          table,
          "1",
          [],
          table === "plans" ? 5001 : 501,
        );
        if (rows.length > (table === "plans" ? 5000 : 500))
          throw new ShoppingError(
            413,
            "snapshot_limit",
            "The shopping workspace exceeds the interactive limit. Use paginated queries/export; no records were discarded.",
          );
        result[table] = rows;
      }
      const prices = await this.db
        .prepare(
          `SELECT ${snakeColumns("prices")} FROM shopping_prices p WHERE id=(SELECT id FROM shopping_prices WHERE offering_id=p.offering_id AND location_id IS p.location_id ORDER BY observed_at DESC,created_at DESC,id DESC LIMIT 1) LIMIT 1001`,
        )
        .all<Record<string, unknown>>();
      if (prices.results.length > 1000)
        throw new ShoppingError(
          413,
          "snapshot_limit",
          "Too many price/location combinations for the interactive view.",
        );
      result.prices = prices.results.map(decode);
      const outcomes = await this.db
        .prepare(
          `SELECT ${snakeColumns("outcomes")} FROM shopping_outcomes o WHERE reversed_at IS NULL AND id=(SELECT id FROM shopping_outcomes WHERE entry_id=o.entry_id AND offering_id=o.offering_id AND reversed_at IS NULL ORDER BY occurred_at DESC,created_at DESC,id DESC LIMIT 1) LIMIT 5001`,
        )
        .all<Record<string, unknown>>();
      if (outcomes.results.length > 5000)
        throw new ShoppingError(
          413,
          "snapshot_limit",
          "Too many offering outcomes for the interactive view.",
        );
      result.outcomes = outcomes.results.map(decode);
      if (q.view === "list") {
        const items = (result.items as ShopRecord[]).filter(
          (r) => !r.archivedAt && !r.mergedIntoId,
        );
        const products = (result.products as ShopRecord[]).filter(
          (r) => !r.archivedAt && items.some((i) => i.id === r.itemId),
        );
        const offers = (result.offerings as ShopRecord[]).filter(
          (r) =>
            !r.archivedAt &&
            products.some((p) => p.id === r.productId) &&
            (result.stores as ShopRecord[]).some(
              (s) => s.id === r.storeId && !s.archivedAt,
            ) &&
            (!r.locationId ||
              (result.locations as ShopRecord[]).some(
                (l) => l.id === r.locationId && !l.archivedAt,
              )) &&
            (!q.storeId || r.storeId === q.storeId) &&
            (!q.locationId || !r.locationId || r.locationId === q.locationId),
        );
        const entries = (result.entries as ShopRecord[]).filter(
          (r) =>
            r.status === "active" &&
            items.some((i) => i.id === r.itemId) &&
            (!(q.storeId || q.locationId) ||
              offers.some((o) =>
                products.some(
                  (p) => p.id === o.productId && p.itemId === r.itemId,
                ),
              )),
        );
        return { ...result, entries, offerings: offers, nextCursor: null };
      }
      if (q.view === "item") {
        const item = (result.items as ShopRecord[]).find((r) => r.id === q.id);
        if (!item)
          throw new ShoppingError(404, "not_found", "Catalog item not found.");
        const products = (result.products as ShopRecord[]).filter(
          (p) => p.itemId === item.id,
        );
        const offers = (result.offerings as ShopRecord[]).filter((o) =>
          products.some((p) => p.id === o.productId),
        );
        return {
          revision,
          item,
          products,
          offerings: offers,
          stores: (result.stores as ShopRecord[]).filter((s) =>
            offers.some((o) => o.storeId === s.id),
          ),
          locations: (result.locations as ShopRecord[]).filter((l) =>
            offers.some((o) => o.storeId === l.storeId),
          ),
          prices: (result.prices as ShopRecord[]).filter((p) =>
            offers.some((o) => o.id === p.offeringId),
          ),
        };
      }
      return result;
    }
    if (["items", "stores"].includes(q.view)) {
      const table = q.view as "items" | "stores";
      const records = await this.rows(
        table,
        `id>? ${q.includeArchived ? "" : "AND archived_at IS NULL"} AND instr(lower(name),lower(?))>0`,
        [q.after, q.search],
        q.limit + 1,
      );
      return {
        revision,
        records: records.slice(0, q.limit),
        nextCursor: records.length > q.limit ? records[q.limit - 1].id : null,
      };
    }
    if (q.view === "audit" || q.view === "export") {
      const rows = await this.db
        .prepare(
          "SELECT * FROM shopping_audit WHERE sequence>? ORDER BY sequence LIMIT ?",
        )
        .bind(Number(q.after || 0), q.limit + 1)
        .all();
      return {
        revision,
        records: rows.results.slice(0, q.limit),
        nextCursor:
          rows.results.length > q.limit
            ? String(rows.results[q.limit - 1].sequence)
            : null,
      };
    }
    const table =
      q.view === "prices" || q.view === "priceSummary" ? "prices" : "outcomes";
    const where: string[] = ["1"],
      values: (string | number | null)[] = [];
    for (const [key, col] of [
      ["offeringId", "offering_id"],
      ["locationId", "location_id"],
      ["tripId", "trip_id"],
    ] as const) {
      if (q[key] && !(table === "prices" && key === "tripId")) {
        where.push(`${col}=?`);
        values.push(q[key]!);
      }
    }
    for (const [key, col] of [
      ["itemId", "item_id"],
      ["productId", "product_id"],
      ["storeId", "store_id"],
    ] as const)
      if (q[key]) {
        if (table === "outcomes") {
          where.push(
            key === "itemId"
              ? `item_id IN (WITH RECURSIVE family(id) AS (SELECT ? UNION ALL SELECT i.id FROM shopping_items i JOIN family f ON i.merged_into_id=f.id) SELECT id FROM family)`
              : `${col}=?`,
          );
          values.push(q[key]!);
        } else {
          where.push(
            `offering_id IN (SELECT o.id FROM shopping_offerings o JOIN shopping_products p ON p.id=o.product_id WHERE ${key === "itemId" ? "p.item_id" : `o.${col}`}=?)`,
          );
          values.push(q[key]!);
        }
      }
    const date = table === "prices" ? "observed_at" : "occurred_at";
    if (q.from) {
      where.push(`${date}>=?`);
      values.push(q.from);
    }
    if (q.to) {
      where.push(`${date}<=?`);
      values.push(q.to);
    }
    if (table === "outcomes" && (!q.includeReversed || q.view === "summary"))
      where.push("reversed_at IS NULL");
    if (q.view === "priceSummary") {
      const records = await this.db
        .prepare(
          `WITH observations AS (SELECT *,
        FIRST_VALUE(amount) OVER (PARTITION BY offering_id,location_id,currency,package_quantity,package_unit ORDER BY observed_at,id ROWS BETWEEN UNBOUNDED PRECEDING AND UNBOUNDED FOLLOWING) AS first_price,
        LAST_VALUE(amount) OVER (PARTITION BY offering_id,location_id,currency,package_quantity,package_unit ORDER BY observed_at,id ROWS BETWEEN UNBOUNDED PRECEDING AND UNBOUNDED FOLLOWING) AS last_price
        FROM shopping_prices WHERE ${where.join(" AND ")})
        SELECT offering_id AS offeringId, location_id AS locationId, currency, package_quantity AS packageQuantity, package_unit AS packageUnit,
        COUNT(*) AS observations, AVG(amount) AS averagePackagePrice, MIN(amount) AS lowestPackagePrice, MAX(amount) AS highestPackagePrice,
        MIN(first_price) AS firstPackagePrice, MIN(last_price) AS latestPackagePrice, MIN(last_price)-MIN(first_price) AS priceChange,
        MIN(observed_at) AS firstObservedAt, MAX(observed_at) AS lastObservedAt
        FROM observations GROUP BY offering_id,location_id,currency,package_quantity,package_unit ORDER BY offering_id LIMIT 501`,
        )
        .bind(...values)
        .all();
      if (records.results.length > 500)
        throw new ShoppingError(
          413,
          "summary_limit",
          "Narrow the item, store or date filters for this summary.",
        );
      return {
        revision,
        records: records.results.map((r) => ({
          ...r,
          averageUnitPrice: unitPrice(
            Number(r.averagePackagePrice),
            Number(r.packageQuantity),
            String(r.packageUnit),
          ),
        })),
      };
    }
    if (q.view === "summary") {
      const condition = where.join(" AND ");
      const totals = await this.db
        .prepare(
          `SELECT currency, SUM(CASE WHEN kind='purchased' THEN quantity ELSE 0 END) AS packages, SUM(CASE WHEN kind='purchased' THEN total_price ELSE 0 END) AS spending, SUM(kind='purchased' AND total_price IS NULL) AS unknownPricePurchases, SUM(kind='out_of_stock') AS outOfStock, SUM(kind='skipped') AS skipped FROM shopping_outcomes WHERE ${condition} GROUP BY currency`,
        )
        .bind(...values)
        .all();
      const last = await this.rows(
        "outcomes",
        `${condition} AND kind='purchased'`,
        values,
        1,
        "occurred_at DESC,id DESC",
      );
      return {
        revision,
        totals: totals.results,
        latestPurchase: last[0] ?? null,
      };
    }
    // Stable keyset cursor, with a revision guard for a consistent multi-page read.
    if (q.after) {
      const anchor = await this.get(table, q.after);
      if (!anchor)
        throw new ShoppingError(
          422,
          "invalid_cursor",
          "Restart from the first page.",
        );
      const dateValue = scalar(
        anchor,
        table === "prices" ? "observedAt" : "occurredAt",
      );
      where.push(`(${date}<? OR (${date}=? AND id<?))`);
      values.push(dateValue, dateValue, q.after);
    }
    const records = await this.rows(
      table,
      where.join(" AND "),
      values,
      q.limit + 1,
      `${date} DESC,id DESC`,
    );
    return {
      revision,
      records: records.slice(0, q.limit).map((r) =>
        table === "prices"
          ? {
              ...r,
              unitPrice: unitPrice(
                numeric(r, "amount"),
                numeric(r, "packageQuantity"),
                scalar(r, "packageUnit"),
              ),
            }
          : r,
      ),
      nextCursor: records.length > q.limit ? records[q.limit - 1].id : null,
    };
  }
}
