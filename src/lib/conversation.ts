import type { Violation } from "@/lib/types";

/**
 * The Copilot is a conversation, not a progress bar. Every agent call,
 * validator result and verifier decision is kept as a timeline item inside
 * the turn that produced it — including the agent's full streamed output, so
 * its reasoning stays readable after the run finishes instead of vanishing
 * with the spinner.
 */
export type TimelineItem =
  | {
      kind: "agent";
      id: string;
      agent: string;
      note: string;
      status: "running" | "ok" | "error";
      /** Full text the agent produced, kept verbatim. */
      output: string;
      /** The agent's own explanation, pulled out of its structured output. */
      rationale?: string;
      latencyMs?: number;
      tokens?: number;
      error?: string;
    }
  | {
      kind: "validator";
      id: string;
      violations: Violation[];
      hardCount: number;
    }
  | {
      kind: "verifier";
      id: string;
      accepted: boolean;
      reason: string;
      hardBefore: number;
      hardAfter: number;
    }
  | {
      kind: "note";
      id: string;
      label: string;
      detail: string;
      tone: "neutral" | "warn";
    };

export type TurnKind = "design" | "repair" | "break";

export interface Turn {
  id: string;
  kind: TurnKind;
  /** What the user said or did to start this turn. */
  prompt: string;
  items: TimelineItem[];
  status: "running" | "done" | "error";
  error?: string;
  /** One-line outcome, e.g. "16 devices · all checks passing". */
  summary?: string;
  startedAt: number;
}

export function newTurn(kind: TurnKind, prompt: string): Turn {
  return {
    id: `turn-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
    kind,
    prompt,
    items: [],
    status: "running",
    startedAt: Date.now(),
  };
}

/**
 * Agents answer with JSON. Surface the human-readable part (every agent
 * schema carries a `rationale`) without making the UI parse half-written
 * JSON mid-stream.
 */
export function extractRationale(output: string): string | undefined {
  try {
    const parsed = JSON.parse(output) as { rationale?: unknown };
    return typeof parsed.rationale === "string" && parsed.rationale.trim().length > 0
      ? parsed.rationale
      : undefined;
  } catch {
    return undefined;
  }
}
