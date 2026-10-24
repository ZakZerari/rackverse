import { describe, expect, it } from "vitest";
import { breakDesign, generateRequirements } from "@/lib/scenarios";
import { PDU_0U, SERVER_1U, SWITCH_1U } from "@/lib/__fixtures__/devices";
import { hardViolations, validateDesign } from "@/lib/validate";
import type { Design, Requirements } from "@/lib/types";

describe("generateRequirements", () => {
  it("is deterministic for a given seed", () => {
    expect(generateRequirements(42)).toEqual(generateRequirements(42));
  });

  it("produces different scenarios for different seeds", () => {
    const seen = new Set(
      Array.from({ length: 20 }, (_, i) => JSON.stringify(generateRequirements(i + 1)))
    );
    expect(seen.size).toBeGreaterThan(1);
  });

  it("stays within the documented ranges across many seeds", () => {
    for (let seed = 1; seed <= 200; seed++) {
      const r = generateRequirements(seed);
      expect(r.rackHeightU).toBeGreaterThanOrEqual(24);
      expect(r.rackHeightU).toBeLessThanOrEqual(48);
      expect(r.powerBudgetW).toBeGreaterThanOrEqual(3000);
      expect(r.powerBudgetW).toBeLessThanOrEqual(12000);
      const serverReq = r.required.find((x) => x.category === "server")!;
      const switchReq = r.required.find((x) => x.category === "switch")!;
      expect(serverReq.qty).toBeGreaterThanOrEqual(2);
      expect(serverReq.qty).toBeLessThanOrEqual(16);
      expect(switchReq.qty).toBeGreaterThanOrEqual(1);
      expect(switchReq.qty).toBeLessThanOrEqual(3);
    }
  });
});

function validRequirements(): Requirements {
  return { rackHeightU: 42, powerBudgetW: 10000, redundantPower: false, required: [] };
}

function validDesign(): Design {
  return {
    rack: { id: "r1", name: "R", heightU: 42, mountingDepthMm: 1000, maxLoadKg: 500, powerBudgetW: 10000 },
    placements: [
      { id: "p1", catalogId: SERVER_1U.id, startU: 1, face: "front" },
      { id: "p2", catalogId: SERVER_1U.id, startU: 2, face: "front" },
      { id: "p3", catalogId: SWITCH_1U.id, startU: 3, face: "front" },
      { id: "p4", catalogId: PDU_0U.id, startU: 1, face: "rear" },
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
