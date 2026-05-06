import {
  describe,
  it,
  expect,
  beforeAll,
  afterAll,
  beforeEach,
  vi,
} from "vitest";
import crypto from "crypto";
import { DataSource } from "typeorm";
import {
  getTestDataSource,
  cleanDatabase,
  destroyTestDataSource,
} from "@/test/db-helpers";
import { ConfigurationEntity } from "@/entities/configuration.entity";
import { TelemetryEventEntity } from "@/entities/telemetry-event.entity";
import { ApiMode } from "@/entities/enums";
import { canonicalJson } from "@/lib/canonical-json";

let testDs: DataSource;

vi.mock("@/lib/db", () => ({ getDb: async () => testDs }));

const { POST } = await import("@/app/api/v1/ingest/route");

const TEST_API_KEY = "tsh_k_0123456789abcdef0123456789abcdef";

const UUID_REGEX =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

// --- Seed helpers (local to this test file) ---

async function seedConfiguration(
  overrides?: Partial<{ telemetryApiKey: string | null }>,
) {
  const repo = testDs.getRepository(ConfigurationEntity);
  return repo.save(
    repo.create({
      apiMode: ApiMode.ORGANISATION,
      entityName: "test-org",
      telemetryApiKey: TEST_API_KEY,
      ...overrides,
    }),
  );
}

async function seedTelemetryEvent(eventInput: Record<string, unknown>) {
  const hashInput =
    String(eventInput.session_id) +
    String(eventInput.event_type) +
    String(eventInput.hook_timestamp) +
    canonicalJson(eventInput.data);
  const eventHash = crypto
    .createHash("sha256")
    .update(hashInput)
    .digest("hex");

  const repo = testDs.getRepository(TelemetryEventEntity);
  return repo.save(
    repo.create({
      batchId: crypto.randomUUID(),
      schemaVersion: String(eventInput.schema_version),
      timestamp: new Date(String(eventInput.timestamp)),
      hookTimestamp: new Date(String(eventInput.hook_timestamp)),
      sessionId: String(eventInput.session_id),
      eventType: String(eventInput.event_type),
      workspaceName: String(eventInput.workspace_name),
      data: eventInput.data as Record<string, unknown>,
      eventHash,
      githubUsername: eventInput.github_username
        ? String(eventInput.github_username)
        : null,
    }),
  );
}

// --- Request helpers ---

function makeValidEvent(
  overrides?: Record<string, unknown>,
): Record<string, unknown> {
  return {
    schema_version: "1.0",
    timestamp: "2024-01-15T10:30:00.000Z",
    hook_timestamp: "2024-01-15T10:30:01.000Z",
    session_id: "a1b2c3d4-e5f6-7890-abcd-ef1234567890",
    event_type: "session_start",
    workspace_name: "test-workspace",
    github_username: "test-user",
    data: { key: "value" },
    ...overrides,
  };
}

function makeNdjsonBody(
  ...events: Record<string, unknown>[]
): string {
  return events.map((e) => JSON.stringify(e)).join("\n");
}

function makeIngestRequest(
  body: string,
  headers: Record<string, string> = {},
): Request {
  return new Request("http://localhost/api/v1/ingest", {
    method: "POST",
    headers: {
      "Content-Type": "application/x-ndjson",
      ...headers,
    },
    body,
  });
}

// --- Tests ---

