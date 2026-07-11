import { NextRequest, NextResponse } from "next/server";
import { ILike } from "typeorm";
import { getDb } from "@/lib/db";
import { CopilotSeatEntity } from "@/entities/copilot-seat.entity";
import { SeatStatus } from "@/entities/enums";
import { requireAdmin, isAuthFailure } from "@/lib/api-auth";
import { calculateNorm, calculateSeatDeviation } from "@/lib/norm-calculation";
import { handleRouteError, escapeLikePattern } from "@/lib/api-helpers";
import type { FindOptionsWhere, FindOptionsOrder } from "typeorm";
import type { CopilotSeat } from "@/entities/copilot-seat.entity";

const DEFAULT_PAGE = 1;
const DEFAULT_PAGE_SIZE = 100;
const MAX_PAGE_SIZE = 300;

const VALID_STATUSES = new Set<string>([SeatStatus.ACTIVE, SeatStatus.INACTIVE]);

const SORTABLE_FIELDS = new Set([
  "githubUsername",
  "firstName",
  "lastName",
  "department",
  "lastActivityAt",
  "status",
]);

export async function GET(request: NextRequest) {
  const auth = await requireAdmin();
  if (isAuthFailure(auth)) return auth;

  try {
    const { searchParams } = request.nextUrl;

    let page = parseInt(searchParams.get("page") ?? "", 10);
    if (isNaN(page) || page < 1) page = DEFAULT_PAGE;

    let pageSize = parseInt(searchParams.get("pageSize") ?? "", 10);
    if (isNaN(pageSize) || pageSize < 1) pageSize = DEFAULT_PAGE_SIZE;
    if (pageSize > MAX_PAGE_SIZE) pageSize = MAX_PAGE_SIZE;

    const statusParam = searchParams.get("status");
    const statusFilter =
      statusParam && VALID_STATUSES.has(statusParam)
        ? (statusParam as SeatStatus)
        : undefined;

    const searchParam = (searchParams.get("search") ?? "").trim();

    const sortByParam = searchParams.get("sortBy") ?? "";
    const sortBy = SORTABLE_FIELDS.has(sortByParam)
      ? (sortByParam as keyof CopilotSeat)
      : "githubUsername";

    const sortOrderParam = (searchParams.get("sortOrder") ?? "").toLowerCase();
    const sortOrder: "ASC" | "DESC" =
      sortOrderParam === "desc" ? "DESC" : "ASC";

    // Build where clause
    let where: FindOptionsWhere<CopilotSeat> | FindOptionsWhere<CopilotSeat>[];

    if (searchParam) {
      const escaped = escapeLikePattern(searchParam);
      const likePattern = `%${escaped}%`;

      const searchFields: (keyof CopilotSeat)[] = [
        "githubUsername",
        "firstName",
        "lastName",
        "department",
      ];

      where = searchFields.map((field) => {
        const condition: FindOptionsWhere<CopilotSeat> = {
          [field]: ILike(likePattern),
        };
        if (statusFilter) {
          condition.status = statusFilter;
        }
        return condition;
      });
    } else {
      where = {};
      if (statusFilter) {
        where.status = statusFilter;
      }
    }

    const order: FindOptionsOrder<CopilotSeat> = {
      [sortBy]: sortOrder,
    };

    const now = new Date();
    const currentMonth = now.getUTCMonth() + 1;
    const currentYear = now.getUTCFullYear();

    const dataSource = await getDb();
    const seatRepo = dataSource.getRepository(CopilotSeatEntity);
    const norm = await calculateNorm(currentMonth, currentYear);

    const [seats, total] = await seatRepo.findAndCount({
      where,
      order,
      skip: (page - 1) * pageSize,
      take: pageSize,
    });

    const totalPages = Math.max(1, Math.ceil(total / pageSize));

    // Aggregate current-month AIC totals for the returned seats
    const seatIds = seats.map((s) => s.id);
    let usageMap = new Map<number, number>();
    let peakMap = new Map<number, { peakDay: number; peakDailyRequests: number }>();

    if (seatIds.length > 0) {
      const usageRows: { seatId: number; totalRequests: string }[] =
        await dataSource.query(
          `SELECT
             cu."seatId",
             COALESCE(SUM((item->>'grossQuantity')::numeric), 0) AS "totalRequests"
           FROM copilot_usage cu,
                jsonb_array_elements(cu."usageItems") AS item
           WHERE cu.month = $1 AND cu.year = $2
             AND cu."seatId" = ANY($3)
           GROUP BY cu."seatId"`,
          [currentMonth, currentYear, seatIds],
        );

      usageMap = new Map(
        usageRows.map((r) => [r.seatId, Number(r.totalRequests)]),
      );

      const peakRows: { seatId: number; peakDay: number; peakDailyRequests: string }[] =
        await dataSource.query(
          `SELECT DISTINCT ON (sub."seatId")
             sub."seatId",
             sub."day" AS "peakDay",
             sub."totalRequests" AS "peakDailyRequests"
           FROM (
             SELECT cu."seatId", cu."day",
                    SUM((item->>'grossQuantity')::numeric) AS "totalRequests"
             FROM copilot_usage cu,
                  jsonb_array_elements(cu."usageItems") AS item
             WHERE cu.month = $1 AND cu.year = $2
               AND cu."seatId" = ANY($3)
             GROUP BY cu."seatId", cu."day"
           ) sub
           ORDER BY sub."seatId", sub."totalRequests" DESC`,
          [currentMonth, currentYear, seatIds],
        );

      peakMap = new Map(
        peakRows.map((row) => [
          row.seatId,
          {
            peakDay: row.peakDay,
            peakDailyRequests: Number(row.peakDailyRequests),
          },
        ]),
      );
    }

    return NextResponse.json({
      seats: seats.map((s) => {
        const peak = peakMap.get(s.id);
        const deviation = calculateSeatDeviation(
          peak?.peakDailyRequests ?? null,
          peak?.peakDay ?? null,
          norm.normValue,
          norm.warningThreshold,
          norm.alertThreshold,
        );

        return {
          id: s.id,
          githubUsername: s.githubUsername,
          status: s.status,
          firstName: s.firstName,
          lastName: s.lastName,
          department: s.department,
          departmentId: s.departmentId,
          lastActivityAt: s.lastActivityAt,
          createdAt: s.createdAt,
          totalAiCredits: usageMap.get(s.id) ?? 0,
          deviationLevel: deviation.deviationLevel,
          peakMultiplier: deviation.peakMultiplier,
          peakDay: deviation.peakDay,
          normValue: norm.normValue,
        };
      }),
      total,
      page,
      pageSize,
      totalPages,
    });
  } catch (error) {
    return handleRouteError(error, "GET /api/seats");
  }
}
