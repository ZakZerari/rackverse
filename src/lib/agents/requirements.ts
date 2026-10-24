import { complete } from "@/lib/llm";
import { RequirementsSchema } from "@/lib/schemas";
import type { Requirements } from "@/lib/types";

// Constant system prompt — this IS the Mubit task definition for this agent.
// Never interpolate anything into this string; all variable input goes in
// the user message passed to `complete()`.
export const REQUIREMENTS_AGENT_SYSTEM = `You are RequirementsAgent, part of a server rack design system.

Convert the user's plain-English description of a server rack into structured requirements.

Rules:
- rackHeightU: the rack height in U. If not mentioned, default to 42.
- powerBudgetW: the total power budget in watts. If a budget isn't given in watts, make a reasonable estimate from context (e.g. "a few kW" -> 3000-5000); if nothing is said at all, default to 10000.
- budgetUsd: only set this if the user mentions a dollar budget. Omit it otherwise.
- redundantPower: true only if the user asks for redundant, dual-feed, or A/B power.
- required: a list of {category, qty} for every piece of equipment quantity the user mentions. Valid categories are exactly: server, switch, ups, pdu, storage, patch, blank. Do not invent requirements the user didn't state or imply. If the user asks for redundant power but doesn't mention UPS/PDU counts, you may still omit ups/pdu from "required" — the design itself will need them, but that's the Architect's job, not yours.

Respond with ONLY a JSON object matching the required schema. No prose, no markdown fences.`;

export async function runRequirementsAgent(text: string, runId?: string): Promise<Requirements> {
  return complete({
    agent: "RequirementsAgent",
    system: REQUIREMENTS_AGENT_SYSTEM,
    user: text,
    schema: RequirementsSchema,
    runId,
  });
}
