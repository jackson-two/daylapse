import { readFile } from "node:fs/promises";
import { deploymentSchema } from "./installation-config";

const { settings } = deploymentSchema.parse(JSON.parse(await readFile("installation.json", "utf8")));
const origin = `https://${settings.familyHostname}`;
const privatePaths = ["/", "/api/events/snapshot", "/api/items/revisions", "/api/recovery", "/api/notifications"];
let failed = false;
for (const path of privatePaths) {
  const response = await fetch(origin + path, { redirect: "manual", signal: AbortSignal.timeout(15000) });
  const location = response.headers.get("location");
  const accessRedirect = response.status === 302 && location && new URL(location, origin).hostname === settings.accessTeamDomain;
  const protectedRoute = response.status === 401 || response.status === 403 || accessRedirect;
  if (!protectedRoute) failed = true;
  console.log(`${protectedRoute ? "PASS" : "FAIL"} anonymous ${path}: ${response.status}`);
  await response.body?.cancel();
}
if (settings.displayHostname) {
  for (const [path, expected] of [["/api/events/snapshot", 404], ["/api/notifications", 404], ["/api/display/items", 401]] as const) {
    const response = await fetch(`https://${settings.displayHostname}${path}`, { redirect: "manual", signal: AbortSignal.timeout(15000) });
    if (response.status !== expected) failed = true;
    console.log(`${response.status === expected ? "PASS" : "FAIL"} display ${path}: ${response.status}`);
    await response.body?.cancel();
  }
}
const jwt = process.env.DAYLAPSE_ACCESS_JWT;
if (jwt) {
  const response = await fetch(origin + "/api/events/snapshot", { redirect: "manual", signal: AbortSignal.timeout(15000),
    headers: { cookie: `CF_Authorization=${jwt}`, "cf-access-jwt-assertion": jwt } });
  const payload = response.ok ? await response.json() as { items?: unknown; revision?: unknown } : null;
  const ok = response.status === 200 && Array.isArray(payload?.items) && typeof payload?.revision === "number";
  if (!ok) failed = true;
  console.log(`${ok ? "PASS" : "FAIL"} authenticated snapshot: ${response.status}`);
  if (!response.ok) await response.body?.cancel();
} else {
  console.log("NOT CHECKED: authenticated app behavior. Sign in and verify the household UI, or supply DAYLAPSE_ACCESS_JWT privately.");
}
process.exitCode = failed ? 1 : 0;
