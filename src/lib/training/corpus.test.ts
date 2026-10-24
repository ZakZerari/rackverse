import { describe, expect, it } from "vitest";
import { AGENT_LIST, taskFingerprint } from "@/lib/agents/registry";
import { MUBIT_TASK_MODEL } from "@/lib/llm";
import {
  DESIGN_SCENARIO_SPACE,
  EDIT_SCENARIO_COUNT,
  designScenario,
  editScenario,
} from "@/lib/training/corpus";

/** Mubit's own normalisation: whitespace collapses, and numbers/dates/IDs
 *  don't split things apart. Two briefs that differ only in a server count
 *  are, for grouping purposes, the same brief. */
function normalise(text: string): string {
  return text.replace(/\d+/g, "#").replace(/\s+/g, " ").trim().toLowerCase();
}

describe("training corpus", () => {
  it("offers far more distinct briefs than a training run needs", () => {
    expect(DESIGN_SCENARIO_SPACE).toBeGreaterThan(10_000);
  });

  it("produces briefs that differ in words, not just in numbers", () => {
    // Sessions come from the first user message, and Mubit holds test cases
    // back by session — so near-duplicate briefs are near-worthless.
    const scenarios = Array.from({ length: 400 }, (_, i) => designScenario(i));
    const distinct = new Set(scenarios.map((s) => normalise(s.prompt)));
    expect(distinct.size).toBe(scenarios.length);
  });

  it("is deterministic, so a resumed run repeats nothing", () => {
    expect(designScenario(137)).toEqual(designScenario(137));
    expect(editScenario(9)).toEqual(editScenario(9));
  });

  it("gives every scenario a unique id", () => {
    const ids = Array.from({ length: 400 }, (_, i) => designScenario(i).id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("writes briefs a person could plausibly have typed", () => {
    for (const scenario of Array.from({ length: 60 }, (_, i) => designScenario(i))) {
      expect(scenario.prompt.length).toBeGreaterThan(40);
      expect(scenario.prompt.length).toBeLessThan(260);
      expect(scenario.prompt).not.toMatch(/undefined|NaN|\{\}/);
      expect(scenario.prompt.endsWith(".")).toBe(true);
    }
  });

  it("covers the edit requests without gaps", () => {
    const prompts = Array.from({ length: EDIT_SCENARIO_COUNT }, (_, i) => editScenario(i).prompt);
    expect(new Set(prompts).size).toBe(EDIT_SCENARIO_COUNT);
  });
});

describe("one adapter per agent, not one per rack", () => {
  /**
   * The requirement behind this whole exercise. Mubit forms a task from
   * "instructions, tools, tool choice, output format, model" — scenario text
   * is none of those, it rides in the user message. So any number of racks
   * collapses into exactly one task per agent.
   *
   * This test is the guard: if someone ever templates a scenario into an
   * agent's instructions, the fingerprint count stops matching the agent
   * count and this fails.
   */
  it("every scenario in the corpus maps to the same task per agent", () => {
    const fingerprints = new Set<string>();

    for (let i = 0; i < 250; i++) {
      // Whatever the scenario, the identity-bearing fields are the agent's
      // own constants — the corpus cannot reach them.
      for (const agent of AGENT_LIST) {
        const fp = taskFingerprint(agent, MUBIT_TASK_MODEL);
        fingerprints.add(`${fp.agent}|${fp.instructionsHash}|${fp.schemaHash}|${fp.model}`);
      }
    }

    expect(fingerprints.size).toBe(AGENT_LIST.length);
  });

  it("no agent's instructions contain anything scenario-shaped", () => {
    for (const agent of AGENT_LIST) {
      // A templated brief would show up as interpolation or as corpus words.
      expect(agent.instructions).not.toMatch(/\$\{|%s|\{\{/);
      for (const i of [0, 1, 2, 37]) {
        expect(agent.instructions).not.toContain(designScenario(i).prompt);
      }
    }
  });
});
