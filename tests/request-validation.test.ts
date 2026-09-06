import assert from "node:assert/strict";
import test from "node:test";
import { MAX_HOUSEHOLD_BODY_BYTES, saveHouseholdRequestSchema } from "../lib/household-schema";
import { parseJsonRequest, RequestValidationError } from "../lib/request-validation";

const validRequest = {
  items: [{
    id: "legacy-id",
    verb: "Maintain",
    title: "A recurring item",
    type: "recurring",
    intervalValue: 30,
    intervalUnit: "days",
    reminderDays: 7,
    history: [],
    createdAt: "2026-08-01",
  }],
  expectedRevision: 4,
};

function jsonRequest(body: string, headers: HeadersInit = {}) {
  return new Request("https://daylapse.example/api/items", {
    method: "PUT",
    headers: { "content-type": "application/json", ...headers },
    body,
  });
}

async function assertValidationStatus(promise: Promise<unknown>, status: number) {
  await assert.rejects(promise, (error) => {
    assert.ok(error instanceof RequestValidationError);
    assert.equal(error.status, status);
    return true;
  });
}

test("parses a bounded, valid household save request", async () => {
  const parsed = await parseJsonRequest(jsonRequest(JSON.stringify(validRequest)), saveHouseholdRequestSchema);
  assert.equal(parsed.expectedRevision, 4);
  assert.equal(parsed.items[0].id, "legacy-id");
});

test("rejects unsupported content types and malformed JSON", async () => {
  await assertValidationStatus(parseJsonRequest(new Request("https://daylapse.example/api/items", {
    method: "PUT",
    headers: { "content-type": "text/plain" },
    body: "{}",
  }), saveHouseholdRequestSchema), 415);
  await assertValidationStatus(parseJsonRequest(jsonRequest("{"), saveHouseholdRequestSchema), 400);
});

test("rejects semantic errors with bounded structural issue details", async () => {
  try {
    await parseJsonRequest(jsonRequest(JSON.stringify({ ...validRequest, items: [{ ...validRequest.items[0], title: "" }] })), saveHouseholdRequestSchema);
    assert.fail("expected request validation to fail");
  } catch (error) {
    assert.ok(error instanceof RequestValidationError);
    assert.equal(error.status, 422);
    assert.equal(error.issues?.[0]?.path, "request.items[0].title");
    assert.equal(error.issues?.length, 1);
  }
});

test("rejects declared and streamed bodies over the storage safety limit", async () => {
  await assertValidationStatus(parseJsonRequest(jsonRequest("{}", {
    "content-length": String(MAX_HOUSEHOLD_BODY_BYTES + 1),
  }), saveHouseholdRequestSchema), 413);

  await assertValidationStatus(parseJsonRequest(jsonRequest(`"${"x".repeat(MAX_HOUSEHOLD_BODY_BYTES)}"`), saveHouseholdRequestSchema), 413);
});
