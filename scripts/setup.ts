import { readFile, writeFile, mkdir } from "node:fs/promises";
import { execFileSync } from "node:child_process";
import { parseArgs } from "node:util";
import { parseConfigFileTextToJson } from "typescript";
import { z } from "zod";
import { deploymentSchema, deploymentConfig, emptyInitializationSql } from "./installation-config";
import { installationSettingsSchema } from "../lib/installation";
import { d1Json } from "./wrangler-output";

const { values, positionals } = parseArgs({ options: {
  local: { type: "boolean" }, remote: { type: "boolean" },
  label: { type: "string" }, id: { type: "string" },
}, allowPositionals: true });
const [action] = positionals;
const template = parseConfigFileTextToJson("wrangler.jsonc", await readFile("wrangler.jsonc", "utf8"));
if (template.error) throw new Error("Invalid wrangler.jsonc");

function wrangler(args: string[], capture = false) {
  return execFileSync(process.execPath, ["node_modules/wrangler/bin/wrangler.js", ...args], {
    encoding: "utf8", stdio: capture ? ["ignore", "pipe", "pipe"] : "inherit",
    env: { ...process.env, WRANGLER_LOG_PATH: ".wrangler/wrangler.log", WRANGLER_SEND_METRICS: "false" },
  });
}
async function configure() {
  const input = deploymentSchema.parse(JSON.parse(await readFile("installation.json", "utf8")));
  const config = deploymentConfig(input, template.config);
  await writeFile("wrangler.deploy.jsonc", JSON.stringify(config, null, 2) + "\n", { mode: 0o600 });
  return input;
}
async function target() {
  if (Boolean(values.local) === Boolean(values.remote)) throw new Error("Choose exactly one of --local or --remote");
  if (values.remote) {
    const input = await configure();
    return { flag: "--remote", config: "wrangler.deploy.jsonc", settings: input.settings };
  }
  return { flag: "--local", config: "wrangler.jsonc", settings: installationSettingsSchema.parse(template.config.vars.DAYLAPSE) };
}
async function executeSql(sql: string, selected: Awaited<ReturnType<typeof target>>) {
  // These bounded admin statements contain no raw tokens. Remote --file uses
  // bulk import and discards SELECT/RETURNING rows, so use --command here.
  const output = wrangler(["d1", "execute", "DB", selected.flag, "--config", selected.config, "--command", sql, "--json"], true);
  return d1Json(output);
}
function quote(value: string) { return `'${value.replaceAll("'", "''")}'`; }

