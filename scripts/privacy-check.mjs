import { execFileSync } from "node:child_process";
import { readFileSync, lstatSync } from "node:fs";

const files = [...new Set(execFileSync("git", ["ls-files", "--cached", "--others", "--exclude-standard", "-z"], { encoding: "utf8" }).split("\0").filter(Boolean))];
const privatePath = /(^|\/)(?:\.dev\.vars(?:\..*)?|\.env(?:\..*)?|installation\.json|wrangler\.deploy\.jsonc|work|backups|exports|\.wrangler)(?:\/|$)|\.(?:sqlite3?|db|pem|key|p12|pfx)$/;
const signatures = [/-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/, /\b(?:ghp_|github_pat_)[A-Za-z0-9_]{30,}\b/,
  /\bAKIA[0-9A-Z]{16}\b/, /\beyJ[A-Za-z0-9_-]{15,}\.[A-Za-z0-9_-]{15,}\.[A-Za-z0-9_-]{15,}\b/];
const findings = [];
for (const file of files) {
  if (privatePath.test(file)) findings.push(`${file}: private file must remain untracked`);
  if (!lstatSync(file).isFile()) { findings.push(`${file}: review non-regular file`); continue; }
  const content = readFileSync(file);
  if (content.includes(0)) continue;
  if (signatures.some((rule) => rule.test(content.toString("utf8")))) findings.push(`${file}: credential-like content`);
}
if (findings.length) { console.error(findings.join("\n")); process.exitCode = 1; }
else console.log(`Privacy check passed for ${files.length} source files. This targeted scan does not replace a full history and secret review.`);
