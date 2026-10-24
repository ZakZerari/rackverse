import { z } from "zod";
import { RACK_ARCHITECT_SYSTEM } from "@/lib/agents/architect";
import { REPAIR_AGENT_SYSTEM } from "@/lib/agents/repair";
import { REQUIREMENTS_AGENT_SYSTEM } from "@/lib/agents/requirements";
import { ArchitectOutputSchema, PatchSchema, RequirementsSchema } from "@/lib/schemas";

/**
 * Every agent in one place, because this file IS the Mubit task surface.
 *
 * Mubit groups calls into a task by: instructions + tools + tool choice +
 * output format + model (docs: /guides/tasks-and-sessions). Change any of
 * those and the task forks — the old one stops accumulating examples and the
 * new one restarts from zero. We learned that the expensive way: iterating on
 * the model and the schema during the build scattered 3 agents across 20
 * tasks, so none of them reached the 25 kept examples an adapter needs.
 *
 * So: the identity-bearing fields live here, `agents.fingerprint.test.ts`
 * pins them, and that test fails loudly if anything drifts.
 */
export type AgentName = "RequirementsAgent" | "RackArchitect" | "RepairAgent";

export interface AgentDefinition {
  name: AgentName;
  /** Shown in the Copilot thread. Not sent to the model. */
  label: string;
  /** What this agent is for. Not sent to the model. */
  purpose: string;
  /**
   * CONSTANT instructions — this is what Mubit names and groups the task by.
   * Never template, never interpolate. All variable data goes in the user
   * message.
   */
  instructions: string;
  /** The output contract. Part of task identity via the response format. */
  schema: z.ZodType<unknown>;
}

export const AGENTS: Record<AgentName, AgentDefinition> = {
  RequirementsAgent: {
    name: "RequirementsAgent",
    label: "Requirements",
    purpose: "Turns a plain-English brief into structured, checkable requirements.",
    instructions: REQUIREMENTS_AGENT_SYSTEM,
    schema: RequirementsSchema,
  },
  RackArchitect: {
    name: "RackArchitect",
    label: "Architect",
    purpose: "Lays out the rack: which catalog devices go where, on which face and feed.",
    instructions: RACK_ARCHITECT_SYSTEM,
    schema: ArchitectOutputSchema,
  },
  RepairAgent: {
    name: "RepairAgent",
    label: "Repair",
    purpose: "Proposes a minimal patch for the violations the validator found.",
    instructions: REPAIR_AGENT_SYSTEM,
    schema: PatchSchema,
  },
};

export const AGENT_LIST = Object.values(AGENTS);

/**
 * Mubit normalises instructions before grouping: "Runs of spaces and line
 * breaks count as one space", and "Numbers, dates, times and IDs don't split
 * a task." Mirror that here so the fingerprint tracks what Mubit actually
 * compares rather than raw bytes.
 */
export function normaliseInstructions(instructions: string): string {
  return instructions.replace(/\s+/g, " ").trim();
}

export interface TaskFingerprint {
  agent: AgentName;
  model: string;
  /** First words of the instructions — this is how the task is named in the console. */
  taskName: string;
  instructionsHash: string;
  schemaHash: string;
}

function hash(value: string): string {
  // Small non-cryptographic hash (FNV-1a). We only need change detection.
  let h = 0x811c9dc5;
  for (let i = 0; i < value.length; i++) {
    h ^= value.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0).toString(16).padStart(8, "0");
}

/**
 * A stable summary of everything that decides which Mubit task a call lands
 * in. If this changes, the task forks.
 */
export function taskFingerprint(definition: AgentDefinition, model: string): TaskFingerprint {
  const normalised = normaliseInstructions(definition.instructions);
  return {
    agent: definition.name,
    model,
    taskName: normalised.split(" ").slice(0, 6).join(" "),
    instructionsHash: hash(normalised),
    schemaHash: hash(JSON.stringify(z.toJSONSchema(definition.schema, { target: "draft-7" }))),
  };
}
