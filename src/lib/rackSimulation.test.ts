import { describe, expect, it } from "vitest";
import { CATALOG } from "@/data/catalog";
import { catalogItemFor } from "@/lib/catalog";
import { removeEquipment, resetEquipment, updateRack, upsertEquipment } from "@/lib/configuration";
import { designTotals } from "@/lib/summary";
import { applyChaosPreset } from "@/lib/scenarios";
import { createDemoRack } from "@/lib/demoRack";
import type { CatalogItem, Design, Requirements } from "@/lib/types";
import { hardViolations, validateDesign } from "@/lib/validate";
import { verifyPatch } from "@/lib/verify";
import { parseWorkspace, serializeWorkspace } from "@/lib/workspace";

const serverId = "supermicro-superserver-1027r-wrf";
const switchId = "brocade-icx-6430-48";
const pduId = "apc-ap7868";

function realisticRack(): { design: Design; requirements: Requirements } {
  return createDemoRack("rack-1");
}

function codes(design: Design, requirements: Requirements): string[] {
  return validateDesign(design, requirements).map((violation) => violation.code);
}

describe("production rack simulation", () => {
  it("turns a 6 kW production rack into an over-budget rack after a 30% utility cut", () => {
    const { design, requirements } = realisticRack();
    const result = applyChaosPreset(design, requirements, "power_cut");
    expect(result.design.rack.powerBudgetW).toBe(4200);
    expect(result.requirements.powerBudgetW).toBe(4200);
    expect(codes(result.design, result.requirements)).toContain("POWER_BUDGET_EXCEEDED");
    expect(design.rack.powerBudgetW).toBe(6000);
  });

  it("shows a real A/B failure when the B-side PDU goes out of service", () => {
    const { design, requirements } = realisticRack();
    const result = applyChaosPreset(design, requirements, "pdu_failure");
    expect(result.design.placements.some((placement) => placement.id === "pdu-b")).toBe(false);
    expect(codes(result.design, result.requirements)).toContain("REDUNDANCY_SINGLE_FEED");
    expect(design.placements.some((placement) => placement.id === "pdu-b")).toBe(true);
  });

  it("makes a 25% CapEx cut visible without dropping required servers, ports, or storage", () => {
    const { design, requirements } = realisticRack();
    const result = applyChaosPreset(design, { ...requirements, budgetUsd: 30000 }, "capex_slash");
    expect(result.requirements.budgetUsd).toBe(22500);
    expect(result.design.placements).toEqual(design.placements);
    expect(codes(result.design, result.requirements)).toContain("BUDGET_EXCEEDED");
    expect(codes(result.design, result.requirements)).not.toContain("NETWORK_PORTS_INSUFFICIENT");
  });

  it("accepts a physically plausible 42U rack with six servers, storage, switching and independent A/B PDUs", () => {
    const { design, requirements } = realisticRack();
    expect(validateDesign(design, requirements)).toEqual([]);
    const totals = designTotals(design);
    expect(totals.deviceCount).toBe(10);
    expect(totals.usedU).toBe(9);
    expect(totals.powerW).toBe(4488);
    expect(totals.outletsRequired).toBe(14);
    expect(totals.outletsSupplied).toBe(72);
    expect(totals.portsRequired).toBe(16);
    expect(totals.portsSupplied).toBe(52);
  });

  it("shrinking rack height or mounting depth exposes actual placement and fit errors", () => {
    const { design, requirements } = realisticRack();
    const shorter = updateRack(design, { ...design.rack, heightU: 8 });
    expect(codes(shorter, { ...requirements, rackHeightU: 8 })).toContain("RACK_OUT_OF_BOUNDS");
    const shallow = updateRack(design, { ...design.rack, mountingDepthMm: 700 });
    expect(codes(shallow, requirements)).toContain("DEPTH_EXCEEDED");
  });

  it("lowering electrical capacity, load rating or cost limit reports separate constraints", () => {
    const { design, requirements } = realisticRack();
    const constrained = updateRack(design, { ...design.rack, maxLoadKg: 100, powerBudgetW: 3000 });
    const failures = codes(constrained, { ...requirements, powerBudgetW: 3000, budgetUsd: 10000 });
    expect(failures).toEqual(expect.arrayContaining(["WEIGHT_EXCEEDED", "POWER_BUDGET_EXCEEDED", "BUDGET_EXCEEDED"]));
  });

  it("losing one PDU breaks redundancy, but preserves the other power checks", () => {
    const { design, requirements } = realisticRack();
    const damaged = { ...design, placements: design.placements.filter((placement) => placement.id !== "pdu-b") };
    expect(codes(damaged, requirements)).toContain("REDUNDANCY_SINGLE_FEED");
    expect(codes(damaged, requirements)).not.toContain("PDU_OUTLETS_INSUFFICIENT");
  });

  it("detects single-PSU servers and a feed with too few physical outlets", () => {
    const { design, requirements } = realisticRack();
    const onePsu = { ...CATALOG.find((item) => item.id === serverId)!, psuCount: 1 };
    const changed = upsertEquipment(design, onePsu);
    expect(codes(changed, requirements)).toContain("REDUNDANCY_DEVICE_PSU");

    const smallPdu = { ...CATALOG.find((item) => item.id === pduId)!, outlets: 4 };
    const underOutlet = upsertEquipment(design, smallPdu);
    expect(codes(underOutlet, requirements)).toContain("REDUNDANCY_FEED_OUTLETS_INSUFFICIENT");
  });

  it("a repair restoring the missing independent feed passes deterministic verification", () => {
    const { design, requirements } = realisticRack();
    const damaged = { ...design, placements: design.placements.filter((placement) => placement.id !== "pdu-b") };
    const result = verifyPatch(damaged, { ops: [{ op: "add", catalogId: pduId, startU: 1, face: "rear", feed: "B" }], rationale: "Restore feed B" }, requirements);
    expect(result.accepted).toBe(true);
    expect(hardViolations(result.after)).toEqual([]);
    expect(damaged.placements).toHaveLength(9);
  });

  it("rejects a patch that fixes two faults by creating a new collision", () => {
    const { design, requirements } = realisticRack();
    const damaged = { ...design, placements: design.placements.filter((placement) => placement.id !== "pdu-b" && placement.id !== "switch") };
    const result = verifyPatch(damaged, { ops: [
      { op: "add", catalogId: pduId, startU: 1, face: "rear", feed: "B" },
      { op: "add", catalogId: switchId, startU: 1, face: "front" },
    ], rationale: "Restore missing hardware" }, requirements);
    expect(result.accepted).toBe(false);
    expect(result.reason).toContain("RACK_OVERLAP");
  });
});

