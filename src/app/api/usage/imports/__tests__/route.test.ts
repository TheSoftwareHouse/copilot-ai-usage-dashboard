/// <reference types="vitest/globals" />
import {
  describe,
  it,
  expect,
  beforeAll,
  afterAll,
  beforeEach,
  vi,
} from "vitest";
import { DataSource } from "typeorm";
import {
  getTestDataSource,
  cleanDatabase,
  destroyTestDataSource,
} from "@/test/db-helpers";
import { CopilotSeatEntity } from "@/entities/copilot-seat.entity";
import { ImportHistoryEntity } from "@/entities/import-history.entity";
import { UserRole } from "@/entities/enums";
import { hashPassword, createSession, SESSION_COOKIE_NAME } from "@/lib/auth";

let testDs: DataSource;

let mockCookieStore: Record<string, string> = {};
vi.mock("next/headers", () => ({
  cookies: async () => ({
    get: (name: string) => {
      const value = mockCookieStore[name];
      return value !== undefined ? { value } : undefined;
    },
  }),
}));

vi.mock("@/lib/db", () => ({ getDb: async () => testDs }));

vi.mock("@/lib/dashboard-metrics", () => ({
  refreshDashboardMetrics: vi.fn(),
}));

const { GET, POST } = await import("@/app/api/usage/imports/route");

async function seedAuthSession(options?: { role?: string }): Promise<void> {
  const { UserEntity } = await import("@/entities/user.entity");
  const userRepo = testDs.getRepository(UserEntity);
  const user = await userRepo.save({
    username: "testadmin",
    passwordHash: await hashPassword("testpass"),
    role: options?.role ?? UserRole.ADMIN,
  });
  const token = await createSession(user.id);
  mockCookieStore[SESSION_COOKIE_NAME] = token;
}

function buildCsv(rows: string[]): string {
  return [
    "date,username,model,product,sku,aic_quantity,aic_gross_amount",
    ...rows,
  ].join("\n");
}

function makeMultipartRequest(file: File | null): Request {
  const formData = new FormData();

  if (file !== null) {
    formData.set("file", file);
  }

  return new Request("http://localhost:3000/api/usage/imports", {
    method: "POST",
    body: formData,
  });
}

describe("POST /api/usage/imports", () => {
  beforeAll(async () => {
    testDs = await getTestDataSource();
  });

  afterAll(async () => {
    await destroyTestDataSource();
  });

  beforeEach(async () => {
    await cleanDatabase(testDs);
    mockCookieStore = {};
    vi.clearAllMocks();
  });

  it("returns 401 without auth", async () => {
    const request = makeMultipartRequest(null);

    const response = await POST(request);

    expect(response.status).toBe(401);
    const json = await response.json();
    expect(json.error).toBe("Authentication required");
  });

  it("returns 403 for non-admin users", async () => {
    await seedAuthSession({ role: UserRole.USER });
    const request = makeMultipartRequest(
      new File(
        [buildCsv(["2026-05-02,octocat,GPT-4o,Copilot,AIC,1,0.50"])],
        "billing.csv",
        {
          type: "text/csv",
        },
      ),
    );

    const response = await POST(request);

    expect(response.status).toBe(403);
    const json = await response.json();
    expect(json.error).toBe("Admin access required");
  });

  it("returns 400 when the file field is missing", async () => {
    await seedAuthSession();
    const request = makeMultipartRequest(null);

    const response = await POST(request);

    expect(response.status).toBe(400);
    const json = await response.json();
    expect(json.error).toBe("CSV file upload is required");
  });

  it("returns 400 when the uploaded file does not have a .csv filename", async () => {
    await seedAuthSession();
    const request = makeMultipartRequest(
      new File(
        [buildCsv(["2026-05-02,octocat,GPT-4o,Copilot,AIC,1,0.50"])],
        "billing.txt",
        {
          type: "text/plain",
        },
      ),
    );

    const response = await POST(request);

    expect(response.status).toBe(400);
    const json = await response.json();
    expect(json.error).toBe("Uploaded file must have a .csv filename");
  });

  it("returns 413 when the file exceeds the size limit", async () => {
    await seedAuthSession();
    const largeFile = new File(
      [new Uint8Array(10 * 1024 * 1024 + 1)],
      "billing.csv",
      { type: "text/csv" },
    );
    const request = makeMultipartRequest(largeFile);

    const response = await POST(request);

    expect(response.status).toBe(413);
    const json = await response.json();
    expect(json.error).toBe("CSV file exceeds 10 MB limit");
  });

  it("returns import counts, skipped usernames, affected months, and refresh warnings", async () => {
    await seedAuthSession();

    const seatRepo = testDs.getRepository(CopilotSeatEntity);
    await seatRepo.save({
      githubUsername: "octocat",
      githubUserId: 123,
    });

    const request = makeMultipartRequest(
      new File(
        [
          buildCsv([
            "2026-05-02,  OctoCat  ,GPT-4o,Copilot,AIC,2,1.00",
            "2026-05-03,missing-user,GPT-4o,Copilot,AIC,3,1.50",
          ]),
        ],
        "billing.csv",
        { type: "text/csv" },
      ),
    );

    const response = await POST(request);

    expect(response.status).toBe(200);
    const json = await response.json();
    expect(json.importHistoryId).toBeGreaterThan(0);
    expect(json.recordsProcessed).toBe(2);
    expect(json.matchedUserCount).toBe(1);
    expect(json.skippedUserCount).toBe(1);
    expect(json.skippedUsernames).toEqual(["missing-user"]);
    expect(json.affectedMonths).toEqual([{ month: 5, year: 2026 }]);
    expect(json.overwrittenSeatDayCount).toBe(0);
    expect(json.overwriteWarnings).toEqual([]);
    expect(json.refreshWarnings).toEqual([]);
  });
});

describe("GET /api/usage/imports", () => {
  beforeAll(async () => {
    testDs = await getTestDataSource();
  });

  afterAll(async () => {
    await destroyTestDataSource();
  });

  beforeEach(async () => {
    await cleanDatabase(testDs);
    mockCookieStore = {};
    vi.clearAllMocks();
  });

  it("returns import history newest-first", async () => {
    await seedAuthSession();

    const historyRepo = testDs.getRepository(ImportHistoryEntity);
    await historyRepo.save([
      {
        filename: "older.csv",
        executedAt: new Date("2026-05-02T10:00:00Z"),
        recordsProcessed: 1,
        matchedUserCount: 1,
        skippedUserCount: 0,
        skippedUsernames: [],
        affectedMonths: [{ month: 5, year: 2026 }],
        overwrittenSeatDayCount: 0,
      },
      {
        filename: "newer.csv",
        executedAt: new Date("2026-05-03T10:00:00Z"),
        recordsProcessed: 2,
        matchedUserCount: 2,
        skippedUserCount: 1,
        skippedUsernames: ["missing-user"],
        affectedMonths: [{ month: 6, year: 2026 }],
        overwrittenSeatDayCount: 1,
      },
    ]);

    const response = await GET(
      new Request("http://localhost:3000/api/usage/imports"),
    );

    expect(response.status).toBe(200);
    const json = await response.json();
    expect(json.imports).toHaveLength(2);
    expect(json.imports[0].filename).toBe("newer.csv");
    expect(json.imports[1].filename).toBe("older.csv");
    expect(json.imports[0].affectedMonths).toEqual([{ month: 6, year: 2026 }]);
  });
});