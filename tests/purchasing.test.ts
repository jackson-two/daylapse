import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";
import { RowRepository } from "../lib/row-repository";
import { convertSnapshot } from "../lib/row-converter";
import { importConverted } from "../lib/row-importer";
import { openLocalRows } from "../scripts/row-storage-local";
import { PurchasingService } from "../lib/purchasing/service";
import {
  ShoppingError,
  priceStatus,
  unitPrice,
  type ShopRecord,
} from "../lib/purchasing/schema";
import { handlePurchasingRequest } from "../lib/purchasing/api";
import { handlePurchasingMcp } from "../lib/purchasing/mcp";
import { testInstallation } from "./fixtures/installation";
import { generateKeyPair, SignJWT } from "jose";
import { accessResponse } from "../lib/access-policy";
import { emptyInitializationSql } from "../scripts/installation-config";

const context = {
  actor: "synthetic-tester",
  source: "user" as const,
  permission: "write" as const,
};
const when = "2026-10-01T12:00:00.000Z";
async function fixture() {
  const { db, mf } = await openLocalRows();
  await db.batch(
    emptyInitializationSql("UTC")
      .split(";")
      .map((s) => s.trim())
      .filter(Boolean)
      .map((s) => db.prepare(s)),
  );
  const service = new PurchasingService(db, context);
  const save = async (
    entity: string,
    id: string,
    data: Record<string, unknown>,
    expectedVersion = 0,
  ) =>
    (
      await service.mutate({
        operation: "save",
        mutationId: crypto.randomUUID(),
        entity,
        id,
        data,
        expectedVersion,
      })
    ).record;
  await save("items", "pepsi", { name: "Diet Pepsi" });
  await save("items", "batteries", { name: "AA Batteries" });
  for (const store of ["costco", "frys", "sams", "walmart"])
    await save("stores", store, { name: store });
  await save("locations", "costco-main", {
    storeId: "costco",
    name: "Preferred warehouse",
    preferred: true,
  });
  await save("products", "pepsi-36", {
    itemId: "pepsi",
    name: "Diet Pepsi 36",
    packageQuantity: 36,
    packageUnit: "can",
  });
  await save("products", "pepsi-15", {
    itemId: "pepsi",
    name: "Diet Pepsi 15",
    packageQuantity: 15,
    packageUnit: "can",
  });
  await save("products", "kirkland", {
    itemId: "batteries",
    name: "Kirkland 48",
    brand: "Kirkland",
    packageQuantity: 48,
    packageUnit: "each",
  });
  await save("products", "energizer", {
    itemId: "batteries",
    name: "Energizer 16",
    packageQuantity: 16,
    packageUnit: "each",
  });
  for (const [id, productId, storeId] of [
    ["pc", "pepsi-36", "costco"],
    ["pf", "pepsi-15", "frys"],
    ["ps", "pepsi-36", "sams"],
    ["bc", "kirkland", "costco"],
    ["bw", "energizer", "walmart"],
  ])
    await save("offerings", id, { productId, storeId });
  const add = async (itemId: string, expectedVersion = 0) =>
    (
      await service.mutate({
        operation: "list",
        mutationId: crypto.randomUUID(),
        itemId,
        action: "add",
        expectedVersion,
      })
    ).record;
  return { db, mf, service, save, add };
}

