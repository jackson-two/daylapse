import { canonical, convertSnapshot, digest } from "./row-converter";
import { completionColumns, completionSchema, eventColumns, eventRecordSchema, parseEventRow, selectColumns, type CompletionRecord, type EventRecord } from "./row-schema";
import { insertChanges, insertRows, RowError, RowRepository, type RowChange } from "./row-repository";

type RecoverySource = {legacyRevision:number} | {sequence:number};
/** Reconstruct a household at a committed boundary; legacy snapshots stay immutable. */
export async function readRecovery(db:D1Database, source:RecoverySource, maxEntities=20000) {
  if ("legacyRevision" in source) {
    const legacy=await db.prepare("SELECT data, created_at FROM household_state_revisions WHERE revision=?").bind(source.legacyRevision).first<{data:string;created_at:string}>();
    if(!legacy) throw new RowError(404,"revision_not_found","Legacy revision not found.");
    const conversion=await convertSnapshot({items:JSON.parse(legacy.data),revision:source.legacyRevision},legacy.created_at,[legacy.created_at.slice(0,10)]);
    return {events:conversion.events,completions:conversion.completions};
  }
  const boundary=await db.prepare("SELECT 1 FROM mutations WHERE sequence=? UNION ALL SELECT 1 FROM migration_runs WHERE end_sequence=? AND completed_at IS NOT NULL").bind(source.sequence,source.sequence).first();
  if(!boundary) throw new RowError(422,"invalid_revision","Choose a committed revision.");
  const rows=await db.prepare("SELECT entity_type, after_json FROM changes WHERE sequence IN (SELECT MAX(sequence) FROM changes WHERE sequence<=? GROUP BY event_id,entity_type,entity_id) LIMIT ?").bind(source.sequence,maxEntities+1).all<{entity_type:string;after_json:string}>();
  if(rows.results.length>maxEntities) throw new RowError(413,"recovery_too_large","This recovery needs an operator maintenance window and a database export.");
  return {events:rows.results.filter((r)=>r.entity_type==="event").map((r)=>eventRecordSchema.parse(JSON.parse(r.after_json))),completions:rows.results.filter((r)=>r.entity_type==="completion").map((r)=>completionSchema.parse(JSON.parse(r.after_json)))};
}
/** Whole-household recovery is a new atomic audited mutation, guarded by the global sequence. */
export async function restoreRows(db:D1Database, source:RecoverySource, expectedSequence:number, mutationId:string, staged=false) {
  await new RowRepository(db).requireEnabled();
  const hash=await digest({source,expectedSequence,mutationId});
  async function receipt() {
    const row=await db.prepare("SELECT request_hash,response_json FROM mutations WHERE id=?").bind(mutationId).first<{request_hash:string;response_json:string}>();
    if(!row)return null;
    if(row.request_hash!==hash)throw new RowError(409,"mutation_id_reused","Mutation ID already used.");
    return JSON.parse(row.response_json);
  }
  const replay=await receipt();if(replay)return replay;
  const maxEntities=staged ? 100000 : 20000;
  const target=await readRecovery(db,source,maxEntities);
  const current=await db.batch<Record<string,unknown>>([
    db.prepare(`SELECT ${selectColumns(eventColumns)} FROM events LIMIT 501`),
    db.prepare(`SELECT ${selectColumns(completionColumns)} FROM completions LIMIT ?`).bind(maxEntities+1),
    db.prepare("SELECT COALESCE(MAX(sequence),0) AS sequence FROM changes"),
  ]);
  if(Number(current[2].results[0].sequence)!==expectedSequence)throw new RowError(409,"household_sequence_conflict","The household changed; reload before restoring.");
  if(current[0].results.length>500||current[1].results.length>maxEntities)throw new RowError(413,"recovery_too_large","This recovery needs an operator maintenance window and a database export.");
  const at=new Date().toISOString(), changes:RowChange[]=[],events:EventRecord[]=[],completions:CompletionRecord[]=[];
  const beforeEvents=new Map(current[0].results.map((r)=>{const e=parseEventRow(r);return [e.id,e];}));
  const desiredEvents=new Map(target.events.map((e)=>[e.id,e]));
  for(const id of new Set([...beforeEvents.keys(),...desiredEvents.keys()])) {
    const before=beforeEvents.get(id)??null, desired=desiredEvents.get(id);
    const after=eventRecordSchema.parse({...desired??before,deletedAt:desired?desired.deletedAt:before!.deletedAt??at,version:(before?.version??0)+1,updatedAt:at});
    events.push(after);changes.push({eventId:id,entityType:"event",entityId:id,before,after});
  }
  const key=(c:CompletionRecord)=>JSON.stringify([c.eventId,c.id]);
  const beforeCompletions=new Map(current[1].results.map((r)=>{const c=completionSchema.parse(r);return [key(c),c];}));
  const desiredCompletions=new Map(target.completions.map((c)=>[key(c),c]));
  for(const id of new Set([...beforeCompletions.keys(),...desiredCompletions.keys()])) {
    const before=beforeCompletions.get(id)??null,desired=desiredCompletions.get(id);
    const after=completionSchema.parse({...desired??before,voidedAt:desired?desired.voidedAt:before!.voidedAt??at,updatedAt:at});
    if(canonical(before)!==canonical(after)){completions.push(after);changes.push({eventId:after.eventId,entityType:"completion",entityId:after.id,before,after});}
  }
  if(new TextEncoder().encode(JSON.stringify(changes)).length>(staged?50000000:750000))throw new RowError(413,"recovery_too_large","This recovery exceeds the atomic restore limit. No changes were applied; use an operator maintenance window and database backup.");
  try {
    await db.batch([
      db.prepare("INSERT INTO mutations(id,event_id,expected_version,operation,request_hash,created_at) VALUES (?,'household',?,'household.restore',?,?)").bind(mutationId,expectedSequence,hash,at),
      insertRows(db,"events",events,true),insertRows(db,"completions",completions,true),insertChanges(db,changes,at,mutationId,null),
      db.prepare("UPDATE mutations SET sequence=(SELECT MAX(sequence) FROM changes), response_json=json_object('sequence',(SELECT MAX(sequence) FROM changes),'restored',1) WHERE id=?").bind(mutationId),
    ]);
  }catch(error){const replay=await receipt();if(replay)return replay;if(String(error).includes("household_sequence_conflict"))throw new RowError(409,"household_sequence_conflict","The household changed while restoring. No changes were applied.");throw error;}
  return receipt();
}
