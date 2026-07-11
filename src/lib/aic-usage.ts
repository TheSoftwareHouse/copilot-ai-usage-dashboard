import type { UsageItem } from "@/entities/copilot-usage.entity";

const AIC_USAGE_START_DATE_KEY = Date.UTC(2026, 4, 1);

export interface AicUsageSourceRow {
  product: string;
  sku: string;
  model: string;
  grossQuantity: number;
  grossAmount: number;
  discountQuantity?: number;
  discountAmount?: number;
  netQuantity?: number;
  netAmount?: number;
  unitType?: string;
  pricePerUnit?: number;
}

export interface MonthYear {
  month: number;
  year: number;
}

export function isSupportedAicUsageDate(
  year: number,
  month: number,
  day: number,
): boolean {
  return Date.UTC(year, month - 1, day) >= AIC_USAGE_START_DATE_KEY;
}

export function buildAicUsageItem(row: AicUsageSourceRow): UsageItem {
  return {
    product: row.product,
    sku: row.sku,
    model: row.model,
    unitType: row.unitType ?? "requests",
    pricePerUnit:
      row.pricePerUnit ?? (row.grossQuantity > 0 ? row.grossAmount / row.grossQuantity : 0),
    grossQuantity: row.grossQuantity,
    grossAmount: row.grossAmount,
    discountQuantity: row.discountQuantity ?? 0,
    discountAmount: row.discountAmount ?? 0,
    netQuantity: row.netQuantity ?? 0,
    netAmount: row.netAmount ?? 0,
  };
}

export function parseAicUsageDate(dateValue: string): {
  year: number;
  month: number;
  day: number;
} {
  const match = dateValue.match(/^(\d{4})-(\d{2})-(\d{2})$/);

  if (match === null) {
    throw new Error(`Unexpected AI usage date format: ${dateValue}`);
  }

  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);

  if (!Number.isInteger(year) || !Number.isInteger(month) || !Number.isInteger(day)) {
    throw new Error(`Unexpected AI usage date format: ${dateValue}`);
  }

  return { year, month, day };
}

export function buildMonthKey(month: number, year: number): string {
  return `${year}-${String(month).padStart(2, "0")}`;
}

export function sortMonths<T extends MonthYear>(months: T[]): T[] {
  return [...months].sort((left, right) => {
    if (left.year !== right.year) {
      return left.year - right.year;
    }

    return left.month - right.month;
  });
}
