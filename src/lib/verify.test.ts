import { describe, expect, it } from "vitest";
import { PDU_0U, SERVER_1U } from "@/lib/__fixtures__/devices";
import type { Design, Rack, Requirements } from "@/lib/types";
import { verifyPatch } from "@/lib/verify";

function rack(overrides: Partial<Rack> = {}): Rack {
  return {
    id: "r1",
    name: "Test Rack",
    heightU: 42,
    mountingDepthMm: 1000,
    maxLoadKg: 500,
    powerBudgetW: 10000,
    ...overrides,
  };
}

function reqs(overrides: Partial<Requirements> = {}): Requirements {
  return {
    rackHeightU: 42,
    powerBudgetW: 10000,
    redundantPower: false,
    required: [],
    ...overrides,
  };
}

describe("verifyPatch", () => {
  it("accepts a patch that fixes a hard violation (adds the missing PDU)", () => {
    const design: Design = {
      rack: rack(),
      placements: [{ id: "p1", catalogId: SERVER_1U.id, startU: 1, face: "front" }],
      version: 1,
    };
    const result = verifyPatch(
      design,
      { ops: [{ op: "add", catalogId: PDU_0U.id, startU: 1, face: "rear" }], rationale: "add PDU" },
      reqs()
    );
    expect(result.accepted).toBe(true);
    expect(result.design.placements).toHaveLength(2);
  });

  it("rejects a patch that introduces a new hard violation", () => {
    const design: Design = {
      rack: rack(),
      placements: [{ id: "p1", catalogId: SERVER_1U.id, startU: 1, face: "front" }],
      version: 1,
    };
    // Adding an overlapping device doesn't fix the missing PDU/switch and adds RACK_OVERLAP.
    const result = verifyPatch(
      design,
      { ops: [{ op: "add", catalogId: SERVER_1U.id, startU: 1, face: "front" }], rationale: "bad" },
      reqs()
    );
    expect(result.accepted).toBe(false);
    expect(result.design).toBe(design);
  });

  it("rejects a patch with no net improvement", () => {
    const design: Design = {
      rack: rack(),
      placements: [],
      version: 1,
    };
    const result = verifyPatch(
      design,
      { ops: [{ op: "move", placementId: "nope", newStartU: 5 }], rationale: "no-op" },
      reqs()
    );
    expect(result.accepted).toBe(false);
  });
});
