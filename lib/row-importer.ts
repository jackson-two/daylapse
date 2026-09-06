import { canonical, digest, type Conversion } from "./row-converter";
import { completionColumns, completionSchema, eventColumns, parseEventRow, selectColumns, type CompletionRecord, type EventRecord } from "./row-schema";
import { insertChanges, insertRows, type RowChange } from "./row-repository";

export function importChunks(conversion: Conversion) {
  const chunks: { table: "events" | "completions"; rows: (EventRecord | CompletionRecord)[] }[] = [];
  for (const [table, records] of [["events", conversion.events], ["completions", conversion.completions]] as const) {
    let rows: (EventRecord | CompletionRecord)[] = [], size = 0;
    for (const row of records) {
      const bytes = new TextEncoder().encode(JSON.stringify(row)).length;
      if (rows.length && size + bytes > 64_000) { chunks.push({ table, rows }); rows = []; size = 0; }
      rows.push(row); size += bytes;
    }
    if (rows.length) chunks.push({ table, rows });
  }
  return chunks;
}
export async function importConverted(db: D1Database, conversion: Conversion, options: { timeZone?: string; afterChunk?: (index: number) => void } = {}) {
  const { runId, importedAt, report } = conversion;
  const timeZone = options.timeZone ?? "UTC";
  new Intl.DateTimeFormat("en", { timeZone }).format();
  const chunks = importChunks(conversion);
  const existing = await db.prepare("SELECT source_hash, imported_at, completed_at FROM migration_runs WHERE id = ?").bind(runId).first<{ source_hash: string; imported_at: string; completed_at: string | null }>();
  if (existing && (existing.source_hash !== report.sourceHash || existing.imported_at !== importedAt)) throw new Error("Import run identity differs; use the original conversion manifest");
  if (existing?.completed_at) return { runId, alreadyImported: true };
  if (!existing) {
    await db.batch([
      db.prepare("INSERT INTO migration_runs (id, source_revision, source_hash, converter_version, expected_events, expected_completions, expected_chunks, imported_at, report_json) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)")
        .bind(runId, report.sourceRevision, report.sourceHash, report.converterVersion, conversion.events.length, conversion.completions.length, chunks.length, importedAt, JSON.stringify(report)),
      db.prepare("UPDATE installation_settings SET import_state = 'importing', active_run_id = ?, default_time_zone = ? WHERE id = 1").bind(runId, timeZone),
    ]);
  }
  for (let i = 0; i < chunks.length; i++) {
    const chunk = chunks[i], checksum = await digest(chunk);
    const applied = await db.prepare("SELECT checksum FROM migration_chunks WHERE run_id = ? AND chunk_number = ?").bind(runId, i).first<{ checksum: string }>();
    if (applied) { if (applied.checksum !== checksum) throw new Error("Previously imported chunk has a different checksum"); continue; }
    const changes: RowChange[] = chunk.rows.map((row) => ({ eventId: "eventId" in row ? row.eventId : row.id, entityType: chunk.table === "events" ? "event" : "completion", entityId: row.id, before: null, after: row }));
    try {
      await db.batch([
        db.prepare("INSERT INTO migration_chunks (run_id, chunk_number, checksum) VALUES (?, ?, ?)").bind(runId, i, checksum),
        insertRows(db, chunk.table, chunk.rows), insertChanges(db, changes, importedAt, null, runId),
      ]);
    } catch (error) {
      const concurrent = await db.prepare("SELECT checksum FROM migration_chunks WHERE run_id = ? AND chunk_number = ?").bind(runId, i).first<{ checksum: string }>();
      if (concurrent?.checksum !== checksum) throw error;
    }
    options.afterChunk?.(i);
  }
  // Verify actual imported values, not just counts, before marking the baseline usable.
  const actualEvents = (await db.prepare(`SELECT ${selectColumns(eventColumns)} FROM events ORDER BY id`).all<Record<string, unknown>>()).results.map(parseEventRow);
  const actualCompletions = (await db.prepare(`SELECT ${selectColumns(completionColumns)} FROM completions ORDER BY event_id, id`).all()).results.map((row) => completionSchema.parse(row));
  const sorted = <T>(rows: T[]) => [...rows].sort((a, b) => canonical(a).localeCompare(canonical(b)));
  if (await digest(sorted(actualEvents)) !== await digest(sorted(conversion.events)) || await digest(sorted(actualCompletions)) !== await digest(sorted(conversion.completions))) throw new Error("Imported row checksum differs from the conversion manifest; activation blocked");
  await db.batch([
    db.prepare("UPDATE migration_runs SET completed_at = ?, end_sequence = COALESCE((SELECT MAX(sequence) FROM changes WHERE import_run_id = ?), 0) WHERE id = ?").bind(new Date().toISOString(), runId, runId),
    db.prepare("UPDATE installation_settings SET import_state = 'ready' WHERE id = 1 AND storage_mode = 'legacy' AND active_run_id = ?").bind(runId),
  ]);
  return { runId, alreadyImported: false };
}
