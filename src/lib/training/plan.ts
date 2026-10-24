import type { AgentName } from "@/lib/agents/registry";

/**
 * How many calls each kind of turn contributes to each agent's task.
 *
 * This is what makes the trainer cheap: one end-to-end turn feeds two tasks
 * at once, so filling four agents never means four separate passes. The
 * repair figure is a floor — the loop samples two candidates per round and
 * only runs at all when the validator actually found something.
 */
export type TurnKind = "design" | "amend" | "repair";

export const CONTRIBUTION: Record<TurnKind, Partial<Record<AgentName, number>>> = {
  design: { RequirementsAgent: 1, RackArchitect: 1 },
  amend: { RequirementsAgent: 1, RackEditor: 1 },
  repair: { RepairAgent: 2 },
};

export interface Plan {
  design: number;
  amend: number;
  repair: number;
}

/**
 * Cheapest mix of turns that closes every gap. Greedy and deliberately
 * simple: serve the neediest agent, credit what that turn contributes,
 * repeat. With four agents and three turn kinds there is nothing to gain
 * from anything cleverer, and the provider's rate limit dwarfs any saving.
 */
export function planTurns(deficits: Record<AgentName, number>): Plan {
  const remaining = { ...deficits };
  const plan: Plan = { design: 0, amend: 0, repair: 0 };

  // Bounded so a contribution table that never reaches an agent can't spin.
  for (let guard = 0; guard < 500; guard++) {
    const neediest = (Object.keys(remaining) as AgentName[])
      .filter((agent) => remaining[agent] > 0)
      .sort((a, b) => remaining[b] - remaining[a])[0];
    if (!neediest) break;

    const kind: TurnKind =
      neediest === "RackEditor" ? "amend"
      : neediest === "RepairAgent" ? "repair"
      : neediest === "RackArchitect" ? "design"
      // RequirementsAgent rides along on both; pick whichever also helps more.
      : remaining.RackEditor > remaining.RackArchitect ? "amend" : "design";

    plan[kind] += 1;
    for (const [agent, contributed] of Object.entries(CONTRIBUTION[kind])) {
      remaining[agent as AgentName] -= contributed ?? 0;
    }
  }

  return plan;
}

/**
 * Amend and repair turns need a real rack to work on. Beyond that, an amend
 * prompt is mostly the rack it is amending — so running twenty edits against
 * ONE base rack would send twenty near-identical opening messages. Mubit
 * derives a Gemini session from "the start of its conversation" and holds
 * test cases back by session, so near-duplicates are wasted calls.
 */
export function baseDesignsNeeded(plan: Plan): number {
  if (plan.amend === 0 && plan.repair === 0) return plan.design;
  return Math.max(plan.design, Math.min(6, Math.max(1, Math.ceil((plan.amend + plan.repair) / 5))));
}
