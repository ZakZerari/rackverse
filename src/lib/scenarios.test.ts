import { describe, expect, it } from "vitest";
import { breakDesign } from "@/lib/scenarios";
import { hardViolations, validateDesign } from "@/lib/validate";
import type { Design, Requirements } from "@/lib/types";

function validRequirements(): Requirements {
  return { rackHeightU: 42, powerBudgetW: 10000, redundantPower: false, required: [] };
}

function validDesign(): Design {
  return {
    rack: { id: "r1", name: "R", heightU: 42, mountingDepthMm: 1000, maxLoadKg: 500, powerBudgetW: 10000 },
    placements: [
      { id: "p1", catalogId: "srv-1u-basic", startU: 1, face: "front" },
      { id: "p2", catalogId: "srv-1u-basic", startU: 2, face: "front" },
      { id: "p3", catalogId: "sw-1u-24", startU: 3, face: "front" },
      { id: "p4", catalogId: "pdu-0u-24", startU: 1, face: "rear" },
    ],
    version: 1,
  };
}

describe("breakDesign", () => {
  it("starts from a design with no hard violations (sanity check on the fixture)", () => {
    expect(hardViolations(validateDesign(validDesign(), validRequirements()))).toEqual([]);
  });

  it("always introduces at least one new hard violation, for every fault kind it can pick", () => {
    // Run many times with different seeded rng values to hit every branch.
    for (let i = 0; i < 20; i++) {
      const rng = () => (i + 0.5) / 20;
      const result = breakDesign(validDesign(), rng);
      const violations = hardViolations(validateDesign(result.design, validRequirements()));
      expect(violations.length).toBeGreaterThan(0);
    }
  });

  it("is a pure function — never mutates the input design", () => {
    const original = validDesign();
    const snapshot = JSON.parse(JSON.stringify(original));
    breakDesign(original, () => 0.1);
    expect(original).toEqual(snapshot);
  });

  it("does nothing destructive to an empty design", () => {
    const empty: Design = {
      rack: { id: "r1", name: "R", heightU: 42, mountingDepthMm: 1000, maxLoadKg: 500, powerBudgetW: 10000 },
      placements: [],
      version: 1,
    };
    const result = breakDesign(empty);
    expect(result.design.placements).toEqual([]);
  });
});
