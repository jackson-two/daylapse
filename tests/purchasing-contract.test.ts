import assert from "node:assert/strict";
import test from "node:test";
import { execFileSync } from "node:child_process";
import { readFile } from "node:fs/promises";
import { z } from "zod";
import { openLocalRows } from "../scripts/row-storage-local";
import { emptyInitializationSql } from "../scripts/installation-config";
import { handlePurchasingMcp } from "../lib/purchasing/mcp";
import { describePurchasing, versionRules, queryViews } from "../lib/purchasing/contract";
import { fields, querySchema, commandSchema, priceFields, outcomeFields } from "../lib/purchasing/schema";
import { responseSchemas } from "../lib/purchasing/responses";
import { PurchasingService } from "../lib/purchasing/service";
import { testInstallation } from "./fixtures/installation";
import type { RecipeStep } from "../lib/purchasing/recipes";

type ObjectValue = Record<string, unknown>;
function descriptions(schema: unknown, path = "root") {
  if (!schema || typeof schema !== "object") return;
  const value = schema as ObjectValue;
  if (value.properties) for (const [key, field] of Object.entries(value.properties as ObjectValue)) {
    assert.ok(typeof (field as ObjectValue).description === "string" && String((field as ObjectValue).description).length > 20, `${path}.${key} needs meaningful description`);
  }
  for (const [key, child] of Object.entries(value)) {
    if (Array.isArray(child)) child.forEach((v, i) => descriptions(v, `${path}.${key}[${i}]`));
    else if (child && typeof child === "object") descriptions(child, `${path}.${key}`);
  }
}
function subset(actual: unknown, expected: unknown) {
  if (Array.isArray(expected)) {
    assert.ok(Array.isArray(actual));
    if (!expected.length) assert.equal(actual.length, 0);
    for (const sample of expected) assert.ok(actual.some((row) => { try { subset(row, sample); return true; } catch { return false; } }), `Missing expected row ${JSON.stringify(sample)} in ${JSON.stringify(actual)}`);
  } else if (expected !== null && typeof expected === "object") {
    assert.ok(actual !== null && typeof actual === "object");
    for (const [key, value] of Object.entries(expected)) subset((actual as ObjectValue)[key], value);
  } else assert.deepEqual(actual, expected);
}

test("discoverable schemas derive from validators and describe every input property", async () => {
  const contract = describePurchasing("read");
  descriptions(contract.commands);
  descriptions(contract.queries);
  descriptions(contract.price);
  descriptions(contract.outcome);
  for (const [name, schema] of Object.entries(fields)) {
    assert.deepEqual(contract.entities[name], z.toJSONSchema(schema, { io: "input" }));
    descriptions(contract.entities[name]);
    descriptions(contract.saveUpdates[name]);
    assert.equal(contract.saveUpdates[name].required, undefined);
    for (const field of Object.values(contract.saveUpdates[name].properties ?? {})) if (typeof field === "object") assert.equal(field.default, undefined);
  }
  assert.deepEqual(Object.keys(queryViews).sort(), querySchema.shape.view.unwrap().options.toSorted());
  assert.deepEqual(Object.keys(responseSchemas).sort(), Object.keys(queryViews).sort());
  assert.deepEqual(Object.keys(versionRules).sort(), commandSchema.options.map((op) => op.shape.operation.value).sort());
  assert.deepEqual(contract.permissions.enum, ["read", "write"]);
  assert.equal(contract.permission, "read");
  assert.deepEqual(contract.entryStatuses.enum, ["active", "completed", "removed"]);
  const packageSchema = z.toJSONSchema(fields.products.shape.packageUnit, { io: "input" });
  delete packageSchema.$schema;
  assert.deepEqual(contract.entities.products.properties?.packageUnit, packageSchema);
  const priority = commandSchema.options[3].shape.priority;
  for (const n of [0, 1, 2, 3]) assert.ok(priority.safeParse(n).success);
  for (const n of [-1, 4, 1.5, "1"]) assert.ok(!priority.safeParse(n).success);
  const ui = await readFile("app/shopping/page.tsx", "utf8");
  for (const [n, label] of [[0, "Normal"], [1, "Soon"], [2, "Important"], [3, "Urgent"]]) {
    assert.ok(ui.includes(`<option value="${n}">${label}</option>`));
    assert.ok(priority.description?.includes(`${n} ${label}`));
  }
  const observation = { offeringId: "fixture", amount: 1799, observedAt: "2026-11-13T11:30:00-07:00", source: "research" };
  assert.equal(priceFields.parse(observation).observedAt, "2026-11-13T18:30:00.000Z");
  assert.ok(!priceFields.safeParse({ ...observation, amount: null }).success);
  assert.ok(!priceFields.safeParse({ ...observation, amount: 17.99 }).success);
  assert.ok(!priceFields.safeParse({ ...observation, currency: "ZZZ" }).success);
  assert.ok(!priceFields.safeParse({ ...observation, observedAt: "2026-11-13" }).success);
  assert.ok(!outcomeFields.safeParse({ entryId: "e", offeringId: "o", kind: "purchased", quantity: 0, occurredAt: observation.observedAt }).success);
  assert.match(contract.conventions.money, /1799 USD = \$17.99/);
  assert.match(contract.conventions.retries, /actor AND source/);
  execFileSync(process.execPath, ["--import", "tsx", "scripts/purchasing-docs.ts", "--check"]);
});

