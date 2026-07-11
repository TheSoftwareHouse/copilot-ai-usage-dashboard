import { z } from "zod";

const nullableString = z
  .union([z.string(), z.null()])
  .optional()
  .transform((val) => {
    if (val === null || val === undefined) return val;
    const trimmed = val.trim();
    return trimmed === "" ? null : trimmed;
  })
  .pipe(
    z
      .union([
        z.string().max(255, "Must be 255 characters or fewer"),
        z.null(),
      ])
      .optional()
  );

export const updateSeatSchema = z
  .object({
    firstName: nullableString,
    lastName: nullableString,
    department: nullableString,
    departmentId: z.number().int().positive().nullable().optional(),
  })
  .refine(
    (data) =>
      data.firstName !== undefined ||
      data.lastName !== undefined ||
      data.department !== undefined ||
      data.departmentId !== undefined,
    {
      message: "At least one field (firstName, lastName, department, or departmentId) must be provided",
    }
  );

export type UpdateSeatInput = z.infer<typeof updateSeatSchema>;

export const seatModelDailyUsageQuerySchema = z.object({
  modelName: z.string().trim().min(1).max(255),
  month: z.coerce
    .number()
    .int()
    .min(1)
    .max(12)
    .optional()
    .default(() => new Date().getUTCMonth() + 1),
  year: z.coerce
    .number()
    .int()
    .min(2020)
    .optional()
    .default(() => new Date().getUTCFullYear()),
});

export type SeatModelDailyUsageQueryInput = z.infer<
  typeof seatModelDailyUsageQuerySchema
>;
