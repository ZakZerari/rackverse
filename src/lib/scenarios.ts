import { catalogItemFor } from "@/lib/catalog";
import type { Design, Placement, Requirements } from "@/lib/types";

/** Deterministic PRNG (mulberry32) so a given seed always reproduces the same scenario. */
function seededRng(seed: number): () => number {
  let state = seed;
  return () => {
    state |= 0;
    state = (state + 0x6d2b79f5) | 0;
    let t = Math.imul(state ^ (state >>> 15), 1 | state);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * Workload profiles keep the benchmark plausible: budgets include supporting
 * network/power gear and GPU workloads receive enough power and money for
 * actual GPU servers. Seeds are stable across training and held-out runs.
 */
export function generateRequirements(seed: number): Requirements {
  const rng = seededRng(seed);
  const profile = Math.floor(rng() * 4);
  const serverQty = profile === 0 ? 2 + Math.floor(rng() * 3)
    : profile === 1 ? 5 + Math.floor(rng() * 8)
      : profile === 2 ? 13 + Math.floor(rng() * 4)
        : 2 + Math.floor(rng() * 2);
  const switchQty = profile === 0 || profile === 3 ? 1 : 1 + Math.floor(rng() * 2);
  const rackHeightU = profile === 0 ? 24 + Math.floor(rng() * 7) : profile === 3 ? 48 : 36 + Math.floor(rng() * 13);
  const powerBudgetW = profile === 0 ? 3000 + Math.floor(rng() * 2001)
    : profile === 1 ? Math.max(6000, Math.min(12000, serverQty * 700 + 1500))
      : profile === 2 ? 10000 + Math.floor(rng() * 2001) : 12000;
  const redundantPower = profile !== 3 && rng() < 0.5;
  const adjustedPowerBudgetW = profile === 2 && redundantPower ? 12000 : powerBudgetW;
  const budgetUsd = profile === 0 ? 20000 + Math.floor(rng() * 10001)
    : profile === 1 ? 30000 + serverQty * 6000
      : profile === 2 ? 80000 + Math.floor(rng() * 20001)
        : 60000 * serverQty + 10000;

  return {
    rackHeightU,
    powerBudgetW: adjustedPowerBudgetW,
    budgetUsd,
    redundantPower,
    required: [
      {
        category: "server",
        qty: serverQty,
        notes: profile === 3 ? "GPU training: each server must be GPU capable"
          : profile === 2 ? "dense compute; prefer efficient 1U servers" : undefined,
      },
      { category: "switch", qty: switchQty },
    ],
  };
}

export type FaultKind = "overlap" | "out_of_bounds" | "remove_critical" | "power_hog";

export interface BreakResult {
  design: Design;
  fault: FaultKind;
  description: string;
}

function heightOf(design: Design, p: Placement): number {
  return catalogItemFor(design, p.catalogId)?.heightU ?? 0;
}

function pickOne<T>(arr: T[], rng: () => number): T {
  return arr[Math.floor(rng() * arr.length)];
}

function pickTwo<T>(arr: T[], rng: () => number): [T, T] {
  const a = pickOne(arr, rng);
  const b = pickOne(
    arr.filter((x) => x !== a),
    rng
  );
  return [a, b];
}

/**
 * Injects one random, plausible fault into an otherwise-valid design (a
 * collision, an out-of-bounds move, a missing PDU/switch, or a power-hungry
 * swap) — pure function, returns a new Design. Used by the Studio's
 * "Break it" button and the benchmark's held-out scenarios.
 */
export function breakDesign(design: Design, rng: () => number = Math.random): BreakResult {
  const placements = design.placements;
  const tallPlacements = placements.filter((p) => heightOf(design, p) > 0);
  const criticalPlacements = placements.filter((p) => {
    const category = catalogItemFor(design, p.catalogId)?.category;
    return category === "pdu" || category === "ups" || category === "switch";
  });
  const serverPlacements = placements.filter((p) => catalogItemFor(design, p.catalogId)?.category === "server");

  const candidates: FaultKind[] = [];
  if (tallPlacements.length >= 2) candidates.push("overlap");
  if (tallPlacements.length >= 1) candidates.push("out_of_bounds");
  if (criticalPlacements.length >= 1) candidates.push("remove_critical");
  if (serverPlacements.length >= 1) candidates.push("power_hog");

  if (candidates.length === 0) {
    return { design, fault: "overlap", description: "Nothing to break — the rack is empty." };
  }

  const kind = candidates[Math.floor(rng() * candidates.length)];
  let newPlacements = placements.map((p) => ({ ...p }));
  let description = "";

  switch (kind) {
    case "overlap": {
      const [a, b] = pickTwo(tallPlacements, rng);
      newPlacements = newPlacements.map((p) => (p.id === b.id ? { ...p, startU: a.startU, face: a.face } : p));
      description = `Moved ${catalogItemFor(design, b.catalogId)?.name} on top of ${catalogItemFor(design, a.catalogId)?.name}.`;
      break;
    }
    case "out_of_bounds": {
      const target = pickOne(tallPlacements, rng);
      newPlacements = newPlacements.map((p) =>
        p.id === target.id ? { ...p, startU: design.rack.heightU + 5 } : p
      );
      description = `Moved ${catalogItemFor(design, target.catalogId)?.name} past the top of the rack.`;
      break;
    }
    case "remove_critical": {
      const target = pickOne(criticalPlacements, rng);
      newPlacements = newPlacements.filter((p) => p.id !== target.id);
      description = `Removed ${catalogItemFor(design, target.catalogId)?.name}.`;
      break;
    }
    case "power_hog": {
      const target = pickOne(serverPlacements, rng);
      newPlacements = newPlacements.map((p) =>
        p.id === target.id ? { ...p, catalogId: "supermicro-as-4125gs-tnrt" } : p
      );
      description = `Swapped ${catalogItemFor(design, target.catalogId)?.name} for a 4U GPU server in the same slot.`;
      break;
    }
  }

  return {
    design: { ...design, placements: newPlacements, version: design.version + 1 },
    fault: kind,
    description,
  };
}
