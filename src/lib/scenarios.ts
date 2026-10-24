import { getCatalogItem } from "@/data/catalog";
import type { Design, Placement } from "@/lib/types";

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
