import { testInstallation } from "./fixtures/installation";
import assert from "node:assert/strict";
import test from "node:test";
import {openLocalRows} from "../scripts/row-storage-local";
import {convertSnapshot,behaviorSnapshot} from "../lib/row-converter";
import {importConverted} from "../lib/row-importer";
import {readRowSnapshot} from "../lib/row-consumers";
import {RowRepository} from "../lib/row-repository";
import {readRecovery,restoreRows} from "../lib/row-recovery";
import {RowTransport} from "../lib/row-transport";
import {HouseholdSync} from "../lib/household-sync";
import {handleRowRequest} from "../lib/row-api";
import {recordCompletion} from "../lib/item-mutations";
import type {TrackedItem} from "../lib/household-schema";
const item:TrackedItem={id:"filter",title:"Filter",notes:"PRIVATE NOTE",type:"recurring",intervalValue:1,intervalUnit:"months",createdAt:"2026-01-01",reminderDays:7,history:Array.from({length:12},(_,i)=>({id:`done-${String(i).padStart(2,"0")}`,date:`2026-08-${String(i+1).padStart(2,"0")}`}))};
const at="2026-09-04T12:00:00.000Z";
const settle=async (condition:()=>boolean)=>{for(let i=0;i<100&&!condition();i++)await new Promise((r)=>setTimeout(r,10));assert.ok(condition(),"sync settled");};
test("row consumers preserve data, destination privacy, recovery, and retryable item saves",async(t)=>{
 const {db,mf}=await openLocalRows();t.after(()=>mf.dispose());
 const source=[item,{...item,id:"second",title:"Second"}];
 await db.prepare("INSERT INTO household_state(id,data,revision,updated_at) VALUES(1,?,1,?)").bind(JSON.stringify(source),at).run();
 const conversion=await convertSnapshot({items:source,revision:1},at,["2026-09-04","2028-02-29"]);
 await importConverted(db,conversion,{timeZone:"America/Phoenix"});
 await assert.rejects(()=>db.prepare("UPDATE household_state SET data='[]'").run(),/reload_required/);
 await db.prepare("UPDATE installation_settings SET storage_mode='rows'").run();
 const repository=new RowRepository(db);
 const baseline=(await readRowSnapshot(db)).revision;
 await t.test("normal reads bound history while exports contain every completion",async()=>{
  const snapshot=await readRowSnapshot(db), exported=await readRowSnapshot(db,"export");
  assert.equal(snapshot.items[0].history.length,6);assert.equal(snapshot.items[0].completionCount,12);
  assert.equal(exported.items[0].history.length,12);
  assert.deepEqual(behaviorSnapshot(snapshot.items,"2026-09-04"),behaviorSnapshot(exported.items,"2026-09-04"));
  assert.equal(snapshot.revision,exported.revision);
 });
 await t.test("visibility flags are independent; display excludes notes/history/hidden records",async()=>{
  await repository.mutate({operation:"patch",mutationId:"hide-display",eventId:"filter",expectedVersion:1,patch:{showOnDashboard:true,showOnDisplay:false,notifyDueToday:false}});
  assert.equal((await readRowSnapshot(db)).items.length,2);
  for(const destination of ["display","notifications"] as const){const s=await readRowSnapshot(db,destination);assert.deepEqual(s.items.map((i)=>i.id),["second"]);}
  const display=await readRowSnapshot(db,"display");assert.ok(!JSON.stringify(display).includes("PRIVATE"));assert.equal(display.items[0].history.length,0);assert.ok(!("notes" in display.items[0]));
 });
 await t.test("full restore preserves baseline, supports legacy revisions, and is idempotent",async()=>{
  const seq=(await readRowSnapshot(db)).revision;
  const restored=await restoreRows(db,{sequence:baseline},seq,"restore-household");
  assert.deepEqual(await restoreRows(db,{sequence:baseline},seq,"restore-household"),restored);
  assert.equal((await repository.getEvent("filter"))!.showOnDisplay,true);
  assert.equal((await readRecovery(db,{legacyRevision:1})).events.length,2);
  const seq2=(await readRowSnapshot(db)).revision;
  await restoreRows(db,{legacyRevision:1},seq2,"restore-legacy");
  assert.equal((await readRowSnapshot(db,"export")).items[0].history.length,12);
  await assert.rejects(()=>restoreRows(db,{sequence:baseline},seq2,"stale-restore"),/household changed/);
 });
 await t.test("whole-household audit failure rolls back every row",async()=>{
  const before=await readRowSnapshot(db,"export");
  await db.prepare("CREATE TRIGGER recovery_fail BEFORE INSERT ON changes WHEN NEW.mutation_id='restore-fail' BEGIN SELECT RAISE(ABORT,'injected'); END").run();
  await assert.rejects(()=>restoreRows(db,{sequence:baseline},before.revision,"restore-fail"),/injected/);
  assert.deepEqual(await readRowSnapshot(db,"export"),before);
  await db.prepare("DROP TRIGGER recovery_fail").run();
 });
 await t.test("client queue sends sparse per-item commands and replays an unconfirmed completion",async()=>{
  let failOnce=true;const bodies:Record<string,unknown>[]=[];
  const request:typeof fetch=async(input,init)=>{
   const url=new URL(String(input),"https://daylapse.example.com");
   if(init?.body)bodies.push(JSON.parse(String(init.body)));
   const response=await handleRowRequest(new Request(url,{...init,headers:{...init?.headers,origin:url.origin}}),db,testInstallation);
   if(init?.method==="POST"&&failOnce){failOnce=false;throw new Error("response lost after commit");}
   return response;
  };
  const transport=new RowTransport(request),sync=new HouseholdSync(transport.read,1,transport.save.bind(transport));t.after(()=>sync.stop());
  sync.start("/api/events/snapshot");await settle(()=>sync.getSnapshot().ready);
  sync.setItems((all)=>all.map((i)=>i.id==="filter"?recordCompletion(i,{id:"new-completion",date:"2026-09-04"}):i));
  await settle(()=>sync.getSnapshot().status==="error");await sync.retry();await settle(()=>sync.getSnapshot().status==="saved");
  assert.equal(bodies.length,2);assert.deepEqual(bodies[0],bodies[1]);assert.ok(!("items" in bodies[0]));assert.equal((bodies[0].edits as unknown[]).length,1);
  assert.equal((await repository.listCompletions("filter")).completions.filter((c)=>c.id==="new-completion").length,1);
  sync.setItems((all)=>all.map((i)=>({...i,title:i.title+" edited"})));
  await settle(()=>sync.getSnapshot().status==="saved");
  assert.equal((await repository.getEvent("second"))!.title,"Second edited");
  for(const title of ["Second", "Second edited", "Second", "Second edited"]){
    sync.setItems((all)=>all.map((i)=>i.id==="second"?{...i,title}:i));
    await settle(()=>sync.getSnapshot().status==="saved");
    assert.equal((await repository.getEvent("second"))!.title,title);
  }
  const legacy=await db.prepare("SELECT data FROM household_state").first<{data:string}>();assert.equal(legacy!.data,JSON.stringify(source));
 });
 await t.test("CSV uses row data and explicit timezone; recovery APIs reject display and cross-origin access",async()=>{
  const api=(path:string,method="GET",host="daylapse.example.com")=>handleRowRequest(new Request(`https://${host}${path}`,{method,headers:{origin:"https://evil.example"}}),db,testInstallation);
  const csv=await api("/api/events/export?kind=items&timeZone=America%2FPhoenix");assert.equal(csv.status,200);assert.match(await csv.text(),/show_on_display/);
  assert.equal((await api("/api/recovery?sequence="+baseline,"GET","display.daylapse.example.com")).status,404);
  assert.equal((await api("/api/recovery","POST")).status,403);
 });
});

