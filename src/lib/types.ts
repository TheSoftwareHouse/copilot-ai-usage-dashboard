/**
 * Shared TypeScript interfaces used across multiple components.
 */

/** A month/year pair returned by the available-months endpoint. */
export interface AvailableMonth {
  month: number;
  year: number;
}

/** A team/department member entry used in detail panels. */
export interface MemberEntry {
  seatId: number;
  githubUsername: string;
  firstName: string | null;
  lastName: string | null;
  totalRequests: number;
  allocatedRequests?: number;
  totalGrossAmount: number;
  allocationPercentage?: number;
}
