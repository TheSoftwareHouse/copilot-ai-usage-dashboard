import type { UsageItem } from "@/entities/copilot-usage.entity";
import { ApiMode } from "@/entities/enums";

export interface GitHubSeatAssignee {
  login: string;
  id: number;
  avatar_url: string;
  type: string;
}

export interface GitHubSeatAssignment {
  created_at: string;
  updated_at: string;
  pending_cancellation_date: string | null;
  last_activity_at: string | null;
  last_activity_editor: string | null;
  plan_type: string;
  assignee: GitHubSeatAssignee;
}

export interface GitHubSeatsResponse {
  total_seats: number;
  seats: GitHubSeatAssignment[];
}

export interface GitHubAiCreditUsageRecord {
  timePeriod: string;
  user: string;
  organization: string;
  usageItems: UsageItem[];
}

export interface GitHubAiCreditUsageRequest {
  apiMode: ApiMode;
  entityName: string;
  year: number;
  month: number;
  day: number;
  user: string;
}

export interface GitHubAiCreditUsageFailure {
  kind: "auth_failure" | "rate_limited" | "http_error";
  statusCode: number;
  message: string;
  responseBody: string;
  retryAfterSeconds?: number;
}

export interface GitHubAiCreditUsageSuccess {
  kind: "success";
  usageRecords: GitHubAiCreditUsageRecord[];
}

export interface GitHubAiCreditUsagePartialFailure {
  kind: "partial_failure";
  usageRecords: GitHubAiCreditUsageRecord[];
  failure: GitHubAiCreditUsageFailure;
}

export type GitHubAiCreditUsageResult =
  | GitHubAiCreditUsageSuccess
  | GitHubAiCreditUsagePartialFailure;

export class GitHubApiError extends Error {
  constructor(
    message: string,
    public readonly statusCode: number,
    public readonly responseBody: string
  ) {
    super(message);
    this.name = "GitHubApiError";
  }
}

const GITHUB_API_BASE = "https://api.github.com";
const PER_PAGE = 100;
const RATE_LIMIT_WARNING_THRESHOLD = 100;

function logRateLimitInfo(response: Response, url: string): void {
  const remaining = response.headers.get("x-ratelimit-remaining");
  const reset = response.headers.get("x-ratelimit-reset");

  if (remaining === null && reset === null) {
    return;
  }

  const remainingNum = remaining !== null ? Number(remaining) : null;
  const resetDate =
    reset !== null && !Number.isNaN(Number(reset))
      ? new Date(Number(reset) * 1000).toISOString()
      : null;

  const endpoint = url.replace(GITHUB_API_BASE, "");

  const remainingDisplay =
    remainingNum !== null && !Number.isNaN(remainingNum)
      ? remainingNum
      : "unknown";

  console.log(
    `GitHub API rate limit: ${remainingDisplay} requests remaining, ` +
      `resets at ${resetDate ?? "unknown"} [${endpoint}]`,
  );

  if (
    remainingNum !== null &&
    !Number.isNaN(remainingNum) &&
    remainingNum < RATE_LIMIT_WARNING_THRESHOLD
  ) {
    console.warn(
      `GitHub API rate limit LOW: only ${remainingNum} requests remaining, ` +
        `resets at ${resetDate ?? "unknown"} [${endpoint}]`,
    );
  }
}

function buildSeatsUrl(apiMode: ApiMode, entityName: string): string {
  if (apiMode === ApiMode.ORGANISATION) {
    return `${GITHUB_API_BASE}/orgs/${encodeURIComponent(entityName)}/copilot/billing/seats`;
  }
  return `${GITHUB_API_BASE}/enterprises/${encodeURIComponent(entityName)}/copilot/billing/seats`;
}

function buildAiCreditUsageUrl(
  config: GitHubAiCreditUsageRequest,
  page: number,
): string {
  const baseUrl =
    config.apiMode === ApiMode.ORGANISATION
      ? `${GITHUB_API_BASE}/orgs/${encodeURIComponent(config.entityName)}/settings/billing/ai_credit/usage`
      : `${GITHUB_API_BASE}/enterprises/${encodeURIComponent(config.entityName)}/settings/billing/ai_credit/usage`;

  const url = new URL(baseUrl);
  url.searchParams.set("year", String(config.year));
  url.searchParams.set("month", String(config.month));
  url.searchParams.set("day", String(config.day));
  url.searchParams.set("user", config.user);
  url.searchParams.set("page", String(page));
  url.searchParams.set("per_page", String(PER_PAGE));
  return url.toString();
}

