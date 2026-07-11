import { CopilotSeatEntity } from "@/entities/copilot-seat.entity";
import {
  CopilotUsageEntity,
  type UsageItem,
} from "@/entities/copilot-usage.entity";
import { CopilotUsageSource } from "@/entities/enums";
import {
  ImportHistoryEntity,
  type ImportHistoryMonth,
} from "@/entities/import-history.entity";
import { buildAicUsageItem, buildMonthKey, sortMonths } from "@/lib/aic-usage";
import { refreshDashboardMetrics } from "@/lib/dashboard-metrics";
import { getDb } from "@/lib/db";

const REQUIRED_COLUMNS = [
  "date",
  "username",
  "model",
  "product",
  "sku",
  "aic_quantity",
  "aic_gross_amount",
] as const;

const IMPORT_START_DATE_KEY = Date.UTC(2026, 4, 1);

export type AicCsvImportErrorCode =
  | "EMPTY_FILE"
  | "MISSING_COLUMNS"
  | "PARSE_ERROR"
  | "DATE_RANGE";

export class AicCsvImportError extends Error {
  constructor(
    message: string,
    public readonly code: AicCsvImportErrorCode,
  ) {
    super(message);
    this.name = "AicCsvImportError";
  }
}

export interface AicCsvImportResult {
  importHistoryId: number;
  recordsProcessed: number;
  matchedUserCount: number;
  skippedUserCount: number;
  skippedUsernames: string[];
  affectedMonths: ImportHistoryMonth[];
  overwrittenSeatDayCount: number;
  overwriteWarnings: string[];
  warnings: string[];
}

interface ParsedAicCsvRow {
  year: number;
  month: number;
  day: number;
  normalizedUsername: string;
  displayUsername: string;
  model: string;
  product: string;
  sku: string;
  grossQuantity: number;
  grossAmount: number;
}

interface AggregatedUsageRow {
  id?: number;
  seatId: number;
  day: number;
  month: number;
  year: number;
  source: CopilotUsageSource;
  usageItems: UsageItem[];
}

interface ExistingUsageRow {
  id: number;
  seatId: number;
  day: number;
  month: number;
  year: number;
  source: CopilotUsageSource;
}

interface SeatLookupRow {
  id: number;
  githubUsername: string;
}

function normalizeCell(value: string): string {
  return value.trim();
}

function normalizeHeader(value: string): string {
  return value.replace(/^\uFEFF/, "").trim().toLowerCase();
}

function isBlankRow(row: string[]): boolean {
  return row.every((cell) => cell.trim().length === 0);
}

function parseCsv(text: string): string[][] {
  const normalizedText = text
    .replace(/^\uFEFF/, "")
    .replace(/\r\n/g, "\n")
    .replace(/\r/g, "\n");
  const rows: string[][] = [];
  let currentRow: string[] = [];
  let currentField = "";
  let inQuotes = false;
  let fieldWasQuoted = false;

  for (let index = 0; index < normalizedText.length; index += 1) {
    const character = normalizedText[index];

    if (inQuotes) {
      if (character === '"') {
        const nextCharacter = normalizedText[index + 1];
        if (nextCharacter === '"') {
          currentField += '"';
          index += 1;
        } else {
          inQuotes = false;
          fieldWasQuoted = true;
        }
      } else {
        currentField += character;
      }
      continue;
    }

    if (character === ",") {
      currentRow.push(currentField);
      currentField = "";
      fieldWasQuoted = false;
      continue;
    }

    if (character === "\n") {
      currentRow.push(currentField);
      rows.push(currentRow);
      currentRow = [];
      currentField = "";
      fieldWasQuoted = false;
      continue;
    }

    if (character === '"') {
      if (currentField.length === 0) {
        inQuotes = true;
        fieldWasQuoted = true;
        continue;
      }

      throw new AicCsvImportError(
        "CSV parsing failed: unexpected quote in an unquoted field.",
        "PARSE_ERROR",
      );
    }

    if (fieldWasQuoted) {
      if (character === " " || character === "\t") {
        continue;
      }

      throw new AicCsvImportError(
        "CSV parsing failed: unexpected characters after a quoted field.",
        "PARSE_ERROR",
      );
    }

    currentField += character;
  }

  if (inQuotes) {
    throw new AicCsvImportError(
      "CSV parsing failed: unterminated quoted field.",
      "PARSE_ERROR",
    );
  }

  if (currentField.length > 0 || currentRow.length > 0) {
    currentRow.push(currentField);
    rows.push(currentRow);
  }

  return rows.filter((row) => !isBlankRow(row));
}