test("staged SQL restore splits large payloads and stays atomic across the whole household",async(t)=>{
 const {renderRestoreSql}=await import("../scripts/restore-sql");
 const {db,mf}=await openLocalRows();t.after(()=>mf.dispose());
 const many=Array.from({length:60},(_,i)=>({...item,id:`large-${i}`,notes:"a;'?".repeat(2000),history:[]}));
 await importConverted(db,await convertSnapshot({items:many,revision:1},at,["2026-09-04"]));
 await db.prepare("UPDATE installation_settings SET storage_mode='rows'").run();
 const baseline=(await readRowSnapshot(db)).revision;
 await assert.rejects(()=>restoreRows(db,{sequence:baseline},baseline,"large-inline"),/atomic restore limit/);
 type Q={sql:string;params:unknown[]};const captured:Q[]=[];
 class Stmt{params:unknown[]=[];constructor(readonly sql:string){}bind(...p:unknown[]){const s=new Stmt(this.sql);s.params=p;return s;}all(){return db.prepare(this.sql).bind(...this.params).all();}first(){return db.prepare(this.sql).bind(...this.params).first();}}
 const capture={prepare:(sql:string)=>new Stmt(sql),batch:async(q:Q[])=>{if(q[0].sql.startsWith("INSERT INTO mutations")){captured.push(...q);return [];}return db.batch(q.map((s)=>db.prepare(s.sql).bind(...s.params)));}} as unknown as D1Database;
 await restoreRows(capture,{sequence:baseline},baseline,"large-staged",true);
 const sql=renderRestoreSql(captured);assert.ok(sql.length>5);assert.ok(sql.every((s)=>Buffer.byteLength(s)<100000));
 await db.prepare("CREATE TRIGGER staged_fail BEFORE INSERT ON changes WHEN NEW.mutation_id='large-staged' AND NEW.event_id='large-9' BEGIN SELECT RAISE(ABORT,'late staged failure'); END").run();
 await assert.rejects(()=>db.batch(sql.map((s)=>db.prepare(s))),/late staged failure/);
 assert.equal((await readRowSnapshot(db)).revision,baseline);assert.equal(await db.prepare("SELECT 1 FROM mutations WHERE id='large-staged'").first(),null);
 await db.prepare("DROP TRIGGER staged_fail").run();await db.batch(sql.map((s)=>db.prepare(s)));
 assert.equal((await new RowRepository(db).getEvent("large-9"))!.notes,many[9].notes);
 assert.ok((await readRowSnapshot(db)).revision>baseline);
});
