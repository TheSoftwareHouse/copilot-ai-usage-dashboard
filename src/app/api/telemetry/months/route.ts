import { NextResponse } from "next/server";
import { requireAuth, isAuthFailure } from "@/lib/api-auth";
import { handleRouteError } from "@/lib/api-helpers";
import { getDb } from "@/lib/db";

export const dynamic = "force-dynamic";

export async function GET() {
  const auth = await requireAuth();
  if (isAuthFailure(auth)) return auth;

  try {
    const dataSource = await getDb();

    const months: { month: number; year: number }[] = await dataSource.query(
      `SELECT DISTINCT
         EXTRACT(MONTH FROM "timestamp" AT TIME ZONE 'UTC')::int AS month,
         EXTRACT(YEAR FROM "timestamp" AT TIME ZONE 'UTC')::int AS year
       FROM telemetry_event
       ORDER BY year DESC, month DESC`,
    );

    return NextResponse.json({ months });
  } catch (error) {
    return handleRouteError(error, "GET /api/telemetry/months");
  }
}