test("an unfamiliar MCP client executes discovered recipes, reads every view, and preserves compatibility", async (t) => {
  const f = await openLocalRows();
  t.after(() => f.mf.dispose());
  await f.db.batch(emptyInitializationSql("UTC").split(";").map((s) => s.trim()).filter(Boolean).map((s) => f.db.prepare(s)));
  const settings = { ...testInstallation, familyHostname: "localhost", displayHostname: "", localDevelopment: true };
  const rpc = async (method: string, params: ObjectValue = {}) => {
    const response = await handlePurchasingMcp(new Request("http://localhost/api/shopping/mcp", {
      method: "POST", headers: { "content-type": "application/json", accept: "application/json, text/event-stream" },
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
    }), f.db, settings);
    assert.equal(response.status, 200);
    const body = await response.json() as { result: ObjectValue; error?: unknown };
    assert.equal(body.error, undefined);
    return body.result;
  };
  const initialization = await rpc("initialize", { protocolVersion: "2025-11-25", capabilities: {}, clientInfo: { name: "discovery-only-fixture", version: "1" } });
  assert.match(String(initialization.instructions), /entry.*offering/);
  const listed = await rpc("tools/list");
  const tools = listed.tools as { name: string; inputSchema: unknown }[];
  assert.deepEqual(tools.map((tool) => tool.name).sort(), ["shopping_describe", "shopping_mutate", "shopping_query"]);
  for (const tool of tools) descriptions(tool.inputSchema, tool.name);
  const call = (name: string, args: unknown) => rpc("tools/call", { name, arguments: args });
  const described = await call("shopping_describe", {});
  const contract = described.structuredContent as ReturnType<typeof describePurchasing>;
  assert.deepEqual(contract.entities, describePurchasing("write").entities);
  assert.ok(JSON.stringify(described).length < 1_000_000, "Keep discovery bounded");
  const results: Record<string, ObjectValue> = {};
  const resolve = (input: unknown): unknown => {
    if (typeof input === "string" && input.startsWith("$")) {
      const path = input.slice(1).split(".");
      let value: unknown = results;
      for (const part of path) value = (value as ObjectValue)?.[part];
      assert.notEqual(value, undefined, `Unresolved recipe reference ${input}`);
      return value;
    }
    if (Array.isArray(input)) return input.map(resolve);
    if (input && typeof input === "object") return Object.fromEntries(Object.entries(input).map(([key, value]) => [key, resolve(value)]));
    return input;
  };
  for (const recipe of Object.values(contract.recipes)) for (const step of recipe.steps as RecipeStep[]) {
    const args = resolve(step.arguments) as ObjectValue;
    const result = await call(step.tool, args);
    assert.equal(Boolean(result.isError), Boolean(step.isError), `${step.id}: ${JSON.stringify(result)}`);
    const value = result.structuredContent as ObjectValue;
    subset(value, resolve(step.expected));
    if (step.tool === "shopping_query") responseSchemas[(args.query as { view: keyof typeof responseSchemas }).view].parse(value);
    results[step.id] = { ...value, request: args };
  }
  // Validate every response schema against real service results, including audit/export.
  for (const view of Object.keys(contract.queryViews) as (keyof typeof responseSchemas)[]) {
    const result = await call("shopping_query", { query: { view, ...(view === "item" ? { id: "diet-pepsi" } : {}) } });
    assert.ok(!result.isError, JSON.stringify(result));
    responseSchemas[view].parse(result.structuredContent);
  }
  // Creation defaults and partial updates remain compatible with old generic save.data.
  const update = await call("shopping_mutate", { command: { operation: "save", entity: "items", id: "diet-pepsi", expectedVersion: 1, mutationId: "patch-item", data: { notes: "preserve category" } } });
  subset(update.structuredContent, { record: { name: "Diet Pepsi", category: "Drinks", notes: "preserve category", version: 2 } });
  const invalid = await call("shopping_mutate", { command: { operation: "save", entity: "products", id: "bad-product", expectedVersion: 0, mutationId: "bad-product", data: { name: "missing references" } } });
  assert.equal(invalid.isError, true);
  subset(invalid.structuredContent, { status: 422, code: "invalid_input", issues: [{ path: ["itemId"] }, { path: ["packageQuantity"] }, { path: ["packageUnit"] }] });
  const purchase = (results.purchase.request as ObjectValue).command as ObjectValue;
  const reused = await call("shopping_mutate", { command: { ...purchase, expectedVersion: 100 } });
  subset(reused.structuredContent, { status: 409, code: "mutation_id_reused" });
  const first = (await call("shopping_query", { query: { view: "history", limit: 1 } })).structuredContent as ObjectValue;
  assert.equal((first.records as unknown[]).length, 1);
  assert.ok(first.nextCursor);
  let cursor: unknown = first.nextCursor;
  let count = 1;
  while (cursor !== null) {
    const next = (await call("shopping_query", { query: { view: "history", limit: 1, after: cursor, revision: first.revision } })).structuredContent as ObjectValue;
    count += (next.records as unknown[]).length;
    cursor = next.nextCursor;
  }
  assert.equal(count, 3, "Exact purchase retry must not duplicate history");
  await call("shopping_mutate", { command: { operation: "save", entity: "items", id: "diet-pepsi", expectedVersion: 2, mutationId: "change-between-pages", data: { notes: "changed" } } });
  const changed = await call("shopping_query", { query: { view: "history", limit: 1, after: first.nextCursor, revision: first.revision } });
  subset(changed.structuredContent, { status: 409, code: "page_changed" });
  const otherActor = new PurchasingService(f.db, { actor: "another-actor", source: "mcp", permission: "write" });
  await assert.rejects(() => otherActor.mutate(purchase), (e: unknown) => (e as { code: string }).code === "mutation_id_reused");
});
