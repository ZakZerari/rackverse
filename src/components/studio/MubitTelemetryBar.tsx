"use client";

import { useEffect, useState } from "react";
import { Activity } from "lucide-react";
import { useRackStore } from "@/lib/store";
import type { RackModelMetrics } from "@/lib/rackRuns";
import type { MubitConsoleSnapshot } from "@/lib/mubitConsoleSnapshot";

interface BenchArm {
  n: number;
  firstRoundRepairPassPct: number;
  avgRepairRounds: number;
  avgEndToEndMs: number;
  providerListCostPerValidatedRepairUsd: number | null;
}

interface PairedBench {
  comparisonDesignsShared: boolean;
  configs: { A: BenchArm; B: BenchArm };
}

function value(number: number | null | undefined, suffix = ""): string {
  return number == null ? "—" : `${number}${suffix}`;
}

/** Rack-scoped operational evidence. Adapter A/B figures require a Mubit console export. */
export function MubitTelemetryBar({ rackId }: { rackId: string }) {
  const [metrics, setMetrics] = useState<RackModelMetrics | null>(null);
  const [bench, setBench] = useState<PairedBench | null>(null);
  const [consoleSnapshot, setConsoleSnapshot] = useState<MubitConsoleSnapshot | null>(null);
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

  useEffect(() => {
    const controller = new AbortController();
    fetch("/api/bench-results", { signal: controller.signal, cache: "no-store" })
      .then((response) => response.json())
      .then((body: { available?: boolean; results?: PairedBench }) => {
        if (!controller.signal.aborted && body.available && body.results?.comparisonDesignsShared &&
          body.results.configs.A.n >= 10 && body.results.configs.B.n >= 10) setBench(body.results);
      })
      .catch(() => {});
    return () => controller.abort();
  }, []);

  useEffect(() => {
    const controller = new AbortController();
    fetch("/api/mubit-console-snapshot", { signal: controller.signal, cache: "no-store" })
      .then((response) => response.json())
      .then((body: { available?: boolean; snapshot?: MubitConsoleSnapshot }) => {
        if (!controller.signal.aborted && body.available) setConsoleSnapshot(body.snapshot ?? null);
      })
      .catch(() => {});
    return () => controller.abort();
  }, []);

  const rows = [
    ["First-round pass", value(metrics?.firstRoundPassRatePct, "%")],
    ["Avg repair rounds", value(metrics?.averageRepairRounds)],
    ["Provider list $ / valid repair", metrics?.providerListCostPerValidatedRepairUsd == null
      ? "—" : `$${metrics.providerListCostPerValidatedRepairUsd.toFixed(4)}`],
    ["End-to-end repair", metrics?.averageRepairDurationMs == null ? "—" : `${(metrics.averageRepairDurationMs / 1000).toFixed(1)}s`],
  ];

  const comparison = bench && [
    ["First-round repair", `${bench.configs.A.firstRoundRepairPassPct}%`, `${bench.configs.B.firstRoundRepairPassPct}%`],
    ["Avg repair rounds", value(bench.configs.A.avgRepairRounds), value(bench.configs.B.avgRepairRounds)],
    ["Provider list $ / valid repair", bench.configs.A.providerListCostPerValidatedRepairUsd == null ? "—" : `$${bench.configs.A.providerListCostPerValidatedRepairUsd.toFixed(4)}`,
      bench.configs.B.providerListCostPerValidatedRepairUsd == null ? "—" : `$${bench.configs.B.providerListCostPerValidatedRepairUsd.toFixed(4)}`],
    ["End-to-end repair", `${(bench.configs.A.avgEndToEndMs / 1000).toFixed(1)}s`, `${(bench.configs.B.avgEndToEndMs / 1000).toFixed(1)}s`],
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
      <span className="text-[10px] text-muted-foreground" title="Cost uses Google paid-tier list rates and recorded tokens; it excludes Mubit fees and any provider discounts or free-tier credit.">
        {consoleSnapshot ? `${consoleSnapshot.liveTasks} live tasks · adapter ${consoleSnapshot.adapter.version} ${consoleSnapshot.adapter.status.toLowerCase()} (${consoleSnapshot.adapter.qualityPct}/${consoleSnapshot.adapter.targetPct}% on ${consoleSnapshot.adapter.testCases} tests) · snapshot ${new Date(consoleSnapshot.capturedAt).toLocaleDateString()}` : "Adapter A/B pending"}
        {" · "}<a href="https://ai.google.dev/gemini-api/docs/pricing" target="_blank" rel="noopener noreferrer" className="underline hover:text-primary">cost basis ↗</a>
      </span>
    </div>
    {comparison && <details className="mt-2 border-t border-border/70 pt-1 text-[10px]">
      <summary className="cursor-pointer font-medium text-primary">Paired local benchmark · {bench.configs.A.n} identical broken racks per arm</summary>
      <div className="mt-2 overflow-x-auto">
        <table className="w-full min-w-[650px] text-left">
          <thead className="text-muted-foreground"><tr><th className="pb-1 font-medium">Metric</th>
            <th className="pb-1 font-medium">Provider baseline</th><th className="pb-1 font-medium">With local verified lessons</th>
            <th className="pb-1 font-medium">Mubit adapter</th></tr></thead>
          <tbody>{comparison.map(([label, baseline, lessons]) => <tr key={label} className="border-t border-border/50">
            <th scope="row" className="py-1 font-normal text-muted-foreground">{label}</th>
            <td className="font-mono">{baseline}</td><td className="font-mono">{lessons}</td><td className="text-muted-foreground">—</td>
          </tr>)}</tbody>
        </table>
      </div>
      <p className="mt-1 text-muted-foreground">Local lessons are separate from a Mubit adapter. Adapter Try models figures remain pending.</p>
    </details>}
  </section>;
}
