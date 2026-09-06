import { dashboardWindowDays } from "./item-visibility";
import type { TrackedItem } from "./household-schema";
import { canonical } from "./row-converter";
import { normalizeStoredItem } from "./item-mutations";

export function itemFields(item: TrackedItem) {
  const scheduleType = item.type === "recurring" ? "interval" : item.weekdayRule ? "weekday_rule" : item.holidayKey ? "holiday_rule" : item.source || item.annual ? "annual_date" : "fixed_date";
  const md = item.monthDay ?? item.targetDate?.slice(5);
  return {
    title:item.title, verb:item.verb ?? null, category:item.category ?? null, notes:item.notes ?? null,
    kind:item.source ?? (item.type === "recurring" ? "task" : "event"), scheduleType,
    intervalValue:item.type === "recurring" ? item.intervalValue : null, intervalUnit:item.type === "recurring" ? item.intervalUnit : null,
    anchorDate:item.type === "recurring" ? item.createdAt : null, targetDate:scheduleType === "fixed_date" ? item.targetDate : null,
    month:item.weekdayRule?.month ?? (scheduleType === "annual_date" ? Number(md?.slice(0,2)) : null), day:scheduleType === "annual_date" ? Number(md?.slice(3)) : null,
    annualAnchorDate:!item.source && item.annual ? item.targetDate : null, holidayKey:item.holidayKey ?? null,
    weekday: item.weekdayRule?.weekday ?? null, occurrence: item.weekdayRule?.occurrence ?? null,
    afterFullWeek: item.weekdayRule?.afterFullWeek ?? false, weekStartsOn: item.weekdayRule?.weekStartsOn ?? 0,
    snoozedUntil:item.type === "recurring" ? item.snoozedUntil ?? null : null,
    highlightWithinDays:item.reminderDays, dashboardWindowDays:dashboardWindowDays(item),
    showOnDashboard:item.showOnDashboard ?? true, showOnDisplay:item.showOnDisplay ?? true, notifyDueToday:item.notifyDueToday ?? true,
  };
}
/** The UI draft stays local; only changed fields/history identities cross the network. */
export class RowTransport {
  private versions: Record<string,number> = {};
  private receipts = new Map<string,{ url:string; method:string; body:string }>();
  constructor(private request: typeof fetch = (...args) => fetch(...args)) {}
  read: typeof fetch = async (input, init) => {
    const response = await this.request(input,init);
    if (response.ok && String(input).startsWith("/api/events/snapshot")) {
      const snapshot = await response.clone().json() as {versions: Record<string,number>};
      this.versions = snapshot.versions;
    }
    return response;
  };
  async save(items: TrackedItem[], base: TrackedItem[], _revision: number, signal: AbortSignal) {
    let revision = _revision;
    const old = new Map(base.map((i) => [i.id,i])), next = new Map(items.map((i) => [i.id,i]));
    for (const id of new Set([...old.keys(),...next.keys()])) {
      const before=old.get(id), after=next.get(id);
      if (canonical(before) === canonical(after)) continue;
      const signature=canonical({before,after});
      let pending=this.receipts.get(signature);
      if (!pending) {
        const mutationId=crypto.randomUUID(), expectedVersion=this.versions[id] ?? 0;
        const beforeFields=before ? itemFields(before) : {};
        const afterFields=after ? itemFields(after) : {};
        const patch=Object.fromEntries(Object.entries(afterFields).filter(([k,v]) => canonical(v)!==canonical((beforeFields as Record<string,unknown>)[k])));
        if (after && before?.archived !== after.archived) patch.archivedAt=after.archived ? new Date().toISOString() : null;
        const previousHistory=new Map(before?.history.map((h) => [h.id,h.date]) ?? []);
        const nextHistory=new Map(after?.history.map((h) => [h.id,h.date]) ?? []);
        const edits=Array.from(new Set([...previousHistory.keys(),...nextHistory.keys()])).filter((key) => previousHistory.get(key)!==nextHistory.get(key)).map((key) => ({id:key,completedOn:nextHistory.get(key) ?? null}));
        if (after && before && !Object.keys(patch).length && !edits.length && before.deletedAt===after.deletedAt) continue;
        const restore=before?.deletedAt && after && !after.deletedAt;
        pending={url:`/api/events/${encodeURIComponent(id)}${!after ? "" : restore ? "/restore" : "/edit"}`,method:!after ? "DELETE" : "POST",body:JSON.stringify({mutationId,expectedVersion,...(!after || restore ? {} : before ? {patch,edits} : {event:{...afterFields,id,createdOn:after.createdAt,archivedAt:after.archived ? new Date().toISOString() : null},edits})})};
        this.receipts.set(signature,pending);
      }
      const response=await this.request(pending.url,{method:pending.method,headers:{"content-type":"application/json"},body:pending.body,signal});
      if (!response.ok) {
        // A definitive rejection can be reconciled; ambiguous network outcomes retain the same ID.
        if (response.status >=400 && response.status <500) this.receipts.delete(signature);
        return response;
      }
      const saved=await response.json() as {sequence:number;event:{version:number}};
      revision=Math.max(revision,saved.sequence);
      this.versions[id]=saved.event.version;
      this.receipts.delete(signature);
      // Acknowledge one item at a time so a later conflict cannot obscure an earlier commit.
      const confirmed = base.flatMap((i) => i.id !== id ? [i] : after ? [after] : []);
      if (after && !before) confirmed.push(after);
      return Response.json({revision,items:confirmed});
    }
    return Response.json({revision});
  }
}
export function normalizeRowItem(item: TrackedItem) {
  return normalizeStoredItem({...item,history:[...item.history].sort((a,b) => a.date.localeCompare(b.date) || a.id.localeCompare(b.id))});
}
