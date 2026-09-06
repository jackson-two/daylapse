import assert from "node:assert/strict";
import test from "node:test";
import { serveAuthorizedRequest } from "../lib/worker-request";
import { testInstallation } from "./fixtures/installation";

test("assets load after access checks and missing assets reach the framework", async () => {
  const calls: string[] = [];
  const env = {
    DAYLAPSE: { ...testInstallation, localDevelopment: true, familyHostname: "localhost" },
    ASSETS: { fetch: async (request: Request) => {
      calls.push("asset");
      return new Response("asset", { status: new URL(request.url).pathname.startsWith("/assets/") ? 200 : 404 });
    } } as Pick<Fetcher, "fetch">,
  };
  const render = async () => { calls.push("render"); return new Response("page"); };
  const asset = await serveAuthorizedRequest(new Request("http://localhost/assets/app.js"), env, render);
  assert.equal(await asset.text(), "asset");
  assert.deepEqual(calls.splice(0), ["asset"]);
  assert.equal(await (await serveAuthorizedRequest(new Request("http://localhost/"), env, render)).text(), "page");
  assert.deepEqual(calls.splice(0), ["asset", "render"]);
  await serveAuthorizedRequest(new Request("http://localhost/api/events/snapshot"), env, render);
  assert.deepEqual(calls.splice(0), ["render"]);
  const denied = await serveAuthorizedRequest(new Request("https://daylapse.example.com/assets/app.js"), { ...env, DAYLAPSE: testInstallation }, render);
  assert.equal(denied.status, 401);
  assert.deepEqual(calls, []);
  const displayDenied = await serveAuthorizedRequest(new Request("https://display.daylapse.example.com/api/events/snapshot"), { ...env, DAYLAPSE: testInstallation }, render);
  assert.equal(displayDenied.status, 404);
  assert.deepEqual(calls, []);
});
