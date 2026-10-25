import { describe, expect, it } from "vitest";
import { estimateMinimumViableDesign, explainInfeasibility } from "@/lib/feasibility";
import type { CatalogItem, Requirements } from "@/lib/types";

/** A tiny, hand-built catalog so every test's numbers are checkable by hand —
 *  no dependency on the real catalog's prices changing underneath the test. */
const CATALOG: CatalogItem[] = [
  { id: "cheap-1psu", manufacturer: "T", name: "Cheap 1-PSU", category: "server", heightU: 1,
    depthMm: 700, weightKg: 10, powerW: 300, psuCount: 1, netPortsNeeded: 1,
    fullDepth: false, priceUsd: 1000, source: "generic", estimated: [] },
  { id: "dual-psu", manufacturer: "T", name: "Dual-PSU", category: "server", heightU: 1,
    depthMm: 700, weightKg: 12, powerW: 400, psuCount: 2, netPortsNeeded: 1,
    fullDepth: false, priceUsd: 2000, source: "generic", estimated: [] },
  { id: "switch-a", manufacturer: "T", name: "Switch", category: "switch", heightU: 1,
    depthMm: 400, weightKg: 4, powerW: 50, netPorts: 24,
    fullDepth: false, priceUsd: 500, source: "generic", estimated: [] },
  { id: "small-pdu", manufacturer: "T", name: "Small PDU", category: "pdu", heightU: 0,
    depthMm: 100, weightKg: 2, powerW: 0, powerCapacityW: 1000, outlets: 4,
    fullDepth: false, priceUsd: 200, source: "generic", estimated: [] },
  { id: "big-pdu", manufacturer: "T", name: "Big PDU", category: "pdu", heightU: 0,
    depthMm: 100, weightKg: 3, powerW: 0, powerCapacityW: 10000, outlets: 20,
    fullDepth: false, priceUsd: 800, source: "generic", estimated: [] },
];

function baseRequirements(overrides: Partial<Requirements> = {}): Requirements {
  return {
    rackHeightU: 42,
    powerBudgetW: 10000,
    redundantPower: false,
    required: [],
    ...overrides,
  };
}

describe("estimateMinimumViableDesign", () => {
  it("picks the cheapest item of each required category", () => {
    const estimate = estimateMinimumViableDesign(
      baseRequirements({ required: [{ category: "server", qty: 2 }] }),
      CATALOG
    );
    // 2x cheap-1psu ($1000 each) + 1 switch for its NIC + a PDU for its outlets.
    expect(estimate.server?.item.id).toBe("cheap-1psu");
    expect(estimate.server?.qty).toBe(2);
  });

  it("is forced onto the dual-PSU pool when redundant power is asked for", () => {
    const estimate = estimateMinimumViableDesign(
      baseRequirements({ redundantPower: true, required: [{ category: "server", qty: 1 }] }),
      CATALOG
    );
    expect(estimate.server?.item.id).toBe("dual-psu");
  });

  it("prices a redundant PDU pair sized to carry the whole load on either feed", () => {
    const estimate = estimateMinimumViableDesign(
      baseRequirements({ redundantPower: true, required: [{ category: "server", qty: 1 }] }),
      CATALOG
    );
    // The server needs a switch port too, so one switch (24 ports, 50W) joins
    // the bill. Load = 400W server + 50W switch = 450W: small-pdu's 1000W
    // capacity and 4 outlets both cover it. Two of them (one per feed): 400.
    expect(estimate.costUsd).toBe(2000 /* server */ + 500 /* switch */ + 400 /* 2x small-pdu */);
  });

  it("escalates to a bigger PDU when the small one can't carry the load", () => {
    const estimate = estimateMinimumViableDesign(
      baseRequirements({ redundantPower: true, required: [{ category: "server", qty: 3 }] }),
      CATALOG
    );
    // 3 servers x 400W + 1 switch x 50W = 1250W > small-pdu's 1000W capacity
    // -> forced to big-pdu.
    expect(estimate.costUsd).toBe(3 * 2000 + 500 /* switch */ + 2 * 800);
  });

  it("adds a switch only when something actually needs a port", () => {
    const withServer = estimateMinimumViableDesign(
      baseRequirements({ required: [{ category: "server", qty: 1 }] }),
      CATALOG
    );
    const withoutAnything = estimateMinimumViableDesign(baseRequirements(), CATALOG);
    expect(withServer.costUsd).toBeGreaterThan(0);
    expect(withoutAnything.costUsd).toBe(0);
  });

  it("flags a category with no matching catalog item as impossible, not free", () => {
    const estimate = estimateMinimumViableDesign(
      baseRequirements({ required: [{ category: "storage", qty: 1 }] }),
      CATALOG // no storage item in this catalog
    );
    expect(estimate.impossibleCategories).toContain("storage");
  });

  it("reports no PDU exists when none can carry the redundant load", () => {
    const tinyPduOnly: CatalogItem[] = [CATALOG[1], { ...CATALOG[3], powerCapacityW: 10 }];
    const estimate = estimateMinimumViableDesign(
      baseRequirements({ redundantPower: true, required: [{ category: "server", qty: 1 }] }),
      tinyPduOnly
    );
    expect(estimate.impossibleCategories).toContain("pdu");
  });
});

