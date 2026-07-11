import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { requireAuth, isAuthFailure } from "@/lib/api-auth";
import { handleRouteError, escapeLikePattern } from "@/lib/api-helpers";
import { calculateNorm, calculateSeatDeviation } from "@/lib/norm-calculation";
import type { NormResult } from "@/lib/norm-calculation";
import { calculateUsageCostMetrics } from "@/lib/usage-cost-metrics";

const DEFAULT_PAGE = 1;
const DEFAULT_PAGE_SIZE = 20;
const MAX_PAGE_SIZE = 100;

const SORTABLE_FIELDS = new Set([
  "githubUsername",
  "totalRequests",
  "totalGrossAmount",
  "department",
]);

const SORT_COLUMN_MAP: Record<string, string> = {
  githubUsername: 'cs."githubUsername"',
  totalRequests: 'st."totalRequests"',
  totalGrossAmount: 'st."totalGrossAmount"',
  department: 'cs."department"',
};

export const dynamic = "force-dynamic";

interface SeatRow {
  seatId: number;
  githubUsername: string;
  firstName: string | null;
  lastName: string | null;
  department: string | null;
  totalRequests: string;
  totalGrossAmount: string;
  totalNetAmount: string;
  models: string;
}

async function enrichSeatsWithDeviation(
  dataSource: import("typeorm").DataSource,
  seats: SeatRow[],
  month: number,
  year: number,
  norm: NormResult,
) {
  const seatIds = seats.map((r) => r.seatId);

  const peakRows: { seatId: number; peakDay: number; peakDailyRequests: string }[] =
    seatIds.length > 0
      ? await dataSource.query(
          `SELECT DISTINCT ON (sub."seatId")
             sub."seatId",
             sub."day" AS "peakDay",
             sub."totalRequests" AS "peakDailyRequests"
           FROM (
             SELECT cu."seatId", cu."day",
                    SUM((item->>'grossQuantity')::numeric) AS "totalRequests"
             FROM copilot_usage cu,
                  jsonb_array_elements(cu."usageItems") AS item
             WHERE cu."month" = $1 AND cu."year" = $2
               AND cu."seatId" = ANY($3)
             GROUP BY cu."seatId", cu."day"
           ) sub
           ORDER BY sub."seatId", sub."totalRequests" DESC`,
          [month, year, seatIds],
        )
      : [];

  const peakMap = new Map<number, { peakDay: number; peakDailyRequests: number }>();
  for (const row of peakRows) {
    peakMap.set(row.seatId, {
      peakDay: row.peakDay,
      peakDailyRequests: Number(row.peakDailyRequests),
    });
  }

  return seats.map((row) => {
    const peak = peakMap.get(row.seatId);
    const deviation = calculateSeatDeviation(
      peak?.peakDailyRequests ?? null,
      peak?.peakDay ?? null,
      norm.normValue,
      norm.warningThreshold,
      norm.alertThreshold,
    );

    return {
      seatId: row.seatId,
      githubUsername: row.githubUsername,
      firstName: row.firstName,
      lastName: row.lastName,
      department: row.department,
      totalRequests: Number(row.totalRequests),
      totalGrossAmount: Number(row.totalGrossAmount),
      totalNetAmount: Number(row.totalNetAmount),
      models: (JSON.parse(row.models) as { model: string; requests: number; grossAmount: number; netAmount: number }[]).map((m) => ({
        model: m.model,
        requests: Number(m.requests),
        grossAmount: Number(m.grossAmount),
        netAmount: Number(m.netAmount),
      })),
      deviationLevel: deviation.deviationLevel,
      normValue: norm.normValue,
      peakMultiplier: deviation.peakMultiplier,
      peakDay: deviation.peakDay,
    };
  });
}

