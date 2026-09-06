import { canonical, digest } from "./row-converter";
import { completionColumns, completionSchema, eventColumns, eventPatchSchema, eventRecordSchema, parseEventRow, selectColumns, type CompletionRecord, type EventRecord } from "./row-schema";

export class RowError extends Error {
  constructor(readonly status: 400 | 404 | 409 | 413 | 422 | 503, readonly code: string, message: string, readonly current?: EventRecord | null) { super(message); }
}
export type RowChange = { eventId: string; entityType: "event" | "completion"; entityId: string; before: EventRecord | CompletionRecord | null; after: EventRecord | CompletionRecord };
export function insertRows(db: D1Database, table: "events" | "completions", records: (EventRecord | CompletionRecord)[], upsert = false) {
  const columns = table === "events" ? eventColumns : completionColumns;
  const entries = Object.entries(columns);
  const conflicts = table === "events" ? "id" : "event_id, id";
  return db.prepare(`INSERT INTO ${table} (${entries.map(([, c]) => c).join(",")}) SELECT ${entries.map(([key]) => `json_extract(value, '$.${key}')`).join(",")} FROM json_each(?) WHERE 1 ${upsert ? `ON CONFLICT(${conflicts}) DO UPDATE SET ${entries.filter(([, c]) => c !== "id" && c !== "event_id").map(([, c]) => `${c} = excluded.${c}`).join(",")}` : ""}`).bind(JSON.stringify(records));
}
export function insertChanges(db: D1Database, changes: RowChange[], at: string, mutationId: string | null, importRunId: string | null) {
  return db.prepare(`INSERT INTO changes (mutation_id, import_run_id, event_id, entity_type, entity_id, before_json, after_json, created_at)
    SELECT ?, ?, json_extract(value,'$.eventId'), json_extract(value,'$.entityType'), json_extract(value,'$.entityId'),
      CASE WHEN json_type(value,'$.before') = 'null' THEN NULL ELSE json_extract(value,'$.before') END, json_extract(value,'$.after'), ? FROM json_each(?)`)
    .bind(mutationId, importRunId, at, JSON.stringify(changes));
}
export class RowRepository {
  constructor(readonly db: D1Database) {}
  async requireEnabled() {
    const row = await this.db.prepare("SELECT storage_mode, import_state FROM installation_settings WHERE id = 1").first<{ storage_mode: string; import_state: string }>();
    if (row?.storage_mode !== "rows" || row.import_state !== "ready") throw new RowError(503, "row_storage_disabled", "Row storage has not been activated. The current household app is unchanged.");
  }
  async getEvent(id: string) {
    const row = await this.db.prepare(`SELECT ${selectColumns(eventColumns)} FROM events WHERE id = ?`).bind(id).first<Record<string, unknown>>();
    return row ? parseEventRow(row) : null;
  }
  async getEventSummary(id: string) {
    const row = await this.db.prepare(`SELECT ${selectColumns(eventColumns, "e.")}, (SELECT MAX(completed_on) FROM completions WHERE event_id = e.id AND voided_at IS NULL) AS lastCompleted FROM events e WHERE id = ?`).bind(id).first<Record<string, unknown>>();
    if (!row) return null;
    const { lastCompleted, ...record } = row;
    return { ...parseEventRow(record), lastCompleted: lastCompleted as string | null };
  }
  async listEvents(after = "", limit = 50, includeDeleted = false) {
    const rows = await this.db.prepare(`SELECT ${selectColumns(eventColumns, "e.")}, (SELECT MAX(completed_on) FROM completions WHERE event_id = e.id AND voided_at IS NULL) AS lastCompleted FROM events e WHERE id > ? ${includeDeleted ? "" : "AND deleted_at IS NULL"} ORDER BY id LIMIT ?`).bind(after, limit + 1).all<Record<string, unknown>>();
    return { events: rows.results.slice(0, limit).map(({ lastCompleted, ...r }) => ({ ...parseEventRow(r), lastCompleted: lastCompleted as string | null })), nextCursor: rows.results.length > limit ? String(rows.results[limit - 1].id) : null };
  }
  async listCompletions(eventId: string, after = "", limit = 50, includeVoided = false, expectedVersion?: number) {
    const [rows, metadata] = await this.db.batch<Record<string,unknown>>([
      this.db.prepare(`SELECT ${selectColumns(completionColumns)} FROM completions WHERE event_id = ? AND id > ? ${includeVoided ? "" : "AND voided_at IS NULL"} ORDER BY id LIMIT ?`).bind(eventId, after, limit + 1),
      this.db.prepare("SELECT version FROM events WHERE id=?").bind(eventId),
    ]);
    const version=Number(metadata.results[0]?.version);
    if(expectedVersion !== undefined && version !== expectedVersion) throw new RowError(409,"history_changed","This item's history changed. Close and reopen history to load a consistent copy.");
    return { completions: rows.results.slice(0, limit).map((r) => completionSchema.parse(r)), nextCursor: rows.results.length > limit ? String(rows.results[limit - 1].id) : null, version };
  }
  private async receipt(id: string, hash: string) {
    const receipt = await this.db.prepare("SELECT request_hash, response_json FROM mutations WHERE id = ?").bind(id).first<{ request_hash: string; response_json: string | null }>();
    if (!receipt) return null;
    if (receipt.request_hash !== hash) throw new RowError(409, "mutation_id_reused", "This mutation ID was already used for a different request.");
    if (!receipt.response_json) throw new RowError(503, "receipt_incomplete", "The stored mutation receipt is incomplete.");
    return JSON.parse(receipt.response_json) as MutationResult;
  }
  async mutate(command: Command): Promise<MutationResult> {
    await this.requireEnabled();
    const hash = await digest(command);
    const previousReceipt = await this.receipt(command.mutationId, hash);
    if (previousReceipt) return previousReceipt;
    const conflict = async (error: RowError) => {
      // Another identical request may have committed since our first receipt read.
      const replay = await this.receipt(command.mutationId, hash);
      if (replay) return replay;
      throw error;
    };
    const before = await this.getEvent(command.eventId);
    if (command.operation === "create" ? !!before : !before || before.version !== command.expectedVersion) {
      return conflict(new RowError(before ? 409 : 404, "event_version_conflict", "The item changed or no longer exists. Reload it before saving.", before));
    }
    if (before?.deletedAt && command.operation !== "restore") return conflict(new RowError(409, "event_deleted", "Restore the item before changing it.", before));
    const at = new Date().toISOString();
    let after: EventRecord;
    const completionWrites: CompletionRecord[] = [], changes: RowChange[] = [];
    if (command.operation === "create") {
      after = eventRecordSchema.parse({ ...command.event, id: command.eventId, createdAt: at, updatedAt: at, deletedAt: null, version: 1 });
    } else {
      after = eventRecordSchema.parse({ ...before, ...(["patch", "edit"].includes(command.operation) && command.patch && Object.keys(command.patch).length ? eventPatchSchema.parse(command.patch) : {}), version: before!.version + 1, updatedAt: at });
      if (command.operation === "delete") after.deletedAt = at;
      if (command.operation === "restore") {
        if (command.sequence === undefined) after.deletedAt = null;
        else {
          const count = await this.db.prepare("SELECT COUNT(*) AS total FROM completions WHERE event_id = ?").bind(command.eventId).first<{ total: number }>();
          if ((count?.total ?? 0) > 2000) throw new RowError(413, "restore_too_large", "This item needs the staged restore workflow; no changes were applied.");
          const restored = await this.readRevision(command.eventId, command.sequence);
          after = eventRecordSchema.parse({ ...restored.event, version: before!.version + 1, updatedAt: at });
          const current = await this.db.prepare(`SELECT ${selectColumns(completionColumns)} FROM completions WHERE event_id = ?`).bind(command.eventId).all<CompletionRecord>();
          const desired = new Map(restored.completions.map((c) => [c.id, c]));
          const existing = new Map(current.results.map((c) => [c.id, completionSchema.parse(c)]));
          for (const id of new Set([...existing.keys(), ...desired.keys()])) {
            const old = existing.get(id) ?? null;
            const historical = desired.get(id);
            const next = historical ? { ...historical, updatedAt: at } : { ...old!, voidedAt: old!.voidedAt ?? at, updatedAt: at };
            if (canonical(old) !== canonical(next)) {
              completionWrites.push(next);
              changes.push({ eventId: command.eventId, entityType: "completion", entityId: id, before: old, after: next });
            }
          }
        }
      }
      if (command.operation.startsWith("completion.")) {
        if (before!.scheduleType !== "interval") throw new RowError(422, "completion_schedule", "Only interval tasks accept completion changes.");
        const id = command.completionId!;
        const row = await this.db.prepare(`SELECT ${selectColumns(completionColumns)} FROM completions WHERE event_id = ? AND id = ?`).bind(command.eventId, id).first();
        const old = row ? completionSchema.parse(row) : null;
        if (command.operation === "completion.create" ? !!old : !old || !!old.voidedAt) return conflict(new RowError(409, "completion_conflict", "The completion already exists, was removed, or no longer exists.", before));
        const next = completionSchema.parse(old ? { ...old, completedOn: command.completedOn ?? old.completedOn, updatedAt: at, voidedAt: command.operation === "completion.delete" ? at : null } : { eventId: command.eventId, id, completedOn: command.completedOn, recordedAt: at, updatedAt: at, source: "recorded", voidedAt: null });
        const latest = await this.db.prepare("SELECT MAX(completed_on) AS date FROM completions WHERE event_id = ? AND voided_at IS NULL").bind(command.eventId).first<{ date: string | null }>();
        if (command.operation !== "completion.create" || !latest?.date || next.completedOn >= latest.date) after.snoozedUntil = null;
        completionWrites.push(next);
        changes.push({ eventId: command.eventId, entityType: "completion", entityId: id, before: old, after: next });
      }
    }
    if (command.edits?.length) {
      if (after.scheduleType !== "interval") throw new RowError(422, "completion_schedule", "Only interval tasks accept completion changes.");
      for (const edit of command.edits) {
        const row = await this.db.prepare(`SELECT ${selectColumns(completionColumns)} FROM completions WHERE event_id = ? AND id = ?`).bind(command.eventId, edit.id).first();
        const old = row ? completionSchema.parse(row) : null;
        if (!old && edit.completedOn === null) throw new RowError(409, "completion_conflict", "Completion no longer exists.");
        const next = completionSchema.parse(old ? { ...old, completedOn: edit.completedOn ?? old.completedOn, voidedAt: edit.completedOn === null ? at : null, updatedAt: at } : { eventId: command.eventId, id: edit.id, completedOn: edit.completedOn, recordedAt: at, updatedAt: at, source: "recorded", voidedAt: null });
        completionWrites.push(next);
        changes.push({ eventId: command.eventId, entityType: "completion", entityId: edit.id, before: old, after: next });
      }
    }
    after = eventRecordSchema.parse(after);
    changes.unshift({ eventId: command.eventId, entityType: "event", entityId: command.eventId, before, after });
    if (new TextEncoder().encode(JSON.stringify(changes)).length > 750_000) throw new RowError(413, "restore_too_large", "This restore requires the staged restore workflow; no changes were applied.");
    const result = { event: after, ...(completionWrites.length === 1 && command.operation.startsWith("completion.") ? { completion: completionWrites[0] } : {}) };
    const statements = [
      this.db.prepare("INSERT INTO mutations (id, event_id, expected_version, operation, request_hash, created_at) VALUES (?, ?, ?, ?, ?, ?)").bind(command.mutationId, command.eventId, command.operation === "create" ? 0 : command.expectedVersion!, command.operation, hash, at),
      insertRows(this.db, "events", [after], command.operation !== "create"),
      ...(completionWrites.length ? [insertRows(this.db, "completions", completionWrites, true)] : []),
      insertChanges(this.db, changes, at, command.mutationId, null),
      this.db.prepare("UPDATE mutations SET sequence = (SELECT MAX(sequence) FROM changes WHERE mutation_id = ?), response_json = json_set(?, '$.sequence', (SELECT MAX(sequence) FROM changes WHERE mutation_id = ?)) WHERE id = ?")
        .bind(command.mutationId, JSON.stringify(result), command.mutationId, command.mutationId),
    ];
    try { await this.db.batch(statements); }
    catch (error) {
      const receipt = await this.receipt(command.mutationId, hash);
      if (receipt) return receipt;
      const message = error instanceof Error ? error.message : "";
      if (message.includes("event_version_conflict")) throw new RowError(409, "event_version_conflict", "The item changed while saving. Reload before retrying.", await this.getEvent(command.eventId));
      if (message.includes("row_storage_disabled")) throw new RowError(503, "row_storage_disabled", "Row storage is disabled.");
      throw error;
    }
    return (await this.receipt(command.mutationId, hash))!;
  }
  async listChanges(after = 0, limit = 50) {
    // Paginate committed operations, never split a multi-row mutation across cursors.
    const rows = await this.db.prepare("SELECT id, event_id AS eventId, sequence, operation, created_at AS createdAt FROM mutations WHERE sequence > ? ORDER BY sequence LIMIT ?").bind(after, limit + 1).all();
    const page = rows.results.slice(0, limit);
    return { mutations: page, nextCursor: rows.results.length > limit ? Number(page[page.length - 1].sequence) : null, cursor: page.length ? Number(page[page.length - 1].sequence) : after };
  }
  async listRevisions(eventId: string, after = 0, limit = 50) {
    const rows = await this.db.prepare("SELECT sequence, operation, created_at AS createdAt FROM mutations WHERE EXISTS (SELECT 1 FROM changes WHERE mutation_id=mutations.id AND event_id = ?) AND sequence > ? ORDER BY sequence LIMIT ?").bind(eventId, after, limit + 1).all();
    const baseline = await this.db.prepare("SELECT end_sequence AS sequence, imported_at AS createdAt FROM migration_runs WHERE completed_at IS NOT NULL AND EXISTS (SELECT 1 FROM changes WHERE import_run_id = migration_runs.id AND event_id = ?)").bind(eventId).first();
    return { baseline, revisions: rows.results.slice(0, limit), nextCursor: rows.results.length > limit ? rows.results[limit - 1].sequence : null };
  }
  async readRevision(eventId: string, sequence: number) {
    const boundary = await this.db.prepare("SELECT 1 AS valid FROM mutations WHERE sequence = ? UNION ALL SELECT 1 FROM migration_runs WHERE end_sequence = ? AND completed_at IS NOT NULL LIMIT 1").bind(sequence, sequence).first();
    if (!boundary) throw new RowError(422, "invalid_revision", "Choose a committed mutation or import revision.");
    const count = await this.db.prepare("SELECT COUNT(DISTINCT entity_id) AS total FROM changes WHERE event_id = ? AND entity_type = 'completion' AND sequence <= ?").bind(eventId, sequence).first<{ total: number }>();
    if ((count?.total ?? 0) > 2000) throw new RowError(413, "revision_too_large", "This revision needs the staged recovery workflow.");
    const rows = await this.db.prepare(`SELECT entity_type, after_json FROM changes WHERE sequence IN
      (SELECT MAX(sequence) FROM changes WHERE event_id = ? AND sequence <= ? GROUP BY entity_type, entity_id)`).bind(eventId, sequence).all<{ entity_type: string; after_json: string }>();
    const event = rows.results.find((r) => r.entity_type === "event");
    if (!event) throw new RowError(404, "revision_not_found", "The item did not exist at this revision.");
    return { event: eventRecordSchema.parse(JSON.parse(event.after_json)), completions: rows.results.filter((r) => r.entity_type === "completion").map((r) => completionSchema.parse(JSON.parse(r.after_json))) };
  }
}
export type MutationResult = { event: EventRecord; completion?: CompletionRecord; sequence: number };
export type Command = {
  operation: "edit" | "create" | "patch" | "delete" | "restore" | "completion.create" | "completion.patch" | "completion.delete";
  mutationId: string; eventId: string; expectedVersion?: number; event?: Record<string, unknown>; patch?: Record<string, unknown>;
  edits?: { id: string; completedOn: string | null }[];
  completionId?: string; completedOn?: string; sequence?: number;
};
