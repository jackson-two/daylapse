import { z } from "zod";
import type { JWTVerifyGetKey } from "jose";
import { accessResponse, verifyAccessToken } from "../access-policy";
import { installationSettingsSchema, isLocalRequest } from "../installation";
import {
  parseJsonRequest,
  RequestValidationError,
} from "../request-validation";
import { digest } from "../row-converter";
import { RowError } from "../row-repository";
import {
  commandSchema,
  querySchema,
  ShoppingError,
  type Context,
} from "./schema";
import { PurchasingService } from "./service";

export const json = (data: unknown, status = 200) =>
  Response.json(data, {
    status,
    headers: {
      "Cache-Control": "no-store",
      "X-Content-Type-Options": "nosniff",
    },
  });
export function failure(error: unknown) {
  if (error instanceof ShoppingError || error instanceof RowError)
    return json(
      { error: error.message, code: error.code, current: error.current },
      error.status,
    );
  if (error instanceof RequestValidationError)
    return json({ error: error.message, issues: error.issues }, error.status);
  if (error instanceof z.ZodError)
    return json(
      {
        error: "Check the supplied fields.",
        issues: error.issues.map(({ path, message }) => ({ path, message })),
      },
      422,
    );
  // Never log queries, record values, raw database errors, or tokens.
  return json(
    {
      error:
        "Purchasing is temporarily unavailable. Your changes were not discarded; retry with the same mutation ID.",
      code: "unavailable",
    },
    503,
  );
}
export async function authorizePurchasing(
  request: Request,
  db: D1Database,
  rawSettings: unknown,
  mcp = false,
  getKey?: JWTVerifyGetKey,
): Promise<Context | Response> {
  const denied = await accessResponse(request, rawSettings, getKey);
  if (denied) return denied;
  const settings = installationSettingsSchema.parse(rawSettings);
  const origin = request.headers.get("origin"),
    ownOrigin = new URL(request.url).origin;
  if (
    (origin && origin !== ownOrigin) ||
    (!mcp && request.method !== "GET" && origin !== ownOrigin)
  )
    return json({ error: "A same-origin request is required." }, 403);
  let context: Context;
  if (isLocalRequest(request, settings)) {
    // Existing explicitly local-only mode. No production bypass is introduced.
    context = {
      actor: "local-synthetic",
      source: mcp ? "mcp" : "user",
      permission: "write",
    };
  } else {
    const token = request.headers.get("cf-access-jwt-assertion")!;
    const { payload } = await verifyAccessToken(
      token,
      mcp
        ? { ...settings, accessAudience: settings.purchasingMcp!.audience }
        : settings,
      getKey,
    );
    const client = mcp
      ? settings.purchasingMcp?.clients.find(
          (c) => c.clientId === payload.common_name,
        )
      : undefined;
    if (mcp && !client)
      return json({ error: "Machine client is not authorized." }, 403);
    context = {
      actor: await digest(String(mcp ? payload.common_name : payload.sub)),
      source: mcp ? "mcp" : "user",
      permission: client?.permission ?? "write",
    };
  }
  const bucket = Math.floor(Date.now() / 60000);
  const key = await digest(context.actor);
  const count = await db
    .prepare(
      `INSERT INTO shopping_rate_limits (actor,bucket,count) VALUES (?,?,1)
    ON CONFLICT(actor) DO UPDATE SET bucket=excluded.bucket,count=CASE WHEN bucket=excluded.bucket THEN count+1 ELSE 1 END RETURNING count`,
    )
    .bind(key, bucket)
    .first<{ count: number }>();
  if (Number(count?.count) > 120)
    return new Response(
      JSON.stringify({ error: "Too many requests. Retry in one minute." }),
      {
        status: 429,
        headers: {
          "Content-Type": "application/json",
          "Cache-Control": "no-store",
          "Retry-After": "60",
        },
      },
    );
  return context;
}
export async function handlePurchasingRequest(
  request: Request,
  db: D1Database,
  settings: unknown,
  getKey?: JWTVerifyGetKey,
) {
  try {
    const auth = await authorizePurchasing(
      request,
      db,
      settings,
      false,
      getKey,
    );
    if (auth instanceof Response) return auth;
    const service = new PurchasingService(db, auth);
    const path = new URL(request.url).pathname;
    if (request.method === "GET" && path === "/api/shopping")
      return json(await service.query({ view: "snapshot" }));
    if (request.method === "POST" && path === "/api/shopping/query")
      return json(
        await service.query(await parseJsonRequest(request, querySchema)),
      );
    if (request.method === "POST" && path === "/api/shopping/command")
      return json(
        await service.mutate(await parseJsonRequest(request, commandSchema)),
      );
    return json({ error: "Not found." }, 404);
  } catch (error) {
    return failure(error);
  }
}
