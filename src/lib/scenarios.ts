import { getCatalogItem } from "@/data/catalog";
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
 * A varied, deterministic Requirements scenario for a given seed — used by
 * the benchmark (train seeds 1-99, held-out seeds 1000-1049) and
 * train-traffic. Ranges per the brief: rack 24-48U, 2-16 servers, 1-3
 * switches, power 3-12kW, budgets and redundancy on/off, some GPU-heavy.
 */
export function generateRequirements(seed: number): Requirements {
  const rng = seededRng(seed);
  const rackHeightU = 24 + Math.floor(rng() * 25);
  const serverQty = 2 + Math.floor(rng() * 15);
  const switchQty = 1 + Math.floor(rng() * 3);
  const powerBudgetW = 3000 + Math.floor(rng() * 9000);
  const redundantPower = rng() < 0.5;
  const budgetUsd = rng() < 0.7 ? 20000 + Math.floor(rng() * 80000) : undefined;
  const gpuHeavy = rng() < 0.2;

  return {
    rackHeightU,
    powerBudgetW,
    budgetUsd,
    redundantPower,
    required: [
      {
        category: "server",
        qty: serverQty,
        notes: gpuHeavy ? "compute-heavy workload; prefer GPU-capable servers" : undefined,
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

function heightOf(p: Placement): number {
  return getCatalogItem(p.catalogId)?.heightU ?? 0;
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
  const tallPlacements = placements.filter((p) => heightOf(p) > 0);
  const criticalPlacements = placements.filter((p) => {
    const category = getCatalogItem(p.catalogId)?.category;
    return category === "pdu" || category === "ups" || category === "switch";
  });
  const serverPlacements = placements.filter((p) => getCatalogItem(p.catalogId)?.category === "server");

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
      description = `Moved ${getCatalogItem(b.catalogId)?.name} on top of ${getCatalogItem(a.catalogId)?.name}.`;
      break;
    }
    case "out_of_bounds": {
      const target = pickOne(tallPlacements, rng);
      newPlacements = newPlacements.map((p) =>
        p.id === target.id ? { ...p, startU: design.rack.heightU + 5 } : p
      );
      description = `Moved ${getCatalogItem(target.catalogId)?.name} past the top of the rack.`;
      break;
    }
    case "remove_critical": {
      const target = pickOne(criticalPlacements, rng);
      newPlacements = newPlacements.filter((p) => p.id !== target.id);
      description = `Removed ${getCatalogItem(target.catalogId)?.name}.`;
      break;
    }
    case "power_hog": {
      const target = pickOne(serverPlacements, rng);
      newPlacements = newPlacements.map((p) =>
        p.id === target.id ? { ...p, catalogId: "srv-4u-gpu" } : p
      );
      description = `Swapped ${getCatalogItem(target.catalogId)?.name} for a 4U GPU server in the same slot.`;
      break;
    }
  }

  return {
    design: { ...design, placements: newPlacements, version: design.version + 1 },
    fault: kind,
    description,
  };
}