function parseCsvDate(value: string, rowNumber: number): {
  year: number;
  month: number;
  day: number;
} {
  const trimmedValue = value.trim();

  if (trimmedValue.length === 0) {
    throw new AicCsvImportError(
      `CSV row ${rowNumber}: date is required.`,
      "PARSE_ERROR",
    );
  }

  let parsedDate: Date;

  if (/^\d{4}-\d{2}-\d{2}$/.test(trimmedValue)) {
    const [yearText, monthText, dayText] = trimmedValue.split("-");
    const year = Number(yearText);
    const month = Number(monthText);
    const day = Number(dayText);
    parsedDate = new Date(Date.UTC(year, month - 1, day));

    if (
      parsedDate.getUTCFullYear() !== year ||
      parsedDate.getUTCMonth() + 1 !== month ||
      parsedDate.getUTCDate() !== day
    ) {
      throw new AicCsvImportError(
        `CSV row ${rowNumber}: date is not a valid UTC calendar date.`,
        "PARSE_ERROR",
      );
    }
  } else {
    parsedDate = new Date(trimmedValue);

    if (Number.isNaN(parsedDate.getTime())) {
      throw new AicCsvImportError(
        `CSV row ${rowNumber}: date is not parseable.`,
        "PARSE_ERROR",
      );
    }
  }

  const year = parsedDate.getUTCFullYear();
  const month = parsedDate.getUTCMonth() + 1;
  const day = parsedDate.getUTCDate();
  const dateKey = Date.UTC(year, month - 1, day);

  const now = new Date();
  const currentMonthEndDateKey = Date.UTC(
    now.getUTCFullYear(),
    now.getUTCMonth() + 1,
    0,
  );

  if (dateKey < IMPORT_START_DATE_KEY || dateKey > currentMonthEndDateKey) {
    throw new AicCsvImportError(
      `CSV row ${rowNumber}: date must be between 2026-05-01 UTC and the end of the current UTC month.`,
      "DATE_RANGE",
    );
  }

  return { year, month, day };
}

function parseNumberValue(
  value: string,
  fieldName: string,
  rowNumber: number,
): number {
  const trimmedValue = value.trim();

  if (trimmedValue.length === 0) {
    throw new AicCsvImportError(
      `CSV row ${rowNumber}: ${fieldName} is required.`,
      "PARSE_ERROR",
    );
  }

  const parsedValue = Number(trimmedValue);

  if (!Number.isFinite(parsedValue)) {
    throw new AicCsvImportError(
      `CSV row ${rowNumber}: ${fieldName} is not parseable.`,
      "PARSE_ERROR",
    );
  }

  return parsedValue;
}

function getRequiredColumnIndexMap(headerRow: string[]): Map<string, number> {
  const headerIndexMap = new Map<string, number>();

  headerRow.forEach((headerValue, index) => {
    const normalizedHeader = normalizeHeader(headerValue);

    if (normalizedHeader.length === 0) {
      return;
    }

    if (headerIndexMap.has(normalizedHeader)) {
      throw new AicCsvImportError(
        `CSV parsing failed: duplicate column name "${normalizedHeader}".`,
        "PARSE_ERROR",
      );
    }

    headerIndexMap.set(normalizedHeader, index);
  });

  const missingColumns = REQUIRED_COLUMNS.filter(
    (columnName) => !headerIndexMap.has(columnName),
  );

  if (missingColumns.length > 0) {
    throw new AicCsvImportError(
      `CSV is missing required columns: ${missingColumns.join(", ")}.`,
      "MISSING_COLUMNS",
    );
  }

  return headerIndexMap;
}

