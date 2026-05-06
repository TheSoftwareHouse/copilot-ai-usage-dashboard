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

  it("accepts valid premiumRequestsPerSeat values", () => {
    for (const value of [1, 300, 100000]) {
      const result = configurationSchema.safeParse({
        apiMode: "organisation",
        entityName: "TestOrg",
        premiumRequestsPerSeat: value,
      });
      expect(result.success).toBe(true);
    }
  });

  it("rejects invalid premiumRequestsPerSeat values", () => {
    for (const value of [0, -1, 1.5, 100001]) {
      const result = configurationSchema.safeParse({
        apiMode: "organisation",
        entityName: "TestOrg",
        premiumRequestsPerSeat: value,
      });
      expect(result.success).toBe(false);
    }
  });

  it("rejects non-numeric premiumRequestsPerSeat", () => {
    const result = configurationSchema.safeParse({
      apiMode: "organisation",
      entityName: "TestOrg",
      premiumRequestsPerSeat: "abc",
    });
    expect(result.success).toBe(false);
  });

  it("accepts payload without premiumRequestsPerSeat (optional)", () => {
    const result = configurationSchema.safeParse({
      apiMode: "organisation",
      entityName: "TestOrg",
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.premiumRequestsPerSeat).toBeUndefined();
    }
  });
});

describe("updateConfigurationSchema", () => {
  it("accepts valid premiumRequestsPerSeat values", () => {
    for (const value of [1, 300, 100000]) {
      const result = updateConfigurationSchema.safeParse({
        premiumRequestsPerSeat: value,
      });
      expect(result.success).toBe(true);
    }
  });

  it("rejects missing premiumRequestsPerSeat", () => {
    const result = updateConfigurationSchema.safeParse({});
    expect(result.success).toBe(false);
  });

  it("rejects invalid premiumRequestsPerSeat values", () => {
    for (const value of [0, -1, 1.5, 100001]) {
      const result = updateConfigurationSchema.safeParse({
        premiumRequestsPerSeat: value,
      });
      expect(result.success).toBe(false);
    }
  });

  it("rejects non-numeric premiumRequestsPerSeat", () => {
    const result = updateConfigurationSchema.safeParse({
      premiumRequestsPerSeat: "abc",
    });
    expect(result.success).toBe(false);
  });

  it("ignores extra fields", () => {
    const result = updateConfigurationSchema.safeParse({
      apiMode: "organisation",
      entityName: "TestOrg",
      premiumRequestsPerSeat: 300,
    });
    expect(result.success).toBe(true);
  });

  it("accepts valid normSeatsCount values", () => {
    for (const value of [1, 30, 10000]) {
      const result = updateConfigurationSchema.safeParse({
        premiumRequestsPerSeat: 300,
        normSeatsCount: value,
      });
      expect(result.success).toBe(true);
    }
  });

  it("rejects invalid normSeatsCount values", () => {
    for (const value of [0, -1, 1.5, 10001]) {
      const result = updateConfigurationSchema.safeParse({
        premiumRequestsPerSeat: 300,
        normSeatsCount: value,
      });
      expect(result.success).toBe(false);
    }
  });

  it("accepts valid deviationWarningThreshold values", () => {
    for (const value of [1.01, 1.5, 99.99]) {
      const result = updateConfigurationSchema.safeParse({
        premiumRequestsPerSeat: 300,
        deviationWarningThreshold: value,
      });
      expect(result.success).toBe(true);
    }
  });

  it("rejects invalid deviationWarningThreshold values", () => {
    for (const value of [0, 1.0, 100, -1, 1.555]) {
      const result = updateConfigurationSchema.safeParse({
        premiumRequestsPerSeat: 300,
        deviationWarningThreshold: value,
      });
      expect(result.success).toBe(false);
    }
  });

  it("accepts valid deviationAlertThreshold values", () => {
    for (const value of [1.01, 2.0, 99.99]) {
      const result = updateConfigurationSchema.safeParse({
        premiumRequestsPerSeat: 300,
        deviationAlertThreshold: value,
      });
      expect(result.success).toBe(true);
    }
  });

  it("rejects invalid deviationAlertThreshold values", () => {
    for (const value of [0, 1.0, 100, -1, 2.555]) {
      const result = updateConfigurationSchema.safeParse({
        premiumRequestsPerSeat: 300,
        deviationAlertThreshold: value,
      });
      expect(result.success).toBe(false);
    }
  });

  it("accepts payload without norm fields (fields are optional)", () => {
    const result = updateConfigurationSchema.safeParse({
      premiumRequestsPerSeat: 300,
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.normSeatsCount).toBeUndefined();
      expect(result.data.deviationWarningThreshold).toBeUndefined();
      expect(result.data.deviationAlertThreshold).toBeUndefined();
    }
  });
});
