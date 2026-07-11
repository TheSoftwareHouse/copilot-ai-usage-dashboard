import { EntitySchema } from "typeorm";

export interface ModelUsageEntry {
  model: string;
  totalRequests: number;
  totalAmount: number;
}

export interface UserActivityEntry {
  seatId: number;
  githubUsername: string;
  firstName: string | null;
  lastName: string | null;
  totalRequests: number;
  totalSpending: number;
}

export interface DashboardMonthlySummary {
  id: number;
  month: number;
  year: number;
  totalSeats: number;
  activeSeats: number;
  totalSpending: number;
  seatBaseCost: number;
  totalAiCredits: number;
  modelUsage: ModelUsageEntry[];
  mostActiveUsers: UserActivityEntry[];
  leastActiveUsers: UserActivityEntry[];
  createdAt: Date;
  updatedAt: Date;
}

export const DashboardMonthlySummaryEntity =
  new EntitySchema<DashboardMonthlySummary>({
    name: "DashboardMonthlySummary",
    tableName: "dashboard_monthly_summary",
    columns: {
      id: {
        type: "int",
        primary: true,
        generated: "increment",
      },
      month: {
        type: "smallint",
      },
      year: {
        type: "smallint",
      },
      totalSeats: {
        type: "int",
        default: 0,
      },
      activeSeats: {
        type: "int",
        default: 0,
      },
      totalSpending: {
        type: "decimal",
        precision: 19,
        scale: 4,
        default: 0,
      },
      seatBaseCost: {
        type: "decimal",
        precision: 19,
        scale: 4,
        default: 0,
      },
      totalAiCredits: {
        type: "int",
        default: 0,
      },
      modelUsage: {
        type: "jsonb",
        default: "[]",
      },
      mostActiveUsers: {
        type: "jsonb",
        default: "[]",
      },
      leastActiveUsers: {
        type: "jsonb",
        default: "[]",
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
    uniques: [
      {
        name: "UQ_dashboard_monthly_summary_month_year",
        columns: ["month", "year"],
      },
    ],
  });
