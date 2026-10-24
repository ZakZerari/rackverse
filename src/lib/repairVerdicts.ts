import { appendFileSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { readCallLog } from "@/lib/callsLog";

const VERDICTS_PATH = join(process.cwd(), "data", "repair-verdicts.jsonl");

export interface RepairVerdict {
  timestamp: string;
  runId: string;
  mubitRequestId: string | null;
  round: number;
  candidate: number;
  suggestedRating: "Good" | "Bad";
  reason: string;
  hardBefore: number;
  hardAfter: number;
}

/** Records verifier evidence beside the gateway request ID for manual Requests review. */
export function recordRepairVerdict(verdict: Omit<RepairVerdict, "timestamp" | "mubitRequestId">): void {
  const call = readCallLog().findLast((entry) => entry.runId === verdict.runId &&
    entry.agent === "RepairAgent" && entry.ok);
  const record: RepairVerdict = {
    ...verdict,
    timestamp: new Date().toISOString(),
    mubitRequestId: call?.mubitRequestId ?? null,
  };
  try { appendFileSync(VERDICTS_PATH, `${JSON.stringify(record)}\n`); } catch { /* Evidence is best effort. */ }
}

export function readRepairVerdicts(): RepairVerdict[] {
  let raw: string;
  try { raw = readFileSync(VERDICTS_PATH, "utf8"); } catch { return []; }
  return raw.split("\n").flatMap((line) => {
    if (!line.trim()) return [];
    try {
      const value = JSON.parse(line) as RepairVerdict;
      return typeof value.runId === "string" && (value.suggestedRating === "Good" || value.suggestedRating === "Bad")
        ? [value] : [];
    } catch { return []; }
  });
}
