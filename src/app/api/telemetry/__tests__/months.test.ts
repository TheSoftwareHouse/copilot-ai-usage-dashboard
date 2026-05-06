/// <reference types="vitest/globals" />
import { describe, it, expect, beforeAll, afterAll, beforeEach } from "vitest";
import crypto from "crypto";
import { DataSource } from "typeorm";
import {
  getTestDataSource,
  cleanDatabase,
  destroyTestDataSource,
} from "@/test/db-helpers";
import { TelemetryEventEntity } from "@/entities/telemetry-event.entity";
import { canonicalJson } from "@/lib/canonical-json";

let testDs: DataSource;

vi.mock("@/lib/db", () => ({ getDb: async () => testDs }));

let mockCookieStore: Record<string, string> = {};
vi.mock("next/headers", () => ({
  cookies: async () => ({
    get: (name: string) => {
      const value = mockCookieStore[name];
      return value !== undefined ? { value } : undefined;
    },
  }),
}));

const { GET } = await import("@/app/api/telemetry/months/route");
const { hashPassword, createSession, SESSION_COOKIE_NAME } = await import(
  "@/lib/auth"
);

// --- Seed helpers ---

async function seedAuthSession(): Promise<void> {
  const { UserEntity } = await import("@/entities/user.entity");
  const userRepo = testDs.getRepository(UserEntity);
  const user = await userRepo.save({
    username: "testadmin",
    passwordHash: await hashPassword("testpass"),
  });
  const token = await createSession(user.id);
  mockCookieStore[SESSION_COOKIE_NAME] = token;
}

let eventCounter = 0;

async function seedTelemetryEvent(timestamp: Date) {
  eventCounter++;
  const sessionId = crypto.randomUUID();
  const data = { key: `val-${eventCounter}` };
  const hookTimestamp = new Date(timestamp.getTime() + 1000);

  const hashInput = sessionId + "user_prompt" + hookTimestamp.toISOString() + canonicalJson(data);
  const eventHash = crypto.createHash("sha256").update(hashInput).digest("hex");

  const repo = testDs.getRepository(TelemetryEventEntity);
  return repo.save(
    repo.create({
      batchId: crypto.randomUUID(),
      schemaVersion: "1.0",
      timestamp,
      hookTimestamp,
      sessionId,
      eventType: "user_prompt",
      workspaceName: `workspace-${eventCounter}`,
      data,
      eventHash,
      githubUsername: "test-user",
    }),
  );
}

// --- Tests ---

describe("GET /api/telemetry/months", () => {
  beforeAll(async () => {
    testDs = await getTestDataSource();
  });

  afterAll(async () => {
    await destroyTestDataSource();
  });

  beforeEach(async () => {
    await cleanDatabase(testDs);
    mockCookieStore = {};
    eventCounter = 0;
  });

  it("returns 401 without auth", async () => {
    const response = await GET();
    expect(response.status).toBe(401);
    const json = await response.json();
    expect(json.error).toBe("Authentication required");
  });

  it("returns empty array when no data exists", async () => {
    await seedAuthSession();
    const response = await GET();
    expect(response.status).toBe(200);
    const json = await response.json();
    expect(json.months).toEqual([]);
  });

  it("returns distinct months sorted by year DESC, month DESC", async () => {
    await seedAuthSession();
    await seedTelemetryEvent(new Date("2026-01-10T10:00:00Z"));
    await seedTelemetryEvent(new Date("2026-03-15T10:00:00Z"));
    await seedTelemetryEvent(new Date("2025-12-05T10:00:00Z"));

    const response = await GET();
    expect(response.status).toBe(200);
    const json = await response.json();
    expect(json.months).toEqual([
      { month: 3, year: 2026 },
      { month: 1, year: 2026 },
      { month: 12, year: 2025 },
    ]);
  });

  it("does not return duplicate month/year combinations", async () => {
    await seedAuthSession();
    await seedTelemetryEvent(new Date("2026-03-10T10:00:00Z"));
    await seedTelemetryEvent(new Date("2026-03-15T10:00:00Z"));
    await seedTelemetryEvent(new Date("2026-03-20T10:00:00Z"));

    const response = await GET();
    expect(response.status).toBe(200);
    const json = await response.json();
    expect(json.months).toHaveLength(1);
    expect(json.months[0]).toEqual({ month: 3, year: 2026 });
  });
});
