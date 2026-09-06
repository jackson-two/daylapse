"use client";
import { useEffect, useState } from "react";
import { createRequestTimeout } from "@/lib/request-timeout";
import { completionSchema, type CompletionRecord } from "@/lib/row-schema";
import { z } from "zod";
const pageSchema = z.object({completions:z.array(completionSchema),nextCursor:z.string().nullable(),version:z.number().int().positive()});
export function CompletionHistory({eventId}:{eventId:string}) {
  const [entries,setEntries]=useState<CompletionRecord[]>([]),[cursor,setCursor]=useState<string|null>(null),[error,setError]=useState(""),[loading,setLoading]=useState(true),[version,setVersion]=useState<number>();
  useEffect(() => {
    let active=true; const timeout=createRequestTimeout();
    fetch(`/api/events/${encodeURIComponent(eventId)}/completions?limit=100`,{cache:"no-store",signal:timeout.signal}).then(async (r) => {
      if(!r.ok) throw new Error("History could not be loaded.");
      const page=pageSchema.parse(await r.json());
      if(active) {setEntries(page.completions);setCursor(page.nextCursor);setVersion(page.version);}
    }).catch(() => {if(active) setError("History could not be loaded. Close and reopen history to retry.");}).finally(() => {timeout.clear();if(active)setLoading(false);});
    return () => {active=false;timeout.clear();};
  },[eventId]);
  async function more() {
    setLoading(true);setError("");const timeout=createRequestTimeout();
    try {const r=await fetch(`/api/events/${encodeURIComponent(eventId)}/completions?limit=100&after=${encodeURIComponent(cursor!)}&version=${version}`,{cache:"no-store",signal:timeout.signal});if(r.status===409){setCursor(null);throw new Error("History changed. Close and reopen it to reload.");}if(!r.ok)throw new Error();const p=pageSchema.parse(await r.json());setEntries((v)=>[...v,...p.completions]);setCursor(p.nextCursor);}catch(error){setError(error instanceof Error && error.message ? error.message : "History could not be loaded. Try again.");}finally{timeout.clear();setLoading(false);}
  }
  return <div className="full-history">{error && <p role="alert">{error}</p>}{[...entries].sort((a,b)=>b.completedOn.localeCompare(a.completedOn)).map((e)=><div key={e.id}><span>{e.completedOn}</span></div>)}{loading && <p>Loading history…</p>}{!loading && cursor && <button onClick={()=>void more()}>Load more history</button>}{!loading && !entries.length && !error && <p>No completions recorded.</p>}</div>;
}
