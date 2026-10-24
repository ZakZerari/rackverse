import { runArchitect } from "@/lib/agents/architect";
import { runRepairAgent } from "@/lib/agents/repair";
import { runRequirementsAgent } from "@/lib/agents/requirements";
import { getRelevantLessons, recordLesson } from "@/lib/lessons";
import { genPlacementId } from "@/lib/patch";
import type { ArchitectOutputSchema } from "@/lib/schemas";
import type { Design, Requirements } from "@/lib/types";
import { hardViolations, validateDesign } from "@/lib/validate";
import { verifyPatch } from "@/lib/verify";
import type { z } from "zod";

export interface TraceStep {
  id: string;
  label: string;
  detail: string;
  ok: boolean;
  hardViolationCount?: number;
}

let traceCounter = 0;
function traceStep(label: string, detail: string, ok: boolean, hardViolationCount?: number): TraceStep {
  traceCounter += 1;
  return { id: `trace-${traceCounter}`, label, detail, ok, hardViolationCount };
}

function buildDesignFromArchitectOutput(
  output: z.infer<typeof ArchitectOutputSchema>,
  requirements: Requirements
): Design {
  return {
    rack: {
      id: "rack-1",
      name: output.rackName,
      heightU: requirements.rackHeightU,
      mountingDepthMm: output.mountingDepthMm,
      maxLoadKg: output.maxLoadKg,
      powerBudgetW: requirements.powerBudgetW,
    },
    placements: output.placements.map((p) => ({ id: genPlacementId(), ...p })),
    version: 1,
  };
}

/**
 * Repair -> verify -> commit-or-rollback, up to `maxAttempts` times. Stops
 * early once there are no hard violations left. Used by both
 * `designFromPrompt` and standalone (the benchmark, the "Auto-repair"/"Break
 * it" buttons).
 */
export async function runRepairLoop(
  design: Design,
  requirements: Requirements,
  maxAttempts: number,
  trace: TraceStep[],
  runId?: string
): Promise<Design> {
  let current = design;

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    const violations = validateDesign(current, requirements);
    const hard = hardViolations(violations);
    if (hard.length === 0) break;

    const lessons = getRelevantLessons(hard);
    const patch = await runRepairAgent({ design: current, violations: hard, requirements, lessons }, runId);
    const result = verifyPatch(current, patch, requirements, "valid");

    trace.push(
      traceStep(
        `RepairAgent (attempt ${attempt})`,
        result.accepted ? `Patch accepted — ${result.reason}` : `Patch rejected — ${result.reason}`,
        result.accepted,
        hardViolations(result.after).length
      )
    );

    if (result.accepted) {
      current = result.design;
      recordLesson(hard, patch, result.reason);
    }
  }

  return current;
}

export interface DesignFromPromptResult {
  design: Design;
  requirements: Requirements;
  trace: TraceStep[];
}

/**
 * The full pipeline: NL -> Requirements -> Architect -> validate -> repair
 * loop -> return. The AI proposes at every step; validateDesign (deterministic
 * code) and verifyPatch (deterministic code) are what actually decide.
 */
export async function designFromPrompt(
  text: string,
  opts?: { runId?: string; maxRepairAttempts?: number }
): Promise<DesignFromPromptResult> {
  const runId = opts?.runId ?? `run-${Date.now()}`;
  const trace: TraceStep[] = [];

  const requirements = await runRequirementsAgent(text, runId);
  const requiredSummary = requirements.required.map((r) => `${r.qty}x ${r.category}`).join(", ");
  trace.push(
    traceStep(
      "RequirementsAgent",
      `${requirements.rackHeightU}U rack, ${requirements.powerBudgetW}W budget${requirements.redundantPower ? ", redundant power" : ""}${requiredSummary ? ` — ${requiredSummary}` : ""}.`,
      true
    )
  );

  const architectOutput = await runArchitect(requirements, runId);
  let design = buildDesignFromArchitectOutput(architectOutput, requirements);
  trace.push(
    traceStep("RackArchitect", architectOutput.rationale || `Proposed ${design.placements.length} placement(s).`, true)
  );

  const initialViolations = validateDesign(design, requirements);
  const initialHard = hardViolations(initialViolations);
  trace.push(
    traceStep(
      "Validator",
      initialViolations.length === 0
        ? "No violations."
        : `${initialHard.length} hard, ${initialViolations.length - initialHard.length} soft violation(s).`,
      initialHard.length === 0,
      initialHard.length
    )
  );

  design = await runRepairLoop(design, requirements, opts?.maxRepairAttempts ?? 3, trace, runId);

  return { design, requirements, trace };
}

export interface RepairOnlyResult {
  design: Design;
  trace: TraceStep[];
}

/** Just the repair loop, for the benchmark and the Studio's "Auto-repair"/"Break it" buttons. */
export async function repairOnly(
  design: Design,
  requirements: Requirements,
  opts?: { runId?: string; maxAttempts?: number }
): Promise<RepairOnlyResult> {
  const trace: TraceStep[] = [];
  const result = await runRepairLoop(design, requirements, opts?.maxAttempts ?? 3, trace, opts?.runId);
  return { design: result, trace };
}
