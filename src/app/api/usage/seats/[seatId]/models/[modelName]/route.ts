import { NextRequest, NextResponse } from "next/server";
import { CopilotSeatEntity } from "@/entities/copilot-seat.entity";
import { requireAuth, isAuthFailure } from "@/lib/api-auth";
import {
  handleRouteError,
  invalidIdResponse,
  parseEntityId,
} from "@/lib/api-helpers";
import { getDb } from "@/lib/db";
import { seatModelDailyUsageQuerySchema } from "@/lib/validations/seat";

type RouteContext = { params: Promise<{ seatId: string; modelName: string }> };

export const dynamic = "force-dynamic";

function decodeRouteModelName(modelName: string): string | null {
  const matches = modelName.match(/%[0-9A-Fa-f]{2}|%/g);
  if (!matches) {
    return modelName;
  }

  const hasValidEscapes = matches.some((match) => match.length === 3);
  const hasInvalidPercents = matches.some((match) => match === "%");

  if (hasValidEscapes && hasInvalidPercents) {
    return null;
  }

  if (!hasValidEscapes) {
    return modelName;
  }

  try {
    return decodeURIComponent(modelName);
  } catch {
    return null;
  }
}

export async function GET(request: NextRequest, context: RouteContext) {
  const auth = await requireAuth();
  if (isAuthFailure(auth)) return auth;

  const { seatId: seatIdParam, modelName: modelNameParam } = await context.params;
  const seatId = parseEntityId(seatIdParam);
  if (seatId === null) return invalidIdResponse("seat");

  const decodedModelName = decodeRouteModelName(modelNameParam);
  if (decodedModelName === null) {
    return NextResponse.json(
      {
        error: "Validation failed",
        details: { modelName: ["Invalid model name encoding"] },
      },
      { status: 400 },
    );
  }

  const { searchParams } = request.nextUrl;
  const rawParams: Record<string, string> = { modelName: decodedModelName };
  const monthParam = searchParams.get("month");
  const yearParam = searchParams.get("year");
  if (monthParam !== null) rawParams.month = monthParam;
  if (yearParam !== null) rawParams.year = yearParam;

  const parsed = seatModelDailyUsageQuerySchema.safeParse(rawParams);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Validation failed", details: parsed.error.flatten().fieldErrors },
      { status: 400 },
    );
  }

  const { modelName, month, year } = parsed.data;

  try {
    const dataSource = await getDb();
    const seatRepo = dataSource.getRepository(CopilotSeatEntity);

    const seat = await seatRepo.findOne({ where: { id: seatId } });
    if (!seat) {
      return NextResponse.json({ error: "Seat not found" }, { status: 404 });
    }

    const dailyRows: { day: number; totalRequests: string }[] = await dataSource.query(
      `SELECT
         cu."day",
         SUM((item->>'grossQuantity')::numeric) AS "totalRequests"
       FROM copilot_usage cu,
            jsonb_array_elements(cu."usageItems") AS item
       WHERE cu."seatId" = $1
         AND cu."month" = $2
         AND cu."year" = $3
         AND item->>'model' = $4
       GROUP BY cu."day"
       ORDER BY cu."day" ASC`,
      [seatId, month, year, modelName],
    );

    const dailyUsage = dailyRows.map((row) => ({
      day: Number(row.day),
      totalRequests: Number(row.totalRequests),
    }));

    return NextResponse.json({
      seat: {
        seatId: seat.id,
        githubUsername: seat.githubUsername,
        firstName: seat.firstName,
        lastName: seat.lastName,
      },
      model: modelName,
      month,
      year,
      dailyUsage,
    });
  } catch (error) {
    return handleRouteError(
      error,
      "GET /api/usage/seats/[seatId]/models/[modelName]",
    );
  }
}