test("purchasing preserves independent plans, outcomes, retry receipts, prices and history", async (t) => {
  const f = await fixture();
  t.after(() => f.mf.dispose());
  const { service, db, save, add } = f;
  let entry = await add("pepsi");
  assert.equal((await add("pepsi")).id, entry.id);
  for (const [offeringId, quantity] of [
    ["pf", 2],
    ["pc", 1],
    ["ps", 1],
    ["pf", 3],
  ] as const)
    entry = (
      await service.mutate({
        operation: "quantity",
        mutationId: crypto.randomUUID(),
        entryId: entry.id,
        expectedVersion: entry.version,
        offeringId,
        quantity,
      })
    ).record;
  const snapshot = await service.query({ view: "snapshot" });
  assert.deepEqual(
    Object.fromEntries(
      (snapshot.plans as ShopRecord[]).map((r) => [r.offeringId, r.quantity]),
    ),
    { pc: 1, pf: 3, ps: 1 },
  );
  const battery = await add("batteries");
  const storeList = await service.query({ view: "list", storeId: "walmart" });
  assert.deepEqual(
    (storeList.entries as ShopRecord[]).map((r) => r.itemId),
    ["batteries"],
  );
  const command = {
    operation: "outcome",
    mutationId: "purchase-retry",
    expectedVersion: entry.version,
    data: {
      entryId: entry.id,
      offeringId: "pc",
      locationId: "costco-main",
      kind: "purchased",
      quantity: 1,
      packagePrice: 1299,
      occurredAt: when,
    },
  };
  const bought = await service.mutate(command);
  assert.deepEqual(await service.mutate(command), bought);
  assert.equal(
    (
      await db
        .prepare("SELECT count(*) AS n FROM shopping_outcomes")
        .first<{ n: number }>()
    )?.n,
    1,
  );
  assert.equal((await service.get("entries", entry.id))?.status, "completed");
  const frozen = bought.record.snapshotJson;
  await save("locations", "costco-main", { name: "Renamed warehouse" }, 1);
  await save(
    "products",
    "pepsi-36",
    { name: "Renamed product", packageQuantity: 40 },
    1,
  );
  const price = {
    offeringId: "pc",
    amount: 1599,
    observedAt: when,
    source: "research",
    sourceUrl: "https://example.com/product",
    verified: false,
  };
  await service.mutate({
    operation: "price",
    mutationId: "price-1",
    expectedVersion: 1,
    data: price,
  });
  assert.equal(
    (await service.get("outcomes", bought.record.id))?.snapshotJson,
    frozen,
  );
  assert.equal(
    (await service.get("outcomes", bought.record.id))?.totalPrice,
    1299,
  );
  assert.equal(
    (await service.query({ view: "summary", itemId: "pepsi" }))
      .latestPurchase &&
      (
        (await service.query({ view: "summary", itemId: "pepsi" })).totals as {
          spending: number;
        }[]
      )[0].spending,
    1299,
  );
  const current = (await service.get("entries", entry.id))!;
  await service.mutate({
    operation: "correct",
    mutationId: "undo-1",
    id: bought.record.id,
    expectedVersion: 1,
    entryVersion: current.version,
    replacement: null,
    reason: "Accidental tap",
    reactivate: true,
  });
  assert.equal((await service.get("entries", entry.id))?.status, "active");
  assert.ok((await service.get("outcomes", bought.record.id))?.reversedAt);
  assert.equal(
    ((await service.query({ view: "history" })).records as unknown[]).length,
    0,
  );
  assert.equal(
    (
      (await service.query({ view: "history", includeReversed: true }))
        .records as unknown[]
    ).length,
    1,
  );
  assert.deepEqual(
    (
      await service.query({
        view: "summary",
        includeReversed: true,
        itemId: "pepsi",
      })
    ).totals,
    [],
  );
  await service.mutate({
    operation: "outcome",
    mutationId: "oos",
    expectedVersion: battery.version,
    data: {
      entryId: battery.id,
      offeringId: "bc",
      kind: "out_of_stock",
      occurredAt: when,
    },
  });
  const b2 = (await service.get("entries", battery.id))!;
  assert.equal(b2.status, "active");
  await service.mutate({
    operation: "outcome",
    mutationId: "skip",
    expectedVersion: b2.version,
    data: {
      entryId: battery.id,
      offeringId: "bw",
      kind: "skipped",
      occurredAt: when,
    },
  });
  assert.equal((await service.get("entries", battery.id))?.status, "active");
  await assert.rejects(
    () =>
      service.mutate({ ...command, data: { ...command.data, quantity: 2 } }),
    /different operation/,
  );
  await assert.rejects(
    () => db.prepare("UPDATE shopping_prices SET amount=1").run(),
    /immutable_shopping_history/,
  );
  assert.equal(
    (await db.prepare("PRAGMA foreign_key_check").all()).results.length,
    0,
  );
});

