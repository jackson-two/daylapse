import { createRemoteJWKSet, jwtVerify, type JWTVerifyGetKey } from "jose";
import { installationSettingsSchema, isFamilyRequest, isLocalRequest, type InstallationSettings } from "./installation";

// Only public signing keys are cached; no user identity or request state is retained.
let signingKeys: { issuer: string; getKey: JWTVerifyGetKey } | undefined;

export async function verifyAccessToken(token: string, settings: InstallationSettings, getKey?: JWTVerifyGetKey) {
  if (!settings.accessTeamDomain || !settings.accessAudience) throw new Error("Access is not configured");
  const issuer = `https://${settings.accessTeamDomain}`;
  if (!getKey) {
    if (signingKeys?.issuer !== issuer) {
      signingKeys = { issuer, getKey: createRemoteJWKSet(new URL(`${issuer}/cdn-cgi/access/certs`), { timeoutDuration: 5000 }) };
    }
    getKey = signingKeys.getKey;
  }
  return jwtVerify(token, getKey, { issuer, audience: settings.accessAudience,
    algorithms: ["RS256"], requiredClaims: ["sub", "iat", "exp"] });
}

const denied = (status: number, error: string) => Response.json({ error }, {
  status, headers: { "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff" },
});
const displayAssets = new Set(["/favicon.svg", "/favicon-32.png", "/icon-192.png", "/icon-512.png",
  "/apple-touch-icon.png", "/site.webmanifest", "/og.png"]);

/** Runs before the framework, covering current and future private endpoints. */
export async function accessResponse(request: Request, rawSettings: unknown, getKey?: JWTVerifyGetKey): Promise<Response | null> {
  const parsed = installationSettingsSchema.safeParse(rawSettings);
  if (!parsed.success) return denied(503, "Installation configuration is invalid.");
  const settings = parsed.data;
  const url = new URL(request.url);
  if (isLocalRequest(request, settings)) return null;
  if (settings.localDevelopment) return denied(403, "Local development is restricted to loopback HTTP.");
  if (settings.displayHostname && url.protocol === "https:" && url.hostname === settings.displayHostname) {
    if (!["GET", "HEAD"].includes(request.method)) return denied(405, "The display is read-only.");
    if (url.pathname === "/display" || url.pathname === "/display/" || url.pathname === "/api/display/items"
      || url.pathname.startsWith("/assets/") || displayAssets.has(url.pathname)) return null;
    return denied(404, "Not found.");
  }
  if (!isFamilyRequest(request, settings)) return denied(404, "Not found.");
  if (!settings.accessTeamDomain || !settings.accessAudience) return denied(503, "Access is not configured.");
  const token = request.headers.get("cf-access-jwt-assertion");
  if (!token || token.length > 16384) return denied(401, "Household sign-in is required.");
  try { await verifyAccessToken(token, settings, getKey); }
  catch { return denied(401, "Household sign-in is required."); }
  return null;
}
