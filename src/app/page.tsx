"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ArrowRight, CheckCircle2, Clock3, Plus, Server, Trash2, TriangleAlert } from "lucide-react";
import { Button } from "@/components/ui/button";
import { MubitPerformance, RackMubitSummary } from "@/components/dashboard/MubitPerformance";
import { useFleetStore, type RackRecord } from "@/lib/fleet";
import type { GatewayMetrics } from "@/lib/gatewayMetrics";
import { designTotals } from "@/lib/summary";
import { validateDesign } from "@/lib/validate";
import type { RackModelMetrics } from "@/lib/rackRuns";

function percent(value: number, total: number): number {
  return total > 0 ? Math.max(0, Math.min(100, Math.round((value / total) * 100))) : 0;
}

function Utilization({ label, used, capacity, display }: {
  label: string; used: number; capacity: number; display: string;
}) {
  const amount = percent(used, capacity);
  const color = used > capacity ? "bg-destructive" : amount >= 80 ? "bg-[var(--warn)]" : "bg-primary";
  return (
    <div className="space-y-1.5">
      <div className="flex justify-between gap-3 text-[11px]"><span className="text-muted-foreground">{label}</span><span className="font-mono tabular-nums">{display}</span></div>
      <div className="h-1.5 overflow-hidden rounded-full bg-secondary"><div className={`h-full rounded-full ${color}`} style={{ width: `${amount}%` }} /></div>
    </div>
  );
}

function RackCard({ rack, metrics, onDelete }: {
  rack: RackRecord; metrics?: RackModelMetrics; onDelete: () => void;
}) {
  const totals = designTotals(rack.design);
  const violations = validateDesign(rack.design, rack.requirements);
  const hard = violations.filter((violation) => violation.severity === "hard");
  const soft = violations.length - hard.length;
  const draft = rack.design.placements.length === 0;
  const status = draft ? "Draft" : hard.length > 0 ? `${hard.length} hard issue${hard.length === 1 ? "" : "s"}`
    : soft > 0 ? `${soft} advisory` : "Checks passing";
  const statusClass = draft ? "bg-secondary text-muted-foreground"
    : hard.length > 0 ? "bg-destructive/15 text-destructive"
      : soft > 0 ? "bg-[var(--warn)]/15 text-[var(--warn)]" : "bg-[var(--ok)]/15 text-[var(--ok)]";

  return (
    <article className="group flex min-w-0 flex-col overflow-hidden rounded-xl border border-border bg-card shadow-sm transition-colors hover:border-primary/50">
      <Link href={`/racks/${rack.id}`} className="block flex-1 p-5 focus-visible:outline-2 focus-visible:outline-primary">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <p className="mb-1 font-mono text-[10px] uppercase tracking-widest text-muted-foreground">{rack.design.rack.heightU}U rack · v{rack.design.version}</p>
            <h2 className="truncate text-lg font-semibold tracking-tight">{rack.design.rack.name}</h2>
          </div>
          <span className={`shrink-0 rounded-full px-2.5 py-1 text-[10px] font-semibold ${statusClass}`}>{status}</span>
        </div>
        <div className="mt-4 grid grid-cols-3 gap-2 border-y border-border/70 py-3 text-center">
          <div><p className="font-mono text-base font-semibold">{totals.deviceCount}</p><p className="text-[10px] text-muted-foreground">devices</p></div>
          <div><p className="font-mono text-base font-semibold">{totals.portsRequired}/{totals.portsSupplied}</p><p className="text-[10px] text-muted-foreground">network ports</p></div>
          <div><p className="font-mono text-base font-semibold">${(totals.costUsd / 1000).toFixed(1)}k</p><p className="text-[10px] text-muted-foreground">estimated cost</p></div>
        </div>
        <div className="mt-4 space-y-3">
          <Utilization label="Rack space" used={totals.usedU} capacity={rack.design.rack.heightU} display={`${totals.usedU}/${rack.design.rack.heightU}U`} />
          <Utilization label="Power draw" used={totals.powerW} capacity={rack.design.rack.powerBudgetW}
            display={`${(totals.powerW / 1000).toFixed(1)}/${(rack.design.rack.powerBudgetW / 1000).toFixed(1)}kW`} />
          <Utilization label="Weight" used={totals.weightKg} capacity={rack.design.rack.maxLoadKg}
            display={`${totals.weightKg.toFixed(0)}/${rack.design.rack.maxLoadKg}kg`} />
        </div>
        <p className="mt-4 text-[11px] text-muted-foreground">
          Engineering checks: <span className={hard.length > 0 ? "font-semibold text-destructive" : "font-semibold text-[var(--ok)]"}>{hard.length} hard</span>
          {` · ${soft} advisory · ${totals.outletsRequired}/${totals.outletsSupplied} outlets`}
        </p>
        {hard.length > 0 && <div className="mt-4 rounded-md bg-destructive/10 px-3 py-2 text-[11px] text-destructive">
          <TriangleAlert className="mr-1 inline size-3.5" />{hard.slice(0, 2).map((violation) => violation.code.replaceAll("_", " ")).join(" · ")}
          {hard.length > 2 && ` · +${hard.length - 2} more`}
        </div>}
        <RackMubitSummary metrics={metrics} />
      </Link>
      <div className="flex items-center justify-between border-t border-border bg-panel/50 px-5 py-3">
        <span className="flex items-center gap-1 text-[10px] text-muted-foreground"><Clock3 className="size-3" /> Edited {new Date(rack.updatedAt).toLocaleDateString()}</span>
        <div className="flex items-center gap-2">
          <button type="button" onClick={onDelete} className="rounded p-1.5 text-muted-foreground hover:bg-destructive/10 hover:text-destructive" aria-label={`Delete ${rack.design.rack.name}`}><Trash2 className="size-3.5" /></button>
          <Button size="xs" nativeButton={false} render={<Link href={`/racks/${rack.id}`} />}>Open <ArrowRight className="size-3" /></Button>
        </div>
      </div>
    </article>
  );
}