test("races and audit failures never partially commit, merges preserve history and cursor guards", async (t) => {
  const f = await fixture();
  t.after(() => f.mf.dispose());
  const entry = await f.add("pepsi");
  const outcomes = await Promise.allSettled(
    ["a", "b"].map((mutationId) =>
      f.service.mutate({
        operation: "outcome",
        mutationId,
        expectedVersion: entry.version,
        data: {
          entryId: entry.id,
          offeringId: "pc",
          kind: "purchased",
          quantity: 1,
          occurredAt: when,
          keepOnList: true,
        },
      }),
    ),
  );
  assert.equal(outcomes.filter((r) => r.status === "fulfilled").length, 1);
  assert.equal(outcomes.filter((r) => r.status === "rejected").length, 1);
  const current = (await f.service.get("entries", entry.id))!;
  await f.db
    .prepare(
      "CREATE TRIGGER fail_shopping_audit BEFORE INSERT ON shopping_audit WHEN NEW.mutation_id='fail' BEGIN SELECT RAISE(ABORT,'synthetic_failure'); END",
    )
    .run();
  await assert.rejects(
    () =>
      f.service.mutate({
        operation: "quantity",
        mutationId: "fail",
        expectedVersion: current.version,
        entryId: current.id,
        offeringId: "pf",
        quantity: 0,
      }),
    /synthetic_failure/,
  );
  assert.deepEqual(await f.service.get("entries", entry.id), current);
  assert.equal(
    await f.db
      .prepare("SELECT id FROM shopping_receipts WHERE id='fail'")
      .first(),
    null,
  );
  const revision = await f.service.revision();
  await f.save("items", "duplicate", { name: "Pepsi duplicate" });
  await f.service.mutate({
    operation: "merge",
    mutationId: "merge",
    id: "pepsi",
    expectedVersion: 1,
    targetId: "duplicate",
    targetVersion: 1,
  });
  assert.equal(
    (await f.service.get("products", "pepsi-36"))?.itemId,
    "duplicate",
  );
  assert.equal(
    (
      (await f.service.query({ view: "history", itemId: "duplicate" }))
        .records as unknown[]
    ).length,
    1,
  );
  await assert.rejects(
    () => f.service.query({ view: "items", revision }),
    (e) => e instanceof ShoppingError && e.code === "page_changed",
  );
  assert.equal(
    (await f.db.prepare("PRAGMA foreign_key_check").all()).results.length,
    0,
  );
});

test("new migration preserves populated old data, deletion markers and outstanding receipts", async (t) => {
  const { db, mf } = await openLocalRows(undefined, 7);
  t.after(() => mf.dispose());
  const items = [
    {
      id: "existing-task",
      title: "Synthetic recurring task",
      type: "recurring" as const,
      intervalValue: 1,
      intervalUnit: "months" as const,
      createdAt: "2026-01-01",
      lastCompleted: "2026-09-01",
      history: [{ id: "old-completion", date: "2026-08-01" }],
      reminderDays: 7,
    },
  ];
  await db
    .prepare(
      "INSERT INTO household_state(id,data,revision,updated_at) VALUES (1,?,1,?)",
    )
    .bind(JSON.stringify(items), when)
    .run();
  await importConverted(
    db,
    await convertSnapshot({ items, revision: 1 }, when, ["2026-10-01"]),
  );
  await db
    .prepare("UPDATE installation_settings SET storage_mode='rows' WHERE id=1")
    .run();
  const repository = new RowRepository(db);
  const retry = {
    operation: "completion.create" as const,
    mutationId: "pending-retry",
    eventId: "existing-task",
    expectedVersion: 1,
    completionId: "new-completion",
    completedOn: "2026-10-01",
  };
  const saved = await repository.mutate(retry);
  await repository.mutate({
    operation: "delete",
    mutationId: "deleted-marker",
    eventId: "existing-task",
    expectedVersion: saved.event.version,
  });
  await db
    .prepare(
      "INSERT INTO display_access_keys(label,token_hash,created_at) VALUES ('synthetic','synthetic-hash',?)",
    )
    .bind(when)
    .run();
  await db
    .prepare(
      "INSERT INTO push_subscriptions(id,endpoint,p256dh,auth,vapid_public_key,time_zone,created_at,updated_at) VALUES ('synthetic','https://example.com/push','synthetic','synthetic','synthetic','UTC',?,?)",
    )
    .bind(when, when)
    .run();
  const tables = [
    "household_state",
    "household_state_revisions",
    "events",
    "completions",
    "mutations",
    "changes",
    "migration_runs",
    "migration_chunks",
    "installation_settings",
    "display_access_keys",
    "push_subscriptions",
  ];
  const before = await Promise.all(
    tables.map(
      async (table) =>
        (await db.prepare(`SELECT * FROM ${table} ORDER BY rowid`).all())
          .results,
    ),
  );
  for (let pass = 0; pass < 2; pass++) {
    for (const name of [
      "0008_household_purchasing.sql",
      "0009_purchasing_history_indexes.sql",
    ]) {
      if (
        await db
          .prepare("SELECT name FROM foundation_migrations WHERE name=?")
          .bind(name)
          .first()
      )
        continue;
      const sql = await readFile(
        new URL(`../drizzle/${name}`, import.meta.url),
        "utf8",
      );
      await db.batch([
        ...sql
          .split("--> statement-breakpoint")
          .map((s) => s.trim())
          .filter(Boolean)
          .map((s) => db.prepare(s)),
        db
          .prepare("INSERT INTO foundation_migrations(name) VALUES (?)")
          .bind(name),
      ]);
    }
    for (let i = 0; i < tables.length; i++)
      assert.deepEqual(
        (await db.prepare(`SELECT * FROM ${tables[i]} ORDER BY rowid`).all())
          .results,
        before[i],
      );
    assert.deepEqual(await new RowRepository(db).mutate(retry), saved);
    assert.equal(
      (await db.prepare("PRAGMA foreign_key_check").all()).results.length,
      0,
    );
    const shop = new PurchasingService(db, context);
    assert.equal(
      ((await shop.query({ view: "list" })).entries as unknown[]).length,
      0,
    );
  }
});

