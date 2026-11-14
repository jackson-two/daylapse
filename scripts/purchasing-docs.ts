import { readFile, writeFile } from "node:fs/promises";
import { describePurchasing } from "../lib/purchasing/contract";
const file = "docs/purchasing-mcp.md";
const marker = "<!-- BEGIN GENERATED PURCHASING CONTRACT -->";
const endMarker = "<!-- END GENERATED PURCHASING CONTRACT -->";
const contract = describePurchasing("write");
const table = (head: string[], rows: unknown[][]) => [head, head.map(() => "---"), ...rows].map((row) => `| ${row.map((cell) => String(cell).replaceAll("|", "\\|").replaceAll("\n", " ")).join(" | ")} |`).join("\n");
const json = (value: unknown) => `\`\`\`json\n${JSON.stringify(value, null, 2)}\n\`\`\``;
const parts = [marker,
  "## Discoverable purchasing contract",
  "Generated from the same schemas, contract and executable recipes returned by `shopping_describe`. Regenerate with `node --import tsx scripts/purchasing-docs.ts`; CI tests reject stale documentation. Authentication/setup above is unchanged. No database migration is needed for this metadata release.",
  "`shopping_describe({})` returns `entities` (create schemas), `saveUpdates` (partial updates), `commands`, `queries`, `records`, `recordMetadata`, `responseSchemas` (one JSON Schema document with view schemas in `properties` and shared definitions in `$defs`), `entityGraph`, `versionRules`, `queryViews`, `conventions`, `errorReference`, `recipes`, this connection's `permission` and the allowed `permissions`. Original `operations`/`priceRules` keys remain. `shopping_query` wraps arguments in `{query: ...}`; `shopping_mutate` wraps in `{command: ...}`. Successful mutations return `{record, revision}`; the record kind depends on the operation below.",
  "### Entity relationships",
  table(["Collection", "Meaning", "Primary key", "Join keys"], Object.entries(contract.entityGraph).map(([key, value]) => [key, value.meaning, value.primaryKey, value.joins.join("; ")])),
  "### Operation and version reference",
  table(["Operation", "expectedVersion / extra versions", "Returned record", "Changes"], Object.entries(contract.versionRules).map(([key, value]) => [key, value.expectedVersion, value.returns, value.changes])),
  "### Query views and responses",
  "Only use the supported filters listed here. `required` lists identifiers required for useful operation even where the shared schema accepts omission for compatibility. All response record fields and constraints are exposed as JSON Schema in `records` and `responseSchemas`.",
  table(["View", "Purpose", "Supported filters", "Required IDs", "Response properties", "Pagination / details"], Object.entries(contract.queryViews).map(([key, value]) => [key, value.purpose, value.filters.join(", "), value.required.join(", ") || "none", value.response.join(", "), value.pagination])),
  "### Formats, consistency and safe operation",
  ...Object.entries(contract.conventions).map(([key, value]) => `**${key}:** ${value}`),
  `**Permissions:** ${contract.permissionRules}`,
  `**Entry statuses:** ${contract.entryStatuses.enum?.join(", ")}. ${contract.entryStatuses.description}`,
  "### Field reference",
  "The create/observation/outcome schemas below show actual defaults and required fields. Partial save updates preserve omitted fields; the discoverable `saveUpdates` schemas remove creation defaults and required lists. Cross-field refinements (purchase quantity, total consistency, active relationships and current versions) are also documented in descriptions and the operation reference; JSON Schema alone cannot express all service rules.",
];
for (const [entity, schema] of Object.entries({ ...contract.entities, price: contract.price, outcome: contract.outcome })) {
  parts.push(`#### ${entity}`, table(["Field", "Required on create", "Default", "Meaning / constraints"], Object.entries(schema.properties ?? {}).map(([key, value]) => [key, schema.required?.includes(key) ? "yes" : "no", typeof value === "object" && "default" in value ? JSON.stringify(value.default) : "—", typeof value === "object" ? value.description ?? "" : ""])));
}
parts.push("### Actionable errors", contract.conventions.errors,
  table(["Code", "Status", "Meaning", "Next action"], contract.errorReference.map((e) => [e.code ?? "(legacy transport; no code)", e.status, e.meaning, e.action])),
  "### Canonical synthetic workflows",
  "Call `shopping_describe` and discover tools before these operations. These recipes are returned in machine-readable form and tested through MCP against an empty disposable database. `$step.path` substitutes a prior response value; `$purchase.request.command` means the exact saved command. Array index references apply only to this isolated single-item fixture; in a real workspace find the matching ID, not the first entry/offer. Expected objects below are subsets, not complete response bodies. Generated server IDs/timestamps and purchasing revisions vary. Keep `revision` from every paginated response and `record.version` from writes; they are different counters.");
for (const [key, recipe] of Object.entries(contract.recipes)) {
  parts.push(`#### Recipe ${key}`, recipe.purpose);
  for (const step of recipe.steps) parts.push(`**${step.id} — ${step.tool}${step.isError ? " (expected conflict)" : ""}**${step.note ? `\n\n${step.note}` : ""}`, json(step.arguments), `Expected response subset${step.isError ? " (isError=true)" : ""}:`, json(step.expected));
}
parts.push(endMarker);
const current = await readFile(file, "utf8");
const start = current.indexOf(marker), end = current.indexOf(endMarker);
if (start < 0 || end < 0) throw new Error("Missing documentation generation markers");
const generated = current.slice(0, start) + parts.join("\n\n") + current.slice(end + endMarker.length);
if (process.argv.includes("--check")) {
  if (generated !== current) throw new Error("Purchasing MCP docs are stale; run node --import tsx scripts/purchasing-docs.ts");
  console.log("Purchasing MCP documentation matches discoverable contract.");
} else await writeFile(file, generated);
