import { NextResponse } from "next/server";
import crypto from "crypto";
import { getDb } from "@/lib/db";
import { ConfigurationEntity } from "@/entities/configuration.entity";
import { telemetryEventEnvelopeSchema } from "@/lib/validations/telemetry";
import { canonicalJson } from "@/lib/canonical-json";
import { handleRouteError } from "@/lib/api-helpers";

const MAX_BODY_SIZE = 10 * 1024 * 1024; // 10 MB

export async function POST(request: Request) {
  try {
    // 1. API Key Auth
    const apiKey = request.headers.get("x-api-key");
    if (!apiKey) {
      return NextResponse.json(
        { error: "Missing or invalid API key" },
        { status: 401 },
      );
    }

    const dataSource = await getDb();
    const configRepo = dataSource.getRepository(ConfigurationEntity);
    const config = await configRepo.findOne({ where: {} });
    const storedKey = config?.telemetryApiKey;

    if (!storedKey) {
      return NextResponse.json(
        { error: "Missing or invalid API key" },
        { status: 401 },
      );
    }

    const keyBuffer = Buffer.from(apiKey);
    const storedBuffer = Buffer.from(storedKey);
    if (
      keyBuffer.length !== storedBuffer.length ||
      !crypto.timingSafeEqual(keyBuffer, storedBuffer)
    ) {
      return NextResponse.json(
        { error: "Missing or invalid API key" },
        { status: 401 },
      );
    }

    // 2. Body size check
    const contentLength = request.headers.get("content-length");
    if (contentLength && parseInt(contentLength, 10) > MAX_BODY_SIZE) {
      return NextResponse.json(
        { error: "Request body exceeds 10 MB limit" },
        { status: 413 },
      );
    }

    // 3. NDJSON parsing
    const body = await request.text();
    const lines = body.split("\n").filter((line) => line.trim() !== "");

    // 4. Per-line processing
    const errors: { line: number; message: string }[] = [];
    const validEvents: {
      schemaVersion: string;
      timestamp: string;
      hookTimestamp: string;
      sessionId: string;
      eventType: string;
      workspaceName: string;
      data: Record<string, unknown>;
      eventHash: string;
      githubUsername: string;
    }[] = [];

    const batchId = crypto.randomUUID();

    for (let i = 0; i < lines.length; i++) {
      const lineNumber = i + 1;

      let parsed: unknown;
      try {
        parsed = JSON.parse(lines[i]);
      } catch {
        errors.push({ line: lineNumber, message: "Invalid JSON" });
        continue;
      }

      const result = telemetryEventEnvelopeSchema.safeParse(parsed);
      if (!result.success) {
        const firstIssue = result.error.issues[0];
        errors.push({
          line: lineNumber,
          message: firstIssue?.message ?? "Validation failed",
        });
        continue;
      }

      const event = result.data;

      const hashInput =
        event.session_id +
        event.event_type +
        event.hook_timestamp +
        canonicalJson(event.data);
      const eventHash = crypto
        .createHash("sha256")
        .update(hashInput)
        .digest("hex");

      validEvents.push({
        schemaVersion: event.schema_version,
        timestamp: event.timestamp,
        hookTimestamp: event.hook_timestamp,
        sessionId: event.session_id,
        eventType: event.event_type,
        workspaceName: event.workspace_name,
        data: event.data as Record<string, unknown>,
        eventHash,
        githubUsername: event.github_username,
      });
    }

    // 5. Batch insert
    let accepted = 0;

    if (validEvents.length > 0) {
      const valuePlaceholders: string[] = [];
      const params: unknown[] = [];
      let paramIndex = 1;

      for (const event of validEvents) {
        valuePlaceholders.push(
          `($${paramIndex}, $${paramIndex + 1}, $${paramIndex + 2}, $${paramIndex + 3}, $${paramIndex + 4}, $${paramIndex + 5}, $${paramIndex + 6}, $${paramIndex + 7}, $${paramIndex + 8}, $${paramIndex + 9})`,
        );
        params.push(
          batchId,
          event.schemaVersion,
          event.timestamp,
          event.hookTimestamp,
          event.sessionId,
          event.eventType,
          event.workspaceName,
          JSON.stringify(event.data),
          event.eventHash,
          event.githubUsername,
        );
        paramIndex += 10;
      }

      const sql = `INSERT INTO telemetry_event ("batchId", "schemaVersion", "timestamp", "hookTimestamp", "sessionId", "eventType", "workspaceName", "data", "eventHash", "githubUsername")
VALUES ${valuePlaceholders.join(", ")}
ON CONFLICT ("eventHash") DO NOTHING
RETURNING "id"`;

      const insertResult = await dataSource.query(sql, params);
      accepted =
        typeof insertResult?.length === "number"
          ? insertResult.length
          : (insertResult?.rowCount ?? 0);
    }

    // 6. Response
    const total = lines.length;
    const failed = errors.length;
    const skipped = validEvents.length - accepted;

    return NextResponse.json({
      batch_id: batchId,
      total,
      accepted,
      skipped,
      failed,
      errors,
    });
  } catch (error) {
    return handleRouteError(error, "POST /api/v1/ingest");
  }
}
