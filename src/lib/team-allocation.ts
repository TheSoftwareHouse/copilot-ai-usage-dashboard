import type { DataSource } from "typeorm";

export const DEFAULT_ALLOCATION_PERCENTAGE = 100;

export interface AllocationWarning {
  seatId: number;
  totalAllocationPercentage: number;
}

export function normalizeAllocationPercentage(
  allocationPercentage?: number | null,
): number {
  return allocationPercentage ?? DEFAULT_ALLOCATION_PERCENTAGE;
}

export function calculateAllocatedValue(
  value: number,
  allocationPercentage: number,
): number {
  return (value * allocationPercentage) / 100;
}

export function calculateAllocatedRequests(
  totalRequests: number,
  allocationPercentage: number,
): number {
  return calculateAllocatedValue(totalRequests, allocationPercentage);
}

export function calculateAllocatedGrossAmount(
  grossAmount: number,
  allocationPercentage: number,
): number {
  return calculateAllocatedValue(grossAmount, allocationPercentage);
}

export async function getAllocationWarningsForSeats(
  dataSource: DataSource,
  seatIds: number[],
  month: number,
  year: number,
): Promise<AllocationWarning[]> {
  if (seatIds.length === 0) {
    return [];
  }

  const rows: { seatId: number; totalAllocationPercentage: string }[] =
    await dataSource.query(
      `SELECT
         tms."seatId" AS "seatId",
         SUM(tms."allocationPercentage")::text AS "totalAllocationPercentage"
       FROM team_member_snapshot tms
       WHERE tms."seatId" = ANY($1)
         AND tms.month = $2
         AND tms.year = $3
       GROUP BY tms."seatId"
       HAVING SUM(tms."allocationPercentage") > 100
       ORDER BY tms."seatId" ASC`,
      [seatIds, month, year],
    );

  return rows.map((row) => ({
    seatId: Number(row.seatId),
    totalAllocationPercentage: Number(row.totalAllocationPercentage),
  }));
}

export async function getAllocationWarningForSeat(
  dataSource: DataSource,
  seatId: number,
  month: number,
  year: number,
): Promise<AllocationWarning | null> {
  const warnings = await getAllocationWarningsForSeats(
    dataSource,
    [seatId],
    month,
    year,
  );

  return warnings[0] ?? null;
}