function checkAnyUsageItem(value: unknown): boolean {
  if (value === null || typeof value !== "object") return false;
  const item = value as Record<string, unknown>;
  return (
    typeof item.product === "string" &&
    typeof item.sku === "string" &&
    typeof item.model === "string" &&
    typeof (item.unitType ?? item.unit_type) === "string" &&
    typeof (item.pricePerUnit ?? item.price_per_unit) === "number" &&
    typeof (item.grossQuantity ?? item.gross_quantity) === "number" &&
    typeof (item.grossAmount ?? item.gross_amount) === "number" &&
    typeof (item.discountQuantity ?? item.discount_quantity) === "number" &&
    typeof (item.discountAmount ?? item.discount_amount) === "number" &&
    typeof (item.netQuantity ?? item.net_quantity) === "number" &&
    typeof (item.netAmount ?? item.net_amount) === "number"
  );
}

function mapUsageItem(item: Record<string, unknown>): UsageItem {
  return {
    product: item.product as string,
    sku: item.sku as string,
    model: item.model as string,
    unitType: (item.unitType ?? item.unit_type) as string,
    pricePerUnit: (item.pricePerUnit ?? item.price_per_unit) as number,
    grossQuantity: (item.grossQuantity ?? item.gross_quantity) as number,
    grossAmount: (item.grossAmount ?? item.gross_amount) as number,
    discountQuantity: (item.discountQuantity ?? item.discount_quantity) as number,
    discountAmount: (item.discountAmount ?? item.discount_amount) as number,
    netQuantity: (item.netQuantity ?? item.net_quantity) as number,
    netAmount: (item.netAmount ?? item.net_amount) as number,
  };
}

type TimePeriodObject = { year: number; month: number; day: number };

function isTimePeriodObject(value: unknown): value is TimePeriodObject {
  if (value === null || typeof value !== "object") {
    return false;
  }

  const candidate = value as Record<string, unknown>;
  return (
    typeof candidate.year === "number" &&
    typeof candidate.month === "number" &&
    typeof candidate.day === "number"
  );
}

function checkGitHubAiCreditUsageRecordRaw(value: unknown): boolean {
  if (value === null || typeof value !== "object") return false;
  const record = value as Record<string, unknown>;
  const items = record.usageItems ?? record.usage_items;
  const tp = record.timePeriod ?? record.time_period;
  const isTpString = typeof tp === "string";
  const isTpObject = isTimePeriodObject(tp);

  return (
    (isTpString || isTpObject) &&
    typeof record.user === "string" &&
    (typeof record.organization === "string" || record.organization === undefined || record.organization === null) &&
    Array.isArray(items) &&
    items.every(checkAnyUsageItem)
  );
}

function mapGitHubAiCreditUsageRecord(value: unknown): GitHubAiCreditUsageRecord {
  const record = value as Record<string, unknown>;
  const items = (record.usageItems ?? record.usage_items) as Record<string, unknown>[];
  
  let timePeriodStr: string;
  const tp = record.timePeriod ?? record.time_period;
  if (typeof tp === "string") {
    timePeriodStr = tp;
  } else {
    const tpObj = tp as TimePeriodObject;
    timePeriodStr = `${tpObj.year}-${String(tpObj.month).padStart(2, "0")}-${String(tpObj.day).padStart(2, "0")}`;
  }

  return {
    timePeriod: timePeriodStr,
    user: record.user as string,
    organization: (record.organization as string) || "",
    usageItems: items.map(mapUsageItem),
  };
}