test("shared API/MCP reject unauthorized requests and expose real tools with permissions", async (t) => {
  const { db, mf, service } = await fixture();
  t.after(() => mf.dispose());
  const local = {
    ...testInstallation,
    familyHostname: "localhost",
    displayHostname: "",
    localDevelopment: true,
  };
  const req = (
    path: string,
    body?: unknown,
    headers: Record<string, string> = {},
    host = "http://localhost",
  ) =>
    new Request(`${host}${path}`, {
      method: body ? "POST" : "GET",
      headers: {
        origin: host,
        "content-type": "application/json",
        accept: "application/json, text/event-stream",
        ...headers,
      },
      ...(body ? { body: JSON.stringify(body) } : {}),
    });
  assert.equal(
    (
      await handlePurchasingRequest(
        req("/api/shopping", undefined, {}, "https://daylapse.example.com"),
        db,
        testInstallation,
      )
    ).status,
    401,
  );
  assert.equal(
    (
      await handlePurchasingRequest(
        req("/api/shopping/command", {}, { origin: "https://evil.example" }),
        db,
        local,
      )
    ).status,
    403,
  );
  const tools = await handlePurchasingMcp(
    req("/api/shopping/mcp", { jsonrpc: "2.0", id: 1, method: "tools/list" }),
    db,
    local,
  );
  const listed = (await tools.json()) as {
    result: { tools: { name: string }[] };
  };
  assert.deepEqual(
    listed.result.tools.map((t) => t.name),
    ["shopping_describe", "shopping_query", "shopping_mutate"],
  );
  const create = {
    operation: "save",
    mutationId: "mcp-create",
    entity: "items",
    id: "mcp-item",
    expectedVersion: 0,
    data: { name: "MCP synthetic item" },
  };
  const rpc = {
    jsonrpc: "2.0",
    id: 2,
    method: "tools/call",
    params: { name: "shopping_mutate", arguments: { command: create } },
  };
  const first = await (
    await handlePurchasingMcp(req("/api/shopping/mcp", rpc), db, local)
  ).json();
  assert.deepEqual(
    await (
      await handlePurchasingMcp(req("/api/shopping/mcp", rpc), db, local)
    ).json(),
    first,
  );
  assert.equal(
    (await service.get("items", "mcp-item"))?.name,
    "MCP synthetic item",
  );
  await assert.rejects(
    () =>
      new PurchasingService(db, { ...context, permission: "read" }).mutate(
        create,
      ),
    /read-only/,
  );
  const { publicKey, privateKey } = await generateKeyPair("RS256");
  const settings = {
    ...testInstallation,
    purchasingMcp: {
      audience: "b".repeat(64),
      clients: [{ clientId: "test.access", permission: "read" }],
    },
  };
  const jwt = await new SignJWT({ common_name: "test.access" })
    .setProtectedHeader({ alg: "RS256" })
    .setSubject("")
    .setIssuedAt()
    .setExpirationTime("5m")
    .setIssuer(`https://${settings.accessTeamDomain}`)
    .setAudience(settings.purchasingMcp.audience)
    .sign(privateKey);
  const signed = req(
    "/api/shopping/mcp",
    rpc,
    { "cf-access-jwt-assertion": jwt },
    "https://daylapse.example.com",
  );
  const readOnly = (await (
    await handlePurchasingMcp(signed, db, settings, async () => publicKey)
  ).json()) as {
    result: { isError: boolean; structuredContent: { status: number } };
  };
  assert.equal(readOnly.result.isError, true);
  assert.equal(readOnly.result.structuredContent.status, 403);
  assert.equal(
    (
      await accessResponse(
        req(
          "/api/shopping",
          undefined,
          { "cf-access-jwt-assertion": jwt },
          "https://daylapse.example.com",
        ),
        settings,
        async () => publicKey,
      )
    )?.status,
    401,
  );
  assert.equal(
    (
      await handlePurchasingMcp(
        req(
          "/api/shopping/mcp",
          rpc,
          { "cf-access-jwt-assertion": jwt },
          "https://display.example.com",
        ),
        db,
        settings,
        async () => publicKey,
      )
    ).status,
    404,
  );
});

