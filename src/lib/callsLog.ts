import { readFileSync } from "node:fs";
import { join } from "node:path";

export interface CallLogEntry {
  ts: string;
  agent: string;
  model?: string;
  /** Local hash of task-defining request fields; not Mubit’s task ID. */
  taskKey?: string;
  recordForTraining?: boolean;
  mubitRequestId?: string | null;
  runId?: string;
  latencyMs: number;
  promptTokens?: number;
  completionTokens?: number;
  ok: boolean;
  attempt: number;
  error?: string;
  structuredMode?: string;
}

const CALLS_PATH = join(process.cwd(), "data", "calls.jsonl");

/** Reads data/calls.jsonl. Missing/empty file (no calls made yet) returns []. */
export function readCallLog(): CallLogEntry[] {
  let raw: string;
  try {
    raw = readFileSync(CALLS_PATH, "utf-8");
  } catch {
    return [];
  }
  const entries: CallLogEntry[] = [];
  for (const line of raw.split("\n")) {
    if (!line.trim()) continue;
    try {
      entries.push(JSON.parse(line) as CallLogEntry);
    } catch {
      // skip a malformed line rather than failing the whole read
    }
  }
  return entries;
}
