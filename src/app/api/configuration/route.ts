import { NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { ConfigurationEntity } from "@/entities/configuration.entity";
import { ApiMode } from "@/entities/enums";
import { configurationSchema, updateConfigurationSchema } from "@/lib/validations/configuration";
import { requireAdmin, isAuthFailure } from "@/lib/api-auth";
import { handleRouteError } from "@/lib/api-helpers";
import { seedDefaultAdmin } from "@/lib/auth";
import { invalidatePremiumAllowanceCache } from "@/lib/get-premium-allowance";

function maskApiKey(key: string | null): string | null {
  if (!key) return null;
  if (key.length <= 4) return "****";
  return "*".repeat(key.length - 4) + key.slice(-4);
}

export async function GET() {
  const auth = await requireAdmin();
  if (isAuthFailure(auth)) return auth;

  try {
    const dataSource = await getDb();
    const repository = dataSource.getRepository(ConfigurationEntity);
    const config = await repository.findOne({ where: {} });

    if (!config) {
      return NextResponse.json(
        { error: "Configuration not found" },
        { status: 404 }
      );
    }

    return NextResponse.json({
      apiMode: config.apiMode,
      entityName: config.entityName,
      premiumRequestsPerSeat: config.premiumRequestsPerSeat,
      telemetryApiKey: maskApiKey(config.telemetryApiKey),
      normSeatsCount: config.normSeatsCount,
      deviationWarningThreshold: Number(config.deviationWarningThreshold),
      deviationAlertThreshold: Number(config.deviationAlertThreshold),
      createdAt: config.createdAt,
      updatedAt: config.updatedAt,
    });
  } catch (error) {
    return handleRouteError(error, "GET /api/configuration");
  }
}

// POST is intentionally unauthenticated: this is the first-run setup
// endpoint used before any admin user exists. It is protected by the
// singleton constraint — once a configuration row exists, this endpoint
// always returns 409.
export async function POST(request: Request) {
  try {
    // Early-reject if configuration already exists (defense-in-depth
    // before parsing the body, so the endpoint is a no-op post-setup).
    const dataSource = await getDb();
    const repository = dataSource.getRepository(ConfigurationEntity);
    const existing = await repository.findOne({ where: {} });
    if (existing) {
      return NextResponse.json(
        { error: "Configuration already exists" },
        { status: 409 }
      );
    }

    let body: unknown;
    try {
      body = await request.json();
    } catch {
      return NextResponse.json(
        { error: "Invalid JSON body" },
        { status: 400 }
      );
    }

    const result = configurationSchema.safeParse(body);
    if (!result.success) {
      return NextResponse.json(
        { error: "Validation failed", details: result.error.flatten().fieldErrors },
        { status: 400 }
      );
    }

    const { apiMode, entityName, premiumRequestsPerSeat } = result.data;

    const config = repository.create({
      apiMode: apiMode as ApiMode,
      entityName,
      ...(premiumRequestsPerSeat !== undefined && { premiumRequestsPerSeat }),
    });
    const created = await repository.save(config);

    // Seed default admin user after first-run setup
    await seedDefaultAdmin();

    return NextResponse.json(
      {
        apiMode: created.apiMode,
        entityName: created.entityName,
        premiumRequestsPerSeat: created.premiumRequestsPerSeat,
        createdAt: created.createdAt,
        updatedAt: created.updatedAt,
      },
      { status: 201 }
    );
  } catch (error) {
    return handleRouteError(error, "POST /api/configuration", {
      uniqueViolationMessage: "Configuration already exists",
    });
  }
}

export async function PUT(request: Request) {
  const auth = await requireAdmin();
  if (isAuthFailure(auth)) return auth;

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json(
      { error: "Invalid JSON body" },
      { status: 400 }
    );
  }

  const result = updateConfigurationSchema.safeParse(body);
  if (!result.success) {
    return NextResponse.json(
      { error: "Validation failed", details: result.error.flatten().fieldErrors },
      { status: 400 }
    );
  }

  const {
    premiumRequestsPerSeat,
    telemetryApiKey,
    normSeatsCount,
    deviationWarningThreshold,
    deviationAlertThreshold,
  } = result.data;

  try {
    const dataSource = await getDb();
    const repository = dataSource.getRepository(ConfigurationEntity);

    const existing = await repository.findOne({ where: {} });
    if (!existing) {
      return NextResponse.json(
        { error: "Configuration not found" },
        { status: 404 }
      );
    }

    // Cross-field validation: merge request values with existing DB values
    const effectiveWarning =
      deviationWarningThreshold ?? Number(existing.deviationWarningThreshold);
    const effectiveAlert =
      deviationAlertThreshold ?? Number(existing.deviationAlertThreshold);
    if (effectiveWarning >= effectiveAlert) {
      return NextResponse.json(
        { error: "Warning threshold must be less than alert threshold" },
        { status: 400 }
      );
    }

    existing.premiumRequestsPerSeat = premiumRequestsPerSeat;
    if (telemetryApiKey !== undefined) {
      existing.telemetryApiKey = telemetryApiKey;
    }
    if (normSeatsCount !== undefined) {
      existing.normSeatsCount = normSeatsCount;
    }
    if (deviationWarningThreshold !== undefined) {
      existing.deviationWarningThreshold = deviationWarningThreshold;
    }
    if (deviationAlertThreshold !== undefined) {
      existing.deviationAlertThreshold = deviationAlertThreshold;
    }

    const updated = await repository.save(existing);
    invalidatePremiumAllowanceCache();

    return NextResponse.json({
      apiMode: updated.apiMode,
      entityName: updated.entityName,
      premiumRequestsPerSeat: updated.premiumRequestsPerSeat,
      telemetryApiKey: maskApiKey(updated.telemetryApiKey),
      normSeatsCount: updated.normSeatsCount,
      deviationWarningThreshold: Number(updated.deviationWarningThreshold),
      deviationAlertThreshold: Number(updated.deviationAlertThreshold),
      createdAt: updated.createdAt,
      updatedAt: updated.updatedAt,
    });
  } catch (error) {
    return handleRouteError(error, "PUT /api/configuration");
  }
}