test("price provenance and comparable units are explicit", () => {
  assert.equal(priceStatus(undefined), "Unknown price");
  assert.equal(priceStatus({ verified: false }), "Needs verification");
  assert.equal(
    unitPrice(1000, 1, "kg")?.amount,
    unitPrice(1000, 1000, "g")?.amount,
  );
  assert.notEqual(
    unitPrice(1000, 36, "can")?.unit,
    unitPrice(1000, 1000, "ml")?.unit,
  );
});

test("complete MCP workflow is visible to the web service and duplicate purchase is replayed", async (t) => {
  const f = await fixture();
  t.after(() => f.mf.dispose());
  const settings = {
    ...testInstallation,
    familyHostname: "localhost",
    displayHostname: "",
    localDevelopment: true,
  };
  const tool = async (name: string, args: unknown) => {
    const response = await handlePurchasingMcp(
      new Request("http://localhost/api/shopping/mcp", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          accept: "application/json, text/event-stream",
        },
        body: JSON.stringify({
          jsonrpc: "2.0",
          id: 1,
          method: "tools/call",
          params: { name, arguments: args },
        }),
      }),
      f.db,
      settings,
    );
    assert.equal(response.status, 200);
    const body = (await response.json()) as {
      result: { isError?: boolean; structuredContent: Record<string, unknown> };
    };
    assert.ok(!body.result.isError, JSON.stringify(body.result));
    return body.result.structuredContent;
  };
  assert.ok((await tool("shopping_describe", {})).entities);
  const mutate = (command: Record<string, unknown>) =>
    tool("shopping_mutate", {
      command: {
        mutationId: crypto.randomUUID(),
        expectedVersion: 0,
        ...command,
      },
    });
  for (const [entity, id, data] of [
    ["items", "mcp-detergent", { name: "Synthetic detergent" }],
    ["stores", "aldi", { name: "Aldi", color: "#234678" }],
    [
      "products",
      "detergent-1l",
      {
        itemId: "mcp-detergent",
        name: "Detergent 1L",
        packageQuantity: 1,
        packageUnit: "l",
      },
    ],
    [
      "offerings",
      "aldi-detergent",
      { productId: "detergent-1l", storeId: "aldi" },
    ],
  ] as const)
    await mutate({ operation: "save", entity, id, data });
  let entry = (
    await mutate({ operation: "list", itemId: "mcp-detergent", action: "add" })
  ).record as ShopRecord;
  entry = (
    await mutate({
      operation: "quantity",
      entryId: entry.id,
      offeringId: "aldi-detergent",
      quantity: 2,
      expectedVersion: entry.version,
    })
  ).record as ShopRecord;
  await mutate({
    operation: "price",
    expectedVersion: 1,
    data: {
      offeringId: "aldi-detergent",
      amount: 499,
      source: "research",
      observedAt: when,
      reference: "Synthetic example, not a retail claim",
      verified: false,
    },
  });
  const purchase = {
    operation: "outcome",
    mutationId: "mcp-purchase-exact",
    expectedVersion: entry.version,
    data: {
      entryId: entry.id,
      offeringId: "aldi-detergent",
      kind: "purchased",
      quantity: 2,
      packagePrice: 479,
      occurredAt: when,
      tripId: "synthetic-trip",
    },
  };
  assert.deepEqual(await mutate(purchase), await mutate(purchase));
  const history = await tool("shopping_query", {
    query: { view: "history", itemId: "mcp-detergent" },
  });
  assert.equal((history.records as ShopRecord[]).length, 1);
  assert.equal((history.records as ShopRecord[])[0].totalPrice, 958);
  const web = await f.service.query({ view: "snapshot" });
  assert.ok((web.items as ShopRecord[]).some((r) => r.id === "mcp-detergent"));
  assert.equal(
    (web.prices as ShopRecord[]).find((r) => r.offeringId === "aldi-detergent")
      ?.amount,
    499,
  );
  await f.save(
    "items",
    "mcp-detergent",
    { notes: "Edited through the same service as the UI" },
    1,
  );
  assert.equal(
    (
      (
        await tool("shopping_query", {
          query: { view: "item", id: "mcp-detergent" },
        })
      ).item as ShopRecord
    ).notes,
    "Edited through the same service as the UI",
  );
});

