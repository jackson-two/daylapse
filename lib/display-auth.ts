import { env } from "cloudflare:workers";
import { isDisplayRequest, installationSettingsSchema } from "./installation";

const createDisplayAccessTable = `
  CREATE TABLE IF NOT EXISTS display_access_keys (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    label TEXT NOT NULL,
    token_hash TEXT NOT NULL UNIQUE,
    created_at TEXT NOT NULL,
    revoked_at TEXT
  )
`;

function toHex(bytes: ArrayBuffer) {
  return Array.from(new Uint8Array(bytes), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

export async function hashDisplayKey(displayKey: string) {
  const bytes = new TextEncoder().encode(displayKey);
  return toHex(await crypto.subtle.digest("SHA-256", bytes));
}

export async function hasValidDisplayKey(request: Request) {
  const displayKey = new URL(request.url).searchParams.get("display_key");
  if (!displayKey || displayKey.length < 32 || displayKey.length > 256) return false;
  if (!env.DB) throw new Error("Shared project storage is not available.");

  await env.DB.prepare(createDisplayAccessTable).run();
  const tokenHash = await hashDisplayKey(displayKey);
  const row = await env.DB.prepare(
    "SELECT id FROM display_access_keys WHERE token_hash = ? AND revoked_at IS NULL LIMIT 1",
  ).bind(tokenHash).first<{ id: number }>();
  return row !== null;
}

export function isDakboardHostname(request: Request) {
  return isDisplayRequest(request, installationSettingsSchema.parse(env.DAYLAPSE));
}