export default function DashboardPage() {
  const router = useRouter();
  const racks = useFleetStore((state) => state.racks);
  const hydrated = useFleetStore((state) => state.hydrated);
  const [name, setName] = useState("");
  const [loadedMetrics, setLoadedMetrics] = useState<{ key: string; metrics: Record<string, RackModelMetrics> } | null>(null);
  const [gateway, setGateway] = useState<GatewayMetrics | null>(null);
  const ids = racks.map((rack) => rack.id).join(",");

  useEffect(() => { useFleetStore.getState().hydrate(); }, []);
  useEffect(() => {
    fetch("/api/calls", { cache: "no-store" }).then((response) => response.json())
      .then((data) => setGateway(data)).catch(() => { /* The rack dashboard remains useful offline. */ });
  }, []);
  useEffect(() => {
    if (!hydrated || !ids) return;
    const controller = new AbortController();
    fetch(`/api/rack-metrics?ids=${encodeURIComponent(ids)}`, { signal: controller.signal, cache: "no-store" })
      .then((response) => response.json())
      .then((data: { metrics?: Record<string, RackModelMetrics> }) => {
        if (!controller.signal.aborted) setLoadedMetrics({ key: ids, metrics: data.metrics ?? {} });
      })
      .catch(() => { /* Rack checks still render when call logs are unavailable. */ });
    return () => controller.abort();
  }, [hydrated, ids]);

  function createRack(event: React.FormEvent) {
    event.preventDefault();
    const id = useFleetStore.getState().createRack(name);
    router.push(`/racks/${id}`);
  }

  const validCount = racks.filter((rack) => rack.design.placements.length > 0 &&
    validateDesign(rack.design, rack.requirements).every((violation) => violation.severity !== "hard")).length;
  const issueCount = racks.filter((rack) => validateDesign(rack.design, rack.requirements).some((violation) => violation.severity === "hard")).length;
  const draftCount = racks.filter((rack) => rack.design.placements.length === 0).length;
  const metrics = loadedMetrics?.key === ids ? loadedMetrics.metrics : {};
  const verifiedRuns = racks.reduce((total, rack) => total + (metrics[rack.id]?.verifiedRuns ?? 0), 0);
  const totalRuns = racks.reduce((total, rack) => total + (metrics[rack.id]?.runs ?? 0), 0);

  return <main className="min-h-dvh bg-background text-foreground">
    <header className="border-b border-border bg-panel"><div className="mx-auto flex max-w-7xl items-center justify-between gap-4 px-5 py-4">
      <div className="flex items-center gap-2.5"><span className="flex size-8 items-center justify-center rounded-lg bg-primary/15 text-primary"><Server className="size-4" /></span>
        <div><h1 className="text-sm font-bold tracking-tight">RackVerse</h1><p className="font-mono text-[9px] uppercase tracking-widest text-muted-foreground">Fleet dashboard</p></div>
      </div>
      <Button variant="outline" size="sm" nativeButton={false} render={<Link href="/lab" />}>Model lab <ArrowRight className="size-3.5" /></Button>
    </div></header>

    <div className="mx-auto max-w-7xl space-y-8 px-5 py-8">
      <section className="flex flex-wrap items-end justify-between gap-5">
        <div><p className="mb-2 font-mono text-[10px] uppercase tracking-[0.2em] text-primary">Infrastructure overview</p>
          <h2 className="text-3xl font-semibold tracking-tight sm:text-4xl">Your racks</h2>
          <p className="mt-2 max-w-2xl text-sm text-muted-foreground">Review design health at a glance, then open a rack to change its layout or equipment.</p>
        </div>
        <form onSubmit={createRack} className="flex w-full max-w-sm gap-2">
          <input value={name} onChange={(event) => setName(event.target.value)} maxLength={80} placeholder="New rack name"
            aria-label="New rack name" className="min-w-0 flex-1 rounded-md border border-input bg-card px-3 py-2 text-sm outline-none focus:border-primary" />
          <Button type="submit" disabled={!hydrated}><Plus className="size-4" /> New rack</Button>
        </form>
      </section>

      <section className="grid grid-cols-2 gap-3 md:grid-cols-4" aria-label="Fleet totals">
        {[
          { label: "Total racks", value: racks.length, icon: Server },
          { label: "Passing checks", value: validCount, icon: CheckCircle2 },
          { label: "Need attention", value: issueCount, icon: TriangleAlert },
          { label: "Draft racks", value: draftCount, icon: Clock3 },
        ].map(({ label, value, icon: Icon }) => <div key={label} className="rounded-xl border border-border bg-card px-4 py-4">
          <div className="flex items-center justify-between"><span className="text-[11px] text-muted-foreground">{label}</span><Icon className="size-4 text-muted-foreground" /></div>
          <p className="mt-3 font-mono text-2xl font-semibold tabular-nums">{hydrated ? value : "—"}</p>
        </div>)}
      </section>

      <section>
        <div className="mb-4 flex items-baseline justify-between"><h3 className="text-sm font-semibold">Rack inventory</h3><span className="font-mono text-[10px] text-muted-foreground">{racks.length} saved locally</span></div>
        {!hydrated ? <p className="rounded-xl border border-border bg-card p-8 text-sm text-muted-foreground">Loading your racks…</p>
          : racks.length === 0 ? <div className="rounded-xl border border-dashed border-border bg-card/50 px-6 py-12 text-center">
            <Server className="mx-auto size-8 text-primary" /><h4 className="mt-4 text-base font-semibold">Your first rack starts here</h4>
            <p className="mt-1 text-sm text-muted-foreground">Create a rack, add equipment, or ask the copilot to propose a design.</p>
          </div>
            : <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
              {[...racks].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt)).map((rack) => <RackCard key={rack.id} rack={rack} metrics={metrics[rack.id]}
                onDelete={() => {
                  if (window.confirm(`Delete ${rack.design.rack.name}? Its saved design and history will be removed from this browser.`)) {
                    useFleetStore.getState().removeRack(rack.id);
                  }
                }} />)}
            </div>}
      </section>

      <p className="text-[11px] text-muted-foreground">Engineering checks use saved catalog specs and estimates, not live rack sensor data.</p>

      <MubitPerformance gateway={gateway} verifiedRuns={verifiedRuns} totalRuns={totalRuns} />
    </div>
  </main>;
}
