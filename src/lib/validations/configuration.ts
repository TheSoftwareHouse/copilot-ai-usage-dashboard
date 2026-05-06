import { z } from "zod";

export const configurationSchema = z.object({
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
  premiumRequestsPerSeat: z
    .number({
      error: "Premium requests per seat must be a number",
    })
    .int("Premium requests per seat must be a whole number")
    .min(1, "Premium requests per seat must be at least 1")
    .max(100000, "Premium requests per seat must be 100000 or fewer")
    .optional(),
});

export type ConfigurationInput = z.infer<typeof configurationSchema>;

export const updateConfigurationSchema = z.object({
  premiumRequestsPerSeat: z
    .number({
      error: "Premium requests per seat must be a number",
    })
    .int("Premium requests per seat must be a whole number")
    .min(1, "Premium requests per seat must be at least 1")
    .max(100000, "Premium requests per seat must be 100000 or fewer"),
  telemetryApiKey: z
    .union([
      z.string().min(1, "Telemetry API key cannot be empty").max(255, "Telemetry API key must be 255 characters or fewer"),
      z.null(),
    ])
    .optional(),
  normSeatsCount: z
    .number({
      error: "Norm seats count must be a number",
    })
    .int("Norm seats count must be a whole number")
    .min(1, "Norm seats count must be at least 1")
    .max(10000, "Norm seats count must be 10000 or fewer")
    .optional(),
  deviationWarningThreshold: z
    .number({
      error: "Warning threshold must be a number",
    })
    .gt(1.0, "Warning threshold must be greater than 1.0")
    .max(99.99, "Warning threshold must be 99.99 or less")
    .multipleOf(0.01, "Warning threshold must have at most 2 decimal places")
    .optional(),
  deviationAlertThreshold: z
    .number({
      error: "Alert threshold must be a number",
    })
    .gt(1.0, "Alert threshold must be greater than 1.0")
    .max(99.99, "Alert threshold must be 99.99 or less")
    .multipleOf(0.01, "Alert threshold must have at most 2 decimal places")
    .optional(),
});

export type UpdateConfigurationInput = z.infer<typeof updateConfigurationSchema>;
