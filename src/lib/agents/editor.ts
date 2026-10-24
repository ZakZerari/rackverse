import { catalogSummaryFor } from "@/lib/catalog";
import type { AgentCallOptions } from "@/lib/agents/requirements";
import { complete } from "@/lib/llm";
import { PatchSchema } from "@/lib/schemas";
import type { HistoryEntry } from "@/lib/turn";
import type { Design, Patch, Requirements } from "@/lib/types";

/**
 * Constant instructions — this IS the Mubit task definition. Never templated.
 *
 * RackEditor exists so that conversational edits don't get routed through
 * RepairAgent. They are different jobs: RepairAgent fixes violations a
 * deterministic validator found, RackEditor carries out what a person asked
 * for. Folding both into one task would feed an adapter two unrelated
 * input shapes and teach it neither well.
 */
export const RACK_EDITOR_SYSTEM = `You are RackEditor, part of a server rack design system.

A rack already exists. The user has asked for a change to it. Produce a Patch — a small list of ops — that makes exactly that change and nothing else.

The catalog arrives as a pipe-delimited table whose first line is the header:
id|cat|tags|U|depth_mm|kg|draw_W|supply_W|outlets|psu|ports|needs_ports|full_depth|usd
One device per line. Empty cells mean the field does not apply. "tags" are short hints about what a device is for, e.g. gpu, ai, budget, poe, nas.

Rules:
- The existing design is the starting point. Never rebuild it, and never remove equipment the user did not ask you to remove.
- Use ONLY placementIds that appear in the given design, and ONLY ids from the given catalog table. Never invent either.
- An op can "add" a catalog device, "move" or "remove" an existing placement by placementId, or "replace" a placement's catalogId.
- Prefer the fewest ops that deliver the request. If the request is already satisfied by the current design, return an empty ops list and say so in the rationale.
- U1 is the BOTTOM of the rack. Keep devices inside the rack's heightU and out of each other's rack units.
- Interpret the request in context: "cheaper" means swap for lower-usd equivalents, "bigger"/"more" means add capacity, "better" means improve what the conversation has been about.
- Supporting gear is allowed when the change needs it — adding servers may need switch ports and PDU outlets. A deterministic validator runs after you, and a repair agent fixes leftovers, so a reasonable change beats a perfect one.
- If requirements call for redundant power, added servers need at least 2 PSUs and each A/B feed needs a PDU outlet for each dual-PSU server.
- If a previous attempt is reported back to you as invalid, fix precisely what was reported.

Respond with ONLY a JSON object matching the required schema: { ops: [...], rationale }. The rationale is shown to the user — one short sentence, plain English, describing what you changed. No prose outside the JSON, no markdown fences.`;

export interface RackEditorInput {
  request: string;
  history: HistoryEntry[];
  requirements: Requirements;
  design: Design;
  /** Set only on a retry, after the deterministic coherence gate rejected an attempt. */
  previousAttemptProblems?: string[];
}

export async function runRackEditor(input: RackEditorInput, opts: AgentCallOptions = {}): Promise<Patch> {
  const user = JSON.stringify({
    request: input.request,
    conversation: input.history,
    requirements: input.requirements,
    design: input.design,
    catalog: catalogSummaryFor(input.design),
    previousAttemptProblems: input.previousAttemptProblems,
  });
  return complete({
    agent: "RackEditor",
    system: RACK_EDITOR_SYSTEM,
    user,
    schema: PatchSchema,
    ...opts,
  });
}
