import { describe, expect, it } from "vitest";
import type { AgentName } from "@/lib/agents/registry";
import { CONTRIBUTION, baseDesignsNeeded, planTurns, type Plan } from "@/lib/training/plan";

const NONE: Record<AgentName, number> = {
  RequirementsAgent: 0,
  RackArchitect: 0,
  RackEditor: 0,
  RepairAgent: 0,
};

/** What a plan actually delivers to each agent, per the contribution table. */
function delivered(plan: Plan): Record<AgentName, number> {
  const total = { ...NONE };
  for (const kind of ["design", "amend", "repair"] as const) {
    for (const [agent, n] of Object.entries(CONTRIBUTION[kind])) {
      total[agent as AgentName] += plan[kind] * (n ?? 0);
    }
  }
  return total;
}

describe("planTurns", () => {
  it("sends nothing when every task is already full", () => {
    expect(planTurns(NONE)).toEqual({ design: 0, amend: 0, repair: 0 });
  });

  it("covers every deficit", () => {
    const deficits = { RequirementsAgent: 10, RackArchitect: 6, RackEditor: 8, RepairAgent: 12 };
    const got = delivered(planTurns(deficits));
    for (const agent of Object.keys(deficits) as AgentName[]) {
      expect(got[agent], agent).toBeGreaterThanOrEqual(deficits[agent]);
    }
  });

  it("serves two tasks per turn rather than one pass per agent", () => {
    // 20 Requirements + 20 Editor is 20 amend turns, not 40 turns: the one
    // call to each agent in a turn is what keeps the run inside the rate limit.
    const plan = planTurns({ ...NONE, RequirementsAgent: 20, RackEditor: 20 });
    expect(plan).toEqual({ design: 0, amend: 20, repair: 0 });
  });

  it("does not run turns for agents that are already full", () => {
    const plan = planTurns({ ...NONE, RackEditor: 5 });
    expect(plan.design).toBe(0);
    expect(plan.repair).toBe(0);
    expect(plan.amend).toBe(5);
  });

  it("uses repair turns for a repair deficit, two candidates at a time", () => {
    expect(planTurns({ ...NONE, RepairAgent: 10 })).toEqual({ design: 0, amend: 0, repair: 5 });
  });

  it("terminates on a large deficit instead of spinning", () => {
    const plan = planTurns({
      RequirementsAgent: 400,
      RackArchitect: 400,
      RackEditor: 400,
      RepairAgent: 400,
    });
    expect(plan.design + plan.amend + plan.repair).toBeGreaterThan(0);
    expect(plan.design + plan.amend + plan.repair).toBeLessThanOrEqual(500);
  });
});

describe("baseDesignsNeeded", () => {
  it("spreads follow-ups over several racks so their prompts differ", () => {
    // 20 edits against one rack would be 20 near-identical opening messages,
    // and Mubit splits test cases by session.
    expect(baseDesignsNeeded({ design: 0, amend: 20, repair: 0 })).toBe(4);
  });

  it("always produces at least one rack to work on", () => {
    expect(baseDesignsNeeded({ design: 0, amend: 1, repair: 0 })).toBe(1);
    expect(baseDesignsNeeded({ design: 0, amend: 0, repair: 1 })).toBe(1);
  });

  it("caps the warm-up so a big run doesn't spend itself on setup", () => {
    expect(baseDesignsNeeded({ design: 0, amend: 200, repair: 200 })).toBe(6);
  });

  it("leaves a design-only plan alone", () => {
    expect(baseDesignsNeeded({ design: 9, amend: 0, repair: 0 })).toBe(9);
  });
});
