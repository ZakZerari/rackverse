import { appendFileSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import type { CallLogEntry } from "@/lib/callsLog";

const RUNS_PATH = join(process.cwd(), "data", "rack-runs.jsonl");
const RACK_ID_PATTERN = /^[a-zA-Z0-9_-]{1,100}$/;

export function validRackId(id: unknown): id is string {
  return typeof id === "string" && RACK_ID_PATTERN.test(id);
}

export function rackRunId(rackId: string): string {
  return `rack:${rackId}:${Date.now()}:${randomUUID()}`;
}

export interface RackRunRecord {
  rackId: string;
  runId: string;
  kind: "design" | "repair";
  timestamp: string;
  status: "completed" | "error";
  initialHardCount?: number;
  finalHardCount?: number;
  acceptedPatch?: boolean;
  repairRounds?: number;
  firstRoundPassed?: boolean;
  durationMs?: number;
}

/** Server-side evidence of deterministic outcomes after Mubit-backed agent calls. */
export function recordRackRun(record: RackRunRecord): void {
  try { appendFileSync(RUNS_PATH, `${JSON.stringify(record)}\n`); } catch { /* Logging is best effort. */ }
}

export function readRackRuns(): RackRunRecord[] {
  let raw: string;
  try { raw = readFileSync(RUNS_PATH, "utf8"); } catch { return []; }
  return raw.split("\n").flatMap((line) => {
    if (!line.trim()) return [];
    try {
      const value = JSON.parse(line) as RackRunRecord;
      return validRackId(value.rackId) && typeof value.runId === "string" ? [value] : [];
    } catch { return []; }
  });
}

export interface RackModelMetrics {
  calls: number;
  successfulCalls: number;
  failedCalls: number;
  averageLatencyMs: number | null;
  lastCallAt: string | null;
  lastModel: string | null;
  runs: number;
  verifiedRuns: number;
  lastRun: RackRunRecord | null;
  agents: Record<string, number>;
  repairRuns: number;
  firstRoundPassRatePct: number | null;
  averageRepairRounds: number | null;
  averageRepairDurationMs: number | null;
  providerListCostPerValidatedRepairUsd: number | null;
}

export function rackMetrics(ids: string[], calls: CallLogEntry[], runs: RackRunRecord[]): Record<string, RackModelMetrics> {
  const result: Record<string, RackModelMetrics> = {};
  for (const id of ids) {
    const ownCalls = calls.filter((call) => call.runId?.startsWith(`rack:${id}:`));
    const ownRuns = runs.filter((run) => run.rackId === id);
    const successful = ownCalls.filter((call) => call.ok);
    const byTime = [...ownCalls].sort((a, b) => b.ts.localeCompare(a.ts));
    const recentRuns = [...ownRuns].sort((a, b) => b.timestamp.localeCompare(a.timestamp));
    const agents: Record<string, number> = {};
    for (const call of ownCalls) agents[call.agent] = (agents[call.agent] ?? 0) + 1;
    const eligibleRepairs = ownRuns.filter((run) => run.kind === "repair" &&
      run.initialHardCount !== undefined && run.initialHardCount > 0);
    const measuredRepairs = eligibleRepairs.filter((run) => run.status === "completed" && run.repairRounds !== undefined);
    const timedRepairs = eligibleRepairs.filter((run) => run.durationMs !== undefined);
    const validatedRepairs = measuredRepairs.filter((run) => run.finalHardCount === 0);
    // Paid-tier Gemini 3.5 Flash-Lite text list price, USD per 1M tokens.
    // This is a provider estimate, not a Mubit invoice or adapter price.
    const pricedRepairs = eligibleRepairs.map((run) => ownCalls.filter((call) => call.runId === run.runId))
      .filter((runCalls) => runCalls.length > 0 && runCalls.every((call) =>
        call.model === "gemini-3.5-flash-lite" && call.promptTokens !== undefined && call.completionTokens !== undefined));
    const pricedCost = pricedRepairs.reduce((total, runCalls) => total + runCalls.reduce((sum, call) =>
      sum + ((call.promptTokens ?? 0) * 0.3 + (call.completionTokens ?? 0) * 2.5) / 1_000_000, 0), 0);
    result[id] = {
      calls: ownCalls.length,
      successfulCalls: successful.length,
      failedCalls: ownCalls.length - successful.length,
      averageLatencyMs: successful.length
        ? Math.round(successful.reduce((total, call) => total + call.latencyMs, 0) / successful.length) : null,
      lastCallAt: byTime[0]?.ts ?? null,
      lastModel: byTime.find((call) => call.model)?.model ?? null,
      runs: ownRuns.length,
      verifiedRuns: ownRuns.filter((run) => run.status === "completed" && run.finalHardCount === 0).length,
      lastRun: recentRuns[0] ?? null,
      agents,
      repairRuns: eligibleRepairs.length,
      firstRoundPassRatePct: eligibleRepairs.length
        ? Math.round(100 * eligibleRepairs.filter((run) => run.firstRoundPassed).length / eligibleRepairs.length) : null,
      averageRepairRounds: measuredRepairs.length
        ? Math.round(10 * measuredRepairs.reduce((total, run) => total + (run.repairRounds ?? 0), 0) / measuredRepairs.length) / 10 : null,
      averageRepairDurationMs: timedRepairs.length
        ? Math.round(timedRepairs.reduce((total, run) => total + (run.durationMs ?? 0), 0) / timedRepairs.length) : null,
      providerListCostPerValidatedRepairUsd: pricedRepairs.length === eligibleRepairs.length && validatedRepairs.length > 0
        ? Math.round(pricedCost / validatedRepairs.length * 1_000_000) / 1_000_000 : null,
    };
  }
  return result;
}
