/// <reference types="vitest/globals" />
import { describe, it, expect, beforeAll, afterAll, beforeEach } from "vitest";
import crypto from "crypto";
import { DataSource } from "typeorm";
import { NextRequest } from "next/server";
import {
  getTestDataSource,
  cleanDatabase,
  destroyTestDataSource,
} from "@/test/db-helpers";
import { TelemetryEventEntity } from "@/entities/telemetry-event.entity";
import { CopilotSeatEntity } from "@/entities/copilot-seat.entity";
import { TeamEntity } from "@/entities/team.entity";
import { TeamMemberSnapshotEntity } from "@/entities/team-member-snapshot.entity";
import { SeatStatus } from "@/entities/enums";
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

const { GET } = await import("@/app/api/telemetry/usage/route");
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

async function seedTelemetryEvent(overrides: {
  eventType?: string;
  timestamp?: Date;
  githubUsername?: string;
  data?: Record<string, unknown>;
}) {
  eventCounter++;
  const eventType = overrides.eventType ?? "user_prompt";
  const timestamp = overrides.timestamp ?? new Date("2026-03-15T10:00:00Z");
  const data = overrides.data ?? {};
  const sessionId = crypto.randomUUID();
  const hookTimestamp = new Date(timestamp.getTime() + 1000);

  const hashInput = sessionId + eventType + hookTimestamp.toISOString() + canonicalJson(data);
  const eventHash = crypto.createHash("sha256").update(hashInput).digest("hex");

  const repo = testDs.getRepository(TelemetryEventEntity);
  return repo.save(
    repo.create({
      batchId: crypto.randomUUID(),
      schemaVersion: "1.0",
      timestamp,
      hookTimestamp,
      sessionId,
      eventType,
      workspaceName: `workspace-${eventCounter}`,
      data,
      eventHash,
      githubUsername: overrides.githubUsername ?? "test-user",
    }),
  );
}

async function seedTeamWithMembers(
  teamName: string,
  githubUsernames: string[],
  month: number,
  year: number,
): Promise<number> {
  const teamRepo = testDs.getRepository(TeamEntity);
  const team = await teamRepo.save({ name: teamName });

  const seatRepo = testDs.getRepository(CopilotSeatEntity);
  const snapshotRepo = testDs.getRepository(TeamMemberSnapshotEntity);

  for (const username of githubUsernames) {
    const seat = await seatRepo.save({
      githubUsername: username,
      githubUserId: Math.floor(Math.random() * 100000),
      status: SeatStatus.ACTIVE,
    });
    await snapshotRepo.save({
      teamId: team.id,
      seatId: seat.id,
      month,
      year,
    });
  }

  return team.id;
}

function makeGetRequest(params?: Record<string, string>): NextRequest {
  const url = new URL("http://localhost:3000/api/telemetry/usage");
  if (params) {
    for (const [key, value] of Object.entries(params)) {
      url.searchParams.set(key, value);
    }
  }
  return new NextRequest(url.toString(), { method: "GET" });
}

// --- Tests ---