export async function GET(request: NextRequest) {
  const auth = await requireAuth();
  if (isAuthFailure(auth)) return auth;

  try {
    const { searchParams } = request.nextUrl;

    const now = new Date();
    const defaultMonth = now.getUTCMonth() + 1;
    const defaultYear = now.getUTCFullYear();

    let month = parseInt(searchParams.get("month") ?? "", 10);
    if (isNaN(month) || month < 1 || month > 12) month = defaultMonth;

    let year = parseInt(searchParams.get("year") ?? "", 10);
    if (isNaN(year) || year < 2020) year = defaultYear;

    let page = parseInt(searchParams.get("page") ?? "", 10);
    if (isNaN(page) || page < 1) page = DEFAULT_PAGE;

    let pageSize = parseInt(searchParams.get("pageSize") ?? "", 10);
    if (isNaN(pageSize) || pageSize < 1) pageSize = DEFAULT_PAGE_SIZE;
    if (pageSize > MAX_PAGE_SIZE) pageSize = MAX_PAGE_SIZE;

    const searchParam = (searchParams.get("search") ?? "").trim();

    const sortByParam = searchParams.get("sortBy") ?? "";
    const sortBy = SORTABLE_FIELDS.has(sortByParam) ? sortByParam : "totalRequests";

    const sortOrderParam = (searchParams.get("sortOrder") ?? "").toLowerCase();
    const sortOrder: "asc" | "desc" =
      sortOrderParam === "asc" ? "asc" : "desc";

    const orderByClause = `${SORT_COLUMN_MAP[sortBy]} ${sortOrder === "asc" ? "ASC" : "DESC"}`;

    const dataSource = await getDb();
    const norm = await calculateNorm(month, year);

    const monthlyGrossQuantityRows: { day: number; grossQuantity: string }[] =
      await dataSource.query(
        `SELECT
           cu."day",
           COALESCE(SUM((item->>'grossQuantity')::numeric), 0) AS "grossQuantity"
         FROM copilot_usage cu,
              jsonb_array_elements(cu."usageItems") AS item
         WHERE cu."month" = $1 AND cu."year" = $2
         GROUP BY cu."day"
         ORDER BY cu."day" ASC`,
        [month, year],
      );

    const dailyGrossQuantity = monthlyGrossQuantityRows.map((row) => ({
      day: row.day,
      grossQuantity: Number(row.grossQuantity),
    }));

    const costStats = calculateUsageCostMetrics({
      month,
      year,
      dailyGrossQuantity,
    });

    // Build optional search filter
    if (searchParam) {
      const escaped = escapeLikePattern(searchParam);
      const likePattern = `%${escaped}%`;

      const searchJoin = `
       JOIN copilot_seat cs_filter ON cs_filter.id = cu."seatId"`;
      const searchWhere = `
         AND (cs_filter."githubUsername" ILIKE $3
              OR cs_filter."firstName" ILIKE $3
              OR cs_filter."lastName" ILIKE $3)`;

      // Count query with search filter
      const countResult: { count: string }[] = await dataSource.query(
        `SELECT COUNT(DISTINCT cu."seatId") AS "count"
         FROM copilot_usage cu${searchJoin}
         WHERE cu."month" = $1 AND cu."year" = $2${searchWhere}`,
        [month, year, likePattern],
      );

      const total = parseInt(countResult[0]?.count ?? "0", 10);
      const totalPages = Math.max(1, Math.ceil(total / pageSize));
      const offset = (page - 1) * pageSize;

      if (total === 0) {
        return NextResponse.json({
          seats: [],
          total: 0,
          page,
          pageSize,
          totalPages: 1,
          month,
          year,
          costStats,
        });
      }

      // Main query with search filter
      const rows: SeatRow[] = await dataSource.query(
        `WITH seat_models AS (
           SELECT
             cu."seatId",
             item->>'model' AS model,
             SUM((item->>'grossQuantity')::numeric) AS requests,
             SUM((item->>'grossAmount')::numeric) AS "grossAmount",
             SUM((item->>'netAmount')::numeric) AS "netAmount"
           FROM copilot_usage cu${searchJoin},
                jsonb_array_elements(cu."usageItems") AS item
           WHERE cu."month" = $1 AND cu."year" = $2${searchWhere}
           GROUP BY cu."seatId", item->>'model'
         ),
         seat_totals AS (
           SELECT
             sm."seatId",
             SUM(sm.requests) AS "totalRequests",
             SUM(sm."grossAmount") AS "totalGrossAmount",
             SUM(sm."netAmount") AS "totalNetAmount",
             jsonb_agg(
               jsonb_build_object(
                 'model', sm.model,
                 'requests', sm.requests,
                 'grossAmount', sm."grossAmount",
                 'netAmount', sm."netAmount"
               ) ORDER BY sm.requests DESC
             ) AS models
           FROM seat_models sm
           GROUP BY sm."seatId"
         )
         SELECT
           st."seatId",
           cs."githubUsername",
           cs."firstName",
           cs."lastName",
           cs."department",
           st."totalRequests",
           st."totalGrossAmount",
           st."totalNetAmount",
           st.models::text AS models
         FROM seat_totals st
         JOIN copilot_seat cs ON cs.id = st."seatId"
         ORDER BY ${orderByClause}
         LIMIT $4 OFFSET $5`,
        [month, year, likePattern, pageSize, offset],
      );

      const seats = await enrichSeatsWithDeviation(dataSource, rows, month, year, norm);

      return NextResponse.json({
        seats,
        total,
        page,
        pageSize,
        totalPages,
        month,
        year,
        costStats,
      });
    }

    // No search — existing logic unchanged

    // Count distinct seats with usage for this month/year
    const countResult: { count: string }[] = await dataSource.query(
      `SELECT COUNT(DISTINCT cu."seatId") AS "count"
       FROM copilot_usage cu
       WHERE cu."month" = $1 AND cu."year" = $2`,
      [month, year],
    );

    const total = parseInt(countResult[0]?.count ?? "0", 10);
    const totalPages = Math.max(1, Math.ceil(total / pageSize));
    const offset = (page - 1) * pageSize;

    if (total === 0) {
      return NextResponse.json({
        seats: [],
        total: 0,
        page,
        pageSize,
        totalPages: 1,
        month,
        year,
        costStats,
      });
    }

    // Aggregate per-seat per-model usage, then roll up to per-seat totals
    const rows: SeatRow[] = await dataSource.query(
      `WITH seat_models AS (
         SELECT
           cu."seatId",
           item->>'model' AS model,
           SUM((item->>'grossQuantity')::numeric) AS requests,
           SUM((item->>'grossAmount')::numeric) AS "grossAmount",
           SUM((item->>'netAmount')::numeric) AS "netAmount"
         FROM copilot_usage cu,
              jsonb_array_elements(cu."usageItems") AS item
         WHERE cu."month" = $1 AND cu."year" = $2
         GROUP BY cu."seatId", item->>'model'
       ),
       seat_totals AS (
         SELECT
           sm."seatId",
           SUM(sm.requests) AS "totalRequests",
           SUM(sm."grossAmount") AS "totalGrossAmount",
           SUM(sm."netAmount") AS "totalNetAmount",
           jsonb_agg(
             jsonb_build_object(
               'model', sm.model,
               'requests', sm.requests,
               'grossAmount', sm."grossAmount",
               'netAmount', sm."netAmount"
             ) ORDER BY sm.requests DESC
           ) AS models
         FROM seat_models sm
         GROUP BY sm."seatId"
       )
       SELECT
         st."seatId",
         cs."githubUsername",
         cs."firstName",
         cs."lastName",
         cs."department",
         st."totalRequests",
         st."totalGrossAmount",
         st."totalNetAmount",
         st.models::text AS models
       FROM seat_totals st
       JOIN copilot_seat cs ON cs.id = st."seatId"
       ORDER BY ${orderByClause}
       LIMIT $3 OFFSET $4`,
      [month, year, pageSize, offset],
    );

    const seats = await enrichSeatsWithDeviation(dataSource, rows, month, year, norm);

    return NextResponse.json({
      seats,
      total,
      page,
      pageSize,
      totalPages,
      month,
      year,
      costStats,
    });
  } catch (error) {
    return handleRouteError(error, "GET /api/usage/seats");
  }
}
