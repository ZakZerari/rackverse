import { catalogSummary } from "@/data/catalog";
import type { AgentCallOptions } from "@/lib/agents/requirements";
import { complete } from "@/lib/llm";
import { renderLessonsForPrompt, type Lesson } from "@/lib/lessons";
import { PatchSchema } from "@/lib/schemas";
import type { Design, Patch, Requirements, Violation } from "@/lib/types";

export const REPAIR_AGENT_SYSTEM = `You are RepairAgent, part of a server rack design system.

You receive a rack design, the hard violations a deterministic validator found in it, the original requirements, and (sometimes) verified fixes from past repairs of similar violations ("lessons"). Propose a minimal Patch — a small list of ops — that fixes the violations.

The catalog arrives as a pipe-delimited table whose first line is the header:
id|cat|tags|U|depth_mm|kg|draw_W|supply_W|outlets|psu|ports|needs_ports|full_depth|usd
One device per line. Empty cells mean the field does not apply. "tags" are short hints about what a device is for, e.g. gpu, ai, budget, poe, nas.

Rules:
- Use ONLY existing placementIds from the given design, or ids from the given catalog table. Never invent either.
- Prefer the fewest ops that resolve the violations. Don't make unrelated changes.
- A patch can "add" a new device, "move" or "remove" an existing placement (by placementId), or "replace" a placement's catalogId.
- U1 is the bottom of the rack. Respect the rack's heightU bounds.
- If "Verified past fixes" are provided, prefer a similar approach when it fits this case — but adapt it; don't copy an op that references an id that doesn't exist in THIS design.

Respond with ONLY a JSON object matching the required schema: { ops: [...], rationale }. No prose outside the JSON, no markdown fences.`;

export interface RepairAgentInput {
  design: Design;
  violations: Violation[];
  requirements: Requirements;
  lessons: Lesson[];
}

export async function runRepairAgent(
  input: RepairAgentInput,
  opts: AgentCallOptions = {}
): Promise<Patch> {
  const user = JSON.stringify({
    design: input.design,
    violations: input.violations.map((v) => ({ code: v.code, message: v.message, placementIds: v.placementIds })),
    requirements: input.requirements,
    catalog: catalogSummary(),
    verifiedPastFixes: renderLessonsForPrompt(input.lessons),
  });
  return complete({
    agent: "RepairAgent",
    system: REPAIR_AGENT_SYSTEM,
    user,
    schema: PatchSchema,
    ...opts,
  });
}
