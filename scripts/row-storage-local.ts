import { readFile, readdir } from "node:fs/promises";
import { Miniflare, convertV4MiniflareOptions } from "miniflare";
import { runtimeCompatibility } from "./runtime-config";

/** Isolated local D1 only. This helper has no remote credentials or execution path. */
export async function openLocalRows(persist?: string, throughMigration = Number.MAX_SAFE_INTEGER) {
  const mf = new Miniflare(convertV4MiniflareOptions({ modules: true, script: "export default { fetch() { return new Response('row storage rehearsal'); } };", ...runtimeCompatibility, d1Databases: ["DB"], ...(persist ? { d1Persist: persist } : {}) }));
  try {
    const db = await mf.getD1Database("DB");
    await db.prepare("CREATE TABLE IF NOT EXISTS foundation_migrations (name TEXT PRIMARY KEY)").run();
    const directory = new URL("../drizzle/", import.meta.url);
    for (const name of (await readdir(directory)).filter((n) => /^\d+.*\.sql$/.test(n) && Number(n.split("_")[0]) <= throughMigration).sort()) {
      if (await db.prepare("SELECT name FROM foundation_migrations WHERE name = ?").bind(name).first()) continue;
      const sql = await readFile(new URL(name, directory), "utf8");
      await db.batch([...sql.split("--> statement-breakpoint").map((s) => s.trim()).filter(Boolean).map((s) => db.prepare(s)), db.prepare("INSERT INTO foundation_migrations (name) VALUES (?)").bind(name)]);
    }
    return { db, mf };
  } catch (error) { await mf.dispose(); throw error; }
}
