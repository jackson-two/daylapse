import { installationSettingsSchema, isFamilyRequest } from "./installation";
import { readRecovery, restoreRows } from "./row-recovery";
import { readRowSnapshot } from "./row-consumers";
import { createCsvExport } from "./csv-export";
import { editEventRequest } from "./row-schema";
import { z } from "zod";
import { parseJsonRequest, RequestValidationError } from "./request-validation";
import { RowError, RowRepository } from "./row-repository";
import { createCompletionRequest, createEventRequest, patchCompletionRequest, patchEventRequest, restoreEventRequest, rowId, versionRequest } from "./row-schema";

const json = (body: unknown, status = 200) => Response.json(body, { status, headers: { "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff" } });
const listQuery = z.strictObject({ after: rowId.optional(), limit: z.coerce.number().int().min(1).max(100).default(50), includeDeleted: z.enum(["true", "false"]).default("false") });
const historyQuery = z.strictObject({ version:z.coerce.number().int().positive().optional(), after: rowId.optional(), limit: z.coerce.number().int().min(1).max(100).default(50), includeVoided: z.enum(["true", "false"]).default("false") });
const sequenceQuery = z.strictObject({ after: z.coerce.number().int().nonnegative().default(0), limit: z.coerce.number().int().min(1).max(100).default(50) });

