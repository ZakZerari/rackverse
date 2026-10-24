import { describe, expect, it } from "vitest";
import fc from "fast-check";
import { CATALOG } from "@/data/catalog";
import type { Design, Placement, Rack, Requirements } from "@/lib/types";
import { validateDesign } from "@/lib/validate";

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

function design(placements: Placement[], rackOverrides: Partial<Rack> = {}): Design {
  return { rack: rack(rackOverrides), placements, version: 1 };
}

function codes(violations: ReturnType<typeof validateDesign>): string[] {
  return violations.map((v) => v.code);
}

describe("validateDesign — one case per rule", () => {
  it("UNKNOWN_CATALOG_ID for a placement referencing a missing catalog id", () => {
    const d = design([{ id: "p1", catalogId: "does-not-exist", startU: 1, face: "front" }]);
    expect(codes(validateDesign(d, reqs()))).toContain("UNKNOWN_CATALOG_ID");
  });

  it("RACK_OUT_OF_BOUNDS when a device extends past the top of the rack", () => {
    const d = design(
      [{ id: "p1", catalogId: "srv-2u-standard", startU: 42, face: "front" }],
      { heightU: 42 }
    );
    expect(codes(validateDesign(d, reqs()))).toContain("RACK_OUT_OF_BOUNDS");
  });

  it("RACK_OUT_OF_BOUNDS when startU is below 1", () => {
    const d = design([{ id: "p1", catalogId: "srv-1u-basic", startU: 0, face: "front" }]);
    expect(codes(validateDesign(d, reqs()))).toContain("RACK_OUT_OF_BOUNDS");
  });

  it("RACK_OVERLAP for two devices on the same face in the same U range", () => {
    const d = design([
      { id: "p1", catalogId: "srv-1u-basic", startU: 10, face: "front" },
      { id: "p2", catalogId: "srv-1u-basic", startU: 10, face: "front" },
    ]);
    expect(codes(validateDesign(d, reqs()))).toContain("RACK_OVERLAP");
  });

  it("RACK_OVERLAP when a full-depth device conflicts with the opposite face", () => {
    const d = design([
      { id: "p1", catalogId: "srv-1u-basic", startU: 10, face: "front" }, // fullDepth
      { id: "p2", catalogId: "patch-1u-24", startU: 10, face: "rear" }, // not fullDepth
    ]);
    expect(codes(validateDesign(d, reqs()))).toContain("RACK_OVERLAP");
  });

  it("no RACK_OVERLAP for two non-full-depth devices on opposite faces in the same U range", () => {
    const d = design([
      { id: "p1", catalogId: "sw-1u-24", startU: 10, face: "front" },
      { id: "p2", catalogId: "patch-1u-24", startU: 10, face: "rear" },
    ]);
    expect(codes(validateDesign(d, reqs()))).not.toContain("RACK_OVERLAP");
  });

  it("DEPTH_EXCEEDED when a device is deeper than the rack's mounting depth", () => {
    const d = design(
      [{ id: "p1", catalogId: "srv-1u-basic", startU: 1, face: "front" }],
      { mountingDepthMm: 400 }
    );
    expect(codes(validateDesign(d, reqs()))).toContain("DEPTH_EXCEEDED");
  });

  it("WEIGHT_EXCEEDED when total weight exceeds the rack's max load", () => {
    const d = design(
      [{ id: "p1", catalogId: "srv-1u-basic", startU: 1, face: "front" }],
      { maxLoadKg: 5 }
    );
    expect(codes(validateDesign(d, reqs()))).toContain("WEIGHT_EXCEEDED");
  });

  it("POWER_BUDGET_EXCEEDED when total draw exceeds the power budget", () => {
    const d = design(
      [{ id: "p1", catalogId: "srv-1u-basic", startU: 1, face: "front" }],
      { powerBudgetW: 100 }
    );
    expect(codes(validateDesign(d, reqs()))).toContain("POWER_BUDGET_EXCEEDED");
  });

  it("POWER_HEADROOM_LOW (soft) when draw is over 80% of budget but not over it", () => {
    const d = design(
      [
        { id: "p1", catalogId: "srv-1u-dual", startU: 1, face: "front" }, // 450W
        { id: "p2", catalogId: "srv-1u-dual", startU: 2, face: "front" }, // 450W -> 900W total
      ],
      { powerBudgetW: 1000 }
    );
    const violations = validateDesign(d, reqs());
    expect(codes(violations)).toContain("POWER_HEADROOM_LOW");
    expect(codes(violations)).not.toContain("POWER_BUDGET_EXCEEDED");
    expect(violations.find((v) => v.code === "POWER_HEADROOM_LOW")?.severity).toBe("soft");
  });

  it("PDU_OUTLETS_INSUFFICIENT when a server has nowhere to plug in", () => {
    const d = design([{ id: "p1", catalogId: "srv-1u-basic", startU: 1, face: "front" }]);
    expect(codes(validateDesign(d, reqs()))).toContain("PDU_OUTLETS_INSUFFICIENT");
  });

  it("REDUNDANCY_SINGLE_FEED when only one feed is populated", () => {
    const d = design([
      { id: "p1", catalogId: "srv-1u-basic", startU: 1, face: "front" },
      { id: "p2", catalogId: "pdu-0u-24", startU: 1, face: "rear", feed: "A" },
    ]);
    expect(codes(validateDesign(d, reqs({ redundantPower: true })))).toContain(
      "REDUNDANCY_SINGLE_FEED"
    );
  });

  it("no REDUNDANCY_SINGLE_FEED when both feeds can independently carry the full load", () => {
    const d = design([
      { id: "p1", catalogId: "srv-1u-basic", startU: 1, face: "front" }, // 300W
      { id: "p2", catalogId: "pdu-0u-24", startU: 1, face: "rear", feed: "A" }, // 7000W capacity
      { id: "p3", catalogId: "pdu-0u-24", startU: 2, face: "rear", feed: "B" }, // 7000W capacity
    ]);
    expect(codes(validateDesign(d, reqs({ redundantPower: true })))).not.toContain(
      "REDUNDANCY_SINGLE_FEED"
    );
  });

  it("NETWORK_PORTS_INSUFFICIENT when no switch is present for a server's NICs", () => {
    const d = design([{ id: "p1", catalogId: "srv-1u-basic", startU: 1, face: "front" }]);
    expect(codes(validateDesign(d, reqs()))).toContain("NETWORK_PORTS_INSUFFICIENT");
  });

  it("BUDGET_EXCEEDED when total cost exceeds the stated budget", () => {
    const d = design([{ id: "p1", catalogId: "srv-2u-standard", startU: 1, face: "front" }]);
    expect(codes(validateDesign(d, reqs({ budgetUsd: 100 })))).toContain("BUDGET_EXCEEDED");
  });

  it("no BUDGET_EXCEEDED when budget is not provided", () => {
    const d = design([{ id: "p1", catalogId: "srv-4u-gpu", startU: 1, face: "front" }]);
    expect(codes(validateDesign(d, reqs({ budgetUsd: undefined })))).not.toContain(
      "BUDGET_EXCEEDED"
    );
  });

  it("REQUIREMENT_MISSING when a required category quantity is not met", () => {
    const d = design([{ id: "p1", catalogId: "srv-1u-basic", startU: 1, face: "front" }]);
    const violations = validateDesign(
      d,
      reqs({ required: [{ category: "server", qty: 2 }] })
    );
    expect(codes(violations)).toContain("REQUIREMENT_MISSING");
    const v = violations.find((x) => x.code === "REQUIREMENT_MISSING");
    expect(v?.details).toMatchObject({ required: 2, actual: 1 });
  });
});

