import type { GitHubAiCreditUsageRecord } from "@/lib/github-api";

export const githubAiCreditUsageRecordFixture: GitHubAiCreditUsageRecord = {
  timePeriod: "2026-05-07",
  user: "octocat",
  organization: "my-org",
  usageItems: [
    {
      product: "Copilot",
      sku: "Premium",
      model: "GPT-4o",
      unitType: "requests",
      pricePerUnit: 0.04,
      grossQuantity: 12,
      grossAmount: 0.48,
      discountQuantity: 2,
      discountAmount: 0.08,
      netQuantity: 10,
      netAmount: 0.4,
    },
    {
      product: "Copilot",
      sku: "Premium",
      model: "Claude Sonnet 4.5",
      unitType: "requests",
      pricePerUnit: 0.05,
      grossQuantity: 3,
      grossAmount: 0.15,
      discountQuantity: 1,
      discountAmount: 0.05,
      netQuantity: 2,
      netAmount: 0.1,
    },
  ],
};

export const githubAiCreditUsageRecordPageFixture: GitHubAiCreditUsageRecord = {
  timePeriod: "2026-05-08",
  user: "hubot",
  organization: "my-org",
  usageItems: [
    {
      product: "Copilot",
      sku: "Premium",
      model: "GPT-4o Mini",
      unitType: "requests",
      pricePerUnit: 0.02,
      grossQuantity: 8,
      grossAmount: 0.16,
      discountQuantity: 0,
      discountAmount: 0,
      netQuantity: 8,
      netAmount: 0.16,
    },
  ],
};

export function makeGitHubAiCreditUsageResponse(
  rows: GitHubAiCreditUsageRecord[] | GitHubAiCreditUsageRecord = githubAiCreditUsageRecordFixture,
  init?: ResponseInit,
): Response {
  return new Response(JSON.stringify(rows), {
    status: init?.status ?? 200,
    statusText: init?.statusText,
    headers: {
      "Content-Type": "application/json",
      ...(init?.headers ?? {}),
    },
  });
}