export async function handleRowRequest(request: Request, db: D1Database, rawSettings: unknown) {
  const settings = installationSettingsSchema.safeParse(rawSettings);
  if (!settings.success || !isFamilyRequest(request, settings.data)) return json({ error: "Not found." }, 404);
  if (!["GET", "HEAD"].includes(request.method) && request.headers.get("origin") !== new URL(request.url).origin) return json({ error: "A same-origin request is required." }, 403);
  try {
    const repository = new RowRepository(db);
    await repository.requireEnabled();
    const url = new URL(request.url), method = request.method;
    const parts = url.pathname.split("/").filter(Boolean).map(decodeURIComponent);
    const query = Object.fromEntries(url.searchParams);
    if (parts[1] === "recovery" && parts.length === 2) {
      const sourceSchema=z.union([z.strictObject({legacyRevision:z.number().int().positive()}),z.strictObject({sequence:z.number().int().positive()})]);
      if(method === "POST") {
        const body=await parseJsonRequest(request,z.strictObject({source:sourceSchema,expectedSequence:z.number().int().nonnegative(),mutationId:rowId}));
        return json(await restoreRows(db,body.source,body.expectedSequence,body.mutationId));
      }
      if(method === "GET") {const source=sourceSchema.parse(query.legacyRevision ? {legacyRevision:Number(query.legacyRevision)} : {sequence:Number(query.sequence)});return json(await readRecovery(db,source));}
    }
    if (parts[1] === "changes" && parts.length === 2 && method === "GET") {
      const q = sequenceQuery.parse(query); return json(await repository.listChanges(q.after, q.limit));
    }
    if (parts[1] !== "events") return json({ error: "Not found." }, 404);
    if (parts.length === 2) {
      if (method === "GET") { const q = listQuery.parse(query); return json(await repository.listEvents(q.after, q.limit, q.includeDeleted === "true")); }
      if (method === "POST") {
        const body = await parseJsonRequest(request, createEventRequest);
        return json(await repository.mutate({ operation: "create", mutationId: body.mutationId, eventId: body.event.id, event: body.event }), 201);
      }
      return json({ error: "Method not allowed." }, 405);
    }
    if (parts.length === 3 && parts[2] === "snapshot" && method === "GET") return json(await readRowSnapshot(db));
    if (parts.length === 3 && parts[2] === "export" && method === "GET") {
      const kind = z.enum(["items", "history"]).parse(query.kind);
      const timeZone = z.string().max(100).parse(query.timeZone ?? "UTC");
      const asOf = new Intl.DateTimeFormat("en-CA", {timeZone,year:"numeric",month:"2-digit",day:"2-digit"}).format(new Date());
      const snapshot = await readRowSnapshot(db, "export");
      return new Response(createCsvExport(snapshot.items,kind,new Date(`${asOf}T12:00:00`),timeZone), {headers:{"Content-Type":"text/csv; charset=utf-8","Cache-Control":"no-store","Content-Disposition":`attachment; filename="daylapse-${kind}-${asOf}-r${snapshot.revision}.csv"`}});
    }
    const eventId = rowId.parse(parts[2]);
    if (parts[3] === "edit" && parts.length === 4 && method === "POST") {
      const body = await parseJsonRequest(request, editEventRequest);
      if (body.event && body.event.id !== eventId) return json({error:"Item ID mismatch."},422);
      if ((body.expectedVersion === 0) !== Boolean(body.event)) return json({error:"Creation requires an event and version zero."},422);
      return json(await repository.mutate({...body,eventId,operation:body.expectedVersion === 0 ? "create" : "edit"}));
    }
    if (parts.length === 3) {
      if (method === "GET") {
        const event = await repository.getEventSummary(eventId);
        return event ? json({ event }) : json({ error: "Item not found." }, 404);
      }
      if (method === "PATCH") { const body = await parseJsonRequest(request, patchEventRequest); return json(await repository.mutate({ ...body, operation: "patch", eventId })); }
      if (method === "DELETE") { const body = await parseJsonRequest(request, versionRequest); return json(await repository.mutate({ ...body, operation: "delete", eventId })); }
    }
    if (parts[3] === "restore" && parts.length === 4 && method === "POST") { const body = await parseJsonRequest(request, restoreEventRequest); return json(await repository.mutate({ ...body, operation: "restore", eventId })); }
    if (parts[3] === "revisions" && method === "GET") {
      if (parts.length === 4) { const q = sequenceQuery.parse(query); return json(await repository.listRevisions(eventId, q.after, q.limit)); }
      if (parts.length === 5) return json(await repository.readRevision(eventId, z.coerce.number().int().positive().parse(parts[4])));
    }
    if (parts[3] === "completions") {
      if (parts.length === 4 && method === "GET") {
        if (!await repository.getEvent(eventId)) return json({ error: "Item not found." }, 404);
        const q = historyQuery.parse(query); return json(await repository.listCompletions(eventId, q.after, q.limit, q.includeVoided === "true", q.version));
      }
      if (parts.length === 4 && method === "POST") {
        const body = await parseJsonRequest(request, createCompletionRequest);
        return json(await repository.mutate({ operation: "completion.create", eventId, mutationId: body.mutationId, expectedVersion: body.expectedVersion, completionId: body.completion.id, completedOn: body.completion.completedOn }), 201);
      }
      if (parts.length === 5) {
        const completionId = rowId.parse(parts[4]);
        if (method === "PATCH") { const body = await parseJsonRequest(request, patchCompletionRequest); return json(await repository.mutate({ ...body, operation: "completion.patch", eventId, completionId })); }
        if (method === "DELETE") { const body = await parseJsonRequest(request, versionRequest); return json(await repository.mutate({ ...body, operation: "completion.delete", eventId, completionId })); }
      }
    }
    return json({ error: "Method not allowed." }, 405);
  } catch (error) {
    if (error instanceof RowError) return json({ error: error.message, code: error.code, ...(error.current !== undefined ? { current: error.current } : {}) }, error.status);
    if (error instanceof RequestValidationError) return json({ error: error.message, issues: error.issues }, error.status);
    if (error instanceof z.ZodError) return json({ error: "Invalid row request.", issues: error.issues.slice(0, 20).map((i) => ({ path: i.path, code: i.code, message: i.message })) }, 422);
    if (error instanceof URIError) return json({ error: "Invalid URL." }, 400);
    const requestId = crypto.randomUUID();
    console.error(JSON.stringify({ operation: "row-api", requestId, errorName: error instanceof Error ? error.name : "UnknownError" }));
    return json({ error: "Row storage is unavailable.", requestId }, 503);
  }
}