describe("validateDesign — property tests", () => {
  it("an empty design has no violations when nothing is required", () => {
    fc.assert(
      fc.property(
        fc.record({
          heightU: fc.integer({ min: 1, max: 60 }),
          powerBudgetW: fc.integer({ min: 0, max: 20000 }),
          maxLoadKg: fc.integer({ min: 0, max: 2000 }),
          mountingDepthMm: fc.integer({ min: 0, max: 2000 }),
        }),
        (rackOverrides) => {
          const d = design([], rackOverrides);
          const violations = validateDesign(d, reqs({ redundantPower: false, required: [] }));
          expect(violations).toEqual([]);
        }
      )
    );
  });

  it("moving a device into free space never creates RACK_OVERLAP", () => {
    fc.assert(
      fc.property(
        fc.constantFrom("srv-1u-basic", "srv-2u-standard", "srv-4u-gpu"),
        fc.constantFrom("srv-1u-basic", "srv-2u-standard", "srv-4u-gpu"),
        (fixedId, movingId) => {
          const fixedItem = CATALOG.find((c) => c.id === fixedId)!;
          const movingItem = CATALOG.find((c) => c.id === movingId)!;
          const fixedEnd = fixedItem.heightU; // fixed device occupies U1..fixedEnd
          const farAwayStart = fixedEnd + 20;
          const freeSlotStart = fixedEnd + 1; // immediately above the fixed device, guaranteed free

          const d = design(
            [
              { id: "fixed", catalogId: fixedId, startU: 1, face: "front" },
              { id: "moving", catalogId: movingId, startU: farAwayStart, face: "front" },
            ],
            { heightU: 100 }
          );

          const moved: Design = {
            ...d,
            placements: d.placements.map((p) =>
              p.id === "moving" ? { ...p, startU: freeSlotStart } : p
            ),
          };

          expect(
            codes(validateDesign(moved, reqs())).includes("RACK_OVERLAP")
          ).toBe(false);
          void movingItem;
        }
      )
    );
  });

  it("a placement with a catalog id that doesn't exist always reports UNKNOWN_CATALOG_ID", () => {
    fc.assert(
      fc.property(
        fc.string({ minLength: 1, maxLength: 20 }),
        fc.integer({ min: 1, max: 40 }),
        (randomId, startU) => {
          fc.pre(!CATALOG.some((c) => c.id === randomId));
          const d = design([{ id: "p1", catalogId: randomId, startU, face: "front" }]);
          expect(codes(validateDesign(d, reqs()))).toContain("UNKNOWN_CATALOG_ID");
        }
      )
    );
  });
});
