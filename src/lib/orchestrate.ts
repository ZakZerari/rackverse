import { runArchitect } from "@/lib/agents/architect";
import { runRepairAgent } from "@/lib/agents/repair";
import { runRequirementsAgent } from "@/lib/agents/requirements";
import { getRelevantLessons, recordLesson, type Lesson } from "@/lib/lessons";
import { genPlacementId } from "@/lib/patch";
import type { ArchitectOutputSchema } from "@/lib/schemas";
import type { Design, Patch, Requirements, Violation } from "@/lib/types";
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

export interface RepairLoopOptions {
  maxAttempts?: number;
  runId?: string;
  /** Defaults to the shared, file-backed data/lessons.json store. The
   * benchmark injects an isolated in-memory store instead, so Config A/B
   * comparisons never read or write the live app's lessons. */
  getLessons?: (violations: Violation[]) => Lesson[];
  onLessonLearned?: (violations: Violation[], patch: Patch, improvement: string) => void;
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
  trace: TraceStep[],
  opts: RepairLoopOptions = {}
): Promise<Design> {
  const maxAttempts = opts.maxAttempts ?? 3;
  const getLessons = opts.getLessons ?? getRelevantLessons;
  const onLessonLearned = opts.onLessonLearned ?? recordLesson;
  let current = design;

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    const violations = validateDesign(current, requirements);
    const hard = hardViolations(violations);
    if (hard.length === 0) break;

    const lessons = getLessons(hard);
    const patch = await runRepairAgent({ design: current, violations: hard, requirements, lessons }, opts.runId);
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
      onLessonLearned(hard, patch, result.reason);
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
 * Architect -> validate -> repair loop -> return, for when Requirements are
 * already structured (scenarios, the benchmark) rather than free text.
 */
export async function designFromRequirements(
  requirements: Requirements,
  opts?: RepairLoopOptions & { trace?: TraceStep[] }
): Promise<DesignFromPromptResult> {
  const runId = opts?.runId ?? `run-${Date.now()}`;
  const trace = opts?.trace ?? [];

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

  design = await runRepairLoop(design, requirements, trace, { ...opts, runId });

  return { design, requirements, trace };
}

/**
 * The full pipeline: NL -> Requirements -> Architect -> validate -> repair
 * loop -> return. The AI proposes at every step; validateDesign (deterministic
 * code) and verifyPatch (deterministic code) are what actually decide.
 */
export async function designFromPrompt(
  text: string,
  opts?: RepairLoopOptions
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

  return designFromRequirements(requirements, { ...opts, runId, trace });
}

export interface RepairOnlyResult {
  design: Design;
  trace: TraceStep[];
}

/** Just the repair loop, for the benchmark and the Studio's "Auto-repair"/"Break it" buttons. */
export async function repairOnly(
  design: Design,
  requirements: Requirements,
  opts?: RepairLoopOptions
): Promise<RepairOnlyResult> {
  const trace: TraceStep[] = [];
  const result = await runRepairLoop(design, requirements, trace, opts);
  return { design: result, trace };
}