describe("GET /api/telemetry/usage", () => {
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
    const request = makeGetRequest({ month: "3", year: "2026" });
    const response = await GET(request);
    expect(response.status).toBe(401);
    const json = await response.json();
    expect(json.error).toBe("Authentication required");
  });

  it("returns 400 for missing month/year", async () => {
    await seedAuthSession();
    const request = makeGetRequest();
    const response = await GET(request);
    expect(response.status).toBe(400);
    const json = await response.json();
    expect(json.error).toBe("Validation failed");
  });

  it("returns empty arrays when no data exists", async () => {
    await seedAuthSession();
    const request = makeGetRequest({ month: "3", year: "2026" });
    const response = await GET(request);
    expect(response.status).toBe(200);
    const json = await response.json();
    expect(json.agentUsage).toEqual([]);
    expect(json.promptUsage).toEqual([]);
  });

  it("aggregates agent from user_prompt events correctly", async () => {
    await seedAuthSession();
    await seedTelemetryEvent({
      eventType: "user_prompt",
      timestamp: new Date("2026-03-15T10:00:00Z"),
      data: { agent: "copilot-chat" },
    });
    await seedTelemetryEvent({
      eventType: "user_prompt",
      timestamp: new Date("2026-03-16T10:00:00Z"),
      data: { agent: "copilot-chat" },
    });
    await seedTelemetryEvent({
      eventType: "user_prompt",
      timestamp: new Date("2026-03-17T10:00:00Z"),
      data: { agent: "copilot-edits" },
    });

    const request = makeGetRequest({ month: "3", year: "2026" });
    const response = await GET(request);
    expect(response.status).toBe(200);
    const json = await response.json();
    expect(json.agentUsage).toHaveLength(2);
    expect(json.agentUsage[0]).toEqual({ agent: "copilot-chat", count: 2 });
    expect(json.agentUsage[1]).toEqual({ agent: "copilot-edits", count: 1 });
  });

  it("aggregates agent from tool_call subagent events", async () => {
    await seedAuthSession();
    await seedTelemetryEvent({
      eventType: "tool_call",
      timestamp: new Date("2026-03-15T10:00:00Z"),
      data: { tool_name: "runSubagent", subagent_name: "code-reviewer" },
    });
    await seedTelemetryEvent({
      eventType: "tool_call",
      timestamp: new Date("2026-03-15T11:00:00Z"),
      data: { tool_name: "runSubagent", subagent_name: "code-reviewer" },
    });
    await seedTelemetryEvent({
      eventType: "tool_call",
      timestamp: new Date("2026-03-15T12:00:00Z"),
      data: { tool_name: "runSubagent", subagent_name: "test-writer" },
    });

    const request = makeGetRequest({ month: "3", year: "2026" });
    const response = await GET(request);
    expect(response.status).toBe(200);
    const json = await response.json();
    expect(json.agentUsage).toHaveLength(2);
    expect(json.agentUsage[0]).toEqual({ agent: "code-reviewer", count: 2 });
    expect(json.agentUsage[1]).toEqual({ agent: "test-writer", count: 1 });
  });

  it("uses 'default' when agent is null or empty", async () => {
    await seedAuthSession();
    await seedTelemetryEvent({
      eventType: "user_prompt",
      timestamp: new Date("2026-03-15T10:00:00Z"),
      data: {},
    });
    await seedTelemetryEvent({
      eventType: "user_prompt",
      timestamp: new Date("2026-03-15T11:00:00Z"),
      data: { agent: "" },
    });
    await seedTelemetryEvent({
      eventType: "tool_call",
      timestamp: new Date("2026-03-15T12:00:00Z"),
      data: { tool_name: "runSubagent" },
    });

    const request = makeGetRequest({ month: "3", year: "2026" });
    const response = await GET(request);
    expect(response.status).toBe(200);
    const json = await response.json();
    expect(json.agentUsage).toHaveLength(1);
    expect(json.agentUsage[0]).toEqual({ agent: "default", count: 3 });
  });

  it("aggregates prompt from user_prompt events", async () => {
    await seedAuthSession();
    await seedTelemetryEvent({
      eventType: "user_prompt",
      timestamp: new Date("2026-03-15T10:00:00Z"),
      data: { detected_prompt: "fix-code" },
    });
    await seedTelemetryEvent({
      eventType: "user_prompt",
      timestamp: new Date("2026-03-16T10:00:00Z"),
      data: { detected_prompt: "fix-code" },
    });
    await seedTelemetryEvent({
      eventType: "user_prompt",
      timestamp: new Date("2026-03-17T10:00:00Z"),
      data: { detected_prompt: "explain" },
    });

    const request = makeGetRequest({ month: "3", year: "2026" });
    const response = await GET(request);
    expect(response.status).toBe(200);
    const json = await response.json();
    expect(json.promptUsage).toHaveLength(2);
    expect(json.promptUsage[0]).toEqual({ prompt: "fix-code", count: 2 });
    expect(json.promptUsage[1]).toEqual({ prompt: "explain", count: 1 });
  });

  it("excludes tool_call subagent events from prompt usage", async () => {
    await seedAuthSession();
    await seedTelemetryEvent({
      eventType: "tool_call",
      timestamp: new Date("2026-03-15T10:00:00Z"),
      data: { tool_name: "runSubagent", subagent_prompt: "review" },
    });
    await seedTelemetryEvent({
      eventType: "tool_call",
      timestamp: new Date("2026-03-15T11:00:00Z"),
      data: { tool_name: "runSubagent", subagent_prompt: "review" },
    });

    const request = makeGetRequest({ month: "3", year: "2026" });
    const response = await GET(request);
    expect(response.status).toBe(200);
    const json = await response.json();
    expect(json.promptUsage).toHaveLength(0);
  });

  it("uses 'other' when prompt is null or empty", async () => {
    await seedAuthSession();
    await seedTelemetryEvent({
      eventType: "user_prompt",
      timestamp: new Date("2026-03-15T10:00:00Z"),
      data: {},
    });
    await seedTelemetryEvent({
      eventType: "user_prompt",
      timestamp: new Date("2026-03-15T11:00:00Z"),
      data: { detected_prompt: "" },
    });
    await seedTelemetryEvent({
      eventType: "tool_call",
      timestamp: new Date("2026-03-15T12:00:00Z"),
      data: { tool_name: "runSubagent" },
    });

    const request = makeGetRequest({ month: "3", year: "2026" });
    const response = await GET(request);
    expect(response.status).toBe(200);
    const json = await response.json();
    expect(json.promptUsage).toHaveLength(1);
    expect(json.promptUsage[0]).toEqual({ prompt: "other", count: 2 });
  });

  it("filters by day", async () => {
    await seedAuthSession();
    await seedTelemetryEvent({
      eventType: "user_prompt",
      timestamp: new Date("2026-03-15T10:00:00Z"),
      data: { agent: "chat" },
    });
    await seedTelemetryEvent({
      eventType: "user_prompt",
      timestamp: new Date("2026-03-16T10:00:00Z"),
      data: { agent: "chat" },
    });

    const request = makeGetRequest({ month: "3", year: "2026", day: "15" });
    const response = await GET(request);
    expect(response.status).toBe(200);
    const json = await response.json();
    expect(json.agentUsage).toHaveLength(1);
    expect(json.agentUsage[0]).toEqual({ agent: "chat", count: 1 });
  });

  it("filters by github_username", async () => {
    await seedAuthSession();
    await seedTelemetryEvent({
      eventType: "user_prompt",
      timestamp: new Date("2026-03-15T10:00:00Z"),
      githubUsername: "alice",
      data: { agent: "chat" },
    });
    await seedTelemetryEvent({
      eventType: "user_prompt",
      timestamp: new Date("2026-03-15T11:00:00Z"),
      githubUsername: "bob",
      data: { agent: "chat" },
    });

    const request = makeGetRequest({ month: "3", year: "2026", github_username: "alice" });
    const response = await GET(request);
    expect(response.status).toBe(200);
    const json = await response.json();
    expect(json.agentUsage).toHaveLength(1);
    expect(json.agentUsage[0]).toEqual({ agent: "chat", count: 1 });
  });

  it("filters by team_id (resolves team members)", async () => {
    await seedAuthSession();
    const teamId = await seedTeamWithMembers("team-alpha", ["alice", "bob"], 3, 2026);

    await seedTelemetryEvent({
      eventType: "user_prompt",
      timestamp: new Date("2026-03-15T10:00:00Z"),
      githubUsername: "alice",
      data: { agent: "chat" },
    });
    await seedTelemetryEvent({
      eventType: "user_prompt",
      timestamp: new Date("2026-03-15T11:00:00Z"),
      githubUsername: "bob",
      data: { agent: "chat" },
    });
    await seedTelemetryEvent({
      eventType: "user_prompt",
      timestamp: new Date("2026-03-15T12:00:00Z"),
      githubUsername: "charlie",
      data: { agent: "chat" },
    });

    const request = makeGetRequest({ month: "3", year: "2026", team_id: String(teamId) });
    const response = await GET(request);
    expect(response.status).toBe(200);
    const json = await response.json();
    expect(json.agentUsage).toHaveLength(1);
    expect(json.agentUsage[0]).toEqual({ agent: "chat", count: 2 });
  });

  it("returns empty arrays when team has no members", async () => {
    await seedAuthSession();
    const teamRepo = testDs.getRepository(TeamEntity);
    const team = await teamRepo.save({ name: "empty-team" });

    await seedTelemetryEvent({
      eventType: "user_prompt",
      timestamp: new Date("2026-03-15T10:00:00Z"),
      data: { agent: "chat" },
    });

    const request = makeGetRequest({ month: "3", year: "2026", team_id: String(team.id) });
    const response = await GET(request);
    expect(response.status).toBe(200);
    const json = await response.json();
    expect(json.agentUsage).toEqual([]);
    expect(json.promptUsage).toEqual([]);
  });

  it("returns results sorted by count DESC", async () => {
    await seedAuthSession();
    await seedTelemetryEvent({
      eventType: "user_prompt",
      timestamp: new Date("2026-03-15T10:00:00Z"),
      data: { agent: "rare-agent" },
    });
    for (let i = 0; i < 3; i++) {
      await seedTelemetryEvent({
        eventType: "user_prompt",
        timestamp: new Date(`2026-03-15T1${i}:00:00Z`),
        data: { agent: "popular-agent" },
      });
    }

    const request = makeGetRequest({ month: "3", year: "2026" });
    const response = await GET(request);
    expect(response.status).toBe(200);
    const json = await response.json();
    expect(json.agentUsage[0].agent).toBe("popular-agent");
    expect(json.agentUsage[0].count).toBe(3);
    expect(json.agentUsage[1].agent).toBe("rare-agent");
    expect(json.agentUsage[1].count).toBe(1);
  });
});