test("corrections reject unrelated items, price summaries retain chronological comparisons and paging", async (t) => {
  const f = await fixture();
  t.after(() => f.mf.dispose());
  const entry = await f.add("pepsi");
  const purchase = await f.service.mutate({
    operation: "outcome",
    mutationId: "original",
    expectedVersion: entry.version,
    data: {
      entryId: entry.id,
      offeringId: "pc",
      kind: "purchased",
      quantity: 1,
      totalPrice: 1200,
      occurredAt: when,
    },
  });
  const current = (await f.service.get("entries", entry.id))!;
  await assert.rejects(
    () =>
      f.service.mutate({
        operation: "correct",
        mutationId: "wrong-item",
        id: purchase.record.id,
        expectedVersion: 1,
        entryVersion: current.version,
        reason: "Wrong item test",
        replacement: {
          entryId: entry.id,
          offeringId: "bc",
          kind: "purchased",
          quantity: 1,
          occurredAt: when,
        },
      }),
    /product must belong/,
  );
  assert.equal(
    (await f.service.get("outcomes", purchase.record.id))?.reversedAt,
    null,
  );
  for (const [amount, observedAt, version] of [
    [1000, "2026-09-01T00:00:00.000Z", 1],
    [900, "2026-10-01T00:00:00.000Z", 2],
    [1200, "2026-08-01T00:00:00.000Z", 3],
  ] as const)
    await f.service.mutate({
      operation: "price",
      mutationId: crypto.randomUUID(),
      expectedVersion: version,
      data: { offeringId: "pc", amount, observedAt, source: "manual" },
    });
  const stats = (
    await f.service.query({ view: "priceSummary", offeringId: "pc" })
  ).records as Record<string, unknown>[];
  assert.equal(stats[0].priceChange, -300);
  assert.equal(stats[0].latestPackagePrice, 900);
  const page = await f.service.query({ view: "prices", limit: 1 });
  assert.equal((page.records as ShopRecord[])[0].amount, 900);
  const next = await f.service.query({
    view: "prices",
    limit: 1,
    after: page.nextCursor,
    revision: page.revision,
  });
  assert.equal((next.records as ShopRecord[])[0].amount, 1000);
  await f.service.mutate({
    operation: "archive",
    mutationId: "archive",
    entity: "items",
    id: "pepsi",
    expectedVersion: 1,
    archived: true,
  });
  assert.equal(
    (
      (await f.service.query({ view: "history", itemId: "pepsi" }))
        .records as ShopRecord[]
    ).length,
    1,
  );
  await f.service.mutate({
    operation: "archive",
    mutationId: "restore",
    entity: "items",
    id: "pepsi",
    expectedVersion: 2,
    archived: false,
  });
  assert.equal((await f.service.get("items", "pepsi"))?.archivedAt, null);
});

