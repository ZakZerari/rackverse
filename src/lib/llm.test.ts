import { describe, expect, it } from "vitest";
import { z } from "zod";
import { isTransientError, toGeminiJsonSchema } from "@/lib/llm";
import { PatchSchema } from "@/lib/schemas";

describe("isTransientError", () => {
  it("treats gateway and rate-limit failures as worth waiting out", () => {
    // 503 "the gateway could not check this key just now" and 429 quota
    // errors are both things we actually hit against Mubit.
    for (const status of [429, 500, 502, 503, 504, 408]) {
      expect(isTransientError({ status })).toBe(true);
    }
    expect(isTransientError(new Error("fetch failed"))).toBe(true);
    expect(isTransientError(new Error("socket hang up"))).toBe(true);
  });

  it("treats client and schema errors as permanent — those need a new prompt, not patience", () => {
    for (const status of [400, 401, 403, 404, 422]) {
      expect(isTransientError({ status })).toBe(false);
    }
    expect(isTransientError(new Error("Invalid JSON"))).toBe(false);
    expect(isTransientError(new z.ZodError([]))).toBe(false);
  });
});

function deepFindKeys(value: unknown, key: string, found: unknown[] = []): unknown[] {
  if (Array.isArray(value)) {
    for (const v of value) deepFindKeys(v, key, found);
  } else if (value && typeof value === "object") {
    for (const [k, v] of Object.entries(value)) {
      if (k === key) found.push(v);
      deepFindKeys(v, key, found);
    }
  }
  return found;
}

describe("toGeminiJsonSchema", () => {
  it("rewrites oneOf to anyOf — Gemini's schema subset has no oneOf", () => {
    const converted = toGeminiJsonSchema({ oneOf: [{ type: "string" }, { type: "number" }] });
    expect(converted).toEqual({ anyOf: [{ type: "string" }, { type: "number" }] });
  });

  it("rewrites const to a single-value enum", () => {
    expect(toGeminiJsonSchema({ const: "add" })).toEqual({ enum: ["add"] });
  });

  it("drops $schema", () => {
    expect(toGeminiJsonSchema({ $schema: "http://json-schema.org/draft-07/schema#", type: "object" })).toEqual({
      type: "object",
    });
  });

  it("leaves a plain object schema untouched", () => {
    const schema = { type: "object", properties: { a: { type: "string" } }, required: ["a"] };
    expect(toGeminiJsonSchema(schema)).toEqual(schema);
  });

  it("converts the real PatchSchema so no oneOf or const survives", () => {
    // Zod's discriminatedUnion emits oneOf + const, neither of which Gemini
    // supports — this is the conversion that makes RepairAgent work at all.
    const raw = z.toJSONSchema(PatchSchema, { target: "draft-7" });
    expect(deepFindKeys(raw, "oneOf").length).toBeGreaterThan(0);

    const converted = toGeminiJsonSchema(raw);
    expect(deepFindKeys(converted, "oneOf")).toEqual([]);
    expect(deepFindKeys(converted, "const")).toEqual([]);
    expect(deepFindKeys(converted, "anyOf").length).toBeGreaterThan(0);
  });
});
