/// <reference types="vitest/globals" />
import { describe, it, expect } from "vitest";
import { telemetryEventEnvelopeSchema, TELEMETRY_EVENT_TYPES } from "@/lib/validations/telemetry";

const validEnvelope = {
  schema_version: "1.1",
  timestamp: "2026-04-19T15:53:40Z",
  hook_timestamp: "2026-04-19T15:53:40.035Z",
  session_id: "b6ac36f6-d5c9-4915-9369-637f06282021",
  event_type: "session_start" as const,
  workspace_name: "my-project",
  github_username: "testuser",
  data: { key: "value" },
};

describe("telemetryEventEnvelopeSchema", () => {
  it("accepts a valid envelope", () => {
    const result = telemetryEventEnvelopeSchema.safeParse(validEnvelope);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.schema_version).toBe("1.1");
      expect(result.data.event_type).toBe("session_start");
    }
  });

  it("accepts all valid event types", () => {
    for (const eventType of TELEMETRY_EVENT_TYPES) {
      const result = telemetryEventEnvelopeSchema.safeParse({
        ...validEnvelope,
        event_type: eventType,
      });
      expect(result.success).toBe(true);
    }
  });

  it("rejects missing schema_version", () => {
    const { schema_version: _, ...rest } = validEnvelope;
    const result = telemetryEventEnvelopeSchema.safeParse(rest);
    expect(result.success).toBe(false);
  });

  it("rejects missing timestamp", () => {
    const { timestamp: _, ...rest } = validEnvelope;
    const result = telemetryEventEnvelopeSchema.safeParse(rest);
    expect(result.success).toBe(false);
  });

  it("rejects missing hook_timestamp", () => {
    const { hook_timestamp: _, ...rest } = validEnvelope;
    const result = telemetryEventEnvelopeSchema.safeParse(rest);
    expect(result.success).toBe(false);
  });

  it("rejects missing session_id", () => {
    const { session_id: _, ...rest } = validEnvelope;
    const result = telemetryEventEnvelopeSchema.safeParse(rest);
    expect(result.success).toBe(false);
  });

  it("rejects missing event_type", () => {
    const { event_type: _, ...rest } = validEnvelope;
    const result = telemetryEventEnvelopeSchema.safeParse(rest);
    expect(result.success).toBe(false);
  });

  it("rejects missing workspace_name", () => {
    const { workspace_name: _, ...rest } = validEnvelope;
    const result = telemetryEventEnvelopeSchema.safeParse(rest);
    expect(result.success).toBe(false);
  });

  it("rejects missing data", () => {
    const { data: _, ...rest } = validEnvelope;
    const result = telemetryEventEnvelopeSchema.safeParse(rest);
    expect(result.success).toBe(false);
  });

  it("rejects invalid event_type", () => {
    const result = telemetryEventEnvelopeSchema.safeParse({
      ...validEnvelope,
      event_type: "invalid_type",
    });
    expect(result.success).toBe(false);
  });

  it("rejects invalid timestamp format", () => {
    const result = telemetryEventEnvelopeSchema.safeParse({
      ...validEnvelope,
      timestamp: "not-a-date",
    });
    expect(result.success).toBe(false);
  });

  it("rejects invalid hook_timestamp format", () => {
    const result = telemetryEventEnvelopeSchema.safeParse({
      ...validEnvelope,
      hook_timestamp: "19/04/2026",
    });
    expect(result.success).toBe(false);
  });

  it("rejects invalid session_id (non-UUID)", () => {
    const result = telemetryEventEnvelopeSchema.safeParse({
      ...validEnvelope,
      session_id: "not-a-uuid",
    });
    expect(result.success).toBe(false);
  });

  it("rejects data as non-object (string)", () => {
    const result = telemetryEventEnvelopeSchema.safeParse({
      ...validEnvelope,
      data: "not-an-object",
    });
    expect(result.success).toBe(false);
  });

  it("rejects data as non-object (number)", () => {
    const result = telemetryEventEnvelopeSchema.safeParse({
      ...validEnvelope,
      data: 42,
    });
    expect(result.success).toBe(false);
  });

  it("rejects data as non-object (array)", () => {
    const result = telemetryEventEnvelopeSchema.safeParse({
      ...validEnvelope,
      data: [1, 2, 3],
    });
    expect(result.success).toBe(false);
  });

  it("accepts data as valid object with arbitrary contents", () => {
    const result = telemetryEventEnvelopeSchema.safeParse({
      ...validEnvelope,
      data: {
        nested: { deep: true },
        count: 42,
        tags: ["a", "b"],
        nothing: null,
      },
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.data).toEqual({
        nested: { deep: true },
        count: 42,
        tags: ["a", "b"],
        nothing: null,
      });
    }
  });

  it("accepts data as empty object", () => {
    const result = telemetryEventEnvelopeSchema.safeParse({
      ...validEnvelope,
      data: {},
    });
    expect(result.success).toBe(true);
  });

  it("rejects empty workspace_name", () => {
    const result = telemetryEventEnvelopeSchema.safeParse({
      ...validEnvelope,
      workspace_name: "",
    });
    expect(result.success).toBe(false);
  });

  it("rejects missing github_username", () => {
    const { github_username: _, ...rest } = validEnvelope;
    const result = telemetryEventEnvelopeSchema.safeParse(rest);
    expect(result.success).toBe(false);
  });

  it("rejects empty github_username", () => {
    const result = telemetryEventEnvelopeSchema.safeParse({
      ...validEnvelope,
      github_username: "",
    });
    expect(result.success).toBe(false);
  });
});