test("MCP fails closed for expired, forged, wrong-audience and unlisted credentials; limits payload and requests", async (t) => {
  const f = await fixture();
  t.after(() => f.mf.dispose());
  const { publicKey, privateKey } = await generateKeyPair("RS256");
  const other = await generateKeyPair("RS256");
  const settings = {
    ...testInstallation,
    purchasingMcp: {
      audience: "b".repeat(64),
      clients: [{ clientId: "allowed.access", permission: "write" }],
    },
  };
  const req = (
    token?: string,
    host = "daylapse.example.com",
    body = JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/list" }),
  ) =>
    new Request(`https://${host}/api/shopping/mcp`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        accept: "application/json, text/event-stream",
        ...(token ? { "cf-access-jwt-assertion": token } : {}),
      },
      body,
    });
  const jwt = async (
    client = "allowed.access",
    audience = settings.purchasingMcp.audience,
    expiry = "5m",
    key = privateKey,
  ) =>
    new SignJWT({ common_name: client })
      .setProtectedHeader({ alg: "RS256" })
      .setSubject("")
      .setIssuedAt()
      .setExpirationTime(expiry)
      .setIssuer(`https://${settings.accessTeamDomain}`)
      .setAudience(audience)
      .sign(key);
  assert.equal(
    (await handlePurchasingMcp(req(), f.db, settings, async () => publicKey))
      .status,
    401,
  );
  for (const token of [
    await jwt("allowed.access", settings.accessAudience),
    await jwt("allowed.access", settings.purchasingMcp.audience, "-1s"),
    await jwt(
      "allowed.access",
      settings.purchasingMcp.audience,
      "5m",
      other.privateKey,
    ),
  ])
    assert.equal(
      (
        await handlePurchasingMcp(
          req(token),
          f.db,
          settings,
          async () => publicKey,
        )
      ).status,
      401,
    );
  assert.equal(
    (
      await handlePurchasingMcp(
        req(await jwt("unlisted.access")),
        f.db,
        settings,
        async () => publicKey,
      )
    ).status,
    403,
  );
  const token = await jwt();
  assert.equal(
    (
      await handlePurchasingMcp(
        req(token, settings.displayHostname),
        f.db,
        settings,
        async () => publicKey,
      )
    ).status,
    405,
  );
  assert.equal(
    (
      await handlePurchasingMcp(
        req(token, "daylapse.example.com", "x".repeat(100001)),
        f.db,
        settings,
        async () => publicKey,
      )
    ).status,
    413,
  );
  await f.db.prepare("UPDATE shopping_rate_limits SET count=120").run();
  assert.equal(
    (
      await handlePurchasingMcp(
        req(token),
        f.db,
        settings,
        async () => publicKey,
      )
    ).status,
    429,
  );
});

test("lost commit responses and simultaneous identical requests preserve one purchase and pending metadata", async (t) => {
  const f = await fixture();
  t.after(() => f.mf.dispose());
  let entry = await f.add("pepsi");
  entry = (
    await f.service.mutate({
      operation: "list",
      mutationId: "list-notes",
      itemId: "pepsi",
      action: "update",
      expectedVersion: entry.version,
      notes: "Synthetic list note",
      priority: 2,
    })
  ).record;
  entry = (
    await f.service.mutate({
      operation: "quantity",
      mutationId: "zero-plan",
      entryId: entry.id,
      offeringId: "pf",
      quantity: 0,
      expectedVersion: entry.version,
    })
  ).record;
  let lost = false;
  const flaky = new Proxy(f.db, {
    get(target, key) {
      if (key === "batch")
        return async (statements: D1PreparedStatement[]) => {
          const response = await target.batch(statements);
          if (!lost) {
            lost = true;
            throw new Error("Synthetic lost response after commit");
          }
          return response;
        };
      const value = Reflect.get(target, key);
      return typeof value === "function" ? value.bind(target) : value;
    },
  });
  const command = {
    operation: "outcome",
    mutationId: "uncertain-purchase",
    expectedVersion: entry.version,
    data: {
      entryId: entry.id,
      offeringId: "pc",
      kind: "purchased",
      quantity: 1,
      totalPrice: 1000,
      occurredAt: "2026-10-01T05:00:00-07:00",
      keepOnList: true,
    },
  };
  const result = await new PurchasingService(flaky, context).mutate(command);
  assert.equal(result.record.occurredAt, when);
  const repeated = await Promise.all([
    f.service.mutate(command),
    f.service.mutate(command),
  ]);
  assert.deepEqual(repeated, [result, result]);
  assert.equal(
    (
      await f.db
        .prepare("SELECT count(*) AS n FROM shopping_outcomes")
        .first<{ n: number }>()
    )?.n,
    1,
  );
  const current = (await f.service.get("entries", entry.id))!;
  const removed = await f.service.mutate({
    operation: "list",
    mutationId: "remove-preserves-note",
    itemId: "pepsi",
    action: "remove",
    expectedVersion: current.version,
  });
  assert.equal(removed.record.notes, "Synthetic list note");
  assert.equal(removed.record.priority, 2);
  assert.equal(
    (await f.service.query({ view: "snapshot" })).plans &&
      (await f.service.rows("plans"))[0].quantity,
    0,
  );
});
