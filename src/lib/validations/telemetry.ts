import { z } from "zod";

export const TELEMETRY_EVENT_TYPES = [
  "session_start",
  "session_end",
  "user_prompt",
  "tool_call",
  "tool_result",
  "error",
] as const;

export const telemetryEventEnvelopeSchema = z.object({
  schema_version: z.string({
    error: "schema_version is required",
  }),
  timestamp: z.string({
    error: "timestamp is required",
  }).datetime({ message: "timestamp must be a valid ISO 8601 date-time string" }),
  hook_timestamp: z.string({
    error: "hook_timestamp is required",
  }).datetime({ message: "hook_timestamp must be a valid ISO 8601 date-time string" }),
  session_id: z.string({
    error: "session_id is required",
  }).uuid("session_id must be a valid UUID"),
  event_type: z.enum(TELEMETRY_EVENT_TYPES, {
    error: "event_type must be one of: session_start, session_end, user_prompt, tool_call, tool_result, error",
  }),
  workspace_name: z.string({
    error: "workspace_name is required",
  }).min(1, "workspace_name cannot be empty"),
  github_username: z.string({
    error: "github_username is required",
  }).min(1, "github_username cannot be empty"),
  data: z.object({}).passthrough(),
});

export type TelemetryEventEnvelopeInput = z.infer<typeof telemetryEventEnvelopeSchema>;

export const telemetryUsageQuerySchema = z.object({
  month: z.coerce.number().int().min(1).max(12),
  year: z.coerce.number().int().min(2020),
  day: z.coerce.number().int().min(1).max(31).optional(),
  github_username: z.string().min(1).optional(),
  team_id: z.coerce.number().int().min(1).optional(),
}).refine(
  (data) => !(data.github_username && data.team_id),
  { message: "Cannot filter by both github_username and team_id", path: ["team_id"] }
);

export type TelemetryUsageQueryInput = z.infer<typeof telemetryUsageQuerySchema>;
