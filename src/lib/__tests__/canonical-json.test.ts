import { describe, it, expect } from "vitest";
import { canonicalJson } from "@/lib/canonical-json";

describe("canonicalJson", () => {
  it("produces same output for objects with different key orders", () => {
    const a = canonicalJson({ z: 1, a: 2, m: 3 });
    const b = canonicalJson({ a: 2, m: 3, z: 1 });
    expect(a).toBe(b);
    expect(a).toBe('{"a":2,"m":3,"z":1}');
  });

  it("sorts nested objects recursively", () => {
    const result = canonicalJson({ z: { b: 1, a: 2 }, a: { d: 4, c: 3 } });
    expect(result).toBe('{"a":{"c":3,"d":4},"z":{"a":2,"b":1}}');
  });

  it("preserves array element order", () => {
    const result = canonicalJson([3, 1, 2]);
    expect(result).toBe("[3,1,2]");
  });

  it("sorts keys inside objects within arrays", () => {
    const result = canonicalJson([{ b: 1, a: 2 }]);
    expect(result).toBe('[{"a":2,"b":1}]');
  });

  it("serialises string primitives correctly", () => {
    expect(canonicalJson("hello")).toBe('"hello"');
  });

  it("serialises number primitives correctly", () => {
    expect(canonicalJson(42)).toBe("42");
  });

  it("serialises boolean primitives correctly", () => {
    expect(canonicalJson(true)).toBe("true");
    expect(canonicalJson(false)).toBe("false");
  });

  it("handles null", () => {
    expect(canonicalJson(null)).toBe("null");
  });

  it("handles null values inside objects", () => {
    const result = canonicalJson({ b: null, a: 1 });
    expect(result).toBe('{"a":1,"b":null}');
  });
});
