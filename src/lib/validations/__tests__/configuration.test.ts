/// <reference types="vitest/globals" />
import { describe, it, expect } from "vitest";
import { configurationSchema, updateConfigurationSchema } from "@/lib/validations/configuration";

describe("configurationSchema", () => {
  it("accepts valid organisation input", () => {
    const result = configurationSchema.safeParse({
      apiMode: "organisation",
      entityName: "TheSoftwareHouse",
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.apiMode).toBe("organisation");
      expect(result.data.entityName).toBe("TheSoftwareHouse");
    }
  });

  it("accepts valid enterprise input", () => {
    const result = configurationSchema.safeParse({
      apiMode: "enterprise",
      entityName: "AcmeCorp",
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.apiMode).toBe("enterprise");
      expect(result.data.entityName).toBe("AcmeCorp");
    }
  });

  it("trims whitespace from entityName", () => {
    const result = configurationSchema.safeParse({
      apiMode: "organisation",
      entityName: "  SpacedName  ",
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.entityName).toBe("SpacedName");
    }
  });

  it("rejects invalid apiMode", () => {
    const result = configurationSchema.safeParse({
      apiMode: "invalid",
      entityName: "TestOrg",
    });
    expect(result.success).toBe(false);
  });

  it("rejects empty entityName", () => {
    const result = configurationSchema.safeParse({
      apiMode: "organisation",
      entityName: "",
    });
    expect(result.success).toBe(false);
  });

  it("rejects whitespace-only entityName", () => {
    const result = configurationSchema.safeParse({
      apiMode: "organisation",
      entityName: "   ",
    });
    expect(result.success).toBe(false);
  });

  it("rejects entityName over 255 characters", () => {
    const result = configurationSchema.safeParse({
      apiMode: "organisation",
      entityName: "a".repeat(256),
    });
    expect(result.success).toBe(false);
  });

  it("accepts entityName at exactly 255 characters", () => {
    const result = configurationSchema.safeParse({
      apiMode: "organisation",
      entityName: "a".repeat(255),
    });
    expect(result.success).toBe(true);
  });

  it("rejects missing apiMode", () => {
    const result = configurationSchema.safeParse({
      entityName: "TestOrg",
    });
    expect(result.success).toBe(false);
  });

  it("rejects missing entityName", () => {
    const result = configurationSchema.safeParse({
      apiMode: "organisation",
    });
    expect(result.success).toBe(false);
  });

  it("rejects the retired allowance field", () => {
    const result = configurationSchema.safeParse({
      apiMode: "organisation",
      entityName: "TestOrg",
      legacyAllowance: 300,
    });
    expect(result.success).toBe(false);
  });
});

describe("updateConfigurationSchema", () => {
  it("accepts valid threshold updates", () => {
    const result = updateConfigurationSchema.safeParse({
      deviationWarningThreshold: 175,
      deviationAlertThreshold: 350,
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.deviationWarningThreshold).toBe(175);
      expect(result.data.deviationAlertThreshold).toBe(350);
    }
  });

  it("rejects an empty payload", () => {
    const result = updateConfigurationSchema.safeParse({});
    expect(result.success).toBe(false);
  });

  it("rejects the retired allowance field", () => {
    const result = updateConfigurationSchema.safeParse({ legacyAllowance: 300 });
    expect(result.success).toBe(false);
  });

  it("rejects invalid deviationWarningThreshold values", () => {
    for (const value of [0, 50000.01, -1, 1.555]) {
      const result = updateConfigurationSchema.safeParse({
        deviationWarningThreshold: value,
      });
      expect(result.success).toBe(false);
    }
  });

  it("rejects invalid deviationAlertThreshold values", () => {
    for (const value of [0, 50000.01, -1, 2.555]) {
      const result = updateConfigurationSchema.safeParse({
        deviationAlertThreshold: value,
      });
      expect(result.success).toBe(false);
    }
  });
});
