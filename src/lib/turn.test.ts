import { describe, expect, it } from "vitest";
import { compactHistory, planTurn, summariseRequirements } from "@/lib/turn";
import type { Design, Requirements } from "@/lib/types";

function design(placementCount: number): Design {
  return {
    rack: { id: "rack-1", name: "R", heightU: 42, mountingDepthMm: 1000, maxLoadKg: 500, powerBudgetW: 10000 },
    placements: Array.from({ length: placementCount }, (_, i) => ({
      id: `pl-${i}`,
      catalogId: "dell-poweredge-r640",
      startU: i + 1,
      face: "front" as const,
    })),
    version: 1,
  };
}

describe("planTurn", () => {
  /**
   * The exact exchange a user reported. Every one of these messages used to
   * rebuild from an empty rack, so "make it better" produced a rack holding
   * one PDU and nothing else. These must all amend.
   */
  it("amends instead of rebuilding on the follow-ups that destroyed a rack", () => {
    for (const message of ["make it better", "bro why you removed everything", "add two more servers"]) {
      expect(planTurn(design(3), message).mode, message).toBe("amend");
    }
  });

  it("designs from scratch when there is nothing to amend", () => {
    expect(planTurn(null, "make it better").mode).toBe("design");
    expect(planTurn(design(0), "make it better").mode).toBe("design");
  });

  it("honours an explicit request to start over", () => {
    for (const message of [
      "start over",
      "scrap it and give me a GPU rack",
      "let's start from scratch",
      "clear the rack",
      "reset",
    ]) {
      expect(planTurn(design(3), message).mode, message).toBe("design");
    }
  });

  it("does not mistake incidental words for a restart", () => {
    // "new" and "clear" appear constantly in ordinary edit requests. Treating
    // these as restarts is exactly the failure this router exists to prevent.
    for (const message of [
      "add a new switch",
      "make the labels clearer",
      "I need a newer server model",
      "is there a clear path for the cables?",
    ]) {
      expect(planTurn(design(3), message).mode, message).toBe("amend");
    }
  });

  it("explains the decision — routing is shown in the thread, never silent", () => {
    expect(planTurn(design(3), "add a switch").reason).toContain("3-device");
    expect(planTurn(null, "anything").reason).toMatch(/no rack yet/i);
  });
});

describe("compactHistory", () => {
  const entries = Array.from({ length: 10 }, (_, i) => ({ user: `u${i}`, outcome: `o${i}` }));

  it("keeps the most recent exchanges, oldest first", () => {
    const kept = compactHistory(entries, 3);
    expect(kept.map((e) => e.user)).toEqual(["u7", "u8", "u9"]);
  });

  it("trims long messages — history rides along on every later request", () => {
    const [entry] = compactHistory([{ user: "x".repeat(500), outcome: "y".repeat(500) }]);
    expect(entry.user).toHaveLength(160);
    expect(entry.outcome).toHaveLength(160);
  });
});

describe("summariseRequirements", () => {
  const base: Requirements = { rackHeightU: 42, powerBudgetW: 10000, redundantPower: false, required: [] };

  it("reads as a one-line brief", () => {
    expect(summariseRequirements(base)).toBe("42U · 10kW");
  });

  it("includes every stated constraint", () => {
    const summary = summariseRequirements({
      ...base,
      powerBudgetW: 20000,
      budgetUsd: 60000,
      redundantPower: true,
      required: [{ category: "server", qty: 4 }],
    });
    expect(summary).toBe("42U · 20kW · $60,000 · A/B power · 4× server");
  });

  it("keeps sub-kW and fractional budgets readable", () => {
    expect(summariseRequirements({ ...base, powerBudgetW: 800 })).toContain("800W");
    expect(summariseRequirements({ ...base, powerBudgetW: 4500 })).toContain("4.5kW");
  });
});
