import { getCatalogItem } from "@/data/catalog";
import type {
  CatalogItem,
  Design,
  OptimisationObjective,
  Placement,
  Requirements,
  Violation,
} from "@/lib/types";

interface Resolved {
  placement: Placement;
  item: CatalogItem;
}

function resolvePlacements(design: Design): {
  resolved: Resolved[];
  unknown: Placement[];
} {
  const resolved: Resolved[] = [];
  const unknown: Placement[] = [];
  for (const placement of design.placements) {
    const item = getCatalogItem(placement.catalogId);
    if (item) resolved.push({ placement, item });
    else unknown.push(placement);
  }
  return { resolved, unknown };
}

function range(p: Placement, item: CatalogItem): [number, number] | null {
  if (item.heightU <= 0) return null; // 0U devices (vertical PDUs) occupy no U range
  return [p.startU, p.startU + item.heightU - 1];
}

function overlaps(a: [number, number], b: [number, number]): boolean {
  return a[0] <= b[1] && b[0] <= a[1];
}

/** Outlets a device consumes on a PDU/UPS. Only power-consuming devices need one. */
function outletsNeeded(item: CatalogItem): number {
  if (item.category === "server") return item.psuCount ?? 1;
  if (item.category === "switch") return 1;
  if (item.category === "storage") return 1;
  return 0;
}

export function validateDesign(
  design: Design,
  requirements: Requirements
): Violation[] {
  const violations: Violation[] = [];
  const { resolved, unknown } = resolvePlacements(design);
  const { rack } = design;

  if (unknown.length > 0) {
    violations.push({
      code: "UNKNOWN_CATALOG_ID",
      severity: "hard",
      message: `${unknown.length} placement(s) reference a catalog id that does not exist.`,
      placementIds: unknown.map((p) => p.id),
      details: { catalogIds: unknown.map((p) => p.catalogId).join(",") },
    });
  }

  // Bounds
  for (const { placement, item } of resolved) {
    const r = range(placement, item);
    if (!r) continue;
    const [start, end] = r;
    if (start < 1 || end > rack.heightU) {
      violations.push({
        code: "RACK_OUT_OF_BOUNDS",
        severity: "hard",
        message: `${item.name} at U${placement.startU} (${item.heightU}U) falls outside the ${rack.heightU}U rack.`,
        placementIds: [placement.id],
        details: { startU: placement.startU, heightU: item.heightU },
      });
    }
  }

  // Overlap: same face, or full-depth vs. opposite face
  for (let i = 0; i < resolved.length; i++) {
    for (let j = i + 1; j < resolved.length; j++) {
      const a = resolved[i];
      const b = resolved[j];
      const ra = range(a.placement, a.item);
      const rb = range(b.placement, b.item);
      if (!ra || !rb) continue;
      if (!overlaps(ra, rb)) continue;

      const sameFace = a.placement.face === b.placement.face;
      const fullDepthConflict = a.item.fullDepth || b.item.fullDepth;
      if (sameFace || fullDepthConflict) {
        violations.push({
          code: "RACK_OVERLAP",
          severity: "hard",
          message: `${a.item.name} and ${b.item.name} occupy overlapping rack units.`,
          placementIds: [a.placement.id, b.placement.id],
        });
      }
    }
  }

  // Depth
  for (const { placement, item } of resolved) {
    if (item.depthMm > rack.mountingDepthMm) {
      violations.push({
        code: "DEPTH_EXCEEDED",
        severity: "hard",
        message: `${item.name} (${item.depthMm}mm) exceeds the rack's ${rack.mountingDepthMm}mm mounting depth.`,
        placementIds: [placement.id],
        details: { depthMm: item.depthMm, mountingDepthMm: rack.mountingDepthMm },
      });
    }
  }

  // Weight
  const totalWeight = resolved.reduce((sum, { item }) => sum + item.weightKg, 0);
  if (totalWeight > rack.maxLoadKg) {
    violations.push({
      code: "WEIGHT_EXCEEDED",
      severity: "hard",
      message: `Total load ${totalWeight.toFixed(1)}kg exceeds the rack's ${rack.maxLoadKg}kg capacity.`,
      placementIds: resolved.map(({ placement }) => placement.id),
      details: { totalWeight, maxLoadKg: rack.maxLoadKg },
    });
  }

  // Power budget + headroom
  const totalPower = resolved.reduce((sum, { item }) => sum + item.powerW, 0);
  if (totalPower > rack.powerBudgetW) {
    violations.push({
      code: "POWER_BUDGET_EXCEEDED",
      severity: "hard",
      message: `Total draw ${totalPower}W exceeds the rack's ${rack.powerBudgetW}W power budget.`,
      placementIds: resolved.map(({ placement }) => placement.id),
      details: { totalPower, powerBudgetW: rack.powerBudgetW },
    });
  } else if (rack.powerBudgetW > 0 && totalPower > 0.8 * rack.powerBudgetW) {
    violations.push({
      code: "POWER_HEADROOM_LOW",
      severity: "soft",
      message: `Power draw ${totalPower}W is over 80% of the ${rack.powerBudgetW}W budget.`,
      placementIds: resolved.map(({ placement }) => placement.id),
      details: { totalPower, powerBudgetW: rack.powerBudgetW },
    });
  }

  // PDU outlets
  const outletsRequired = resolved.reduce(
    (sum, { item }) => sum + outletsNeeded(item),
    0
  );
  const outletsSupplied = resolved.reduce(
    (sum, { item }) => sum + (item.category === "pdu" ? item.outlets ?? 0 : 0),
    0
  );
  if (outletsRequired > outletsSupplied) {
    violations.push({
      code: "PDU_OUTLETS_INSUFFICIENT",
      severity: "hard",
      message: `${outletsRequired} outlet(s) needed but only ${outletsSupplied} available across installed PDUs.`,
      placementIds: resolved
        .filter(({ item }) => item.category === "pdu")
        .map(({ placement }) => placement.id),
      details: { outletsRequired, outletsSupplied },
    });
  }

  // Redundant power (N+1 across two independent feeds)
  if (requirements.redundantPower) {
    const feedA = resolved.filter(
      ({ item, placement }) =>
        (item.category === "pdu" || item.category === "ups") &&
        placement.feed === "A"
    );
    const feedB = resolved.filter(
      ({ item, placement }) =>
        (item.category === "pdu" || item.category === "ups") &&
        placement.feed === "B"
    );
    const capacityA = feedA.reduce((sum, { item }) => sum + (item.powerCapacityW ?? 0), 0);
    const capacityB = feedB.reduce((sum, { item }) => sum + (item.powerCapacityW ?? 0), 0);

    if (
      feedA.length === 0 ||
      feedB.length === 0 ||
      capacityA < totalPower ||
      capacityB < totalPower
    ) {
      violations.push({
        code: "REDUNDANCY_SINGLE_FEED",
        severity: "hard",
        message: `Redundant power requires both an A and a B feed, each able to carry the full ${totalPower}W load alone.`,
        placementIds: [...feedA, ...feedB].map(({ placement }) => placement.id),
        details: { capacityA, capacityB, totalPower },
      });
    }
  }

  // Network ports
  const portsNeeded = resolved.reduce(
    (sum, { item }) => sum + (item.netPortsNeeded ?? 0),
    0
  );
  const portsSupplied = resolved.reduce(
    (sum, { item }) => sum + (item.category === "switch" ? item.netPorts ?? 0 : 0),
    0
  );
  if (portsNeeded > portsSupplied) {
    violations.push({
      code: "NETWORK_PORTS_INSUFFICIENT",
      severity: "hard",
      message: `${portsNeeded} network port(s) needed but only ${portsSupplied} available across installed switches.`,
      placementIds: resolved
        .filter(({ item }) => item.category === "switch")
        .map(({ placement }) => placement.id),
      details: { portsNeeded, portsSupplied },
    });
  }

  // Budget
  if (requirements.budgetUsd !== undefined) {
    const totalCost = resolved.reduce((sum, { item }) => sum + item.priceUsd, 0);
    if (totalCost > requirements.budgetUsd) {
      violations.push({
        code: "BUDGET_EXCEEDED",
        severity: "hard",
        message: `Total cost $${totalCost.toLocaleString()} exceeds the $${requirements.budgetUsd.toLocaleString()} budget.`,
        placementIds: resolved.map(({ placement }) => placement.id),
        details: { totalCost, budgetUsd: requirements.budgetUsd },
      });
    }
  }

  // Required categories
  for (const req of requirements.required) {
    const count = resolved.filter(({ item }) => item.category === req.category).length;
    if (count < req.qty) {
      violations.push({
        code: "REQUIREMENT_MISSING",
        severity: "hard",
        message: `Requires ${req.qty}x ${req.category}, design has ${count}.`,
        placementIds: resolved
          .filter(({ item }) => item.category === req.category)
          .map(({ placement }) => placement.id),
        details: { category: req.category, required: req.qty, actual: count },
      });
    }
  }

  return violations;
}

