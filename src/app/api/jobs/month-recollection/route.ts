import { NextResponse } from "next/server";
import { requireAdmin, isAuthFailure } from "@/lib/api-auth";
import { handleRouteError } from "@/lib/api-helpers";
import {
  executeUsageCollection,
  mapUsageCollectionSkipReason,
} from "@/lib/usage-collection";
import { JobType } from "@/entities/enums";

export async function POST() {
  const auth = await requireAdmin();
  if (isAuthFailure(auth)) return auth;

  try {
    const result = await executeUsageCollection({
      jobType: JobType.MONTH_RECOLLECTION,
    });

    if (result.skipped) {
      return NextResponse.json(
        {
          error: mapUsageCollectionSkipReason(result.reason ?? "unknown"),
          skipped: true,
          reason: result.reason ?? "unknown",
        },
        { status: 409 },
      );
    }

    return NextResponse.json({
      skipped: false,
      jobExecutionId: result.jobExecutionId,
      status: result.status,
      recordsProcessed: result.recordsProcessed ?? null,
      errorMessage: result.errorMessage ?? null,
    });
  } catch (error) {
    return handleRouteError(error, "POST /api/jobs/month-recollection");
  }
}