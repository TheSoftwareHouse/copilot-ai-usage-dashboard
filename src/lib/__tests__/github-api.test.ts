import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { ApiMode } from "@/entities/enums";
import {
  fetchCopilotAiCreditUsage,
  fetchAllCopilotSeats,
  GitHubApiError,
  type GitHubAiCreditUsageResult,
  type GitHubSeatsResponse,
} from "@/lib/github-api";
import {
  githubAiCreditUsageRecordFixture,
  githubAiCreditUsageRecordPageFixture,
  makeGitHubAiCreditUsageResponse,
} from "@/lib/__tests__/github-usage.fixture";

const TEST_TOKEN = "ghp_test_token_123";

function makeSeatsResponse(
  count: number,
  totalSeats: number,
  startId = 1,
): GitHubSeatsResponse {
  return {
    total_seats: totalSeats,
    seats: Array.from({ length: count }, (_, index) => ({
      created_at: "2021-08-03T18:00:00-06:00",
      updated_at: "2021-09-23T15:00:00-06:00",
      pending_cancellation_date: null,
      last_activity_at: "2021-10-14T00:53:32-06:00",
      last_activity_editor: "vscode/1.77.3/copilot/1.86.82",
      plan_type: "business",
      assignee: {
        login: `user-${startId + index}`,
        id: startId + index,
        avatar_url: `https://github.com/images/user-${startId + index}.gif`,
        type: "User",
      },
    })),
  };
}

