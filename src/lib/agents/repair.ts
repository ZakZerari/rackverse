import { catalogSummary } from "@/data/catalog";
import { complete } from "@/lib/llm";
import type { Lesson } from "@/lib/lessons";
import { PatchSchema } from "@/lib/schemas";
import type { Design, Patch, Requirements, Violation } from "@/lib/types";

export const REPAIR_AGENT_SYSTEM = `You are RepairAgent, part of a server rack design system.

You receive a rack design, the hard violations a deterministic validator found in it, the original requirements, and (sometimes) verified fixes from past repairs of similar violations ("lessons"). Propose a minimal Patch — a small list of ops — that fixes the violations.

Rules:
- Use ONLY existing placementIds from the given design, or catalogIds from the given catalog. Never invent either.
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

export async function runRepairAgent(input: RepairAgentInput, runId?: string): Promise<Patch> {
  const user = JSON.stringify({
    design: input.design,
    violations: input.violations,
    requirements: input.requirements,
    catalog: catalogSummary(),
    verifiedPastFixes: input.lessons,
  });
  return complete({
    agent: "RepairAgent",
    system: REPAIR_AGENT_SYSTEM,
    user,
    schema: PatchSchema,
    runId,
  });
}
