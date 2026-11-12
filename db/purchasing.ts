import { sql } from "drizzle-orm";
import {
  sqliteTable,
  text,
  integer,
  real,
  check,
  index,
  uniqueIndex,
  type AnySQLiteColumn,
} from "drizzle-orm/sqlite-core";

export const shoppingItems = sqliteTable(
  "shopping_items",
  {
    id: text("id").primaryKey().notNull(),
    version: integer("version").notNull(),
    createdAt: text("created_at").notNull(),
    updatedAt: text("updated_at").notNull(),
    archivedAt: text("archived_at"),
    name: text("name").notNull(),
    category: text("category").notNull(),
    notes: text("notes").notNull(),
    imageUrl: text("image_url").notNull(),
    defaultUnit: text("default_unit").notNull(),
    mergedIntoId: text("merged_into_id").references(
      (): AnySQLiteColumn => shoppingItems.id,
    ),
  },
  (t) => [check("shopping_items_version", sql`${t.version} >= 1`)],
);

export const shoppingProducts = sqliteTable(
  "shopping_products",
  {
    id: text("id").primaryKey().notNull(),
    version: integer("version").notNull(),
    createdAt: text("created_at").notNull(),
    updatedAt: text("updated_at").notNull(),
    archivedAt: text("archived_at"),
    itemId: text("item_id")
      .notNull()
      .references((): AnySQLiteColumn => shoppingItems.id),
    name: text("name").notNull(),
    brand: text("brand").notNull(),
    packageQuantity: real("package_quantity").notNull(),
    packageUnit: text("package_unit").notNull(),
    upc: text("upc").notNull(),
    sku: text("sku").notNull(),
    imageUrl: text("image_url").notNull(),
    preference: integer("preference").notNull(),
  },
  (t) => [
    check("shopping_products_version", sql`${t.version} >= 1`),
    check("shopping_products_valid_0", sql`package_quantity > 0`),
    check("shopping_products_valid_1", sql`preference >= 0`),
    index("shopping_products_item_id").on(t.itemId),
  ],
);

export const shoppingStores = sqliteTable(
  "shopping_stores",
  {
    id: text("id").primaryKey().notNull(),
    version: integer("version").notNull(),
    createdAt: text("created_at").notNull(),
    updatedAt: text("updated_at").notNull(),
    archivedAt: text("archived_at"),
    name: text("name").notNull(),
    color: text("color").notNull(),
    logoUrl: text("logo_url").notNull(),
    website: text("website").notNull(),
    notes: text("notes").notNull(),
  },
  (t) => [check("shopping_stores_version", sql`${t.version} >= 1`)],
);

export const shoppingLocations = sqliteTable(
  "shopping_locations",
  {
    id: text("id").primaryKey().notNull(),
    version: integer("version").notNull(),
    createdAt: text("created_at").notNull(),
    updatedAt: text("updated_at").notNull(),
    archivedAt: text("archived_at"),
    storeId: text("store_id")
      .notNull()
      .references((): AnySQLiteColumn => shoppingStores.id),
    name: text("name").notNull(),
    address: text("address").notNull(),
    city: text("city").notNull(),
    region: text("region").notNull(),
    postalCode: text("postal_code").notNull(),
    latitude: real("latitude"),
    longitude: real("longitude"),
    storeIdentifier: text("store_identifier").notNull(),
    preferred: integer("preferred").notNull(),
  },
  (t) => [
    check("shopping_locations_version", sql`${t.version} >= 1`),
    check("shopping_locations_valid_0", sql`preferred IN (0,1)`),
    index("shopping_locations_store_id").on(t.storeId),
    uniqueIndex("shopping_locations_preferred")
      .on(t.storeId)
      .where(sql`${t.preferred} = 1 AND ${t.archivedAt} IS NULL`),
  ],
);

export const shoppingOfferings = sqliteTable(
  "shopping_offerings",
  {
    id: text("id").primaryKey().notNull(),
    version: integer("version").notNull(),
    createdAt: text("created_at").notNull(),
    updatedAt: text("updated_at").notNull(),
    archivedAt: text("archived_at"),
    productId: text("product_id")
      .notNull()
      .references((): AnySQLiteColumn => shoppingProducts.id),
    storeId: text("store_id")
      .notNull()
      .references((): AnySQLiteColumn => shoppingStores.id),
    locationId: text("location_id").references(
      (): AnySQLiteColumn => shoppingLocations.id,
    ),
    preference: integer("preference").notNull(),
    url: text("url").notNull(),
    notes: text("notes").notNull(),
  },
  (t) => [
    check("shopping_offerings_version", sql`${t.version} >= 1`),
    index("shopping_offerings_product_id").on(t.productId),
    index("shopping_offerings_store_id").on(t.storeId),
    index("shopping_offerings_location_id").on(t.locationId),
  ],
);

