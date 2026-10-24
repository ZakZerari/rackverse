import { CheckCircle2, CircleHelp, Cpu, XCircle } from "lucide-react";
import type { GatewayMetrics } from "@/lib/gatewayMetrics";
import type { RackModelMetrics } from "@/lib/rackRuns";

const comparisonGuide = "https://docs.mubit.ai/guides/first-adapter";

function time(ms: number | null): string {
  return ms == null ? "—" : `${(ms / 1000).toFixed(1)}s`;
}

function rate(part: number, whole: number): number {
  return whole ? Math.round((part / whole) * 100) : 0;
}

export function MubitPerformance({ gateway, verifiedRuns, totalRuns }: {
  gateway: GatewayMetrics | null;
  verifiedRuns: number;
  totalRuns: number;
}) {
  const calls = gateway?.totalCalls ?? 0;
  const valid = gateway?.successfulCalls ?? 0;

  return <section aria-labelledby="model-comparison-title" className="overflow-hidden rounded-xl border border-border bg-card">
    <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border px-4 py-3 sm:px-5">
      <div>
        <h3 id="model-comparison-title" className="text-sm font-semibold">Model performance comparison</h3>
        <p className="mt-1 text-[11px] text-muted-foreground">Recorded provider calls and verified rack outcomes.</p>
      </div>
      <span className="font-mono text-[10px] uppercase tracking-wider text-muted-foreground">Mubit evidence</span>
    </div>
    <div className="overflow-x-auto">
      <table className="w-full min-w-[720px] border-collapse text-left text-xs">
        <thead className="bg-panel text-[10px] uppercase tracking-wide text-muted-foreground">
          <tr>
            <th scope="col" className="px-4 py-2.5 font-medium sm:px-5">Mode</th>
            <th scope="col" className="px-3 py-2.5 font-medium">Calls</th>
            <th scope="col" className="px-3 py-2.5 font-medium">Valid replies</th>
            <th scope="col" className="px-3 py-2.5 font-medium">Avg call</th>
            <th scope="col" className="px-3 py-2.5 font-medium">Verified runs</th>
            <th scope="col" className="px-4 py-2.5 font-medium sm:px-5">Evidence</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-border">
          <tr>
            <th scope="row" className="px-4 py-3 font-medium sm:px-5"><span className="block">Provider via Mubit</span><span className="mt-0.5 block font-mono text-[10px] font-normal text-muted-foreground">{gateway?.lastModel ?? "No model recorded"}</span></th>
            <td className="px-3 py-3 font-mono tabular-nums">{gateway ? calls : "—"}</td>
            <td className="px-3 py-3 font-mono tabular-nums">{calls ? `${valid}/${calls} · ${rate(valid, calls)}%` : "—"}</td>
            <td className="px-3 py-3 font-mono tabular-nums">{time(gateway?.averageLatencyMs ?? null)}</td>
            <td className="px-3 py-3 font-mono tabular-nums">{totalRuns ? `${verifiedRuns}/${totalRuns}` : "—"}</td>
            <td className="px-4 py-3 text-muted-foreground sm:px-5">{gateway?.confirmedResponses ? `${gateway.confirmedResponses} gateway IDs` : "No response IDs yet"}</td>
          </tr>
          <tr className="bg-panel/35">
            <th scope="row" className="px-4 py-3 font-medium sm:px-5"><span className="block">Mubit adapter</span><span className="mt-0.5 block text-[10px] font-normal text-muted-foreground">Try models comparison</span></th>
            <td className="px-3 py-3 text-muted-foreground">—</td>
            <td className="px-3 py-3 text-muted-foreground">—</td>
            <td className="px-3 py-3 text-muted-foreground">—</td>
            <td className="px-3 py-3 text-muted-foreground">—</td>
            <td className="px-4 py-3 sm:px-5"><a href={comparisonGuide} target="_blank" rel="noopener noreferrer" className="text-primary hover:underline">Compare in Mubit ↗</a></td>
          </tr>
        </tbody>
      </table>
    </div>
    <p className="border-t border-border px-4 py-3 text-[10px] leading-4 text-muted-foreground sm:px-5">Valid replies pass the response schema. Verified rack runs finish with zero hard design issues. The app&apos;s calls use the provider route; adapter results are available in Mubit&apos;s console.</p>
  </section>;
}

export function RackMubitSummary({ metrics }: { metrics?: RackModelMetrics }) {
  const calls = metrics?.calls ?? 0;
  const valid = metrics?.successfulCalls ?? 0;
  const runs = metrics?.runs ?? 0;
  const verified = metrics?.verifiedRuns ?? 0;

  return <div className="mt-4 rounded-lg border border-border bg-background/50 px-3 py-2.5">
    <div className="flex items-center justify-between gap-2"><span className="flex items-center gap-1.5 text-[10px] font-semibold"><Cpu className="size-3 text-primary" /> Model checks</span><span className="text-[9px] text-muted-foreground">Provider via Mubit</span></div>
    {calls ? <>
      <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 font-mono text-[10px] tabular-nums"><span>{valid}/{calls} valid replies</span><span>{verified}/{runs} verified runs</span><span>{time(metrics?.averageLatencyMs ?? null)} avg valid reply</span>{(metrics?.repairRuns ?? 0) > 0 && <span>{metrics?.firstRoundPassRatePct}% first-round repair · n={metrics?.repairRuns}</span>}</div>
      {metrics?.lastRun && <div className="mt-2 flex items-center gap-1 border-t border-border/70 pt-2 text-[10px] text-muted-foreground">{metrics.lastRun.status === "completed" && metrics.lastRun.finalHardCount === 0 ? <CheckCircle2 className="size-3 text-[var(--ok)]" /> : <XCircle className="size-3 text-destructive" />}Last {metrics.lastRun.kind}: {metrics.lastRun.status === "error" ? "request failed" : `${metrics.lastRun.finalHardCount ?? "?"} hard issues left`}</div>}
    </> : <p className="mt-2 flex items-center gap-1 text-[10px] text-muted-foreground"><CircleHelp className="size-3" /> No agent calls recorded</p>}
  </div>;
}
