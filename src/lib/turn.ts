import type { Design, Requirements } from "@/lib/types";

/**
 * What the agents are told about the conversation so far.
 *
 * Until now every message ran the full NL -> Requirements -> Architect
 * pipeline from an empty rack, so "make it better" was read as a brand-new
 * brief that mentioned no equipment: RequirementsAgent returned `required: []`
 * and the Architect dutifully built an empty rack. The user's work vanished.
 * Agents need the design they are being asked to change.
 */
export interface HistoryEntry {
  /** What the user asked for. */
  user: string;
  /** What the run ended up doing, e.g. "4 devices · all checks passing". */
  outcome: string;
}

export interface TurnContext {
  message: string;
  history: HistoryEntry[];
  /** null on the very first turn. */
  requirements: Requirements | null;
  design: Design | null;
}

export type TurnMode = "design" | "amend";

export interface TurnPlan {
  mode: TurnMode;
  /** Shown in the thread so the routing decision is never a mystery. */
  reason: string;
}

/**
 * Phrases that mean "throw away what's there". Deliberately narrow: the
 * damaging failure is discarding a rack the user wanted to keep, so anything
 * ambiguous amends. Matched on word boundaries against the lowercased message.
 */
const RESTART_PATTERNS = [
  /\bstart over\b/,
  /\bstart again\b/,
  /\bstart from scratch\b/,
  /\bfrom scratch\b/,
  /\bscrap (it|this|that|the rack)\b/,
  /\b(new|different|fresh) rack\b/,
  /\bempty the rack\b/,
  /\bclear (it|the rack|everything)\b/,
  /\bwipe (it|the rack|everything)\b/,
  /\breset\b/,
  /\bblank slate\b/,
];

/**
 * Decides whether this message builds a new rack or edits the current one.
 * Deterministic on purpose — this is the decision that was silently destroying
 * the user's design, and it is far too consequential to hand to a model.
 */
export function planTurn(design: Design | null, message: string): TurnPlan {
  if (!design || design.placements.length === 0) {
    return { mode: "design", reason: "No rack yet — designing from scratch." };
  }

  const normalised = message.toLowerCase();
  const restart = RESTART_PATTERNS.find((pattern) => pattern.test(normalised));
  if (restart) {
    return { mode: "design", reason: "You asked to start over — building a new rack." };
  }

  return {
    mode: "amend",
    reason: `Editing the existing ${design.placements.length}-device rack.`,
  };
}

/**
 * Oldest first, newest last — the last `limit` exchanges, trimmed for prompt
 * size.
 *
 * maxChars was 160 until a real outcome got cut mid-sentence: an
 * infeasibility explanation ("...the minimum to about $22,10") lost the
 * "0 — within budget" that made it actionable, so the next turn's "ok drop
 * it" had no "it" to resolve. 480 comfortably covers that explanation even
 * in its worst case (every reason and suggestion firing at once, ~450
 * chars) — a few hundred extra tokens across 6 turns is cheap next to
 * silently discarding the one thing a follow-up message needs.
 */
export function compactHistory(history: HistoryEntry[], limit = 6, maxChars = 480): HistoryEntry[] {
  return history.slice(-limit).map((entry) => ({
    user: entry.user.slice(0, maxChars),
    outcome: entry.outcome.slice(0, maxChars),
  }));
}

/** One line summarising what the agents are currently working towards. */
export function summariseRequirements(requirements: Requirements): string {
  const parts = [
    `${requirements.rackHeightU}U`,
    requirements.powerBudgetW >= 1000
      ? `${(requirements.powerBudgetW / 1000).toFixed(requirements.powerBudgetW % 1000 === 0 ? 0 : 1)}kW`
      : `${requirements.powerBudgetW}W`,
  ];
  if (requirements.budgetUsd !== undefined) parts.push(`$${requirements.budgetUsd.toLocaleString()}`);
  if (requirements.redundantPower) parts.push("A/B power");
  for (const item of requirements.required) parts.push(`${item.qty}× ${item.category}`);
  return parts.join(" · ");
}
