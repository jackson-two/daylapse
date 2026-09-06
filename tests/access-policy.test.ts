import assert from "node:assert/strict";
import test from "node:test";
import { createLocalJWKSet, exportJWK, generateKeyPair, SignJWT } from "jose";
import { accessResponse } from "../lib/access-policy";
import { testInstallation as settings } from "./fixtures/installation";
import { build } from "esbuild";
import { Miniflare, convertV4MiniflareOptions } from "miniflare";
import { runtimeCompatibility } from "../scripts/runtime-config";

test("workerd verifies Access signatures using the remote signing-key endpoint", async (t) => {
  const pair = await generateKeyPair("RS256");
  const keys = { keys: [{ ...await exportJWK(pair.publicKey), kid: "runtime-key", alg: "RS256" }] };
  const token = await new SignJWT({}).setProtectedHeader({ alg: "RS256", kid: "runtime-key" })
    .setSubject("synthetic-member").setIssuedAt().setExpirationTime("5m")
    .setIssuer(`https://${settings.accessTeamDomain}`).setAudience(settings.accessAudience).sign(pair.privateKey);
  const bundle = await build({ stdin: { contents: `
    import { accessResponse } from './lib/access-policy';
    export default { async fetch(request) {
      return await accessResponse(request, ${JSON.stringify(settings)}) ?? Response.json({ authorized: true });
    }};`, resolveDir: process.cwd(), loader: "ts" }, bundle: true, write: false, format: "esm", platform: "browser", target: "es2022" });
  const mf = new Miniflare(convertV4MiniflareOptions({ workers: [
    { name: "guard", modules: true, script: bundle.outputFiles[0].text, ...runtimeCompatibility, outboundService: "signing-keys" },
    { name: "signing-keys", modules: true, ...runtimeCompatibility, script: `export default { fetch(request) {
      if (request.url !== 'https://${settings.accessTeamDomain}/cdn-cgi/access/certs') return new Response(null, {status:404});
      return Response.json(${JSON.stringify(keys)});
    }};` },
  ] }));
  t.after(() => mf.dispose());
  const url = `https://${settings.familyHostname}/api/events/snapshot`;
  assert.equal((await mf.dispatchFetch(url)).status, 401);
  const response = await mf.dispatchFetch(url, { headers: { "cf-access-jwt-assertion": token } });
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { authorized: true });
});

test("all household routes require a valid, unexpired Access JWT for this installation", async () => {
  const pair = await generateKeyPair("RS256");
  const key = { ...await exportJWK(pair.publicKey), kid: "test-key", alg: "RS256" };
  const getKey = createLocalJWKSet({ keys: [key] });
  async function token(overrides: { issuer?: string; audience?: string; expired?: boolean } = {}) {
    return new SignJWT({ email: "member@example.com" }).setProtectedHeader({ alg: "RS256", kid: "test-key" })
      .setSubject("household-member").setIssuedAt().setIssuer(overrides.issuer ?? `https://${settings.accessTeamDomain}`)
      .setAudience(overrides.audience ?? settings.accessAudience).setExpirationTime(overrides.expired ? "-5m" : "5m").sign(pair.privateKey);
  }
  const valid = await token();
  for (const path of ["/", "/api/events/snapshot", "/api/recovery", "/api/notifications", "/api/items/revisions", "/api/future-endpoint"]) {
    const request = (jwt?: string) => new Request(`https://${settings.familyHostname}${path}`, {
      headers: jwt ? { "cf-access-jwt-assertion": jwt } : { "cf-access-authenticated-user-email": "spoofed@example.com" },
    });
    assert.equal((await accessResponse(request(), settings, getKey))?.status, 401);
    assert.equal(await accessResponse(request(valid), settings, getKey), null);
    for (const invalid of ["garbage", await token({ issuer: "https://other.cloudflareaccess.com" }),
      await token({ audience: "wrong-app" }), await token({ expired: true }), valid.slice(0, -8) + "tampered"]) {
      assert.equal((await accessResponse(request(invalid), settings, getKey))?.status, 401);
    }
  }
});

test("unknown hosts, forwarded-host spoofing, missing configuration and public local mode fail closed", async () => {
  const request = new Request("https://unknown.example.com/api/events", { headers: { "x-forwarded-host": settings.familyHostname } });
  assert.equal((await accessResponse(request, settings))?.status, 404);
  assert.equal((await accessResponse(request, undefined))?.status, 503);
  assert.equal((await accessResponse(new Request(`https://${settings.familyHostname}/`), { ...settings, accessAudience: "" }))?.status, 503);
  assert.equal((await accessResponse(new Request(`https://${settings.familyHostname}/`), { ...settings, localDevelopment: true }))?.status, 403);
  assert.equal(await accessResponse(new Request("http://localhost:5173/"), { ...settings, localDevelopment: true }), null);
  assert.equal((await accessResponse(new Request("http://localhost:5173/"), settings))?.status, 404);
});

test("display host permits only read-only display paths and assets; forwards cannot unlock private APIs", async () => {
  const request = (path: string, method = "GET") => new Request(`https://${settings.displayHostname}${path}`, {
    method, headers: { "x-forwarded-host": settings.familyHostname },
  });
  for (const path of ["/display", "/api/display/items", "/assets/page-abc.js", "/favicon.svg"]) {
    assert.equal(await accessResponse(request(path), settings), null);
    assert.equal((await accessResponse(request(path, "POST"), settings))?.status, 405);
  }
  for (const path of ["/", "/api/events/snapshot", "/api/notifications", "/api/recovery", "/assets/../api/events"]) {
    assert.equal((await accessResponse(request(path), settings))?.status, 404);
  }
  assert.equal((await accessResponse(request("/display"), { ...settings, displayHostname: "" }))?.status, 404);
});
