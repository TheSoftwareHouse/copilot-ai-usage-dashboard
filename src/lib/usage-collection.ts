import { ConfigurationEntity } from "@/entities/configuration.entity";
import { CopilotSeatEntity } from "@/entities/copilot-seat.entity";
import { CopilotUsageEntity, type UsageItem } from "@/entities/copilot-usage.entity";
import { CopilotUsageSource, JobStatus, JobType, SeatStatus } from "@/entities/enums";
import { JobExecutionEntity } from "@/entities/job-execution.entity";
import { ERROR_MESSAGE_MAX_LENGTH } from "@/lib/constants";
import { getDb } from "@/lib/db";
import { fetchCopilotAiCreditUsage } from "@/lib/github-api";
import { getInstallationToken, NoOrgConnectedError } from "@/lib/github-app-token";
import { acquireJobLock } from "@/lib/job-lock";
import { refreshDashboardMetrics } from "@/lib/dashboard-metrics";

export interface UsageCollectionResult {
  skipped: boolean;
  reason?: string;
  jobExecutionId?: number;
  status?: JobStatus;
  recordsProcessed?: number;
  errorMessage?: string;
}

interface UsageCollectionOptions {
  jobType: JobType.USAGE_COLLECTION | JobType.MONTH_RECOLLECTION;
}

interface ExistingUsageRow {
  id: number;
  seatId: number;
  day: number;
  month: number;
  year: number;
}

interface UsageAggregate {
  id?: number;
  seatId: number;
  day: number;
  month: number;
  year: number;
  source: CopilotUsageSource;
  usageItems: UsageItem[];
}

interface UsageCollectionFailure {
  message: string;
}

function buildUsageKey(seatId: number, day: number, month: number, year: number): string {
  return `${seatId}:${day}:${month}:${year}`;
}

function buildDayList(jobType: JobType.USAGE_COLLECTION | JobType.MONTH_RECOLLECTION): Array<{ day: number; month: number; year: number }> {
  const now = new Date();
  const month = now.getUTCMonth() + 1;
  const year = now.getUTCFullYear();
  const today = now.getUTCDate();

  if (jobType === JobType.USAGE_COLLECTION) {
    return [{ day: today, month, year }];
  }

  return Array.from({ length: today }, (_, index) => ({
    day: index + 1,
    month,
    year,
  }));
}

function normalizeUsageItems(items: UsageItem[]): UsageItem[] {
  const byModel = new Map<string, UsageItem>();

  for (const item of items) {
    const key = `${item.product}:${item.sku}:${item.model}:${item.unitType}`;
    const existing = byModel.get(key);

    if (!existing) {
      byModel.set(key, { ...item });
      continue;
    }

    existing.grossQuantity += item.grossQuantity;
    existing.grossAmount += item.grossAmount;
    existing.discountQuantity += item.discountQuantity;
    existing.discountAmount += item.discountAmount;
    existing.netQuantity += item.netQuantity;
    existing.netAmount += item.netAmount;
    existing.pricePerUnit =
      existing.grossQuantity > 0 ? existing.grossAmount / existing.grossQuantity : 0;
  }

  return [...byModel.values()];
}

function parseTimePeriod(value: string): { day: number; month: number; year: number } | null {
  const match = value.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!match) {
    return null;
  }

  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);

  if (month < 1 || month > 12 || day < 1 || day > 31) {
    return null;
  }

  return { day, month, year };
}

function buildSkipReasonMessage(reason: string): string {
  if (reason === "no_configuration") {
    return "Configuration not found. Complete first-run setup before collecting usage.";
  }

  if (reason === "no_org_connected") {
    return "No GitHub App installation connected. Complete GitHub App setup before collecting usage.";
  }

  if (reason === "already_running") {
    return "Usage collection is already running. Please wait for the current run to finish.";
  }

  return "Usage collection could not start.";
}

export function mapUsageCollectionSkipReason(reason: string): string {
  return buildSkipReasonMessage(reason);
}

