import { NextRequest, NextResponse } from "next/server";
import { requireAuth, isAuthFailure } from "@/lib/api-auth";
import { handleRouteError } from "@/lib/api-helpers";
import { getDb } from "@/lib/db";
import { telemetryUsageQuerySchema } from "@/lib/validations/telemetry";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  const auth = await requireAuth();
  if (isAuthFailure(auth)) return auth;

  const { searchParams } = request.nextUrl;
  const rawParams: Record<string, string> = {};
  for (const key of ["month", "year", "day", "github_username", "team_id"]) {
    const val = searchParams.get(key);
    if (val !== null) rawParams[key] = val;
  }

  const parsed = telemetryUsageQuerySchema.safeParse(rawParams);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Validation failed", details: parsed.error.flatten().fieldErrors },
      { status: 400 },
    );
  }

  const { month, year, day, github_username, team_id } = parsed.data;

  try {
    const dataSource = await getDb();

    // Build shared WHERE conditions and params
    const conditions: string[] = [
      `EXTRACT(MONTH FROM "timestamp" AT TIME ZONE 'UTC') = $1`,
      `EXTRACT(YEAR FROM "timestamp" AT TIME ZONE 'UTC') = $2`,
    ];
    const params: unknown[] = [month, year];
    let paramIndex = 3;

    if (day !== undefined) {
      conditions.push(`EXTRACT(DAY FROM "timestamp" AT TIME ZONE 'UTC') = $${paramIndex}`);
      params.push(day);
      paramIndex++;
    }

    if (github_username) {
      conditions.push(`"githubUsername" = $${paramIndex}`);
      params.push(github_username);
      paramIndex++;
    }

    if (team_id !== undefined) {
      // Resolve team members' github usernames
      const memberRows: { githubUsername: string }[] = await dataSource.query(
        `SELECT DISTINCT cs."githubUsername"
         FROM team_member_snapshot tms
         JOIN copilot_seat cs ON cs.id = tms."seatId"
         WHERE tms."teamId" = $1 AND tms.month = $2 AND tms.year = $3`,
        [team_id, month, year],
      );

      if (memberRows.length === 0) {
        return NextResponse.json({ agentUsage: [], promptUsage: [] });
      }

      const usernames = memberRows.map((r) => r.githubUsername);
      const placeholders = usernames.map((_, i) => `$${paramIndex + i}`).join(", ");
      conditions.push(`"githubUsername" IN (${placeholders})`);
      params.push(...usernames);
      paramIndex += usernames.length;
    }

    const whereClause = conditions.join(" AND ");

    // Agent usage query
    const agentSql = `
      SELECT agent_name AS "agent", COUNT(*)::int AS "count" FROM (
        SELECT COALESCE(NULLIF(data->>'agent', ''), 'default') AS agent_name
        FROM telemetry_event
        WHERE "eventType" = 'user_prompt' AND ${whereClause}
        UNION ALL
        SELECT COALESCE(NULLIF(data->>'subagent_name', ''), 'default') AS agent_name
        FROM telemetry_event
        WHERE "eventType" = 'tool_call' AND data->>'tool_name' = 'runSubagent' AND ${whereClause}
      ) sub
      GROUP BY agent_name
      ORDER BY "count" DESC
    `;

    // Prompt usage query (only user_prompt events — subagent runs count towards agents only)
    const promptSql = `
      SELECT prompt_name AS "prompt", COUNT(*)::int AS "count" FROM (
        SELECT COALESCE(NULLIF(data->>'detected_prompt', ''), 'other') AS prompt_name
        FROM telemetry_event
        WHERE "eventType" = 'user_prompt' AND ${whereClause}
      ) sub
      GROUP BY prompt_name
      ORDER BY "count" DESC
    `;

    const [agentUsage, promptUsage] = await Promise.all([
      dataSource.query(agentSql, params),
      dataSource.query(promptSql, params),
    ]);

    return NextResponse.json({ agentUsage, promptUsage });
  } catch (error) {
    return handleRouteError(error, "GET /api/telemetry/usage");
  }
}