function parseAicCsvRows(csvContent: string): ParsedAicCsvRow[] {
  if (csvContent.trim().length === 0) {
    throw new AicCsvImportError(
      "CSV file is empty or has no data rows.",
      "EMPTY_FILE",
    );
  }

  const rows = parseCsv(csvContent);

  if (rows.length === 0) {
    throw new AicCsvImportError(
      "CSV file is empty or has no data rows.",
      "EMPTY_FILE",
    );
  }

  const [headerRow, ...dataRows] = rows;

  if (dataRows.length === 0) {
    throw new AicCsvImportError(
      "CSV file is empty or has no data rows.",
      "EMPTY_FILE",
    );
  }

  const headerIndexMap = getRequiredColumnIndexMap(headerRow);

  return dataRows.flatMap((row, index) => {
    const rowNumber = index + 2;

    if (row.length !== headerRow.length) {
      throw new AicCsvImportError(
        `CSV row ${rowNumber}: column count does not match the header.`,
        "PARSE_ERROR",
      );
    }

    const dateValue = row[headerIndexMap.get("date")!];
    const usernameValue = normalizeCell(row[headerIndexMap.get("username")!]);
    const modelValue = normalizeCell(row[headerIndexMap.get("model")!]);
    const productValue = normalizeCell(row[headerIndexMap.get("product")!]);
    const skuValue = normalizeCell(row[headerIndexMap.get("sku")!]);
    const quantityValue = row[headerIndexMap.get("aic_quantity")!];
    const grossAmountValue = row[headerIndexMap.get("aic_gross_amount")!];

    if (usernameValue.length === 0) {
      return [];
    }

    if (modelValue.length === 0) {
      throw new AicCsvImportError(
        `CSV row ${rowNumber}: model is required.`,
        "PARSE_ERROR",
      );
    }

    if (productValue.length === 0) {
      throw new AicCsvImportError(
        `CSV row ${rowNumber}: product is required.`,
        "PARSE_ERROR",
      );
    }

    if (skuValue.length === 0) {
      throw new AicCsvImportError(
        `CSV row ${rowNumber}: sku is required.`,
        "PARSE_ERROR",
      );
    }

    const dateParts = parseCsvDate(dateValue, rowNumber);
    const grossQuantity = parseNumberValue(
      quantityValue,
      "aic_quantity",
      rowNumber,
    );
    const grossAmount = parseNumberValue(
      grossAmountValue,
      "aic_gross_amount",
      rowNumber,
    );

    return [{
      ...dateParts,
      normalizedUsername: usernameValue.toLowerCase(),
      displayUsername: usernameValue,
      model: modelValue,
      product: productValue,
      sku: skuValue,
      grossQuantity,
      grossAmount,
    }];
  });
}

function buildUsageKey(
  seatId: number,
  day: number,
  month: number,
  year: number,
): string {
  return `${seatId}:${day}:${month}:${year}`;
}

async function refreshAffectedMonths(
  affectedMonths: ImportHistoryMonth[],
): Promise<string[]> {
  const warnings: string[] = [];

  for (const { month, year } of affectedMonths) {
    try {
      await refreshDashboardMetrics(month, year);
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      const warning = `Dashboard summary refresh failed for ${month}/${year}: ${errorMessage}`;

      console.warn(warning);
      warnings.push(warning);
    }
  }

  return warnings;
}