export const shoppingEntries = sqliteTable(
  "shopping_entries",
  {
    id: text("id").primaryKey().notNull(),
    version: integer("version").notNull(),
    createdAt: text("created_at").notNull(),
    updatedAt: text("updated_at").notNull(),
    archivedAt: text("archived_at"),
    itemId: text("item_id")
      .notNull()
      .references((): AnySQLiteColumn => shoppingItems.id),
    listId: text("list_id").notNull(),
    status: text("status").notNull(),
    notes: text("notes").notNull(),
    priority: integer("priority").notNull(),
    sortPosition: integer("sort_position").notNull(),
    completedAt: text("completed_at"),
  },
  (t) => [
    check("shopping_entries_version", sql`${t.version} >= 1`),
    check(
      "shopping_entries_valid_0",
      sql`status IN ('active','completed','removed')`,
    ),
    index("shopping_entries_item_id").on(t.itemId),
    index("shopping_entries_status").on(t.status),
    uniqueIndex("shopping_entries_active")
      .on(t.listId, t.itemId)
      .where(sql`${t.status} = 'active'`),
  ],
);

export const shoppingPlans = sqliteTable(
  "shopping_plans",
  {
    id: text("id").primaryKey().notNull(),
    version: integer("version").notNull(),
    createdAt: text("created_at").notNull(),
    updatedAt: text("updated_at").notNull(),
    archivedAt: text("archived_at"),
    entryId: text("entry_id")
      .notNull()
      .references((): AnySQLiteColumn => shoppingEntries.id),
    offeringId: text("offering_id")
      .notNull()
      .references((): AnySQLiteColumn => shoppingOfferings.id),
    quantity: integer("quantity").notNull(),
  },
  (t) => [
    check("shopping_plans_version", sql`${t.version} >= 1`),
    check("shopping_plans_valid_0", sql`quantity >= 0`),
    check("shopping_plans_valid_1", sql`quantity <= 10000`),
    index("shopping_plans_entry_id").on(t.entryId),
    uniqueIndex("shopping_plans_pair").on(t.entryId, t.offeringId),
  ],
);

export const shoppingPrices = sqliteTable(
  "shopping_prices",
  {
    id: text("id").primaryKey().notNull(),
    version: integer("version").notNull(),
    createdAt: text("created_at").notNull(),
    updatedAt: text("updated_at").notNull(),
    archivedAt: text("archived_at"),
    offeringId: text("offering_id")
      .notNull()
      .references((): AnySQLiteColumn => shoppingOfferings.id),
    locationId: text("location_id").references(
      (): AnySQLiteColumn => shoppingLocations.id,
    ),
    amount: integer("amount").notNull(),
    currency: text("currency").notNull(),
    observedAt: text("observed_at").notNull(),
    source: text("source").notNull(),
    sourceUrl: text("source_url").notNull(),
    reference: text("reference").notNull(),
    verified: integer("verified").notNull(),
    conditions: text("conditions").notNull(),
    expiresAt: text("expires_at"),
    notes: text("notes").notNull(),
    actor: text("actor").notNull(),
    packageQuantity: real("package_quantity").notNull(),
    packageUnit: text("package_unit").notNull(),
    snapshotJson: text("snapshot_json").notNull(),
  },
  (t) => [
    check("shopping_prices_version", sql`${t.version} >= 1`),
    check("shopping_prices_valid_0", sql`amount >= 0`),
    check("shopping_prices_valid_1", sql`verified IN (0,1)`),
    check("shopping_prices_valid_2", sql`json_valid(snapshot_json)`),
    index("shopping_prices_offering_id").on(t.offeringId),
    index("shopping_prices_observed_at").on(t.observedAt),
    index("shopping_prices_latest").on(
      t.offeringId,
      t.locationId,
      t.observedAt,
      t.createdAt,
      t.id,
    ),
  ],
);

