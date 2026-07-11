import { z } from "zod";

export const configurationSchema = z
  .object({
    apiMode: z.enum(["organisation", "enterprise"], {
      error: "API mode must be either 'organisation' or 'enterprise'",
    }),
    entityName: z
      .string({
        error: "Entity name is required",
      })
      .trim()
      .min(1, "Entity name cannot be empty")
      .max(255, "Entity name must be 255 characters or fewer"),
  })
  .strict();

export type ConfigurationInput = z.infer<typeof configurationSchema>;

export const updateConfigurationSchema = z
  .object({
    deviationWarningThreshold: z
      .number({
        error: "Warning threshold must be a number",
      })
      .gt(0, "Warning threshold must be greater than 0")
      .max(50000, "Warning threshold must be 50000 or less")
      .multipleOf(0.01, "Warning threshold must have at most 2 decimal places")
      .optional(),
    deviationAlertThreshold: z
      .number({
        error: "Alert threshold must be a number",
      })
      .gt(0, "Alert threshold must be greater than 0")
      .max(50000, "Alert threshold must be 50000 or less")
      .multipleOf(0.01, "Alert threshold must have at most 2 decimal places")
      .optional(),
  })
  .strict()
  .refine(
    (data) => Object.values(data).some((value) => value !== undefined),
    { message: "At least one field must be provided" },
  );

export type UpdateConfigurationInput = z.infer<typeof updateConfigurationSchema>;
