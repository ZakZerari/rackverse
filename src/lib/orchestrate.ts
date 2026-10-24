import { runArchitect } from "@/lib/agents/architect";
import { runRepairAgent } from "@/lib/agents/repair";
import { runRequirementsAgent } from "@/lib/agents/requirements";
import { noopEmit, type EmitFn } from "@/lib/events";
import { getRelevantLessons, recordLesson, type Lesson } from "@/lib/lessons";
import { genPlacementId } from "@/lib/patch";
import type { ArchitectOutputSchema } from "@/lib/schemas";
import type { Design, Patch, Requirements, Violation } from "@/lib/types";
import { hardViolations, validateDesign } from "@/lib/validate";
import { verifyPatch } from "@/lib/verify";
import type { z } from "zod";

/** How many repair candidates to sample per round. Sampling in parallel costs
 *  one round trip instead of N, and gives the deterministic Verifier a choice
 *  of patches rather than a single take-it-or-leave-it proposal. */
const REPAIR_CANDIDATES = 2;

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
  emit?: EmitFn;
  /** Defaults to the shared, file-backed data/lessons.json store. The benchmark
   *  injects an isolated in-memory store so Config A/B never read or write the
   *  live app's lessons. */
  getLessons?: (violations: Violation[]) => Lesson[];
  onLessonLearned?: (violations: Violation[], patch: Patch, improvement: string) => void;
}

/**
 * Repair -> verify -> commit-or-rollback, up to `maxAttempts` rounds. Each
 * round samples REPAIR_CANDIDATES patches concurrently and keeps the first the
 * deterministic Verifier accepts. Stops as soon as there are no hard
 * violations left.
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
  const emit = opts.emit ?? noopEmit;
  let current = design;

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    const hard = hardViolations(validateDesign(current, requirements));
    if (hard.length === 0) break;

    const lessons = getLessons(hard);
    const proposals = await Promise.allSettled(
      Array.from({ length: REPAIR_CANDIDATES }, () =>
        runRepairAgent(
          { design: current, violations: hard, requirements, lessons },
          { runId: opts.runId, emit, note: `Proposing a fix for ${hard.length} violation(s)…` }
        )
      )
    );

    let committed = false;
    for (const proposal of proposals) {
      if (proposal.status !== "fulfilled") continue;
      const result = verifyPatch(current, proposal.value, requirements, "valid");

      emit({
        type: "verifier:decision",
        accepted: result.accepted,
        reason: result.reason,
        hardBefore: hardViolations(result.before).length,
        hardAfter: hardViolations(result.after).length,
      });
      trace.push(
        traceStep(
          `RepairAgent (round ${attempt})`,
          result.accepted ? `Patch accepted — ${result.reason}` : `Patch rejected — ${result.reason}`,
          result.accepted,
          hardViolations(result.after).length
        )
      );

      if (result.accepted) {
        current = result.design;
        onLessonLearned(hard, proposal.value, result.reason);
        emit({ type: "design:update", design: current });
        committed = true;
        break;
      }
    }

    // Every candidate this round was rejected — another round with identical
    // input would just burn round trips for the same answer.
    if (!committed) break;
  }

  return current;
}

export interface DesignFromPromptResult {
  design: Design;
  requirements: Requirements;
  trace: TraceStep[];
}

/** Architect -> validate -> repair, for when Requirements are already structured. */
export async function designFromRequirements(
  requirements: Requirements,
  opts?: RepairLoopOptions & { trace?: TraceStep[] }
): Promise<DesignFromPromptResult> {
  const runId = opts?.runId ?? `run-${Date.now()}`;
  const trace = opts?.trace ?? [];
  const emit = opts?.emit ?? noopEmit;

  const architectOutput = await runArchitect(requirements, {
    runId,
    emit,
    note: "Laying out the rack…",
  });
  let design = buildDesignFromArchitectOutput(architectOutput, requirements);
  trace.push(
    traceStep("RackArchitect", architectOutput.rationale || `Proposed ${design.placements.length} placement(s).`, true)
  );
  emit({ type: "design:update", design });

  const initialViolations = validateDesign(design, requirements);
  const initialHard = hardViolations(initialViolations);
  emit({ type: "validator:result", violations: initialViolations, hardCount: initialHard.length });
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

  design = await runRepairLoop(design, requirements, trace, { ...opts, runId, emit });

  emit({ type: "run:done", design, requirements });
  return { design, requirements, trace };
}

/**
 * The full pipeline: NL -> Requirements -> Architect -> validate -> repair.
 * The AI proposes at every step; validateDesign and verifyPatch (both plain
 * deterministic code) are what actually decide.
 */
export async function designFromPrompt(
  text: string,
  opts?: RepairLoopOptions
): Promise<DesignFromPromptResult> {
  const runId = opts?.runId ?? `run-${Date.now()}`;
  const trace: TraceStep[] = [];
  const emit = opts?.emit ?? noopEmit;

  emit({ type: "run:start", runId });

  const requirements = await runRequirementsAgent(text, {
    runId,
    emit,
    note: "Reading your requirements…",
  });
  const requiredSummary = requirements.required.map((r) => `${r.qty}x ${r.category}`).join(", ");
  trace.push(
    traceStep(
      "RequirementsAgent",
      `${requirements.rackHeightU}U rack, ${requirements.powerBudgetW}W budget${requirements.redundantPower ? ", redundant power" : ""}${requiredSummary ? ` — ${requiredSummary}` : ""}.`,
      true
    )
  );

  return designFromRequirements(requirements, { ...opts, runId, trace, emit });
}

export interface RepairOnlyResult {
  design: Design;
  trace: TraceStep[];
}

/** Just the repair loop — the benchmark and the Studio's Auto-repair button. */
export async function repairOnly(
  design: Design,
  requirements: Requirements,
  opts?: RepairLoopOptions
): Promise<RepairOnlyResult> {
  const trace: TraceStep[] = [];
  const result = await runRepairLoop(design, requirements, trace, opts);
  return { design: result, trace };
}
