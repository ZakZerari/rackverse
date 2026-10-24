import { runArchitect } from "@/lib/agents/architect";
import { runRackEditor, type RackEditorInput } from "@/lib/agents/editor";
import { runRepairAgent } from "@/lib/agents/repair";
import { runRequirementsAgent } from "@/lib/agents/requirements";
import { noopEmit, type EmitFn } from "@/lib/events";
import { getRelevantLessons, recordLesson, type Lesson } from "@/lib/lessons";
import { applyPatch, genPlacementId, patchCoherenceProblems } from "@/lib/patch";
import { planTurn, summariseRequirements, type HistoryEntry } from "@/lib/turn";
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
  requirements: Requirements,
  catalogDesign?: Design
): Design {
  return {
    rack: {
      id: catalogDesign?.rack.id ?? "rack-1",
      name: catalogDesign?.placements.length === 0 && catalogDesign.rack.name !== "Untitled Rack"
        ? catalogDesign.rack.name : output.rackName,
      heightU: requirements.rackHeightU,
      mountingDepthMm: catalogDesign?.placements.length === 0 && catalogDesign.rack.mountingDepthMm !== 1000
        ? catalogDesign.rack.mountingDepthMm : output.mountingDepthMm,
      maxLoadKg: catalogDesign?.placements.length === 0 && catalogDesign.rack.maxLoadKg !== 500
        ? catalogDesign.rack.maxLoadKg : output.maxLoadKg,
      powerBudgetW: requirements.powerBudgetW,
    },
    placements: output.placements.map((p) => ({ id: genPlacementId(), ...p })),
    version: 1,
    catalogOverrides: catalogDesign?.catalogOverrides,
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
  currentDesign?: Design;
  currentRequirements?: Requirements;
  history?: HistoryEntry[];
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

/**
 * RackEditor proposes an edit; a deterministic coherence check decides whether
 * it is even applicable, and gets one chance to re-ask with the exact problem.
 *
 * Without this, an op naming a placementId that doesn't exist is applied as a
 * silent no-op: the agent reports the change, and the rack is untouched. The
 * retry is bounded at one — a second identical failure means the agent isn't
 * going to get there, and saying so beats burning the user's rate limit.
 */
async function proposeCoherentEdit(
  input: Omit<RackEditorInput, "previousAttemptProblems">,
  opts: { runId?: string; emit: EmitFn }
): Promise<{ patch: Patch; problems: string[] }> {
  const first = await runRackEditor(input, { ...opts, note: "Editing your rack…" });
  const firstProblems = patchCoherenceProblems(input.design, first);
  if (firstProblems.length === 0) return { patch: first, problems: [] };

  const second = await runRackEditor(
    { ...input, previousAttemptProblems: firstProblems },
    { ...opts, note: `Retrying — ${firstProblems.length} op(s) named something that doesn't exist…` }
  );
  return { patch: second, problems: patchCoherenceProblems(input.design, second) };
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
    catalogDesign: opts?.currentDesign,
  });
  let design = buildDesignFromArchitectOutput(architectOutput, requirements, opts?.currentDesign);
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

  emit({ type: "run:done", design, requirements, mode: "design" });
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

  const mode = planTurn(opts?.currentDesign ?? null, text).mode;
  const requirements = await runRequirementsAgent({
    message: text,
    history: opts?.history ?? [],
    current: mode === "amend" || (opts?.currentDesign && opts.currentDesign.placements.length === 0)
      ? opts?.currentRequirements ?? null : null,
  }, {
    runId,
    emit,
    note: "Reading your requirements…",
  });
  // RequirementsSchema has no `rationale`, so without this the step would read
  // "Responded." in the thread. The brief itself is the useful thing to show.
  const brief = summariseRequirements(requirements);
  emit({ type: "requirements:update", requirements, summary: brief });
  trace.push(traceStep("RequirementsAgent", brief, true));

  if (mode === "amend" && opts?.currentDesign) {
    const baseline: Design = {
      ...opts.currentDesign,
      rack: { ...opts.currentDesign.rack, heightU: requirements.rackHeightU, powerBudgetW: requirements.powerBudgetW },
    };
    let design = baseline;
    const { patch, problems } = await proposeCoherentEdit(
      { request: text, history: opts.history ?? [], requirements, design },
      { runId, emit }
    );

    if (problems.length > 0) {
      // Nothing is applied: an incoherent patch can only damage the rack or
      // do nothing at all, and the user is owed the real reason either way.
      const hard = hardViolations(validateDesign(baseline, requirements)).length;
      emit({
        type: "verifier:decision",
        accepted: false,
        reason: `Rejected — the edit named things that aren't in the rack or the catalog. ${problems[0]}`,
        hardBefore: hard,
        hardAfter: hard,
      });
      trace.push(traceStep("RackEditor", `Patch rejected — ${problems.join(" ")}`, false, hard));
      emit({ type: "run:done", design: baseline, requirements, mode: "amend" });
      return { design: baseline, requirements, trace };
    }

    if (patch.ops.length > 0) design = applyPatch(design, patch);
    emit({ type: "design:update", design });
    trace.push(traceStep("RackEditor", patch.rationale, true));
    const violations = validateDesign(design, requirements);
    emit({ type: "validator:result", violations, hardCount: hardViolations(violations).length });
    design = await runRepairLoop(design, requirements, trace, { ...opts, runId, emit });
    const baselineHard = hardViolations(validateDesign(baseline, requirements));
    const finalHard = hardViolations(validateDesign(design, requirements));
    const priorCodes = new Set(baselineHard.map((violation) => violation.code));
    const newCodes = finalHard.filter((violation) => !priorCodes.has(violation.code));
    if (finalHard.length > baselineHard.length || newCodes.length > 0) {
      emit({ type: "verifier:decision", accepted: false,
        reason: "Edit would worsen engineering checks; kept the previous equipment layout.",
        hardBefore: baselineHard.length, hardAfter: finalHard.length });
      design = baseline;
    }
    emit({ type: "run:done", design, requirements, mode: "amend" });
    return { design, requirements, trace };
  }
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
