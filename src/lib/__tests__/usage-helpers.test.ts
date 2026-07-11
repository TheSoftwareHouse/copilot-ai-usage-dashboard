/// <reference types="vitest/globals" />
import { describe, it, expect } from "vitest";
import { getUsageColour } from "@/lib/usage-helpers";

describe("getUsageColour", () => {
  it("returns red for 0%", () => {
    const result = getUsageColour(0);
    expect(result).toEqual({ bgClass: "bg-red-500", label: "Low usage" });
  });

  it("returns red for 49.9%", () => {
    const result = getUsageColour(49.9);
    expect(result).toEqual({ bgClass: "bg-red-500", label: "Low usage" });
  });

  it("returns orange for 50%", () => {
    const result = getUsageColour(50);
    expect(result).toEqual({ bgClass: "bg-orange-500", label: "Moderate usage" });
  });

  it("returns orange for 89.9%", () => {
    const result = getUsageColour(89.9);
    expect(result).toEqual({ bgClass: "bg-orange-500", label: "Moderate usage" });
  });

  it("returns green for 90%", () => {
    const result = getUsageColour(90);
    expect(result).toEqual({ bgClass: "bg-green-500", label: "High usage" });
  });

  it("returns green for 100%", () => {
    const result = getUsageColour(100);
    expect(result).toEqual({ bgClass: "bg-green-500", label: "High usage" });
  });

  it("returns green for 150% (over 100%)", () => {
    const result = getUsageColour(150);
    expect(result).toEqual({ bgClass: "bg-green-500", label: "High usage" });
  });
});


