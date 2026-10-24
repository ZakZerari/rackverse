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

/**
 * Applies `patch` to a copy of `design` and decides whether to keep it.
 * ACCEPT iff the hard-violation count strictly decreases, OR the result has
 * zero hard violations AND the objective score strictly improves AND no hard
 * violation code appears that wasn't already present before the patch.
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
  const beforeHardCodes = new Set(beforeHard.map((v) => v.code));

  const candidate = applyPatch(design, patch);
  const after = validateDesign(candidate, requirements);
  const afterHard = hardViolations(after);
  const afterHardCodes = new Set(afterHard.map((v) => v.code));

  const newHardCodes = [...afterHardCodes].filter((c) => !beforeHardCodes.has(c));

  if (afterHard.length < beforeHard.length) {
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
    if (scoreAfter > scoreBefore && newHardCodes.length === 0) {
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
      newHardCodes.length > 0
        ? `Rejected: introduced new hard violation(s): ${newHardCodes.join(", ")}.`
        : `Rejected: no improvement (hard violations ${beforeHard.length} -> ${afterHard.length}).`,
    design,
    before,
    after,
  };
}
