import { z } from "zod";

const monthField = z
  .number({ error: "Month must be a number" })
  .int("Month must be an integer")
  .min(1, "Month must be between 1 and 12")
  .max(12, "Month must be between 1 and 12");

const yearField = z
  .number({ error: "Year must be a number" })
  .int("Year must be an integer")
  .min(2020, "Year must be 2020 or later");

export const allocationPercentageField = z
  .number({ error: "Allocation percentage must be a number" })
  .int("Allocation percentage must be an integer")
  .min(1, "Allocation percentage must be between 1 and 100")
  .max(100, "Allocation percentage must be between 1 and 100");

const seatIdsField = z
  .array(
    z
      .number({ error: "Each seatId must be a number" })
      .int("Each seatId must be an integer")
      .positive("Each seatId must be a positive integer"),
  )
  .min(1, "At least one seatId is required")
  .max(100, "Cannot process more than 100 seats at once");

export const teamMembersQuerySchema = z.object({
  month: z.coerce.number().int("Month must be an integer").min(1, "Month must be between 1 and 12").max(12, "Month must be between 1 and 12").optional(),
  year: z.coerce.number().int("Year must be an integer").min(2020, "Year must be 2020 or later").optional(),
});

export type TeamMembersQueryInput = z.infer<typeof teamMembersQuerySchema>;

export const createTeamMembersSchema = z.object({
  seatIds: seatIdsField,
  month: monthField,
  year: yearField,
  allocationPercentage: allocationPercentageField.optional(),
});

export type CreateTeamMembersInput = z.infer<typeof createTeamMembersSchema>;

export const teamMembersRemoveSchema = z.object({
  seatIds: seatIdsField,
  month: monthField,
  year: yearField,
  mode: z.enum(["retire", "purge"]).default("retire"),
});

export type TeamMembersRemoveInput = z.infer<typeof teamMembersRemoveSchema>;

export const updateTeamMemberAllocationSchema = z.object({
  month: monthField,
  year: yearField,
  allocationPercentage: allocationPercentageField,
});

export type UpdateTeamMemberAllocationInput = z.infer<
  typeof updateTeamMemberAllocationSchema
>;

export const teamMembersBackfillSchema = z
  .object({
    seatIds: seatIdsField,
    startMonth: monthField,
    startYear: yearField,
    endMonth: monthField,
    endYear: yearField,
  })
  .refine(
    (data) => {
      const startVal = data.startYear * 12 + data.startMonth;
      const endVal = data.endYear * 12 + data.endMonth;
      return endVal >= startVal;
    },
    { message: "Start date must not be after end date", path: ["startMonth"] },
  )
  .refine(
    (data) => {
      const now = new Date();
      const currentMonth = now.getUTCMonth() + 1;
      const currentYear = now.getUTCFullYear();
      const currentVal = currentYear * 12 + currentMonth;
      const endVal = data.endYear * 12 + data.endMonth;
      return endVal <= currentVal;
    },
    { message: "End date must not be in the future", path: ["endMonth"] },
  )
  .refine(
    (data) => {
      const startVal = data.startYear * 12 + data.startMonth;
      const endVal = data.endYear * 12 + data.endMonth;
      return endVal - startVal + 1 <= 24;
    },
    { message: "Date range must not exceed 24 months", path: ["startMonth"] },
  );

export type TeamMembersBackfillInput = z.infer<typeof teamMembersBackfillSchema>;
