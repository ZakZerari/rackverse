"use client";

import { useEffect, useState } from "react";
import { Activity } from "lucide-react";
import { useRackStore } from "@/lib/store";
import type { RackModelMetrics } from "@/lib/rackRuns";

function value(number: number | null | undefined, suffix = ""): string {
  return number == null ? "—" : `${number}${suffix}`;
}

/** Rack-scoped operational evidence. Adapter A/B figures require a Mubit console export. */
export function MubitTelemetryBar({ rackId }: { rackId: string }) {
  const [metrics, setMetrics] = useState<RackModelMetrics | null>(null);
  const finishedRepairs = useRackStore((state) => state.turns.filter((turn) =>
    turn.kind === "repair" && turn.status !== "running").length);

  useEffect(() => {
    const controller = new AbortController();
    fetch(`/api/rack-metrics?ids=${encodeURIComponent(rackId)}`, { signal: controller.signal, cache: "no-store" })
      .then((response) => response.json())
      .then((body: { metrics?: Record<string, RackModelMetrics> }) => {
        if (!controller.signal.aborted) setMetrics(body.metrics?.[rackId] ?? null);
      })
      .catch(() => { /* Keep the Studio usable when telemetry storage is unavailable. */ });
    return () => controller.abort();
  }, [rackId, finishedRepairs]);

  const rows = [
    ["First-round pass", value(metrics?.firstRoundPassRatePct, "%")],
    ["Avg repair rounds", value(metrics?.averageRepairRounds)],
    ["Cost / valid rack", "—"],
    ["End-to-end repair", metrics?.averageRepairDurationMs == null ? "—" : `${(metrics.averageRepairDurationMs / 1000).toFixed(1)}s`],
  ];

  return <section aria-label="Mubit intelligence telemetry" className="shrink-0 border-b border-border bg-panel/70 px-3 py-2">
    <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
      <div className="flex min-w-[170px] items-center gap-2">
        <Activity className="size-4 text-primary" aria-hidden="true" />
        <div><p className="text-[11px] font-semibold">Mubit intelligence telemetry</p>
          <p className="text-[10px] text-muted-foreground">Provider route · {metrics?.repairRuns ?? 0} measured repairs</p></div>
      </div>
      <div className="flex flex-1 flex-wrap gap-x-5 gap-y-1">
        {rows.map(([label, measured]) => <div key={label} className="flex items-baseline gap-1.5 text-[10px]">
          <span className="text-muted-foreground">{label}</span>
          <strong className="font-mono text-xs tabular-nums">{measured}</strong>
        </div>)}
      </div>
      <span className="text-[10px] text-muted-foreground" title="Adapter comparisons and dollar costs require verified Mubit evaluation and pricing data.">
        Adapter A/B pending · no estimated cost
      </span>
    </div>
  </section>;
}