export async function importAicCsvUsage(options: {
  filename: string;
  csvContent: string | Buffer;
}): Promise<AicCsvImportResult> {
  const csvText = Buffer.isBuffer(options.csvContent)
    ? options.csvContent.toString("utf8")
    : options.csvContent;

  const parsedRows = parseAicCsvRows(csvText);

  const dataSource = await getDb();
  const queryRunner = dataSource.createQueryRunner();
  await queryRunner.connect();
  await queryRunner.startTransaction();

  let importResult: AicCsvImportResult | null = null;

  try {
    const seatRepository = queryRunner.manager.getRepository(CopilotSeatEntity);
    const seatRows: SeatLookupRow[] = await seatRepository.find({
      select: {
        id: true,
        githubUsername: true,
      },
    });

    const seatLookup = new Map<string, SeatLookupRow>();

    for (const seat of seatRows) {
      seatLookup.set(seat.githubUsername.trim().toLowerCase(), seat);
    }

    const matchedSeatIds = new Set<number>();
    const skippedUsernames = new Map<string, string>();
    const aggregatedBySeatDay = new Map<string, AggregatedUsageRow>();

    for (const row of parsedRows) {
      const seat = seatLookup.get(row.normalizedUsername);

      if (!seat) {
        if (!skippedUsernames.has(row.normalizedUsername)) {
          skippedUsernames.set(row.normalizedUsername, row.displayUsername);
        }

        continue;
      }

      matchedSeatIds.add(seat.id);

      const dayKey = buildUsageKey(seat.id, row.day, row.month, row.year);
      const existingDayAggregation = aggregatedBySeatDay.get(dayKey);

      if (!existingDayAggregation) {
        aggregatedBySeatDay.set(dayKey, {
          seatId: seat.id,
          day: row.day,
          month: row.month,
          year: row.year,
          source: CopilotUsageSource.CSV_IMPORT,
          usageItems: [buildAicUsageItem(row)],
        });
        continue;
      }

      const existingUsageItem = existingDayAggregation.usageItems.find(
        (usageItem) => usageItem.model === row.model,
      );

      if (!existingUsageItem) {
        existingDayAggregation.usageItems.push(buildAicUsageItem(row));
        continue;
      }

      existingUsageItem.grossQuantity += row.grossQuantity;
      existingUsageItem.grossAmount += row.grossAmount;
      existingUsageItem.pricePerUnit =
        existingUsageItem.grossQuantity > 0
          ? existingUsageItem.grossAmount / existingUsageItem.grossQuantity
          : 0;
    }

    const usageRows = [...aggregatedBySeatDay.values()];
    const usageKeyToExistingUsage = new Map<string, ExistingUsageRow>();
    const persistableUsageRows: AggregatedUsageRow[] = [];
    let blockedByGithubApiSeatDayCount = 0;

    if (usageRows.length > 0) {
      const whereClauses: string[] = [];
      const parameters: Array<number> = [];

      usageRows.forEach((usageRow, index) => {
        const offset = index * 4;
        whereClauses.push(
          `(\"seatId\" = $${offset + 1} AND \"day\" = $${offset + 2} AND \"month\" = $${offset + 3} AND \"year\" = $${offset + 4})`,
        );
        parameters.push(
          usageRow.seatId,
          usageRow.day,
          usageRow.month,
          usageRow.year,
        );
      });

      const existingUsageRows: Array<{
        id: number;
        seatId: number;
        day: number;
        month: number;
        year: number;
        source: CopilotUsageSource;
      }> = await queryRunner.manager.query(
        `SELECT id, "seatId", "day", "month", "year", "source"
         FROM copilot_usage
         WHERE ${whereClauses.join(" OR ")}`,
        parameters,
      );

      for (const existingUsageRow of existingUsageRows) {
        usageKeyToExistingUsage.set(
          buildUsageKey(
            existingUsageRow.seatId,
            existingUsageRow.day,
            existingUsageRow.month,
            existingUsageRow.year,
          ),
          existingUsageRow,
        );
      }

      for (const usageRow of usageRows) {
        const existingUsage = usageKeyToExistingUsage.get(
          buildUsageKey(
            usageRow.seatId,
            usageRow.day,
            usageRow.month,
            usageRow.year,
          ),
        );

        if (existingUsage?.source === CopilotUsageSource.GITHUB_API) {
          blockedByGithubApiSeatDayCount += 1;
          continue;
        }

        if (existingUsage !== undefined) {
          usageRow.id = existingUsage.id;
        }

        usageRow.source = CopilotUsageSource.CSV_IMPORT;
        persistableUsageRows.push(usageRow);
      }
    }

    const overwrittenSeatDayCount = persistableUsageRows.filter(
      (usageRow) => usageRow.id !== undefined,
    ).length;

    if (persistableUsageRows.length > 0) {
      await queryRunner.manager.save(CopilotUsageEntity, persistableUsageRows);
    }

    const overwriteWarnings =
      blockedByGithubApiSeatDayCount > 0
        ? [
            `Skipped ${blockedByGithubApiSeatDayCount} seat/day row(s) because GitHub API data already exists.`,
          ]
        : [];

    if (overwriteWarnings.length > 0) {
      console.warn(overwriteWarnings[0]);
    }

    const affectedMonthsMap = new Map<string, ImportHistoryMonth>();

    for (const usageRow of persistableUsageRows) {
      affectedMonthsMap.set(buildMonthKey(usageRow.month, usageRow.year), {
        month: usageRow.month,
        year: usageRow.year,
      });
    }

    const affectedMonths = sortMonths([...affectedMonthsMap.values()]);

    const importHistory = await queryRunner.manager.save(ImportHistoryEntity, {
      filename: options.filename,
      executedAt: new Date(),
      recordsProcessed: parsedRows.length,
      matchedUserCount: matchedSeatIds.size,
      skippedUserCount: skippedUsernames.size,
      skippedUsernames: [...skippedUsernames.values()],
      affectedMonths,
      overwrittenSeatDayCount,
    });

    await queryRunner.commitTransaction();

    importResult = {
      importHistoryId: importHistory.id,
      recordsProcessed: parsedRows.length,
      matchedUserCount: matchedSeatIds.size,
      skippedUserCount: skippedUsernames.size,
      skippedUsernames: [...skippedUsernames.values()],
      affectedMonths,
      overwrittenSeatDayCount,
      overwriteWarnings,
      warnings: [],
    };
  } catch (error) {
    await queryRunner.rollbackTransaction();

    if (error instanceof AicCsvImportError) {
      throw error;
    }

    throw new AicCsvImportError(
      error instanceof Error ? error.message : String(error),
      "PARSE_ERROR",
    );
  } finally {
    await queryRunner.release();
  }

  if (importResult === null) {
    throw new AicCsvImportError(
      "AIC CSV import did not complete successfully.",
      "PARSE_ERROR",
    );
  }

  const warnings = await refreshAffectedMonths(importResult.affectedMonths);

  return {
    ...importResult,
    warnings,
  };
}