export async function executeUsageCollection(
  options: UsageCollectionOptions,
): Promise<UsageCollectionResult> {
  const dataSource = await getDb();
  const configRepository = dataSource.getRepository(ConfigurationEntity);
  const seatRepository = dataSource.getRepository(CopilotSeatEntity);
  const jobRepository = dataSource.getRepository(JobExecutionEntity);

  const config = await configRepository.findOne({ where: {} });
  if (!config || !config.entityName || !config.apiMode) {
    return { skipped: true, reason: "no_configuration" };
  }

  let token: string;
  try {
    token = await getInstallationToken();
  } catch (error) {
    if (error instanceof NoOrgConnectedError) {
      return { skipped: true, reason: "no_org_connected" };
    }

    throw error;
  }

  const lockResult = await acquireJobLock(dataSource, options.jobType);
  if (!lockResult.acquired) {
    return { skipped: true, reason: lockResult.reason };
  }
  const jobExecution = lockResult.jobExecution;

  const activeSeats = await seatRepository.find({
    where: { status: SeatStatus.ACTIVE },
    select: { id: true, githubUsername: true },
  });

  if (activeSeats.length === 0) {
    await jobRepository.save({
      ...jobExecution,
      status: JobStatus.NO_OP,
      reason: "no_active_seats",
      completedAt: new Date(),
      recordsProcessed: 0,
    });

    return {
      skipped: false,
      jobExecutionId: jobExecution.id,
      status: JobStatus.NO_OP,
      recordsProcessed: 0,
    };
  }

  try {
    const seatByUsername = new Map<string, { id: number; githubUsername: string }>();
    for (const seat of activeSeats) {
      seatByUsername.set(seat.githubUsername.trim().toLowerCase(), seat);
    }

    const days = buildDayList(options.jobType);
    const aggregatesByKey = new Map<string, UsageAggregate>();
    const failures: UsageCollectionFailure[] = [];

    for (const { day, month, year } of days) {
      for (const seat of activeSeats) {
        const result = await fetchCopilotAiCreditUsage(
          {
            apiMode: config.apiMode,
            entityName: config.entityName,
            year,
            month,
            day,
            user: seat.githubUsername,
          },
          token,
        );

        const usageRecords = result.usageRecords;

        if (result.kind === "partial_failure") {
          failures.push({ message: result.failure.message });
        }

        for (const usageRecord of usageRecords) {
          const period = parseTimePeriod(usageRecord.timePeriod);
          if (!period) {
            continue;
          }

          const mappedSeat = seatByUsername.get(usageRecord.user.trim().toLowerCase()) ?? seat;
          const usageKey = buildUsageKey(mappedSeat.id, period.day, period.month, period.year);
          const existingAggregate = aggregatesByKey.get(usageKey);

          if (!existingAggregate) {
            aggregatesByKey.set(usageKey, {
              seatId: mappedSeat.id,
              day: period.day,
              month: period.month,
              year: period.year,
              source: CopilotUsageSource.GITHUB_API,
              usageItems: normalizeUsageItems(usageRecord.usageItems),
            });
            continue;
          }

          existingAggregate.usageItems = normalizeUsageItems([
            ...existingAggregate.usageItems,
            ...usageRecord.usageItems,
          ]);
        }
      }
    }

    const persistableRows = [...aggregatesByKey.values()];

    if (persistableRows.length > 0) {
      const whereClauses: string[] = [];
      const parameters: Array<number> = [];

      persistableRows.forEach((usageRow, index) => {
        const offset = index * 4;
        whereClauses.push(
          `("seatId" = $${offset + 1} AND "day" = $${offset + 2} AND "month" = $${offset + 3} AND "year" = $${offset + 4})`,
        );
        parameters.push(usageRow.seatId, usageRow.day, usageRow.month, usageRow.year);
      });

      const existingRows: ExistingUsageRow[] = await dataSource.query(
        `SELECT id, "seatId", "day", "month", "year"
         FROM copilot_usage
         WHERE ${whereClauses.join(" OR ")}`,
        parameters,
      );

      const existingByKey = new Map<string, ExistingUsageRow>();
      for (const row of existingRows) {
        existingByKey.set(buildUsageKey(row.seatId, row.day, row.month, row.year), row);
      }

      for (const usageRow of persistableRows) {
        const existing = existingByKey.get(
          buildUsageKey(usageRow.seatId, usageRow.day, usageRow.month, usageRow.year),
        );
        if (existing) {
          usageRow.id = existing.id;
        }
      }

      await dataSource.manager.save(CopilotUsageEntity, persistableRows);
    }

    const status =
      failures.length > 0
        ? JobStatus.PARTIAL_FAILURE
        : persistableRows.length === 0
          ? JobStatus.NO_OP
          : JobStatus.SUCCESS;

    const firstFailureMessage = failures[0]?.message;
    const errorMessage = firstFailureMessage
      ? failures
          .map((failure) => failure.message)
          .join("; ")
          .substring(0, ERROR_MESSAGE_MAX_LENGTH)
      : null;

    await jobRepository.save({
      ...jobExecution,
      status,
      reason: status === JobStatus.NO_OP ? "no_usage_data" : null,
      completedAt: new Date(),
      recordsProcessed: persistableRows.length,
      errorMessage,
    });

    const now = new Date();
    const currentMonth = now.getUTCMonth() + 1;
    const currentYear = now.getUTCFullYear();
    await refreshDashboardMetrics(currentMonth, currentYear);

    return {
      skipped: false,
      jobExecutionId: jobExecution.id,
      status,
      recordsProcessed: persistableRows.length,
      errorMessage: firstFailureMessage ?? undefined,
    };
  } catch (error) {
    const errorMessage =
      (error instanceof Error ? error.message : String(error)).substring(
        0,
        ERROR_MESSAGE_MAX_LENGTH,
      );

    await jobRepository.save({
      ...jobExecution,
      status: JobStatus.FAILURE,
      completedAt: new Date(),
      errorMessage,
    });

    return {
      skipped: false,
      jobExecutionId: jobExecution.id,
      status: JobStatus.FAILURE,
      errorMessage,
    };
  }
}