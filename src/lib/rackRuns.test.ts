import { describe, expect, it } from "vitest";
import type { CallLogEntry } from "@/lib/callsLog";
import { rackMetrics, rackRunId, validRackId, type RackRunRecord } from "@/lib/rackRuns";

function call(runId: string, ts: string, ok: boolean, latencyMs: number, agent = "RackArchitect"): CallLogEntry {
  return { runId, ts, agent, model: "gemini-3.5-flash-lite", ok, latencyMs, attempt: 1 };
}

describe("rack-scoped Mubit evidence", () => {
  it("uses unique rack-scoped run IDs and refuses malformed rack IDs", () => {
    expect(validRackId("rack-123_abc")).toBe(true);
    expect(validRackId("rack:123")).toBe(false);
    expect(rackRunId("rack-a")).toMatch(/^rack:rack-a:\d+:/);
    expect(rackRunId("rack-a")).not.toBe(rackRunId("rack-a"));
  });

  it("isolates call and verification metrics across similar rack IDs", () => {
    const calls = [
      call("rack:rack-a:1:one", "2026-10-24T10:00:00Z", true, 1000, "RequirementsAgent"),
      call("rack:rack-a:1:one", "2026-10-24T10:00:01Z", true, 3000),
      call("rack:rack-a:2:two", "2026-10-24T11:00:00Z", false, 9000, "RepairAgent"),
      call("rack:rack-ab:1:other", "2026-10-24T12:00:00Z", true, 2000),
      call("bench-A-1", "2026-10-24T13:00:00Z", true, 500),
    ];
    const runs: RackRunRecord[] = [
      { rackId: "rack-a", runId: "rack:rack-a:1:one", kind: "design", timestamp: "2026-10-24T10:00:02Z", status: "completed", finalHardCount: 0 },
      { rackId: "rack-a", runId: "rack:rack-a:2:two", kind: "repair", timestamp: "2026-10-24T11:00:01Z", status: "error" },
      { rackId: "rack-ab", runId: "rack:rack-ab:1:other", kind: "design", timestamp: "2026-10-24T12:00:01Z", status: "completed", finalHardCount: 2 },
    ];
    const metrics = rackMetrics(["rack-a", "rack-ab"], calls, runs);
    expect(metrics["rack-a"]).toMatchObject({ calls: 3, successfulCalls: 2, failedCalls: 1,
      averageLatencyMs: 2000, runs: 2, verifiedRuns: 1, lastModel: "gemini-3.5-flash-lite" });
    expect(metrics["rack-a"].lastRun?.status).toBe("error");
    expect(metrics["rack-a"].agents).toEqual({ RequirementsAgent: 1, RackArchitect: 1, RepairAgent: 1 });
    expect(metrics["rack-ab"]).toMatchObject({ calls: 1, runs: 1, verifiedRuns: 0 });
  });

  it("shows no proof when a rack has no recorded Mubit calls", () => {
    expect(rackMetrics(["new-rack"], [], [])["new-rack"]).toMatchObject({
      calls: 0, successfulCalls: 0, runs: 0, verifiedRuns: 0,
      averageLatencyMs: null, lastModel: null, lastRun: null,
    });
  });

  it("computes first-round pass, rounds and end-to-end latency from verified repair runs", () => {
    const runs: RackRunRecord[] = [
      { rackId: "rack-a", runId: "rack:rack-a:one", kind: "repair", timestamp: "2026-10-24T10:00:00Z",
        status: "completed", initialHardCount: 2, finalHardCount: 0, repairRounds: 1, firstRoundPassed: true, durationMs: 1100 },
      { rackId: "rack-a", runId: "rack:rack-a:two", kind: "repair", timestamp: "2026-10-24T11:00:00Z",
        status: "completed", initialHardCount: 1, finalHardCount: 0, repairRounds: 3, firstRoundPassed: false, durationMs: 3300 },
      { rackId: "rack-a", runId: "rack:rack-a:error", kind: "repair", timestamp: "2026-10-24T12:00:00Z",
        status: "error", durationMs: 9000 },
      { rackId: "rack-b", runId: "rack:rack-b:one", kind: "repair", timestamp: "2026-10-24T13:00:00Z",
        status: "completed", initialHardCount: 1, finalHardCount: 0, repairRounds: 1, firstRoundPassed: true },
    ];
    expect(rackMetrics(["rack-a"], [], runs)["rack-a"]).toMatchObject({
      repairRuns: 2, firstRoundPassRatePct: 50, averageRepairRounds: 2, averageRepairDurationMs: 2200,
    });
  });

  it("estimates provider list cost only when every validated repair call has token usage", () => {
    const run: RackRunRecord = { rackId: "rack-a", runId: "rack:rack-a:priced", kind: "repair",
      timestamp: "2026-10-24T12:00:00Z", status: "completed", initialHardCount: 1,
      finalHardCount: 0, repairRounds: 1, firstRoundPassed: true, durationMs: 2000 };
    const used = { ...call(run.runId, run.timestamp, true, 1000, "RepairAgent"),
      promptTokens: 1000, completionTokens: 200 };
    expect(rackMetrics(["rack-a"], [used], [run])["rack-a"].providerListCostPerValidatedRepairUsd).toBe(0.0008);
    expect(rackMetrics(["rack-a"], [used, call(run.runId, run.timestamp, false, 1000, "RepairAgent")], [run])["rack-a"]
      .providerListCostPerValidatedRepairUsd).toBeNull();
  });

  it("includes failed repair runs in the first-round pass denominator", () => {
    const runs: RackRunRecord[] = [
      { rackId: "rack-a", runId: "rack:rack-a:ok", kind: "repair", timestamp: "2026-10-24T10:00:00Z",
        status: "completed", initialHardCount: 1, finalHardCount: 0, repairRounds: 1, firstRoundPassed: true, durationMs: 1000 },
      { rackId: "rack-a", runId: "rack:rack-a:failed", kind: "repair", timestamp: "2026-10-24T11:00:00Z",
        status: "error", initialHardCount: 1, firstRoundPassed: false, durationMs: 3000 },
    ];
    expect(rackMetrics(["rack-a"], [], runs)["rack-a"]).toMatchObject({
      repairRuns: 2, firstRoundPassRatePct: 50, averageRepairDurationMs: 2000,
    });
  });
});