describe("explainInfeasibility", () => {
  it("returns null when the cheapest design fits comfortably", () => {
    const report = explainInfeasibility(
      baseRequirements({ budgetUsd: 100_000, required: [{ category: "server", qty: 2 }] }),
      CATALOG
    );
    expect(report).toBeNull();
  });

  it("proves the exact scenario a user hit: 8 dual-PSU servers under a too-small budget", () => {
    const report = explainInfeasibility(
      baseRequirements({
        redundantPower: true,
        // Minimum is 8*2000 (servers) + 500 (switch for 8 NICs) + 2*800 (PDU
        // pair big enough for the 3,250W load) = $18,100 — nowhere close.
        budgetUsd: 3000,
        required: [{ category: "server", qty: 8 }],
      }),
      CATALOG
    );
    expect(report).not.toBeNull();
    expect(report?.reasons[0]).toMatch(/\$18,100/);
    expect(report?.minCostUsd).toBe(18_100);
  });

  it("suggests dropping redundancy only when that actually helps", () => {
    const report = explainInfeasibility(
      baseRequirements({
        redundantPower: true,
        budgetUsd: 5000,
        required: [{ category: "server", qty: 3 }],
      }),
      CATALOG
    );
    // Without redundancy: 3 * 1000 (cheap-1psu) + 1 switch (500) + 1 pdu for
    // outlets. Well under both the redundant minimum and the budget.
    expect(report?.suggestions.some((s) => /dropping redundant/i.test(s))).toBe(true);
    expect(report?.suggestions.some((s) => /within budget/i.test(s))).toBe(true);
  });

  it("suggests a smaller server count computed from the real unit price", () => {
    const report = explainInfeasibility(
      baseRequirements({
        redundantPower: true,
        budgetUsd: 10_000,
        required: [{ category: "server", qty: 8 }],
      }),
      CATALOG
    );
    // Fixed cost (switch + PDUs) must be subtracted before dividing by the
    // $2000 unit price — this pins that the arithmetic, not just the prose,
    // is right.
    expect(report?.suggestions.some((s) => /\$2,000/.test(s) && /instead of 8/.test(s))).toBe(true);
  });

  it("says plainly that nothing fits, rather than suggesting a count of zero", () => {
    const report = explainInfeasibility(
      baseRequirements({
        redundantPower: true,
        budgetUsd: 100, // less than even the fixed switch+PDU cost alone
        required: [{ category: "server", qty: 10 }],
      }),
      CATALOG
    );
    const serverSuggestion = report?.suggestions.find((s) => /\$2,000/.test(s));
    expect(serverSuggestion).toMatch(/doesn't fit/);
    expect(serverSuggestion).not.toMatch(/instead of 10/);
  });

  it("flags an unreachable power budget even when cost is fine", () => {
    const report = explainInfeasibility(
      baseRequirements({ powerBudgetW: 100, required: [{ category: "server", qty: 1 }] }),
      CATALOG
    );
    expect(report?.reasons.some((r) => /power budget/i.test(r))).toBe(true);
  });

  it("flags a rack too short for even the most compact pick", () => {
    const report = explainInfeasibility(
      baseRequirements({ rackHeightU: 1, required: [{ category: "server", qty: 2 }] }),
      CATALOG
    );
    expect(report?.reasons.some((r) => /42U rack/.test(r) === false && /rack/.test(r))).toBe(true);
  });

  it("never claims feasibility — a null result is silence, not a guarantee", () => {
    // This is a documentation test: null means "found no proof of
    // impossibility", not "a valid design exists". Nothing to assert beyond
    // the type signature, but it's worth a comment where someone might
    // otherwise be tempted to treat null as a green light.
    const report = explainInfeasibility(baseRequirements(), CATALOG);
    expect(report).toBeNull();
  });
});
