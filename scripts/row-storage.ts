import { chmod, mkdir, readFile, writeFile } from "node:fs/promises";
import { resolve, sep } from "node:path";
import { parseArgs } from "node:util";
import { convertSnapshot } from "../lib/row-converter";
import { importConverted } from "../lib/row-importer";
import { openLocalRows } from "./row-storage-local";

const { values, positionals } = parseArgs({ allowPositionals: true, options: { snapshot: { type: "string" }, output: { type: "string", default: "work/row-storage" }, date: { type: "string", default: new Date().toISOString().slice(0, 10) }, timezone: { type: "string", default: "UTC" } } });
const action = positionals[0];
if (!["inventory", "rehearse"].includes(action) || !values.snapshot) throw new Error("Usage: npm run rows -- inventory|rehearse --snapshot <private JSON file> [--date YYYY-MM-DD] [--timezone UTC]");
const output = resolve(values.output!), work = resolve("work");
if (!output.startsWith(work + sep)) throw new Error("Reports and local databases must stay under the ignored work/ directory");
await mkdir(output, { recursive: true, mode: 0o700 });
await chmod(output, 0o700);
const snapshot = JSON.parse(await readFile(values.snapshot, "utf8"));
const year = Number(values.date!.slice(0, 4));
const dates = [...new Set([values.date!, `${year}-12-31`, `${year + 1}-01-01`, `${year + 1}-02-28`, "2028-02-29", "2029-03-01"])];
const conversion = await convertSnapshot(snapshot, snapshot.updatedAt ?? "1970-01-01T00:00:00.000Z", dates);
for (const [name, data] of [["inventory.json", conversion.report], ["conversion.json", conversion]] as const) {
  const path = resolve(output, name);
  await writeFile(path, JSON.stringify(data, null, 2), { mode: 0o600 }); await chmod(path, 0o600);
}
console.log(JSON.stringify({ sourceRevision: conversion.report.sourceRevision, events: conversion.events.length, originalCompletions: conversion.report.originalCompletionCount, importedCompletions: conversion.completions.length, syntheticLegacyCompletions: conversion.report.syntheticCompletions, comparisonsPassed: conversion.report.comparisons.every((c) => c.equal), warningCounts: conversion.report.warnings.reduce<Record<string, number>>((r, w) => ({ ...r, [w.code]: (r[w.code] ?? 0) + 1 }), {}) }));
if (action === "rehearse") {
  const { db, mf } = await openLocalRows(resolve(output, "d1"));
  try {
    const result = await importConverted(db, conversion, { timeZone: values.timezone });
    console.log(JSON.stringify({ alreadyImported: result.alreadyImported, localImport: "verified", rowApis: "disabled", productionWrites: false }));
  } finally { await mf.dispose(); }
}
