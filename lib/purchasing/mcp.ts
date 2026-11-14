import { z } from "zod";
import type { JWTVerifyGetKey } from "jose";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { WebStandardStreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js";
import { authorizePurchasing, failure, json } from "./api";
import {
  commandSchema,
  querySchema,
  type Context,
} from "./schema";
import { describePurchasing, purchasingInstructions } from "./contract";
import { PurchasingService } from "./service";

export function createPurchasingMcp(db: D1Database, context: Context) {
  const server = new McpServer(
    { name: "daylapse-purchasing", version: "1.1.0" },
    {
      instructions: purchasingInstructions,
    },
  );
  const service = new PurchasingService(db, context);
  const result = (value: Record<string, unknown>) => ({
    content: [{ type: "text" as const, text: JSON.stringify(value) }],
    structuredContent: value,
  });
  const call = async (work: () => Promise<Record<string, unknown>>) => {
    try {
      return result(await work());
    } catch (error) {
      const response = failure(error);
      const body = (await response.json()) as Record<string, unknown>;
      return { ...result({ ...body, status: response.status }), isError: true };
    }
  };
  server.registerTool(
    "shopping_describe",
    {
      description:
        "Discover authoritative create/partial-update schemas, command/query schemas, entity joins, operation-specific versions, every query response, errors, retry/retention rules and executable synthetic Diet Pepsi recipes A–F. Call before writing. All input money is integer minor units; quantities are packages. Returns this connection’s read/write permission; never execute examples against household data as a demo.",
      inputSchema: z.object({}),
      annotations: { readOnlyHint: true, openWorldHint: false },
    },
    async () => result(describePurchasing(context.permission)),
  );
  server.registerTool(
    "shopping_query",
    {
      description:
        "Read shopping snapshot or filtered list, search items/stores, fetch item detail, paginated purchase/outcome history and price history, spending summary, price summary, or audit/export. Filters use stable item/product/store/location/offering/trip IDs and ISO instants. Summary spending is grouped by currency. Use shopping_describe.queryViews for supported filters and exact response shape; other common-schema filters may be ignored. Snapshot includes catalog, variants, retailers, locations, offers, entries, plans (entryId + offeringId + package quantity), latest observations and latest non-reversed outcomes. Paginated views default to 50/max 100: copy nextCursor to after with returned revision and unchanged filters until null. Restart on page_changed; bounded views are not paginated.",
      inputSchema: z.object({ query: querySchema.describe("Purchasing query; use shopping_describe.queryViews for supported filters, required IDs and response properties.") }),
      annotations: { readOnlyHint: true, openWorldHint: false },
    },
    ({ query }) => call(() => service.query(query)),
  );
  server.registerTool(
    "shopping_mutate",
    {
      description:
        "Perform one validated household purchasing change, shared with the web UI. Create/edit/archive/restore/merge catalog and store records; add/remove/reactivate/complete a list item; set independent offering package quantities; record purchase/out-of-stock/skipped; reverse/correct an outcome; append a price observation. Use shopping_describe for data fields. Purchases satisfy the item unless keepOnList=true. Retry the identical mutation ID/body after uncertainty. Never replace conflicting edits without the user's deliberate choice.",
      inputSchema: z.object({ command: commandSchema.describe("One intended purchasing write. Read current targets first; shopping_describe exposes entity-specific save fields and versionRules. Preserve this exact body and mutationId for uncertain retries.") }),
      annotations: {
        readOnlyHint: false,
        destructiveHint: true,
        idempotentHint: true,
        openWorldHint: false,
      },
    },
    ({ command }) => call(async () => ({ ...(await service.mutate(command)) })),
  );
  return server;
}
export async function handlePurchasingMcp(
  request: Request,
  db: D1Database,
  settings: unknown,
  getKey?: JWTVerifyGetKey,
) {
  try {
    const auth = await authorizePurchasing(request, db, settings, true, getKey);
    if (auth instanceof Response) return auth;
    if (request.method !== "POST")
      return json(
        { error: "This stateless MCP endpoint accepts POST only." },
        405,
      );
    const server = createPurchasingMcp(db, auth);
    const transport = new WebStandardStreamableHTTPServerTransport({
      sessionIdGenerator: undefined,
      enableJsonResponse: true,
      maxRequestBodySize: 100_000,
    });
    await server.connect(transport);
    try {
      const response = await transport.handleRequest(request);
      const body = await response.arrayBuffer();
      const headers = new Headers(response.headers);
      headers.set("Cache-Control", "no-store");
      headers.set("X-Content-Type-Options", "nosniff");
      return new Response(body.byteLength ? body : null, {
        status: response.status,
        headers,
      });
    } finally {
      await server.close();
    }
  } catch (error) {
    return failure(error);
  }
}