describe("editable equipment and saved rack", () => {
  it("uses custom server specs in power, cost, ports and weight checks", () => {
    const { design, requirements } = realisticRack();
    const custom: CatalogItem = { ...CATALOG.find((item) => item.id === serverId)!,
      id: "custom-ai-server", name: "AI compute node", source: "custom", estimated: [],
      heightU: 2, powerW: 4000, weightKg: 65, priceUsd: 25000, netPortsNeeded: 48 };
    const withCustom = upsertEquipment(design, custom);
    const placed = { ...withCustom, placements: [...withCustom.placements,
      { id: "custom-node", catalogId: custom.id, startU: 12, face: "front" as const }] };
    expect(catalogItemFor(placed, custom.id)).toEqual(custom);
    expect(codes(placed, requirements)).toEqual(expect.arrayContaining([
      "POWER_BUDGET_EXCEEDED", "BUDGET_EXCEEDED", "NETWORK_PORTS_INSUFFICIENT",
    ]));
    expect(designTotals(placed).costUsd).toBe(designTotals(design).costUsd + 25000);
    expect(() => removeEquipment(placed, custom.id)).toThrow(/Remove this equipment/);
  });

  it("editing a built-in price changes budget checks and reset restores source data", () => {
    const { design, requirements } = realisticRack();
    const original = CATALOG.find((item) => item.id === serverId)!;
    const edited = upsertEquipment(design, { ...original, priceUsd: 20000, estimated: ["priceUsd"] });
    expect(codes(edited, requirements)).toContain("BUDGET_EXCEEDED");
    const restored = resetEquipment(edited, serverId);
    expect(codes(restored, requirements)).not.toContain("BUDGET_EXCEEDED");
    expect(catalogItemFor(restored, serverId)?.priceUsd).toBe(original.priceUsd);
  });

  it("rejects impossible equipment fields before they enter a design", () => {
    const { design } = realisticRack();
    const original = CATALOG.find((item) => item.id === serverId)!;
    expect(() => upsertEquipment(design, { ...original, heightU: -1 })).toThrow();
    expect(() => upsertEquipment(design, { ...original, category: "pdu", powerCapacityW: 0, outlets: 0 })).toThrow();
    expect(() => updateRack(design, { ...design.rack, heightU: 0 })).toThrow();
  });

  it("round-trips rack settings, custom specs and version history through browser storage", () => {
    const { design, requirements } = realisticRack();
    const custom = { ...CATALOG.find((item) => item.id === serverId)!, id: "custom-test", source: "custom" as const };
    const edited = upsertEquipment(design, custom);
    const saved = parseWorkspace(serializeWorkspace({ design: edited, requirements, versions: [design, edited] }));
    expect(saved?.design.catalogOverrides).toEqual([custom]);
    expect(saved?.versions).toHaveLength(2);
    expect(parseWorkspace("{not JSON")).toBeNull();
  });
});
