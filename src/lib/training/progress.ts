import { readFileSync } from "node:fs";
import { join } from "node:path";
import { AGENT_LIST, type AgentName } from "@/lib/agents/registry";
import { MUBIT_TASK_MODEL, mubitResponseFormat, mubitTaskKey } from "@/lib/llm";

/**
 * Mubit trains a task at "25 kept examples" by default. We aim past it:
 * "Not every call becomes a kept example", and a task also needs spare
 * examples to hold back as test cases ("Waiting for more examples: {k} of
 * {need}" means "too few examples to keep some back as test cases").
 */
export const KEPT_EXAMPLE_THRESHOLD = 25;
export const DEFAULT_GOAL = 34;

export interface AgentProgress {
  agent: AgentName;
  /** Local audit key for the agent's CURRENT task identity. */
  taskKey: string;
  /** Successful recorded calls on that identity. Our best local proxy. */
  sent: number;
  failed: number;
}

/** The task key each agent's calls land on right now. */
export function currentTaskKeys(): Record<AgentName, string> {
  const keys = {} as Record<AgentName, string>;
  for (const agent of AGENT_LIST) {
    keys[agent.name] = mubitTaskKey(
      agent.instructions,
      mubitResponseFormat(agent.name, agent.schema),
      MUBIT_TASK_MODEL
    );
  }
  return keys;
}

/**
 * Counts what we have already sent on each agent's current task.
 *
 * Deliberately scoped to the current `taskKey`: calls made before the last
 * deliberate fork landed on tasks that no longer accumulate, so counting them
 * would overstate progress and stop the trainer early.
 *
 * This is a LOCAL proxy, not ground truth. The docs are explicit: "the count
 * your console shows is the source of truth", and not every call we send
 * becomes a kept example.
 */
export function readProgress(callsLogPath = join(process.cwd(), "data", "calls.jsonl")): AgentProgress[] {
  const keys = currentTaskKeys();
  const tally = new Map<string, { sent: number; failed: number }>();

  let lines: string[] = [];
  try {
    lines = readFileSync(callsLogPath, "utf-8").trim().split("\n");
  } catch {
    lines = [];
  }

  for (const line of lines) {
    let row: { agent?: string; taskKey?: string; ok?: boolean; recordForTraining?: boolean };
    try {
      row = JSON.parse(line);
    } catch {
      continue;
    }
    if (!row.agent || !row.taskKey) continue;
    // A call sent with recording off can never become a kept example.
    if (row.recordForTraining === false) continue;
    if (keys[row.agent as AgentName] !== row.taskKey) continue;

    const bucket = tally.get(row.agent) ?? { sent: 0, failed: 0 };
    if (row.ok) bucket.sent += 1;
    else bucket.failed += 1;
    tally.set(row.agent, bucket);
  }

  return AGENT_LIST.map((agent) => ({
    agent: agent.name,
    taskKey: keys[agent.name],
    sent: tally.get(agent.name)?.sent ?? 0,
    failed: tally.get(agent.name)?.failed ?? 0,
  }));
}

export function renderProgress(rows: AgentProgress[], goal: number): string {
  const width = Math.max(...rows.map((r) => r.agent.length));
  return rows
    .map((row) => {
      const done = Math.min(row.sent, goal);
      const bar = "█".repeat(Math.round((done / goal) * 24)).padEnd(24, "·");
      const flag = row.sent >= goal ? "✓" : row.sent >= KEPT_EXAMPLE_THRESHOLD ? "~" : " ";
      return `  ${flag} ${row.agent.padEnd(width)}  ${bar} ${String(row.sent).padStart(3)}/${goal}` +
        `  task ${row.taskKey}${row.failed ? `  (${row.failed} failed)` : ""}`;
    })
    .join("\n");
}
