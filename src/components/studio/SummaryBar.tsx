"use client";

import { useRackStore } from "@/lib/store";
import { designTotals } from "@/lib/summary";

function Metric({
  label,
  value,
  sub,
  tone = "normal",
}: {
  label: string;
  value: string;
  sub?: string;
  tone?: "normal" | "warn" | "bad";
}) {
  const toneClass =
    tone === "bad" ? "text-destructive" : tone === "warn" ? "text-[var(--warn)]" : "text-foreground";
  return (
    <div className="flex min-w-0 flex-col px-3">
      <span className="font-mono text-[9px] uppercase tracking-wider text-muted-foreground">{label}</span>
      <span className={`font-mono text-xs tabular ${toneClass}`}>
        {value}
        {sub && <span className="ml-1 text-[10px] text-muted-foreground">{sub}</span>}
      </span>
    </div>
  );
}

export function SummaryBar() {
  const design = useRackStore((s) => s.design);
  const requirements = useRackStore((s) => s.requirements);
  const totals = designTotals(design);

  const powerPct = design.rack.powerBudgetW > 0 ? (totals.powerW / design.rack.powerBudgetW) * 100 : 0;
  const weightPct = design.rack.maxLoadKg > 0 ? (totals.weightKg / design.rack.maxLoadKg) * 100 : 0;
  const uPct = design.rack.heightU > 0 ? (totals.usedU / design.rack.heightU) * 100 : 0;
  const overBudget = requirements.budgetUsd !== undefined && totals.costUsd > requirements.budgetUsd;

  const tone = (pct: number) => (pct > 100 ? "bad" : pct > 80 ? "warn" : "normal");

  return (
    <div className="flex shrink-0 items-center overflow-x-auto border-b border-border bg-panel py-1.5">
      <Metric label="Devices" value={String(totals.deviceCount)} />
      <Metric
        label="Rack space"
        value={`${totals.usedU}/${design.rack.heightU}U`}
        sub={`${uPct.toFixed(0)}%`}
        tone={tone(uPct)}
      />
      <Metric
        label="Power"
        value={`${(totals.powerW / 1000).toFixed(2)}kW`}
        sub={`of ${(design.rack.powerBudgetW / 1000).toFixed(1)}kW`}
        tone={tone(powerPct)}
      />
      <Metric
        label="Weight"
        value={`${totals.weightKg.toFixed(0)}kg`}
        sub={`of ${design.rack.maxLoadKg}kg`}
        tone={tone(weightPct)}
      />
      <Metric
        label="Outlets"
        value={`${totals.outletsRequired}/${totals.outletsSupplied}`}
        sub="need/have"
        tone={totals.outletsRequired > totals.outletsSupplied ? "bad" : "normal"}
      />
      <Metric
        label="Net ports"
        value={`${totals.portsRequired}/${totals.portsSupplied}`}
        sub="need/have"
        tone={totals.portsRequired > totals.portsSupplied ? "bad" : "normal"}
      />
      <Metric
        label="Cost"
        value={`$${(totals.costUsd / 1000).toFixed(1)}k`}
        sub={requirements.budgetUsd ? `of $${(requirements.budgetUsd / 1000).toFixed(0)}k` : undefined}
        tone={overBudget ? "bad" : "normal"}
      />
    </div>
  );
}
