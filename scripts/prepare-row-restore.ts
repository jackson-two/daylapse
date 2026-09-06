import {renderRestoreSql} from "./restore-sql";
import {mkdir,writeFile} from "node:fs/promises";
import {remoteD1} from "./remote-d1";
import {restoreRows} from "../lib/row-recovery";
import {parseArgs} from "node:util";
const {values}=parseArgs({options:{sequence:{type:"string"},legacy:{type:"string"},expected:{type:"string"}}});
if((!values.sequence===!values.legacy)||!values.expected)throw new Error("Usage: node --import tsx scripts/prepare-row-restore.ts --sequence N|--legacy N --expected CURRENT_SEQUENCE");
const source=values.sequence?{sequence:Number(values.sequence)}:{legacyRevision:Number(values.legacy)};
const expected=Number(values.expected);
if(!Number.isSafeInteger(expected)||expected<0||!Number.isSafeInteger(Object.values(source)[0]))throw new Error("Invalid revision");
const remote=await remoteD1();
type Statement={sql:string;params:unknown[]};
const statements:Statement[]=[];
const capture=new Proxy(remote,{get(target,key){if(key==="batch")return async (batch:Statement[])=>{if(batch[0]?.sql.startsWith("INSERT INTO mutations")){statements.push(...batch);return batch.map(()=>({success:true,results:[]}));}return target.batch(batch as unknown as D1PreparedStatement[]);};return Reflect.get(target,key);}});
const id=crypto.randomUUID();await restoreRows(capture,source,expected,id,true);
if(!statements.length)throw new Error("No restore was prepared");
// Cloudflare's bulk SQL import runs under maintenance and rolls back the entire import on failure.
// Split JSON array bindings into small statements, preserving the one guard and final receipt.
const output=renderRestoreSql(statements);
await mkdir("work/recovery",{recursive:true,mode:0o700});
await writeFile("work/recovery/restore.sql",output.join("\n"),{mode:0o600});
await writeFile("work/recovery/manifest.json",JSON.stringify({source,expectedSequence:expected,mutationId:id,statements:output.length,preparedAt:new Date().toISOString()},null,2),{mode:0o600});
console.log(JSON.stringify({prepared:true,statements:output.length,mutationId:id,file:"work/recovery/restore.sql",productionWrites:false}));