export const shoppingOutcomes = sqliteTable(
  "shopping_outcomes",
  {
    id: text("id").primaryKey().notNull(),
    version: integer("version").notNull(),
    createdAt: text("created_at").notNull(),
    updatedAt: text("updated_at").notNull(),
    archivedAt: text("archived_at"),
    entryId: text("entry_id")
      .notNull()
      .references((): AnySQLiteColumn => shoppingEntries.id),
    itemId: text("item_id")
      .notNull()
      .references((): AnySQLiteColumn => shoppingItems.id),
    productId: text("product_id")
      .notNull()
      .references((): AnySQLiteColumn => shoppingProducts.id),
    storeId: text("store_id")
      .notNull()
      .references((): AnySQLiteColumn => shoppingStores.id),
    locationId: text("location_id").references(
      (): AnySQLiteColumn => shoppingLocations.id,
    ),
    offeringId: text("offering_id")
      .notNull()
      .references((): AnySQLiteColumn => shoppingOfferings.id),
    kind: text("kind").notNull(),
    quantity: integer("quantity").notNull(),
    packagePrice: integer("package_price"),
    totalPrice: integer("total_price"),
    currency: text("currency").notNull(),
    occurredAt: text("occurred_at").notNull(),
    notes: text("notes").notNull(),
    tripId: text("trip_id"),
    keepOnList: integer("keep_on_list").notNull(),
    source: text("source").notNull(),
    actor: text("actor").notNull(),
    snapshotJson: text("snapshot_json").notNull(),
    reversedAt: text("reversed_at"),
    correctionOfId: text("correction_of_id").references(
      (): AnySQLiteColumn => shoppingOutcomes.id,
    ),
    correctionReason: text("correction_reason").notNull(),
  },
  (t) => [
    check("shopping_outcomes_version", sql`${t.version} >= 1`),
    check(
      "shopping_outcomes_valid_0",
      sql`kind IN ('purchased','out_of_stock','skipped')`,
    ),
    check("shopping_outcomes_valid_1", sql`quantity >= 0`),
    check(
      "shopping_outcomes_valid_2",
      sql`package_price IS NULL OR package_price >= 0`,
    ),
    check(
      "shopping_outcomes_valid_3",
      sql`total_price IS NULL OR total_price >= 0`,
    ),
    check("shopping_outcomes_valid_4", sql`json_valid(snapshot_json)`),
    index("shopping_outcomes_item_id").on(t.itemId),
    index("shopping_outcomes_product_id").on(t.productId),
    index("shopping_outcomes_store_id").on(t.storeId),
    index("shopping_outcomes_location_id").on(t.locationId),
    index("shopping_outcomes_occurred_at").on(t.occurredAt),
    index("shopping_outcomes_trip_id").on(t.tripId),
    index("shopping_outcomes_latest")
      .on(t.entryId, t.offeringId, t.occurredAt, t.createdAt, t.id)
      .where(sql`${t.reversedAt} IS NULL`),
  ],
);

export const shoppingState = sqliteTable(
  "shopping_state",
  {
    id: integer("id").primaryKey(),
    revision: integer("revision").notNull().default(0),
  },
  (t) => [check("shopping_state_singleton", sql`${t.id}=1`)],
);
export const shoppingReceipts = sqliteTable(
  "shopping_receipts",
  {
    id: text("id").primaryKey().notNull(),
    requestHash: text("request_hash").notNull(),
    expectedRevision: integer("expected_revision").notNull(),
    responseJson: text("response_json").notNull(),
    actor: text("actor").notNull(),
    createdAt: text("created_at").notNull(),
  },
  (t) => [check("shopping_receipt_json", sql`json_valid(${t.responseJson})`)],
);
export const shoppingAudit = sqliteTable(
  "shopping_audit",
  {
    sequence: integer("sequence").primaryKey({ autoIncrement: true }),
    mutationId: text("mutation_id")
      .notNull()
      .references(() => shoppingReceipts.id),
    entity: text("entity").notNull(),
    entityId: text("entity_id").notNull(),
    beforeJson: text("before_json"),
    afterJson: text("after_json").notNull(),
    createdAt: text("created_at").notNull(),
  },
  (t) => [index("shopping_audit_entity").on(t.entity, t.entityId, t.sequence)],
);
export const shoppingRateLimits = sqliteTable("shopping_rate_limits", {
  actor: text("actor").primaryKey().notNull(),
  bucket: integer("bucket").notNull(),
  count: integer("count").notNull(),
});
