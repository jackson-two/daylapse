// Synthetic, executable MCP recipes. $step.path resolves a prior tool response.
// Expected values are response subsets; generated IDs/timestamps/revisions vary.
export type RecipeStep = {
  id: string;
  tool: "shopping_query" | "shopping_mutate";
  arguments: Record<string, unknown>;
  expected: Record<string, unknown>;
  note?: string;
  isError?: boolean;
};
const query = (id: string, args: Record<string, unknown>, expected: Record<string, unknown>, note?: string): RecipeStep =>
  ({ id, tool: "shopping_query", arguments: { query: args }, expected, note });
const mutate = (id: string, args: Record<string, unknown>, expected: Record<string, unknown>, note?: string): RecipeStep =>
  ({ id, tool: "shopping_mutate", arguments: { command: { mutationId: `example-${id}`, expectedVersion: 0, ...args } }, expected, note });
const save = (id: string, entity: string, recordId: string, data: Record<string, unknown>) =>
  mutate(id, { operation: "save", entity, id: recordId, data }, { record: { id: recordId, version: 1, ...data } });
const when = "2026-11-13T18:30:00.000Z";
export const recipes: Record<string, { purpose: string; steps: RecipeStep[] }> = {
  A: {
    purpose: "Create Diet Pepsi with a Costco offering and one-package plan in an empty synthetic workspace. Client generates catalog IDs and unique mutation IDs; entry/plan/observation/outcome IDs come from server results. Before real creation search items/stores and reuse existing matches; examples assume no match. $step.path is a substitution instruction, never a literal tool value. Expected responses are subsets: all successful mutations also return revision; records include server timestamps/version/IDs and defaults. Run A–F sequentially only in isolated fixtures, never against household data as a demonstration.",
    steps: [
      query("findItem", { view: "items", search: "Diet Pepsi" }, { records: [], nextCursor: null }),
      save("item", "items", "diet-pepsi", { name: "Diet Pepsi", category: "Drinks" }),
      query("findCostco", { view: "stores", search: "Costco" }, { records: [], nextCursor: null }),
      save("costco", "stores", "costco", { name: "Costco" }),
      save("pack36", "products", "diet-pepsi-36", { itemId: "$item.record.id", name: "Diet Pepsi 36-pack", brand: "Pepsi", packageQuantity: 36, packageUnit: "can" }),
      save("costcoOffer", "offerings", "costco-pepsi-36", { productId: "$pack36.record.id", storeId: "$costco.record.id" }),
      mutate("add", { operation: "list", itemId: "$item.record.id", action: "add" }, { record: { itemId: "diet-pepsi", status: "active", version: 1 } }, "Save returned record.id as entry ID; no client-generated entry ID argument exists."),
      mutate("costcoPlan", { operation: "quantity", entryId: "$add.record.id", offeringId: "$costcoOffer.record.id", expectedVersion: "$add.record.version", quantity: 1 }, { record: { id: "$add.record.id", version: 2 } }),
      query("planned", { view: "snapshot" }, { plans: [{ entryId: "$add.record.id", offeringId: "costco-pepsi-36", quantity: 1 }] }),
    ],
  },
  B: {
    purpose: "Add independent alternatives: Costco 36-pack ×1, Fry's 15-pack ×2, Sam's Club 36-pack ×1. Reuse the same generic item/entry and matching 36-pack variant. Do not add 36+30+36 cans as household demand.",
    steps: [
      query("findFrys", { view: "stores", search: "Fry's" }, { records: [], nextCursor: null }),
      save("frys", "stores", "frys", { name: "Fry's" }),
      query("findSams", { view: "stores", search: "Sam's Club" }, { records: [], nextCursor: null }),
      save("sams", "stores", "sams", { name: "Sam's Club" }),
      save("pack15", "products", "diet-pepsi-15", { itemId: "$item.record.id", name: "Diet Pepsi 15-pack", brand: "Pepsi", packageQuantity: 15, packageUnit: "can" }),
      save("frysOffer", "offerings", "frys-pepsi-15", { productId: "$pack15.record.id", storeId: "$frys.record.id" }),
      save("samsOffer", "offerings", "sams-pepsi-36", { productId: "$pack36.record.id", storeId: "$sams.record.id" }),
      mutate("frysPlan", { operation: "quantity", entryId: "$add.record.id", offeringId: "$frysOffer.record.id", expectedVersion: "$costcoPlan.record.version", quantity: 2 }, { record: { version: 3 } }),
      mutate("samsPlan", { operation: "quantity", entryId: "$add.record.id", offeringId: "$samsOffer.record.id", expectedVersion: "$frysPlan.record.version", quantity: 1 }, { record: { version: 4 } }),
      query("alternatives", { view: "snapshot" }, {
        plans: [
          { offeringId: "costco-pepsi-36", quantity: 1 },
          { offeringId: "frys-pepsi-15", quantity: 2 },
          { offeringId: "sams-pepsi-36", quantity: 1 },
        ]
      }),
    ],
  },
  C: {
    purpose: "Record synthetic price evidence, not a completed purchase. Read item detail to obtain exact product, package and offering match plus offering version. Unknown price means skip observation and report unknown; never submit zero. This URL and amount are fixtures, not claims about retailer prices.",
    steps: [
      query("beforePrice", { view: "item", id: "$item.record.id" }, { offerings: [{ id: "costco-pepsi-36", version: 1 }] }),
      mutate("price", { operation: "price", expectedVersion: "$beforePrice.offerings.0.version", data: { offeringId: "$costcoOffer.record.id", locationId: null, amount: 1799, currency: "USD", observedAt: when, source: "research", sourceUrl: "https://example.com/synthetic-diet-pepsi", reference: "Synthetic 36-can package, Costco example; no live retailer claim", verified: false, conditions: "Illustrative membership price; verify membership and promotion", expiresAt: "2026-11-20T18:30:00.000Z" } }, { record: { amount: 1799, verified: false, source: "research", version: 1 } }),
      query("afterPrice", { view: "item", id: "$item.record.id" }, { offerings: [{ id: "costco-pepsi-36", version: 2 }], prices: [{ amount: 1799 }] }),
    ],
  },
  D: {
    purpose: "Read entry and offering, record actual paid price, then verify history and completed entry. keepOnList=true would keep the need active. A price observation and actual purchase can have different prices. Exact repeated mutation returns original response/revision, no duplicate purchase.",
    steps: [
      query("beforePurchase", { view: "snapshot" }, { entries: [{ id: "$add.record.id", status: "active", version: 4 }], offerings: [{ id: "costco-pepsi-36", version: 2 }] }),
      mutate("purchase", { operation: "outcome", expectedVersion: "$beforePurchase.entries.0.version", data: { entryId: "$add.record.id", offeringId: "$costcoOffer.record.id", kind: "purchased", quantity: 1, packagePrice: 1699, totalPrice: 1699, currency: "USD", occurredAt: when, keepOnList: false, tripId: "synthetic-trip" } }, { record: { kind: "purchased", quantity: 1, totalPrice: 1699, version: 1 } }),
      { id: "retryPurchase", tool: "shopping_mutate", arguments: { command: "$purchase.request.command" }, expected: { record: { id: "$purchase.record.id" }, revision: "$purchase.revision" }, note: "Re-send the exact saved request after a lost response; do not allocate a new mutationId." },
      query("purchasedHistory", { view: "history", itemId: "$item.record.id", limit: 50 }, { records: [{ id: "$purchase.record.id", kind: "purchased", totalPrice: 1699 }], nextCursor: null }),
      query("completed", { view: "snapshot" }, { entries: [{ id: "$add.record.id", status: "completed", version: 5 }] }),
    ],
  },
  E: {
    purpose: "Separate unsuccessful attempts after deliberately reactivating the need. Both use zero packages and unknown (null) paid prices; neither completes the entry. Re-read entry after every outcome because its version advances even on unsuccessful attempts.",
    steps: [
      mutate("reactivate", { operation: "list", itemId: "$item.record.id", action: "reactivate", expectedVersion: "$completed.entries.0.version" }, { record: { status: "active", version: 6 } }),
      mutate("unavailable", { operation: "outcome", expectedVersion: "$reactivate.record.version", data: { entryId: "$add.record.id", offeringId: "$frysOffer.record.id", kind: "out_of_stock", quantity: 0, packagePrice: null, totalPrice: null, occurredAt: when, notes: "Synthetic empty shelf" } }, { record: { kind: "out_of_stock", quantity: 0 } }),
      query("afterUnavailable", { view: "snapshot" }, { entries: [{ status: "active", version: 7 }] }),
      mutate("skipped", { operation: "outcome", expectedVersion: "$afterUnavailable.entries.0.version", data: { entryId: "$add.record.id", offeringId: "$samsOffer.record.id", kind: "skipped", quantity: 0, packagePrice: null, totalPrice: null, occurredAt: when, notes: "Synthetic deliberate skip" } }, { record: { kind: "skipped", quantity: 0 } }),
      query("afterSkipped", { view: "snapshot" }, { entries: [{ status: "active", version: 8 }] }),
    ],
  },
  F: {
    purpose: "Synthetic conflict demonstration: another user changes notes after a read. Keep both versions, read current, and only after deliberate user reconciliation send new arguments with a new mutationId. Never blindly overwrite. The conflict here is a test of recovery, not a way to discover parameters.",
    steps: [
      query("beforeConflict", { view: "snapshot" }, { entries: [{ version: 8 }] }),
      mutate("otherUserEdit", { operation: "list", action: "update", itemId: "$item.record.id", expectedVersion: "$beforeConflict.entries.0.version", notes: "Other user's note" }, { record: { version: 9 } }, "Simulates a separate user's change in the isolated fixture."),
      { ...mutate("conflict", { operation: "list", action: "update", itemId: "$item.record.id", expectedVersion: "$beforeConflict.entries.0.version", notes: "My retained draft" }, { status: 409, code: "version_conflict", current: { version: 9, notes: "Other user's note" } }), isError: true },
      query("fresh", { view: "snapshot" }, { entries: [{ version: 9, notes: "Other user's note" }] }),
      mutate("reconciled", { operation: "list", action: "update", itemId: "$item.record.id", expectedVersion: "$fresh.entries.0.version", notes: "Other user's note; my addition agreed after review" }, { record: { version: 10, notes: "Other user's note; my addition agreed after review" } }, "Requires the user's deliberate reconciliation; new ID example-reconciled replaces confirmed failed example-conflict."),
    ],
  },
};
