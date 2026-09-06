import assert from "node:assert/strict";
import test from "node:test";
import { build } from "esbuild";
import { Miniflare, convertV4MiniflareOptions } from "miniflare";
import { runtimeCompatibility } from "../scripts/runtime-config";

// Run encryption AND fetch in workerd: a Node fetch mock accepts redirect modes
// that the deployed Workers runtime rejects before contacting the push service.
test("Workers sends encrypted push requests and refuses to follow push-service redirects", async (t) => {
  const bundle = await build({ stdin: { contents: `
    import { sendPush } from './lib/notification-service';
    export default { async fetch(request) {
      try {
        const vapid = await crypto.subtle.generateKey({name:'ECDSA',namedCurve:'P-256'},true,['sign','verify']);
        const browser = await crypto.subtle.generateKey({name:'ECDH',namedCurve:'P-256'},true,['deriveBits']);
        const encode = (bytes) => btoa(String.fromCharCode(...new Uint8Array(bytes))).replaceAll('+','-').replaceAll('/','_').replaceAll('=','');
        const env = {VAPID_PUBLIC_KEY:encode(await crypto.subtle.exportKey('raw',vapid.publicKey)),VAPID_PRIVATE_KEY:(await crypto.subtle.exportKey('jwk',vapid.privateKey)).d,VAPID_SUBJECT:'mailto:notifications@example.com'};
        const row = {endpoint:'https://web.push.apple.com'+new URL(request.url).pathname,p256dh:encode(await crypto.subtle.exportKey('raw',browser.publicKey)),auth:encode(crypto.getRandomValues(new Uint8Array(16)))};
        const status = await sendPush(env,row,{title:'Private test title',body:'Private notification body',tag:'test',data:{url:'/',dueDate:''}});
        return Response.json({status});
      } catch(error) { return Response.json({error:error.message},{status:500}); }
    }};
  `, resolveDir: process.cwd(), loader: "ts" }, bundle: true, write: false, format: "esm", platform: "browser", target: "es2022" });
  const mf = new Miniflare(convertV4MiniflareOptions({ workers: [
    { name: "sender", modules: true, script: bundle.outputFiles[0].text, ...runtimeCompatibility, outboundService: "push-service" },
    { name: "push-service", modules: true, ...runtimeCompatibility, script: `
      export default { async fetch(request) {
        const path = new URL(request.url).pathname;
        if(path === '/redirected') return new Response(null,{status:307,headers:{Location:'https://example.com/leak'}});
        if(path !== '/accepted') return new Response('Unexpected redirect destination',{status:418});
        const body = new Uint8Array(await request.arrayBuffer());
        const valid = request.method === 'POST' && request.headers.get('authorization')?.startsWith('vapid ')
          && request.headers.get('content-encoding') === 'aes128gcm' && body.length === 4096
          && !new TextDecoder().decode(body).includes('Private notification body');
        return new Response(null,{status:valid ? 201 : 422});
      }};
    ` },
  ] }));
  t.after(() => mf.dispose());
  const accepted = await mf.dispatchFetch("https://worker.test/accepted");
  assert.equal(accepted.status, 200, await accepted.clone().text());
  assert.deepEqual(await accepted.json(), { status: 201 });
  assert.deepEqual(await (await mf.dispatchFetch("https://worker.test/redirected")).json(), { status: 307 });
});
