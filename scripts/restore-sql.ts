type Statement={sql:string;params:unknown[]};
export function renderRestoreSql(statements:Statement[]) {
const literal=(v:unknown)=>v===null?"NULL":typeof v==="number"?String(v):"'"+String(v).replaceAll("'","''")+"'";
const output:string[]=[];
for(const statement of statements){
 const index=statement.params.findIndex((p)=>typeof p==="string"&&p.startsWith("["));
 const groups:unknown[][]=[];
 if(index>=0&&statement.sql.includes("json_each(?)")){
  const records=JSON.parse(String(statement.params[index]));let chunk:unknown[]=[];let size=0;
  for(const record of records){const bytes=Buffer.byteLength(JSON.stringify(record));if(chunk.length&&size+bytes>24000){const params=[...statement.params];params[index]=JSON.stringify(chunk);groups.push(params);chunk=[];size=0;}chunk.push(record);size+=bytes;}
  if(chunk.length){const params=[...statement.params];params[index]=JSON.stringify(chunk);groups.push(params);}
 }else groups.push(statement.params);
 for(const params of groups){let cursor=0;output.push(statement.sql.replace(/\?/g,()=>literal(params[cursor++]))+";");}
}
return output;
}