export function hardViolations(violations: Violation[]): Violation[] {
  return violations.filter((v) => v.severity === "hard");
}

/**
 * Higher is always better, across every objective. Used by the Verifier to
 * accept/reject a patch and by the Optimisation agent's objective.
 */
export function score(
  design: Design,
  requirements: Requirements,
  objective: OptimisationObjective
): number {
  const violations = validateDesign(design, requirements);
  const hardCount = hardViolations(violations).length;
  const softCount = violations.length - hardCount;
  const { resolved } = resolvePlacements(design);

  // Any objective is dominated by validity: an invalid design always scores
  // lower than a valid one, regardless of what it optimises for.
  const validityScore = -1000 * hardCount - softCount;

  switch (objective) {
    case "valid":
      return validityScore;
    case "cost": {
      const totalCost = resolved.reduce((sum, { item }) => sum + item.priceUsd, 0);
      return validityScore - totalCost / 1000;
    }
    case "headroom": {
      const totalPower = resolved.reduce((sum, { item }) => sum + item.powerW, 0);
      const headroomW = design.rack.powerBudgetW - totalPower;
      return validityScore + headroomW / 100;
    }
    case "spareU": {
      const highestUsed = resolved.reduce((max, { placement, item }) => {
        if (item.heightU <= 0) return max;
        return Math.max(max, placement.startU + item.heightU - 1);
      }, 0);
      const spareU = design.rack.heightU - highestUsed;
      return validityScore + spareU;
    }
  }
}
