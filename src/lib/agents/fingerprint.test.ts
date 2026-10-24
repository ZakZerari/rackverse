import { describe, expect, it } from "vitest";
import {
  AGENTS,
  AGENT_LIST,
  normaliseInstructions,
  taskFingerprint,
  type AgentName,
} from "@/lib/agents/registry";
import { MUBIT_TASK_MODEL } from "@/lib/llm";

/**
 * These pins exist because task drift is invisible at runtime and expensive:
 * every change forks the Mubit task, the old one stops collecting, and the
 * new one restarts from zero kept examples. If a change here is deliberate,
 * update the pin AND expect the agent's adapter to start over.
 */
const PINNED: Record<AgentName, { taskName: string; instructionsHash: string; schemaHash: string }> = {
  RequirementsAgent: {
    taskName: "You are RequirementsAgent, part of a",
    instructionsHash: "b6cf6684",
    schemaHash: "8b92498a",
  },
  RackArchitect: {
    taskName: "You are RackArchitect, part of a",
    instructionsHash: "a15dc1d5",
    schemaHash: "a1226e8a",
  },
  RackEditor: {
    taskName: "You are RackEditor, part of a",
    instructionsHash: "f1c3510e",
    schemaHash: "d1146ef3",
  },
  RepairAgent: {
    taskName: "You are RepairAgent, part of a",
    instructionsHash: "05efc2c9",
    schemaHash: "b27b7f33",
  },
};

const MODEL = MUBIT_TASK_MODEL;
const PINNED_MODEL = "gemini-3.5-flash-lite";

describe("Mubit task identity", () => {
  it("pins the production model so changing it requires an intentional task migration", () => {
    expect(MUBIT_TASK_MODEL).toBe(PINNED_MODEL);
  });

  it("every agent has distinct instructions — shared ones would collapse into one task", () => {
    const unique = new Set(AGENT_LIST.map((a) => normaliseInstructions(a.instructions)));
    expect(unique.size).toBe(AGENT_LIST.length);
  });

  it("instructions are constant strings with no interpolation left in them", () => {
    for (const agent of AGENT_LIST) {
      expect(agent.instructions).not.toMatch(/\$\{/);
      expect(agent.instructions.length).toBeGreaterThan(50);
    }
  });

  it("fingerprints are stable — a change here forks the task and resets adapter training", () => {
    for (const agent of AGENT_LIST) {
      const actual = taskFingerprint(agent, MODEL);
      const pinned = PINNED[agent.name];

      expect(actual.taskName).toBe(pinned.taskName);

      if (pinned.instructionsHash !== "__PIN_ME__") {
        expect(
          actual.instructionsHash,
          `${agent.name} instructions changed — this forks its Mubit task. Update the pin only if that's intended.`
        ).toBe(pinned.instructionsHash);
      }
      if (pinned.schemaHash !== "__PIN_ME__") {
        expect(
          actual.schemaHash,
          `${agent.name} output schema changed — this forks its Mubit task. Update the pin only if that's intended.`
        ).toBe(pinned.schemaHash);
      }
    }
  });

  it("the fingerprint actually notices a model swap (the fork we hit in practice)", () => {
    const a = taskFingerprint(AGENTS.RackArchitect, "gemini-3.5-flash-lite");
    const b = taskFingerprint(AGENTS.RackArchitect, "gemini-3.8-flash");
    expect(a.model).not.toBe(b.model);
  });
});
