import { describe, it, expect } from "vitest";

describe("UsageCostStatsCards", () => {
  it("exports a default function component", async () => {
    const mod = await import("../UsageCostStatsCards");
    expect(mod.default).toBeDefined();
    expect(typeof mod.default).toBe("function");
  });
});
