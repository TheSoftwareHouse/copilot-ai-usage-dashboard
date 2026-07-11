import type { MemberEntry } from "@/lib/types";

/**
 * Get CSS classes and label for colour-coded usage indicator.
 *
 * Thresholds:
 * - ≥90% → green (High usage)
 * - 50–89% → orange (Moderate usage)
 * - <50% → red (Low usage)
 */
export function getUsageColour(percent: number): {
  bgClass: string;
  label: string;
} {
  if (percent >= 90) {
    return { bgClass: "bg-green-500", label: "High usage" };
  }
  if (percent >= 50) {
    return { bgClass: "bg-orange-500", label: "Moderate usage" };
  }
  return { bgClass: "bg-red-500", label: "Low usage" };
}

/**
 * Check whether a member matches a search query.
 *
 * Matches case-insensitively against `githubUsername`, `firstName`, and
 * `lastName`. `null` values for `firstName` / `lastName` are treated as
 * non-matching.
 */
export function memberMatchesSearch(
  member: MemberEntry,
  query: string,
): boolean {
  const lowerQuery = query.toLowerCase();
  return (
    member.githubUsername.toLowerCase().includes(lowerQuery) ||
    (member.firstName?.toLowerCase().includes(lowerQuery) ?? false) ||
    (member.lastName?.toLowerCase().includes(lowerQuery) ?? false)
  );
}