describe("fetchAllCopilotSeats", () => {
  beforeEach(() => {
    vi.stubGlobal("fetch", vi.fn());
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("fetches single page of seats for organisation mode with correct URL and headers", async () => {
    const mockResponse = makeSeatsResponse(3, 3);
    vi.mocked(fetch).mockResolvedValueOnce(
      new Response(JSON.stringify(mockResponse), { status: 200 }),
    );

    const seats = await fetchAllCopilotSeats(
      {
        apiMode: ApiMode.ORGANISATION,
        entityName: "my-org",
      },
      TEST_TOKEN,
    );

    expect(fetch).toHaveBeenCalledOnce();
    expect(fetch).toHaveBeenCalledWith(
      "https://api.github.com/orgs/my-org/copilot/billing/seats?page=1&per_page=100",
      {
        headers: {
          Accept: "application/vnd.github+json",
          Authorization: `Bearer ${TEST_TOKEN}`,
          "X-GitHub-Api-Version": "2022-11-28",
        },
      },
    );
    expect(seats).toHaveLength(3);
    expect(seats[0].assignee.login).toBe("user-1");
  });

  it("fetches single page of seats for enterprise mode with correct URL", async () => {
    const mockResponse = makeSeatsResponse(2, 2);
    vi.mocked(fetch).mockResolvedValueOnce(
      new Response(JSON.stringify(mockResponse), { status: 200 }),
    );

    const seats = await fetchAllCopilotSeats(
      {
        apiMode: ApiMode.ENTERPRISE,
        entityName: "my-enterprise",
      },
      TEST_TOKEN,
    );

    expect(fetch).toHaveBeenCalledWith(
      "https://api.github.com/enterprises/my-enterprise/copilot/billing/seats?page=1&per_page=100",
      expect.any(Object),
    );
    expect(seats).toHaveLength(2);
  });

  it("handles multi-page pagination", async () => {
    const page1 = makeSeatsResponse(100, 150, 1);
    const page2 = makeSeatsResponse(50, 150, 101);

    vi.mocked(fetch)
      .mockResolvedValueOnce(new Response(JSON.stringify(page1), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify(page2), { status: 200 }));

    const seats = await fetchAllCopilotSeats(
      {
        apiMode: ApiMode.ORGANISATION,
        entityName: "big-org",
      },
      TEST_TOKEN,
    );

    expect(fetch).toHaveBeenCalledTimes(2);
    expect(fetch).toHaveBeenNthCalledWith(
      1,
      expect.stringContaining("page=1"),
      expect.any(Object),
    );
    expect(fetch).toHaveBeenNthCalledWith(
      2,
      expect.stringContaining("page=2"),
      expect.any(Object),
    );
    expect(seats).toHaveLength(150);
    expect(seats[0].assignee.login).toBe("user-1");
    expect(seats[149].assignee.login).toBe("user-150");
  });

  it("throws GitHubApiError for 401 Unauthorized", async () => {
    vi.mocked(fetch).mockResolvedValueOnce(
      new Response(JSON.stringify({ message: "Bad credentials" }), {
        status: 401,
        statusText: "Unauthorized",
      }),
    );

    await expect(
      fetchAllCopilotSeats(
        {
          apiMode: ApiMode.ORGANISATION,
          entityName: "my-org",
        },
        TEST_TOKEN,
      ),
    ).rejects.toThrow(GitHubApiError);
  });

  it("throws GitHubApiError for 503 Service Unavailable", async () => {
    vi.mocked(fetch).mockResolvedValueOnce(
      new Response("Service Unavailable", {
        status: 503,
        statusText: "Service Unavailable",
      }),
    );

    await expect(
      fetchAllCopilotSeats(
        {
          apiMode: ApiMode.ENTERPRISE,
          entityName: "my-ent",
        },
        TEST_TOKEN,
      ),
    ).rejects.toThrow(GitHubApiError);
  });

  it("returns empty array when API returns zero seats", async () => {
    const emptyResponse: GitHubSeatsResponse = { total_seats: 0, seats: [] };
    vi.mocked(fetch).mockResolvedValueOnce(
      new Response(JSON.stringify(emptyResponse), { status: 200 }),
    );

    const seats = await fetchAllCopilotSeats(
      {
        apiMode: ApiMode.ORGANISATION,
        entityName: "empty-org",
      },
      TEST_TOKEN,
    );

    expect(seats).toEqual([]);
  });
});

describe("rate limit header logging", () => {
  beforeEach(() => {
    vi.stubGlobal("fetch", vi.fn());
    vi.spyOn(console, "log").mockImplementation(() => {});
    vi.spyOn(console, "warn").mockImplementation(() => {});
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  const seatsConfig = {
    apiMode: ApiMode.ORGANISATION as const,
    entityName: "my-org",
  };

  function makeResponseWithRateLimitHeaders(
    body: unknown,
    status: number,
    remaining: string,
    reset: string,
  ): Response {
    return new Response(JSON.stringify(body), {
      status,
      statusText: status === 200 ? "OK" : "Forbidden",
      headers: {
        "x-ratelimit-remaining": remaining,
        "x-ratelimit-reset": reset,
      },
    });
  }

  it("logs rate limit info from response headers on success", async () => {
    const resetTimestamp = "1740700800";
    vi.mocked(fetch).mockResolvedValueOnce(
      makeResponseWithRateLimitHeaders(makeSeatsResponse(2, 2), 200, "4500", resetTimestamp),
    );

    await fetchAllCopilotSeats(seatsConfig, TEST_TOKEN);

    expect(console.log).toHaveBeenCalledWith(
      expect.stringContaining("4500 requests remaining"),
    );
    expect(console.log).toHaveBeenCalledWith(
      expect.stringContaining("2025-02-28T00:00:00.000Z"),
    );
  });

  it("logs rate limit info on each page of a multi-page response", async () => {
    const page1 = makeSeatsResponse(100, 150, 1);
    const page2 = makeSeatsResponse(50, 150, 101);

    vi.mocked(fetch)
      .mockResolvedValueOnce(
        makeResponseWithRateLimitHeaders(page1, 200, "4800", "1740700800"),
      )
      .mockResolvedValueOnce(
        makeResponseWithRateLimitHeaders(page2, 200, "4799", "1740700800"),
      );

    await fetchAllCopilotSeats(seatsConfig, TEST_TOKEN);

    const logCalls = vi.mocked(console.log).mock.calls
      .map((call) => call[0] as string)
      .filter((message) => message.includes("rate limit"));

    expect(logCalls).toHaveLength(2);
    expect(logCalls[0]).toContain("4800 requests remaining");
    expect(logCalls[1]).toContain("4799 requests remaining");
  });

  it("logs rate limit info before throwing on error response", async () => {
    vi.mocked(fetch).mockResolvedValueOnce(
      makeResponseWithRateLimitHeaders(
        { message: "rate limit exceeded" },
        403,
        "0",
        "1740700800",
      ),
    );

    await expect(fetchAllCopilotSeats(seatsConfig, TEST_TOKEN)).rejects.toThrow(
      GitHubApiError,
    );

    expect(console.log).toHaveBeenCalledWith(
      expect.stringContaining("0 requests remaining"),
    );
  });

  it("handles missing rate limit headers gracefully without logging", async () => {
    vi.mocked(fetch).mockResolvedValueOnce(
      new Response(JSON.stringify(makeSeatsResponse(1, 1)), { status: 200 }),
    );

    await fetchAllCopilotSeats(seatsConfig, TEST_TOKEN);

    const rateLimitLogs = vi.mocked(console.log).mock.calls
      .map((call) => call[0] as string)
      .filter((message) => message.includes("rate limit"));

    expect(rateLimitLogs).toHaveLength(0);
    expect(console.warn).not.toHaveBeenCalled();
  });

  it("handles non-numeric rate limit header values gracefully", async () => {
    vi.mocked(fetch).mockResolvedValueOnce(
      makeResponseWithRateLimitHeaders(
        makeSeatsResponse(1, 1),
        200,
        "not-a-number",
        "invalid",
      ),
    );

    await fetchAllCopilotSeats(seatsConfig, TEST_TOKEN);

    expect(console.log).toHaveBeenCalledWith(
      expect.stringContaining("unknown requests remaining"),
    );
    expect(console.log).toHaveBeenCalledWith(
      expect.stringContaining("resets at unknown"),
    );
    expect(console.warn).not.toHaveBeenCalled();
  });
});

describe("fetchCopilotAiCreditUsage", () => {
  const usageConfig = {
    apiMode: ApiMode.ORGANISATION as const,
    entityName: "my-org",
    year: 2026,
    month: 5,
    day: 7,
    user: "octocat",
  };

  beforeEach(() => {
    vi.stubGlobal("fetch", vi.fn());
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("fetches the confirmed AI credit usage response shape with the GitHub App token path", async () => {
    vi.mocked(fetch).mockResolvedValueOnce(makeGitHubAiCreditUsageResponse());

    const result = (await fetchCopilotAiCreditUsage(
      usageConfig,
      TEST_TOKEN,
    )) as GitHubAiCreditUsageResult;

    expect(fetch).toHaveBeenCalledOnce();
    expect(fetch).toHaveBeenCalledWith(
      "https://api.github.com/orgs/my-org/settings/billing/ai_credit/usage?year=2026&month=5&day=7&user=octocat&page=1&per_page=100",
      {
        headers: {
          Accept: "application/vnd.github+json",
          Authorization: `Bearer ${TEST_TOKEN}`,
          "X-GitHub-Api-Version": "2022-11-28",
        },
      },
    );
    expect(result.kind).toBe("success");
    if (result.kind === "success") {
      expect(result.usageRecords).toEqual([githubAiCreditUsageRecordFixture]);
      expect(result.usageRecords).toHaveLength(1);
      expect(result.usageRecords[0]).toMatchObject({
        timePeriod: "2026-05-07",
        user: "octocat",
        organization: "my-org",
      });
      expect(result.usageRecords[0].usageItems[0]).toMatchObject({
        model: "GPT-4o",
        unitType: "requests",
        discountAmount: 0.08,
        netAmount: 0.4,
      });
      expect(result.usageRecords[0].usageItems[1]).toMatchObject({
        model: "Claude Sonnet 4.5",
        netAmount: 0.1,
      });
      expect(result.usageRecords[0].usageItems).toHaveLength(2);
    }
  });

  it("accepts object-based timePeriod from live GitHub payload", async () => {
    const objectTpPayload = {
      timePeriod: { year: 2026, month: 6, day: 4 },
      user: "sethii",
      usageItems: [
        {
          product: "Copilot",
          sku: "Premium",
          model: "Claude Sonnet 4.5",
          unitType: "requests",
          pricePerUnit: 0.1,
          grossQuantity: 5,
          grossAmount: 0.5,
          discountQuantity: 0,
          discountAmount: 0,
          netQuantity: 5,
          netAmount: 0.5,
        }
      ]
    };
    
    vi.mocked(fetch).mockResolvedValueOnce(
      new Response(JSON.stringify(objectTpPayload), { status: 200, headers: { "Content-Type": "application/json" } })
    );

    const result = await fetchCopilotAiCreditUsage(usageConfig, TEST_TOKEN);

    expect(result.kind).toBe("success");
    if (result.kind === "success") {
      expect(result.usageRecords).toHaveLength(1);
      expect(result.usageRecords[0]).toMatchObject({
        timePeriod: "2026-06-04",
        user: "sethii",
        organization: "", // fallback
      });
    }
  });

  it("accepts organization: null from live GitHub payload", async () => {
    const nullOrgPayload = {
      timePeriod: "2026-05-10",
      user: "sethii",
      organization: null,
      usageItems: [
        {
          product: "Copilot",
          sku: "Premium",
          model: "Claude Sonnet 4.5",
          unitType: "requests",
          pricePerUnit: 0.1,
          grossQuantity: 5,
          grossAmount: 0.5,
          discountQuantity: 0,
          discountAmount: 0,
          netQuantity: 5,
          netAmount: 0.5,
        }
      ]
    };
    
    vi.mocked(fetch).mockResolvedValueOnce(
      new Response(JSON.stringify(nullOrgPayload), { status: 200, headers: { "Content-Type": "application/json" } })
    );

    const result = await fetchCopilotAiCreditUsage(usageConfig, TEST_TOKEN);

    expect(result.kind).toBe("success");
    if (result.kind === "success") {
      expect(result.usageRecords).toHaveLength(1);
      expect(result.usageRecords[0]).toMatchObject({
        user: "sethii",
        organization: "",
      });
    }
  });

  it("accepts snake_case properties from live GitHub payload", async () => {
    const snakeCasePayload = {
      time_period: "2026-05-10",
      user: "sethii",
      // organization might be missing or included
      usage_items: [
        {
          product: "Copilot",
          sku: "Premium",
          model: "Claude Sonnet 4.5",
          unit_type: "requests",
          price_per_unit: 0.1,
          gross_quantity: 5,
          gross_amount: 0.5,
          discount_quantity: 0,
          discount_amount: 0,
          net_quantity: 5,
          net_amount: 0.5,
        }
      ]
    };
    
    vi.mocked(fetch).mockResolvedValueOnce(
      new Response(JSON.stringify(snakeCasePayload), { status: 200, headers: { "Content-Type": "application/json" } })
    );

    const result = await fetchCopilotAiCreditUsage(usageConfig, TEST_TOKEN);

    expect(result.kind).toBe("success");
    if (result.kind === "success") {
      expect(result.usageRecords).toHaveLength(1);
      expect(result.usageRecords[0]).toMatchObject({
        timePeriod: "2026-05-10",
        user: "sethii",
        organization: "", // fallback
      });
      expect(result.usageRecords[0].usageItems[0]).toMatchObject({
        pricePerUnit: 0.1,
        netAmount: 0.5,
      });
    }
  });

  it("accepts an array response payload", async () => {
    vi.mocked(fetch).mockResolvedValueOnce(
      makeGitHubAiCreditUsageResponse([
        githubAiCreditUsageRecordFixture,
        githubAiCreditUsageRecordPageFixture,
      ]),
    );

    const result = await fetchCopilotAiCreditUsage(usageConfig, TEST_TOKEN);

    expect(result.kind).toBe("success");
    if (result.kind === "success") {
      expect(result.usageRecords).toHaveLength(2);
      expect(result.usageRecords[0]).toMatchObject({
        timePeriod: "2026-05-07",
        user: "octocat",
      });
      expect(result.usageRecords[1]).toMatchObject({
        timePeriod: "2026-05-08",
        user: "hubot",
      });
    }
  });

  it("accepts wrapper response payloads", async () => {
    vi.mocked(fetch).mockResolvedValueOnce(
      new Response(
        JSON.stringify({ usageRecords: [githubAiCreditUsageRecordFixture] }),
        {
          status: 200,
          headers: { "Content-Type": "application/json" },
        },
      ),
    );

    const result = await fetchCopilotAiCreditUsage(usageConfig, TEST_TOKEN);

    expect(result.kind).toBe("success");
    if (result.kind === "success") {
      expect(result.usageRecords).toHaveLength(1);
      expect(result.usageRecords[0]).toMatchObject({
        timePeriod: "2026-05-07",
        organization: "my-org",
      });
    }
  });

  it("follows pagination when GitHub includes a next link", async () => {
    const page1 = makeGitHubAiCreditUsageResponse(githubAiCreditUsageRecordFixture, {
      headers: {
        Link:
          '<https://api.github.com/orgs/my-org/settings/billing/ai_credit/usage?year=2026&month=5&day=7&user=octocat&page=2&per_page=100>; rel="next"',
      },
    });
    const page2 = makeGitHubAiCreditUsageResponse(githubAiCreditUsageRecordPageFixture);

    vi.mocked(fetch)
      .mockResolvedValueOnce(page1)
      .mockResolvedValueOnce(page2);

    const result = await fetchCopilotAiCreditUsage(usageConfig, TEST_TOKEN);

    expect(fetch).toHaveBeenCalledTimes(2);
    expect(result.kind).toBe("success");
    if (result.kind === "success") {
      expect(result.usageRecords).toHaveLength(2);
      expect(result.usageRecords[0]).toMatchObject({
        timePeriod: "2026-05-07",
        user: "octocat",
        organization: "my-org",
      });
      expect(result.usageRecords[1]).toMatchObject({
        timePeriod: "2026-05-08",
        user: "hubot",
      });
    }
  });

  it("returns a typed auth failure outcome for 401 responses", async () => {
    vi.mocked(fetch).mockResolvedValueOnce(
      new Response(JSON.stringify({ message: "Bad credentials" }), {
        status: 401,
        statusText: "Unauthorized",
        headers: { "Content-Type": "application/json" },
      }),
    );

    const result = await fetchCopilotAiCreditUsage(usageConfig, TEST_TOKEN);

    expect(result.kind).toBe("partial_failure");
    if (result.kind === "partial_failure") {
      expect(result.usageRecords).toHaveLength(0);
      expect(result.failure.kind).toBe("auth_failure");
      expect(result.failure.statusCode).toBe(401);
    }
  });

  it("returns a typed rate-limit outcome for 429 responses", async () => {
    vi.mocked(fetch).mockResolvedValueOnce(
      new Response(JSON.stringify({ message: "rate limit exceeded" }), {
        status: 429,
        statusText: "Too Many Requests",
        headers: {
          "Content-Type": "application/json",
          "Retry-After": "60",
        },
      }),
    );

    const result = await fetchCopilotAiCreditUsage(usageConfig, TEST_TOKEN);

    expect(result.kind).toBe("partial_failure");
    if (result.kind === "partial_failure") {
      expect(result.failure.kind).toBe("rate_limited");
      expect(result.failure.retryAfterSeconds).toBe(60);
      expect(result.failure.statusCode).toBe(429);
    }
  });
});