function extractGitHubAiCreditUsageRecords(
  payload: unknown,
): GitHubAiCreditUsageRecord[] {
  if (checkGitHubAiCreditUsageRecordRaw(payload)) {
    return [mapGitHubAiCreditUsageRecord(payload)];
  }

  if (Array.isArray(payload) && payload.every(checkGitHubAiCreditUsageRecordRaw)) {
    return payload.map(mapGitHubAiCreditUsageRecord);
  }

  if (payload !== null && typeof payload === "object") {
    const candidate =
      (payload as { usageRecords?: unknown }).usageRecords ??
      (payload as { usage_records?: unknown }).usage_records ??
      (payload as { items?: unknown }).items;

    if (Array.isArray(candidate) && candidate.every(checkGitHubAiCreditUsageRecordRaw)) {
      return candidate.map(mapGitHubAiCreditUsageRecord);
    }
  }

  throw new Error("Unexpected GitHub AI credit usage response shape");
}

function parseNextPage(linkHeader: string | null): number | null {
  if (linkHeader === null) {
    return null;
  }

  const nextLink = linkHeader
    .split(",")
    .map((part) => part.trim())
    .find((part) => part.includes('rel="next"'));

  if (nextLink === undefined) {
    return null;
  }

  const match = nextLink.match(/[?&]page=(\d+)/);
  return match !== null ? Number(match[1]) : null;
}

function buildAiCreditUsageFailure(
  response: Response,
  responseBody: string,
): GitHubAiCreditUsageFailure {
  const remaining = response.headers.get("x-ratelimit-remaining");
  const retryAfter = response.headers.get("retry-after");
  const isRateLimited =
    response.status === 429 ||
    (response.status === 403 && (remaining === "0" || /rate limit/i.test(responseBody)));

  if (isRateLimited) {
    return {
      kind: "rate_limited",
      statusCode: response.status,
      message: `GitHub API rate limit exceeded (${response.status})`,
      responseBody,
      retryAfterSeconds:
        retryAfter !== null && /^\d+$/.test(retryAfter) ? Number(retryAfter) : undefined,
    };
  }

  if (response.status === 401 || response.status === 403) {
    return {
      kind: "auth_failure",
      statusCode: response.status,
      message: `GitHub API authentication failed (${response.status})`,
      responseBody,
    };
  }

  return {
    kind: "http_error",
    statusCode: response.status,
    message: `GitHub API returned ${response.status}: ${response.statusText}`,
    responseBody,
  };
}

export async function fetchCopilotAiCreditUsage(
  config: GitHubAiCreditUsageRequest,
  token: string,
): Promise<GitHubAiCreditUsageResult> {
  const usageRecords: GitHubAiCreditUsageRecord[] = [];
  let page = 1;

  while (true) {
    const url = buildAiCreditUsageUrl(config, page);
    const response = await fetch(url, {
      headers: {
        Accept: "application/vnd.github+json",
        Authorization: `Bearer ${token}`,
        "X-GitHub-Api-Version": "2022-11-28",
      },
    });

    logRateLimitInfo(response, url);

    if (!response.ok) {
      const responseBody = await response.text();
      return {
        kind: "partial_failure",
        usageRecords,
        failure: buildAiCreditUsageFailure(response, responseBody),
      };
    }

    if (response.status === 204) {
      return { kind: "success", usageRecords };
    }

    const payload: unknown = await response.json();
    usageRecords.push(...extractGitHubAiCreditUsageRecords(payload));

    const nextPage = parseNextPage(response.headers.get("link"));
    if (nextPage === null) {
      return { kind: "success", usageRecords };
    }

    page = nextPage;
  }
}

export async function fetchAllCopilotSeats(
  config: { apiMode: ApiMode; entityName: string },
  token: string,
): Promise<GitHubSeatAssignment[]> {
  const baseUrl = buildSeatsUrl(config.apiMode, config.entityName);
  const allSeats: GitHubSeatAssignment[] = [];
  let page = 1;

  while (true) {
    const url = `${baseUrl}?page=${page}&per_page=${PER_PAGE}`;

    const response = await fetch(url, {
      headers: {
        Accept: "application/vnd.github+json",
        Authorization: `Bearer ${token}`,
        "X-GitHub-Api-Version": "2022-11-28",
      },
    });

    logRateLimitInfo(response, url);

    if (!response.ok) {
      const body = await response.text();
      throw new GitHubApiError(
        `GitHub API returned ${response.status}: ${response.statusText}`,
        response.status,
        body
      );
    }

    const data: GitHubSeatsResponse = await response.json();
    allSeats.push(...data.seats);

    if (data.seats.length < PER_PAGE) {
      break;
    }

    page++;
  }

  return allSeats;
}
