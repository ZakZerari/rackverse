import { applyPatch } from "@/lib/patch";
import { hardViolations, score, validateDesign } from "@/lib/validate";
import type {
  Design,
  OptimisationObjective,
  Patch,
  Requirements,
  Violation,
} from "@/lib/types";

export interface VerifyResult {
  accepted: boolean;
  reason: string;
  design: Design; // the candidate if accepted, the original design if rejected
  before: Violation[];
  after: Violation[];
}

/** Identify the affected devices, so moving an overlap onto a new pair is a regression. */
function violationKey(violation: Violation): string {
  const placementSpecific = new Set(["UNKNOWN_CATALOG_ID", "RACK_OUT_OF_BOUNDS", "RACK_OVERLAP", "DEPTH_EXCEEDED"]);
  const ids = placementSpecific.has(violation.code) ? [...violation.placementIds].sort().join(",") : "";
  const category = violation.code === "REQUIREMENT_MISSING" ? String(violation.details?.category ?? "") : "";
  return `${violation.code}:${ids}:${category}`;
}

/** Smaller is better. Only codes with a meaningful numeric deficit use this. */
function violationMagnitude(violation: Violation): number | null {
  const d = violation.details;
  if (!d) return null;
  const n = (key: string) => typeof d[key] === "number" ? d[key] as number : 0;
  switch (violation.code) {
    case "WEIGHT_EXCEEDED": return n("totalWeight") - n("maxLoadKg");
    case "POWER_BUDGET_EXCEEDED": return n("totalPower") - n("powerBudgetW");
    case "PDU_OUTLETS_INSUFFICIENT": return n("outletsRequired") - n("outletsSupplied");
    case "NETWORK_PORTS_INSUFFICIENT": return n("portsNeeded") - n("portsSupplied");
    case "BUDGET_EXCEEDED": return n("totalCost") - n("budgetUsd");
    case "REQUIREMENT_MISSING": return n("required") - n("actual");
    case "DEPTH_EXCEEDED": return n("depthMm") - n("mountingDepthMm");
    case "REDUNDANCY_SINGLE_FEED":
      return Math.max(0, n("totalPower") - n("capacityA")) + Math.max(0, n("totalPower") - n("capacityB"));
    case "REDUNDANCY_FEED_OUTLETS_INSUFFICIENT":
      return Math.max(0, n("dualPsuServers") - n("outletsA")) + Math.max(0, n("dualPsuServers") - n("outletsB"));
    default: return null;
  }
}

/**
 * Applies `patch` to a copy of `design` and decides whether to keep it.
 * ACCEPT iff the hard-violation count strictly decreases with no new hard
 * violation, OR the result has zero hard violations and the objective score
 * strictly improves. Device-specific errors are keyed by the affected
 * placement IDs so a newly introduced collision cannot hide behind one that
 * was fixed elsewhere. Existing numeric deficits must not increase either.
 * Otherwise REJECT and keep the original design.
 */
export function verifyPatch(
  design: Design,
  patch: Patch,
  requirements: Requirements,
  objective: OptimisationObjective = "valid"
): VerifyResult {
  const before = validateDesign(design, requirements);
  const beforeHard = hardViolations(before);
  const beforeHardKeys = new Set(beforeHard.map(violationKey));
  const beforeMagnitudes = new Map(beforeHard.map((violation) => [violationKey(violation), violationMagnitude(violation)]));

  const candidate = applyPatch(design, patch);
  const after = validateDesign(candidate, requirements);
  const afterHard = hardViolations(after);
  const introduced = afterHard.filter((violation) => !beforeHardKeys.has(violationKey(violation)));
  const worsened = afterHard.filter((violation) => {
    const prior = beforeMagnitudes.get(violationKey(violation));
    const next = violationMagnitude(violation);
    return prior != null && next != null && next > prior;
  });

  if (afterHard.length < beforeHard.length && introduced.length === 0 && worsened.length === 0) {
    return {
      accepted: true,
      reason: `Hard violations reduced from ${beforeHard.length} to ${afterHard.length}.`,
      design: candidate,
      before,
      after,
    };
  }

  if (afterHard.length === 0) {
    const scoreBefore = score(design, requirements, objective);
    const scoreAfter = score(candidate, requirements, objective);
    if (scoreAfter > scoreBefore && introduced.length === 0 && worsened.length === 0) {
      return {
        accepted: true,
        reason: `Design stays valid and ${objective} score improved (${scoreBefore.toFixed(2)} -> ${scoreAfter.toFixed(2)}).`,
        design: candidate,
        before,
        after,
      };
    }
  }

  return {
    accepted: false,
    reason:
      introduced.length > 0
        ? `Rejected: introduced new hard violation(s): ${[...new Set(introduced.map((violation) => violation.code))].join(", ")}.`
        : worsened.length > 0
          ? `Rejected: worsened existing hard violation(s): ${[...new Set(worsened.map((violation) => violation.code))].join(", ")}.`
        : `Rejected: no improvement (hard violations ${beforeHard.length} -> ${afterHard.length}).`,
    design,
    before,
    after,
  };
}
