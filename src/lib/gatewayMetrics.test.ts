import { describe, expect, it } from "vitest";
import { gatewayMetrics } from "@/lib/gatewayMetrics";
import type { CallLogEntry } from "@/lib/callsLog";

const call = (ts: string, agent: string, ok: boolean, latencyMs: number, model?: string): CallLogEntry =>
  ({ ts, agent, ok, latencyMs, model, attempt: 1 });

describe("gateway dashboard evidence", () => {
  it("keeps an empty log empty without inventing model results", () => {
    expect(gatewayMetrics([])).toEqual({
      totalCalls: 0, confirmedResponses: 0, successfulCalls: 0, averageLatencyMs: null,
      lastModel: null, agents: [],
    });
  });

  it("counts schema-valid replies, includes failed attempt time, and picks the latest model", () => {
    const calls = [
      { ...call("2026-10-24T10:00:00Z", "RackArchitect", true, 1000, "model-old"), mubitRequestId: `mreq_${"a".repeat(32)}` },
      { ...call("2026-10-24T12:00:00Z", "RepairAgent", false, 5000, "model-new"), mubitRequestId: "not-a-gateway-id" },
      call("2026-10-24T11:00:00Z", "RackArchitect", true, 3000),
    ];
    expect(gatewayMetrics(calls)).toMatchObject({
      totalCalls: 3, confirmedResponses: 1, successfulCalls: 2, averageLatencyMs: 3000,
      lastModel: "model-new",
      agents: [
        { agent: "RackArchitect", count: 2, successCount: 2, successRatePct: 100, avgLatencyMs: 2000 },
        { agent: "RepairAgent", count: 1, successCount: 0, successRatePct: 0, avgLatencyMs: 5000 },
      ],
    });
  });
});
