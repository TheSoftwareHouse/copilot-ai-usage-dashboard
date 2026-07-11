import { EntitySchema } from "typeorm";

export interface ImportHistoryMonth {
  month: number;
  year: number;
}

export interface ImportHistory {
  id: number;
  filename: string;
  executedAt: Date;
  recordsProcessed: number;
  matchedUserCount: number;
  skippedUserCount: number;
  skippedUsernames: string[];
  affectedMonths: ImportHistoryMonth[];
  overwrittenSeatDayCount: number;
}

export const ImportHistoryEntity = new EntitySchema<ImportHistory>({
  name: "ImportHistory",
  tableName: "import_history",
  columns: {
    id: {
      type: "int",
      primary: true,
      generated: "increment",
    },
    filename: {
      type: "varchar",
      length: 255,
    },
    executedAt: {
      type: "timestamptz",
    },
    recordsProcessed: {
      type: "int",
      default: 0,
    },
    matchedUserCount: {
      type: "int",
      default: 0,
    },
    skippedUserCount: {
      type: "int",
      default: 0,
    },
    skippedUsernames: {
      type: "jsonb",
      default: "[]",
    },
    affectedMonths: {
      type: "jsonb",
      default: "[]",
    },
    overwrittenSeatDayCount: {
      type: "int",
      default: 0,
    },
  },
  indices: [
    {
      name: "IDX_import_history_executed_at",
      columns: ["executedAt"],
    },
  ],
});