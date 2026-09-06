import { writeFile } from "node:fs/promises";

const subject = process.argv[2];
if (!subject || !/^(mailto:[^\s@]+@[^\s@]+|https:\/\/[^\s]+)$/.test(subject)) {
  throw new Error("Provide a contact address: npm run notifications:keys -- mailto:you@example.com");
}
const pair = await crypto.subtle.generateKey({ name: "ECDSA", namedCurve: "P-256" }, true, ["sign", "verify"]);
const publicKey = Buffer.from(await crypto.subtle.exportKey("raw", pair.publicKey)).toString("base64url");
const privateKey = (await crypto.subtle.exportKey("jwk", pair.privateKey)).d;
await writeFile(".dev.vars", `VAPID_PUBLIC_KEY=${publicKey}\nVAPID_PRIVATE_KEY=${privateKey}\nVAPID_SUBJECT=${subject}\n`, { flag: "wx", mode: 0o600 });
console.log("Created .dev.vars with VAPID keys. Keep this file private and back it up. Existing files are never overwritten.");
