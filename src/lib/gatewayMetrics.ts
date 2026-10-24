import type { CallLogEntry } from "@/lib/callsLog";

export interface GatewayMetrics {
  totalCalls: number;
  confirmedResponses: number;
  successfulCalls: number;
  averageLatencyMs: number | null;
  lastModel: string | null;
  agents: { agent: string; count: number; successCount: number; successRatePct: number; avgLatencyMs: number }[];
}

/** Local request evidence. These calls use Mubit's provider pass-through route. */
export function gatewayMetrics(calls: CallLogEntry[]): GatewayMetrics {
  const byAgent = new Map<string, { count: number; successCount: number; totalLatencyMs: number }>();
  let successfulCalls = 0;
  let confirmedResponses = 0;
  let totalLatencyMs = 0;

  for (const call of calls) {
    const stats = byAgent.get(call.agent) ?? { count: 0, successCount: 0, totalLatencyMs: 0 };
    stats.count += 1;
    if (call.ok) {
      successfulCalls += 1;
      stats.successCount += 1;
    }
    if (/^mreq_[a-f0-9]{32}$/.test(call.mubitRequestId ?? "")) confirmedResponses += 1;
    stats.totalLatencyMs += call.latencyMs;
    totalLatencyMs += call.latencyMs;
    byAgent.set(call.agent, stats);
  }

  const recent = [...calls].sort((a, b) => b.ts.localeCompare(a.ts));
  return {
    totalCalls: calls.length,
    confirmedResponses,
    successfulCalls,
    averageLatencyMs: calls.length ? Math.round(totalLatencyMs / calls.length) : null,
    lastModel: recent.find((call) => call.model)?.model ?? null,
    agents: [...byAgent.entries()].map(([agent, stats]) => ({
      agent,
      count: stats.count,
      successCount: stats.successCount,
      successRatePct: Math.round((stats.successCount / stats.count) * 1000) / 10,
      avgLatencyMs: Math.round(stats.totalLatencyMs / stats.count),
    })),
  };
}
