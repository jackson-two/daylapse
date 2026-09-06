import {readFile,writeFile,mkdir,chmod} from "node:fs/promises";
import {resolve} from "node:path";
import {remoteD1} from "./remote-d1";
import {deploymentSchema} from "./installation-config";
import {convertSnapshot,canonical,digest,eventAsLegacy,behaviorSnapshot} from "../lib/row-converter";
import {importConverted} from "../lib/row-importer";
import {readRowSnapshot} from "../lib/row-consumers";
import {eventColumns,completionColumns,selectColumns,parseEventRow,completionSchema} from "../lib/row-schema";
const action=process.argv[2], output=resolve("work/cutover");
if(!["snapshot","import","activate","verify","reverse-export"].includes(action))throw new Error("Usage: node --import tsx scripts/row-cutover.ts snapshot|import|activate|verify|reverse-export");
await mkdir(output,{recursive:true,mode:0o700});await chmod(output,0o700);
const db=await remoteD1();
async function write(name:string,data:unknown){await writeFile(resolve(output,name),JSON.stringify(data,null,2),{mode:0o600});await chmod(resolve(output,name),0o600);}
if(action==="snapshot") {
 const row=await db.prepare("SELECT data,revision,updated_at FROM household_state WHERE id=1").first<{data:string;revision:number;updated_at:string}>();
 if(!row)throw new Error("No legacy snapshot found.");
 const snapshot={items:JSON.parse(row.data),revision:row.revision,updatedAt:row.updated_at};
 await write("snapshot.json",snapshot);
 const conversion=await convertSnapshot(snapshot,row.updated_at,["2026-09-04","2026-12-31","2027-01-01","2027-02-28","2028-02-29","2029-03-01"]);
 await write("conversion.json",conversion);await write("report.json",conversion.report);
 console.log(JSON.stringify({revision:row.revision,events:conversion.events.length,completions:conversion.completions.length,synthetic:conversion.report.syntheticCompletions,parity:conversion.report.comparisons.every((c)=>c.equal)}));
} else if(action==="import") {
 const conversion=JSON.parse(await readFile(resolve(output,"conversion.json"),"utf8"));
 const source=await db.prepare("SELECT data,revision FROM household_state WHERE id=1").first<{data:string;revision:number}>();
 const current=await convertSnapshot({items:JSON.parse(source!.data),revision:source!.revision},conversion.importedAt,["2026-09-04"]);
 if(current.report.sourceHash!==conversion.report.sourceHash)throw new Error("Production changed since snapshot; take a fresh backup and snapshot.");
 const installation=deploymentSchema.parse(JSON.parse(await readFile("installation.json","utf8")));
 console.log(await importConverted(db,conversion,{timeZone:installation.settings.timeZone}));
} else if(action==="activate"||action==="verify") {
 const manifest=JSON.parse(await readFile(resolve(output,"conversion.json"),"utf8"));
 const events=(await db.prepare(`SELECT ${selectColumns(eventColumns)} FROM events`).all<Record<string,unknown>>()).results.map(parseEventRow);
 const completions=(await db.prepare(`SELECT ${selectColumns(completionColumns)} FROM completions`).all()).results.map((r)=>completionSchema.parse(r));
 const sorted=(rows:unknown[])=>rows.sort((a,b)=>canonical(a).localeCompare(canonical(b)));
 if(await digest(sorted(events))!==await digest(sorted(manifest.events))||await digest(sorted(completions))!==await digest(sorted(manifest.completions)))throw new Error("Row data differs from import manifest. Activation blocked.");
 if(action==="activate")await db.prepare("UPDATE installation_settings SET storage_mode='rows' WHERE id=1 AND import_state='ready'").run();
 const snapshot=await readRowSnapshot(db,"export");
 const legacy=JSON.parse(await readFile(resolve(output,"snapshot.json"),"utf8"));
 for(const date of manifest.report.comparisons.map((c:{date:string})=>c.date))if(canonical(behaviorSnapshot(legacy.items,date))!==canonical(behaviorSnapshot(snapshot.items,date)))throw new Error("Behavior differs after cutover");
 const display=await readRowSnapshot(db,"display");
 if(display.items.some((i)=>"notes" in i||i.history.length))throw new Error("Display privacy verification failed");
 await write("verification.json",{verifiedAt:new Date().toISOString(),events:events.length,completions:completions.length,sequence:snapshot.revision,displayCount:display.items.length,parity:true});
 console.log(JSON.stringify({events:events.length,completions:completions.length,sequence:snapshot.revision,displayCount:display.items.length,parity:true}));
} else {
 const snapshot=await readRowSnapshot(db,"export");
 // A rollback copy preserves current row data; keep metadata/flags separately from the legacy-compatible array.
 const rows=await db.prepare(`SELECT ${selectColumns(eventColumns)} FROM events`).all<Record<string,unknown>>();
 const completions=(await db.prepare(`SELECT ${selectColumns(completionColumns)} FROM completions`).all()).results.map((r)=>completionSchema.parse(r));
 const events=rows.results.map(parseEventRow);
 await write("row-backup.json",{events,completions,sequence:snapshot.revision});
 const items=events.filter((e)=>!e.deletedAt).map((e)=>{const {showOnDashboard,showOnDisplay,notifyDueToday,deletedAt,...item}=eventAsLegacy(e,completions);void showOnDashboard;void showOnDisplay;void notifyDueToday;void deletedAt;return item;});
 await write("reverse-export.json",{items,revision:snapshot.revision,updatedAt:new Date().toISOString()});
 console.log(JSON.stringify({sequence:snapshot.revision,activeAndArchivedItems:items.length,backup:"written"}));
}
