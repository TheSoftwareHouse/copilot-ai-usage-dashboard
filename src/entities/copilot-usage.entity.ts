import { EntitySchema } from "typeorm";
import { CopilotUsageSource } from "./enums";

export interface UsageItem {
  product: string;
  sku: string;
  model: string;
  unitType: string;
  pricePerUnit: number;
  grossQuantity: number;
  grossAmount: number;
  discountQuantity: number;
  discountAmount: number;
  netQuantity: number;
  netAmount: number;
}

export interface CopilotUsage {
  id: number;
  seatId: number;
  day: number;
  month: number;
  year: number;
  source: CopilotUsageSource;
  usageItems: UsageItem[];
  createdAt: Date;
  updatedAt: Date;
}

export const CopilotUsageEntity = new EntitySchema<CopilotUsage>({
  name: "CopilotUsage",
  tableName: "copilot_usage",
  columns: {
    id: {
      type: "int",
      primary: true,
      generated: "increment",
    },
    seatId: {
      type: "int",
    },
    day: {
      type: "smallint",
    },
    month: {
      type: "smallint",
    },
    year: {
      type: "smallint",
    },
    source: {
      type: "enum",
      enum: CopilotUsageSource,
      default: CopilotUsageSource.CSV_IMPORT,
    },
    usageItems: {
      type: "jsonb",
    },
    createdAt: {
      type: "timestamptz",
      createDate: true,
    },
    updatedAt: {
      type: "timestamptz",
      updateDate: true,
    },
  },
  relations: {
    seatId: {
      type: "many-to-one",
      target: "CopilotSeat",
      joinColumn: {
        name: "seatId",
        referencedColumnName: "id",
      },
    },
  },
  indices: [
    {
      name: "IDX_copilot_usage_seat_id",
      columns: ["seatId"],
    },
    {
      name: "IDX_copilot_usage_year_month",
      columns: ["year", "month"],
    },
  ],
  uniques: [
    {
      name: "UQ_copilot_usage_seat_day",
      columns: ["seatId", "day", "month", "year"],
    },
  ],
});