describe("POST /api/v1/ingest", () => {
  beforeAll(async () => {
    testDs = await getTestDataSource();
  });

  afterAll(async () => {
    await destroyTestDataSource();
  });

  beforeEach(async () => {
    await cleanDatabase(testDs);
  });

  describe("authentication", () => {
    it("returns 401 when X-API-Key header is missing", async () => {
      await seedConfiguration();
      const body = makeNdjsonBody(makeValidEvent());
      const request = makeIngestRequest(body);

      const response = await POST(request);

      expect(response.status).toBe(401);
      const json = await response.json();
      expect(json.error).toBe("Missing or invalid API key");
    });

    it("returns 401 when X-API-Key is invalid", async () => {
      await seedConfiguration();
      const body = makeNdjsonBody(makeValidEvent());
      const request = makeIngestRequest(body, {
        "X-API-Key": "wrong-key-value",
      });

      const response = await POST(request);

      expect(response.status).toBe(401);
      const json = await response.json();
      expect(json.error).toBe("Missing or invalid API key");
    });

    it("returns 200 when X-API-Key matches configured key", async () => {
      await seedConfiguration();
      const body = makeNdjsonBody(makeValidEvent());
      const request = makeIngestRequest(body, {
        "X-API-Key": TEST_API_KEY,
      });

      const response = await POST(request);

      expect(response.status).toBe(200);
    });

    it("returns 401 when no telemetryApiKey is configured", async () => {
      await seedConfiguration({ telemetryApiKey: null });
      const body = makeNdjsonBody(makeValidEvent());
      const request = makeIngestRequest(body, {
        "X-API-Key": TEST_API_KEY,
      });

      const response = await POST(request);

      expect(response.status).toBe(401);
      const json = await response.json();
      expect(json.error).toBe("Missing or invalid API key");
    });
  });

  describe("validation", () => {
    it("counts events with missing envelope fields as failed", async () => {
      await seedConfiguration();
      const incompleteEvent = { schema_version: "1.0" };
      const body = makeNdjsonBody(incompleteEvent);
      const request = makeIngestRequest(body, {
        "X-API-Key": TEST_API_KEY,
      });

      const response = await POST(request);

      expect(response.status).toBe(200);
      const json = await response.json();
      expect(json.failed).toBe(1);
      expect(json.accepted).toBe(0);
      expect(json.errors).toHaveLength(1);
    });

    it("rejects events with invalid event_type", async () => {
      await seedConfiguration();
      const event = makeValidEvent({ event_type: "invalid_type" });
      const body = makeNdjsonBody(event);
      const request = makeIngestRequest(body, {
        "X-API-Key": TEST_API_KEY,
      });

      const response = await POST(request);

      expect(response.status).toBe(200);
      const json = await response.json();
      expect(json.failed).toBe(1);
      expect(json.errors).toHaveLength(1);
      expect(json.errors[0].line).toBe(1);
    });

    it("rejects events with non-object data", async () => {
      await seedConfiguration();
      const event = makeValidEvent({ data: "not-an-object" });
      const body = makeNdjsonBody(event);
      const request = makeIngestRequest(body, {
        "X-API-Key": TEST_API_KEY,
      });

      const response = await POST(request);

      expect(response.status).toBe(200);
      const json = await response.json();
      expect(json.failed).toBe(1);
    });

    it("accepts events with valid envelope and arbitrary data contents", async () => {
      await seedConfiguration();
      const event = makeValidEvent({
        data: { nested: { deeply: { value: 123 } }, list: [1, 2, 3] },
      });
      const body = makeNdjsonBody(event);
      const request = makeIngestRequest(body, {
        "X-API-Key": TEST_API_KEY,
      });

      const response = await POST(request);

      expect(response.status).toBe(200);
      const json = await response.json();
      expect(json.failed).toBe(0);
      expect(json.accepted).toBe(1);
    });
  });

  describe("idempotency", () => {
    it("silently skips duplicate events", async () => {
      await seedConfiguration();
      const event = makeValidEvent();

      // Pre-seed the event in the database
      await seedTelemetryEvent(event);

      const body = makeNdjsonBody(event);
      const request = makeIngestRequest(body, {
        "X-API-Key": TEST_API_KEY,
      });

      const response = await POST(request);
      const json = await response.json();

      expect(json.skipped).toBe(1);
      expect(json.accepted).toBe(0);
    });

    it("returns accepted: 0, skipped: N when re-sending the same body", async () => {
      await seedConfiguration();
      const events = [
        makeValidEvent({
          session_id: "a1b2c3d4-e5f6-7890-abcd-ef1234567890",
        }),
        makeValidEvent({
          session_id: "b2c3d4e5-f6a7-8901-bcde-f23456789012",
        }),
      ];
      const body = makeNdjsonBody(...events);

      // First send
      const request1 = makeIngestRequest(body, {
        "X-API-Key": TEST_API_KEY,
      });
      const response1 = await POST(request1);
      const json1 = await response1.json();
      expect(json1.accepted).toBe(2);

      // Re-send
      const request2 = makeIngestRequest(body, {
        "X-API-Key": TEST_API_KEY,
      });
      const response2 = await POST(request2);
      const json2 = await response2.json();

      expect(json2.total).toBe(2);
      expect(json2.accepted).toBe(0);
      expect(json2.skipped).toBe(2);
    });
  });

  describe("NDJSON parsing", () => {
    it("processes multiple events on separate lines", async () => {
      await seedConfiguration();
      const event1 = makeValidEvent({
        session_id: "a1b2c3d4-e5f6-7890-abcd-ef1234567890",
        hook_timestamp: "2024-01-15T10:30:01.000Z",
      });
      const event2 = makeValidEvent({
        session_id: "b2c3d4e5-f6a7-8901-bcde-f23456789012",
        hook_timestamp: "2024-01-15T10:30:02.000Z",
      });
      const body = makeNdjsonBody(event1, event2);
      const request = makeIngestRequest(body, {
        "X-API-Key": TEST_API_KEY,
      });

      const response = await POST(request);

      expect(response.status).toBe(200);
      const json = await response.json();
      expect(json.total).toBe(2);
      expect(json.accepted).toBe(2);
      expect(json.failed).toBe(0);
    });

    it("ignores empty lines", async () => {
      await seedConfiguration();
      const event = makeValidEvent();
      const body = JSON.stringify(event) + "\n\n\n";
      const request = makeIngestRequest(body, {
        "X-API-Key": TEST_API_KEY,
      });

      const response = await POST(request);

      expect(response.status).toBe(200);
      const json = await response.json();
      expect(json.total).toBe(1);
    });

    it("does not reject valid lines when one line has malformed JSON", async () => {
      await seedConfiguration();
      const validEvent = makeValidEvent();
      const body = "not valid json\n" + JSON.stringify(validEvent);
      const request = makeIngestRequest(body, {
        "X-API-Key": TEST_API_KEY,
      });

      const response = await POST(request);

      expect(response.status).toBe(200);
      const json = await response.json();
      expect(json.total).toBe(2);
      expect(json.failed).toBe(1);
      expect(json.accepted).toBe(1);
    });

    it("includes line and message in errors array for failures", async () => {
      await seedConfiguration();
      const body =
        "not valid json\n" + JSON.stringify(makeValidEvent());
      const request = makeIngestRequest(body, {
        "X-API-Key": TEST_API_KEY,
      });

      const response = await POST(request);

      const json = await response.json();
      expect(json.errors).toHaveLength(1);
      expect(json.errors[0]).toEqual({
        line: 1,
        message: "Invalid JSON",
      });
    });
  });

  describe("response format", () => {
    it("contains batch_id, total, accepted, skipped, failed, errors", async () => {
      await seedConfiguration();
      const body = makeNdjsonBody(makeValidEvent());
      const request = makeIngestRequest(body, {
        "X-API-Key": TEST_API_KEY,
      });

      const response = await POST(request);

      expect(response.status).toBe(200);
      const json = await response.json();
      expect(json.batch_id).toMatch(UUID_REGEX);
      expect(typeof json.total).toBe("number");
      expect(typeof json.accepted).toBe("number");
      expect(typeof json.skipped).toBe("number");
      expect(typeof json.failed).toBe("number");
      expect(Array.isArray(json.errors)).toBe(true);
    });
  });

  describe("body size", () => {
    it("returns 413 when Content-Length exceeds 10MB", async () => {
      await seedConfiguration();
      const body = makeNdjsonBody(makeValidEvent());
      const request = makeIngestRequest(body, {
        "X-API-Key": TEST_API_KEY,
        "Content-Length": String(11 * 1024 * 1024),
      });

      const response = await POST(request);

      expect(response.status).toBe(413);
      const json = await response.json();
      expect(json.error).toBe("Request body exceeds 10 MB limit");
    });
  });

  describe("githubUsername storage", () => {
    it("stores githubUsername from envelope", async () => {
      await seedConfiguration();
      const event = makeValidEvent({ github_username: "octocat" });
      const body = makeNdjsonBody(event);
      const request = makeIngestRequest(body, {
        "X-API-Key": TEST_API_KEY,
      });

      const response = await POST(request);

      expect(response.status).toBe(200);
      const json = await response.json();
      expect(json.accepted).toBe(1);

      const repo = testDs.getRepository(TelemetryEventEntity);
      const stored = await repo.findOne({
        where: { sessionId: String(event.session_id) },
      });
      expect(stored).not.toBeNull();
      expect(stored!.githubUsername).toBe("octocat");
    });
  });
});
