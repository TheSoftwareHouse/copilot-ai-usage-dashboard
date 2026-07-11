import { NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { ImportHistoryEntity } from "@/entities/import-history.entity";
import { requireAdmin, isAuthFailure } from "@/lib/api-auth";
import {
  AicCsvImportError,
  importAicCsvUsage,
} from "@/lib/aic-csv-import";
import { handleRouteError } from "@/lib/api-helpers";

const MAX_CSV_FILE_SIZE_BYTES = 10 * 1024 * 1024;
const CSV_FILE_FIELD_NAME = "file";

interface CsvUploadPayload {
  filename: string;
  csvContent: Buffer;
}

const DEFAULT_HISTORY_LIMIT = 10;
const MAX_HISTORY_LIMIT = 25;

function isUploadFile(value: FormDataEntryValue | null): value is File {
  return (
    value !== null &&
    typeof value === "object" &&
    "name" in value &&
    "size" in value &&
    "arrayBuffer" in value
  );
}

function invalidUploadResponse(message: string, status = 400): NextResponse {
  return NextResponse.json({ error: message }, { status });
}

async function parseCsvUpload(
  request: Request,
): Promise<CsvUploadPayload | NextResponse> {
  let formData: FormData;

  try {
    formData = await request.formData();
  } catch {
    return invalidUploadResponse("Invalid multipart form data");
  }

  const upload = formData.get(CSV_FILE_FIELD_NAME);

  if (!isUploadFile(upload)) {
    return invalidUploadResponse("CSV file upload is required");
  }

  if (!upload.name.toLowerCase().endsWith(".csv")) {
    return invalidUploadResponse("Uploaded file must have a .csv filename");
  }

  if (upload.size > MAX_CSV_FILE_SIZE_BYTES) {
    return invalidUploadResponse("CSV file exceeds 10 MB limit", 413);
  }

  return {
    filename: upload.name,
    csvContent: Buffer.from(await upload.arrayBuffer()),
  };
}

function parseHistoryLimit(request: Request): number {
  const url = new URL(request.url);
  const parsedLimit = Number.parseInt(url.searchParams.get("limit") ?? "", 10);

  if (Number.isNaN(parsedLimit) || parsedLimit < 1) {
    return DEFAULT_HISTORY_LIMIT;
  }

  return Math.min(parsedLimit, MAX_HISTORY_LIMIT);
}

export async function GET(request: Request) {
  const auth = await requireAdmin();
  if (isAuthFailure(auth)) return auth;

  try {
    const dataSource = await getDb();
    const historyRepository = dataSource.getRepository(ImportHistoryEntity);
    const history = await historyRepository.find({
      order: {
        executedAt: "DESC",
        id: "DESC",
      },
      take: parseHistoryLimit(request),
    });

    return NextResponse.json({
      imports: history.map((record) => ({
        id: record.id,
        filename: record.filename,
        executedAt: record.executedAt,
        recordsProcessed: record.recordsProcessed,
        matchedUserCount: record.matchedUserCount,
        skippedUserCount: record.skippedUserCount,
        skippedUsernames: record.skippedUsernames,
        affectedMonths: record.affectedMonths,
        overwrittenSeatDayCount: record.overwrittenSeatDayCount,
      })),
    });
  } catch (error) {
    return handleRouteError(error, "GET /api/usage/imports");
  }
}

export async function POST(request: Request) {
  const auth = await requireAdmin();
  if (isAuthFailure(auth)) return auth;

  try {
    const upload = await parseCsvUpload(request);
    if (upload instanceof NextResponse) return upload;

    const result = await importAicCsvUsage(upload);

    return NextResponse.json({
      importHistoryId: result.importHistoryId,
      recordsProcessed: result.recordsProcessed,
      matchedUserCount: result.matchedUserCount,
      skippedUserCount: result.skippedUserCount,
      skippedUsernames: result.skippedUsernames,
      affectedMonths: result.affectedMonths,
      overwrittenSeatDayCount: result.overwrittenSeatDayCount,
      overwriteWarnings: result.overwriteWarnings,
      refreshWarnings: result.warnings,
    });
  } catch (error) {
    if (error instanceof AicCsvImportError) {
      return invalidUploadResponse(error.message);
    }

    return handleRouteError(error, "POST /api/usage/imports");
  }
}