try {
  if (positionals.length !== 1) throw new Error("Provide one setup action");
  if (action === "init") {
    await writeFile("installation.json", await readFile("installation.example.json"), { flag: "wx", mode: 0o600 });
    console.log("Created ignored installation.json. Fill in your own resource IDs and Access settings; existing files are never replaced.");
  } else if (action === "check") {
    if (values.local) {
      if (values.remote) throw new Error("Choose one target");
      installationSettingsSchema.parse(template.config.vars.DAYLAPSE);
      console.log("Local configuration is valid. It accepts loopback HTTP only.");
    } else {
      await configure();
      console.log("Deployment configuration is valid; wrote ignored wrangler.deploy.jsonc. No Cloudflare resources were changed.");
    }
  } else if (action === "provision-db") {
    if (!values.remote || values.local) throw new Error("Database provisioning requires --remote");
    const input = JSON.parse(await readFile("installation.json", "utf8"));
    const fields = z.strictObject({ accountId: z.string().regex(/^[a-f0-9]{32}$/).refine((v) => !/^0+$/.test(v)),
      databaseName: z.string().regex(/^[a-z0-9][a-z0-9-]{0,62}$/) }).parse({ accountId: input.accountId, databaseName: input.databaseName });
    if (input.databaseId !== "00000000-0000-0000-0000-000000000000") {
      z.uuid().parse(input.databaseId);
      console.log("A database ID is already recorded. No database was created or modified.");
    } else {
      await mkdir("work/setup", { recursive: true, mode: 0o700 });
      const file = "work/setup/provision.jsonc";
      await writeFile(file, JSON.stringify({ account_id: fields.accountId }), { flag: "wx", mode: 0o600 });
      wrangler(["d1", "create", fields.databaseName, "--config", file, "--update-config", "--binding", "DB"]);
      const created = parseConfigFileTextToJson(file, await readFile(file, "utf8"));
      input.databaseId = z.uuid().parse(created.config?.d1_databases?.find((db: { binding: string }) => db.binding === "DB")?.database_id);
      await writeFile("installation.json", JSON.stringify(input, null, 2) + "\n", { mode: 0o600 });
      console.log("Recorded the new database ID in ignored installation.json. Existing databases were not adopted or modified.");
    }
  } else if (action === "migrate") {
    const selected = await target();
    wrangler(["d1", "migrations", "apply", "DB", selected.flag, "--config", selected.config]);
  } else if (action === "init-db") {
    const selected = await target();
    const results = await executeSql(emptyInitializationSql(selected.settings.timeZone), selected);
    const row = results.flatMap((result) => result.results).find((row) => "storage_mode" in row);
    if (!row || row.storage_mode !== "rows" || row.import_state !== "ready") {
      throw new Error("Database was not initialized: apply migrations and inspect existing data. Never clear tables to bypass the initializer.");
    }
    console.log(JSON.stringify({ ready: true, timeZone: row.default_time_zone }));
  } else if (action === "display-create") {
    const selected = await target();
    const label = z.string().trim().min(1).max(100).parse(values.label);
    if (values.remote && !selected.settings.displayHostname) throw new Error("Set displayHostname before creating a remote display key");
    const token = Buffer.from(crypto.getRandomValues(new Uint8Array(32))).toString("base64url");
    const hash = Buffer.from(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(token))).toString("hex");
    // Save the private URL before the insert. A failed/uncertain insert leaves a
    // recoverable file; rerunning creates a separate key and never rotates others.
    await mkdir("work/display-keys", { recursive: true, mode: 0o700 });
    const file = `work/display-keys/${crypto.randomUUID()}.json`;
    const origin = values.local ? "http://localhost:5173" : `https://${selected.settings.displayHostname}`;
    await writeFile(file, JSON.stringify({ label, tokenHash: hash, url: `${origin}/display?display_key=${token}` }, null, 2) + "\n", { flag: "wx", mode: 0o600 });
    const result = await executeSql(`INSERT INTO display_access_keys (label, token_hash, created_at) VALUES (${quote(label)}, ${quote(hash)}, ${quote(new Date().toISOString())}) RETURNING id;`, selected);
    console.log(JSON.stringify({ id: result.flatMap((r) => r.results)[0]?.id, privateUrlFile: file }));
  } else if (action === "display-list") {
    const result = await executeSql("SELECT id, label, created_at, revoked_at FROM display_access_keys ORDER BY id", await target());
    console.log(JSON.stringify(result.flatMap((r) => r.results), null, 2));
  } else if (action === "display-revoke") {
    const id = z.coerce.number().int().positive().parse(values.id);
    const result = await executeSql(`UPDATE display_access_keys SET revoked_at = COALESCE(revoked_at, ${quote(new Date().toISOString())}) WHERE id = ${id} RETURNING id;`, await target());
    if (!result.some((row) => row.results.some((key) => key.id === id))) throw new Error("No display key has that ID");
    console.log(JSON.stringify({ revokedId: id }));
  } else if (action === "deploy" || action === "deploy-check") {
    if (values.local || values.remote) throw new Error("Deployment always uses installation.json; omit target flags");
    await configure();
    execFileSync(process.execPath, ["node_modules/vinext/dist/cli.js", "build"], {
      stdio: "inherit", env: { ...process.env, DAYLAPSE_WRANGLER_CONFIG: "wrangler.deploy.jsonc", WRANGLER_LOG_PATH: ".wrangler/wrangler.log" },
    });
    // Always select the build just produced, never Wrangler's last-used redirect.
    const built = JSON.parse(await readFile("dist/server/wrangler.json", "utf8"));
    if (built.vars?.DAYLAPSE?.localDevelopment !== false) throw new Error("Refusing to deploy a development build");
    wrangler(["deploy", "--config", "dist/server/wrangler.json", ...(action === "deploy-check" ? ["--dry-run"] : [])]);
  } else {
    throw new Error("Usage: npm run setup -- init|check|provision-db|migrate|init-db|display-create|display-list|display-revoke|deploy-check|deploy [--local|--remote] [--label NAME] [--id ID]");
  }
} catch (error) {
  // Do not print child-process output: SQL and credential-bearing URLs can be private.
  console.error(error instanceof z.ZodError ? error.issues.map((issue) => `${issue.path.join(".")}: ${issue.message}`).join("\n")
    : error && typeof error === "object" && "status" in error ? "Cloudflare command failed. Inspect private local logs and verify the selected configuration."
    : error instanceof Error ? error.message : "Setup failed.");
  process.exitCode = 1;
}
