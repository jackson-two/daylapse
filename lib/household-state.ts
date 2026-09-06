import { env } from "cloudflare:workers";
import { householdItemsSchema, validationIssues, type TrackedItem, type ValidationIssue } from "@/lib/household-schema";

const createHouseholdStateTable = `
  CREATE TABLE IF NOT EXISTS household_state (
    id INTEGER PRIMARY KEY,
    data TEXT NOT NULL,
    revision INTEGER NOT NULL DEFAULT 1,
    updated_at TEXT NOT NULL
  )
`;

export type HouseholdState = {
  items: TrackedItem[];
  revision: number;
  updatedAt: string | null;
};

export type HouseholdRevisionMetadata = {
  revision: number;
  createdAt: string;
  itemCount: number;
  sizeBytes: number;
  isCurrent: boolean;
};

type StoredRevision = Omit<HouseholdRevisionMetadata, "isCurrent"> & { data: string };

export class StoredHouseholdDataError extends Error {
  constructor(
    message: string,
    readonly revision: number,
    readonly issues: ValidationIssue[] = [],
  ) {
    super(message);
    this.name = "StoredHouseholdDataError";
  }
}

export class HouseholdRevisionConflictError extends Error {
  constructor(readonly revision: number, readonly updatedAt: string | null) {
    super("Household data changed on another device. Reload before saving again.");
    this.name = "HouseholdRevisionConflictError";
  }
}

export class HouseholdRevisionNotFoundError extends Error {
  constructor(readonly revision: number) {
    super(`Household revision ${revision} was not found.`);
    this.name = "HouseholdRevisionNotFoundError";
  }
}

export class HouseholdRevisionStorageError extends Error {
  constructor() {
    super("Household revision storage is not initialized. Apply the pending D1 migrations before accepting writes.");
    this.name = "HouseholdRevisionStorageError";
  }
}

export async function ensureHouseholdStateTable() {
  if (!env.DB) throw new Error("Shared project storage is not available.");
  await env.DB.prepare(createHouseholdStateTable).run();
}

export async function ensureHouseholdRevisionStorage() {
  if (!env.DB) throw new Error("Shared project storage is not available.");
  const row = await env.DB.prepare(`
    SELECT COUNT(*) AS objectCount
    FROM sqlite_master
    WHERE (type = 'table' AND name = 'household_state_revisions')
       OR (type = 'trigger' AND name = 'snapshot_household_state_after_insert')
       OR (type = 'trigger' AND name = 'snapshot_household_state_after_update')
  `).first<{ objectCount: number }>();
  if (Number(row?.objectCount) !== 3) throw new HouseholdRevisionStorageError();
}

function parseStoredItems(data: string, revision: number) {
  let input: unknown;
  try {
    input = JSON.parse(data);
  } catch {
    throw new StoredHouseholdDataError("Stored household data is not valid JSON.", revision);
  }

  const result = householdItemsSchema.safeParse(input);
  if (!result.success) {
    throw new StoredHouseholdDataError(
      "Stored household data failed validation.",
      revision,
      validationIssues(result.error),
    );
  }
  return result.data;
}

export async function readHouseholdState(): Promise<HouseholdState> {
  await ensureHouseholdStateTable();
  const row = await env.DB.prepare(
    "SELECT data, revision, updated_at AS updatedAt FROM household_state WHERE id = ?",
  ).bind(1).first<{ data: string; revision: number; updatedAt: string }>();

  return {
    items: row ? parseStoredItems(row.data, row.revision) : [],
    revision: row?.revision ?? 0,
    updatedAt: row?.updatedAt ?? null,
  };
}

async function currentRevision() {
  const current = await env.DB.prepare(
    "SELECT revision, updated_at AS updatedAt FROM household_state WHERE id = ?",
  ).bind(1).first<{ revision: number; updatedAt: string }>();
  return { revision: current?.revision ?? 0, updatedAt: current?.updatedAt ?? null };
}

export async function listHouseholdRevisions(limit = 50): Promise<HouseholdRevisionMetadata[]> {
  await ensureHouseholdRevisionStorage();
  const current = await currentRevision();
  const result = await env.DB.prepare(`
    SELECT revision, created_at AS createdAt, item_count AS itemCount, size_bytes AS sizeBytes
    FROM household_state_revisions
    WHERE household_id = ?
    ORDER BY revision DESC
    LIMIT ?
  `).bind(1, limit).all<Omit<HouseholdRevisionMetadata, "isCurrent">>();

  return result.results.map((revision) => ({
    ...revision,
    isCurrent: revision.revision === current.revision,
  }));
}

export async function readHouseholdRevision(revision: number) {
  await ensureHouseholdRevisionStorage();
  const row = await env.DB.prepare(`
    SELECT revision, data, created_at AS createdAt, item_count AS itemCount, size_bytes AS sizeBytes
    FROM household_state_revisions
    WHERE household_id = ? AND revision = ?
  `).bind(1, revision).first<StoredRevision>();
  if (!row) throw new HouseholdRevisionNotFoundError(revision);

  const current = await currentRevision();
  return {
    revision: row.revision,
    createdAt: row.createdAt,
    itemCount: row.itemCount,
    sizeBytes: row.sizeBytes,
    isCurrent: row.revision === current.revision,
    items: parseStoredItems(row.data, row.revision),
  };
}

export function noStoreJson(body: unknown, init?: ResponseInit) {
  const response = Response.json(body, init);
  response.headers.set("Cache-Control", "no-store");
  response.headers.set("X-Content-Type-Options", "nosniff");
  return response;
}
