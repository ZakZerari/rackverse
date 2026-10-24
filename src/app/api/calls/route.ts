import { NextResponse } from "next/server";
import { readCallLog } from "@/lib/callsLog";

export async function GET() {
  const calls = readCallLog();

  const byAgent = new Map<string, { count: number; successCount: number; totalLatencyMs: number }>();
  for (const call of calls) {
    const stats = byAgent.get(call.agent) ?? { count: 0, successCount: 0, totalLatencyMs: 0 };
    stats.count += 1;
    if (call.ok) stats.successCount += 1;
    stats.totalLatencyMs += call.latencyMs;
    byAgent.set(call.agent, stats);
  }

  const agents = [...byAgent.entries()].map(([agent, stats]) => ({
    agent,
    count: stats.count,
    successRatePct: Math.round((stats.successCount / stats.count) * 1000) / 10,
    avgLatencyMs: Math.round(stats.totalLatencyMs / stats.count),
  }));

  return NextResponse.json({ totalCalls: calls.length, agents });
}
