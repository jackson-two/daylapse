import { deploymentConfig } from "./installation-config";
import {readFile} from "node:fs/promises";
import {homedir} from "node:os";
import {join} from "node:path";
/** Operator-only adapter. Uses the existing Wrangler login; never logs credentials or SQL data. */
export async function remoteD1() {
  const config=deploymentConfig(JSON.parse(await readFile("installation.json","utf8")), {});
  let auth="";
  for(const path of [join(homedir(),".wrangler/config/default.toml"),join(homedir(),"Library/Preferences/.wrangler/config/default.toml"),join(homedir(),".config/.wrangler/config/default.toml")]) {
    try {auth=await readFile(path,"utf8");break;}catch{}
  }
  const token=process.env.CLOUDFLARE_API_TOKEN ?? auth.match(/^oauth_token\s*=\s*"([^"]+)"/m)?.[1];
  if(!token)throw new Error("Run wrangler login or supply CLOUDFLARE_API_TOKEN.");
  const binding=config.d1_databases.find((b:{binding:string})=>b.binding==="DB");
  if(!binding)throw new Error("No configured DB binding");
  const endpoint=`https://api.cloudflare.com/client/v4/accounts/${config.account_id}/d1/database/${binding.database_id}/query`;
  type Query={sql:string;params:unknown[]};
  async function batch(queries:Query[]) {
    const response=await fetch(endpoint,{method:"POST",headers:{authorization:`Bearer ${token}`,"content-type":"application/json"},body:JSON.stringify({batch:queries}),signal:AbortSignal.timeout(60000)});
    const body=await response.json() as {success:boolean;result:D1Result[];errors?:{code:number;message:string}[]};
    if(!response.ok||!body.success||body.result.some((r)=>!r.success))throw new Error(`D1 query failed (${response.status}): ${body.errors?.map((e)=>e.code+":"+e.message).join("; ")??"unknown error"}`);
    return body.result;
  }
  class Statement {
    params:unknown[]=[];
    constructor(readonly sql:string){}
    bind(...params:unknown[]){const s=new Statement(this.sql);s.params=params;return s;}
    async all(){return (await batch([this]))[0];}
    async run(){return this.all();}
    async first(column?:string){const row=(await this.all()).results[0] as Record<string,unknown>|undefined;return column?row?.[column]??null:row??null;}
  }
  return {prepare:(sql:string)=>new Statement(sql),batch} as unknown as D1Database;
}
