"use client";

import { useRef, useState } from "react";
import { getCatalogItem } from "@/data/catalog";
import { readSSE } from "@/lib/events";
import { useRackStore } from "@/lib/store";
import type { Design } from "@/lib/types";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";

const EXAMPLES = [
  "42U rack, 8 servers, redundant A/B power, 2 switches, $60k budget",
  "Small 24U edge rack: 3 low-power servers, 1 switch, keep it under $15k",
  "GPU training rack — 4 GPU servers, redundant power, 48U, 20kW",
];

function countChangedPlacements(before: Design, after: Design): number {
  const beforeById = new Map(before.placements.map((p) => [p.id, p]));
  const afterById = new Map(after.placements.map((p) => [p.id, p]));
  let changed = 0;
  for (const id of new Set([...beforeById.keys(), ...afterById.keys()])) {
    const a = beforeById.get(id);
    const b = afterById.get(id);
    if (!a || !b || JSON.stringify(a) !== JSON.stringify(b)) changed += 1;
  }
  return changed;
}

export function CopilotPanel() {
  const applyEvent = useRackStore((s) => s.applyEvent);
  const clearActivity = useRackStore((s) => s.clearActivity);
  const isRunning = useRackStore((s) => s.isRunning);
  const runningAgent = useRackStore((s) => s.runningAgent);
  const streamPreview = useRackStore((s) => s.streamPreview);

  const [text, setText] = useState("");
  const [error, setError] = useState<string | null>(null);
  const abortRef = useRef<AbortController | null>(null);

  async function handleGenerate() {
    if (!text.trim() || isRunning) return;
    setError(null);
    clearActivity();

    const controller = new AbortController();
    abortRef.current = controller;

    try {
      const res = await fetch("/api/design", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text }),
        signal: controller.signal,
      });

      if (!res.ok || !res.body) {
        const body = await res.json().catch(() => ({}) as { error?: string });
        throw new Error(body.error ?? `Request failed (${res.status}).`);
      }

      for await (const event of readSSE(res.body)) {
        applyEvent(event);
        if (event.type === "run:error") setError(event.error);
      }
    } catch (err) {
      if (err instanceof DOMException && err.name === "AbortError") return;
      const message = err instanceof Error ? err.message : String(err);
      setError(message);
      applyEvent({ type: "run:error", error: message });
    } finally {
      abortRef.current = null;
    }
  }

  return (
    <aside className="flex min-h-0 flex-col border-l border-border bg-panel">
      <header className="shrink-0 border-b border-border px-3 py-2">
        <h2 className="text-xs font-semibold">AI Copilot</h2>
        <p className="mt-0.5 text-[11px] text-muted-foreground">Describe the rack. Agents propose, code decides.</p>
      </header>

      <div className="scroll-region flex-1">
        <div className="space-y-3 p-3">
          <Textarea
            value={text}
            onChange={(e) => setText(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) handleGenerate();
            }}
            placeholder={EXAMPLES[0]}
            rows={3}
            className="resize-none text-xs"
          />

          <div className="flex items-center gap-2">
            <Button size="sm" className="flex-1" disabled={isRunning || !text.trim()} onClick={handleGenerate}>
              {isRunning ? "Designing…" : "Generate rack"}
            </Button>
            {isRunning && (
              <Button
                size="sm"
                variant="outline"
                onClick={() => {
                  abortRef.current?.abort();
                  applyEvent({ type: "run:error", error: "Cancelled." });
                }}
              >
                Stop
              </Button>
            )}
          </div>

          {!isRunning && (
            <div className="space-y-1">
              {EXAMPLES.map((example) => (
                <button
                  key={example}
                  onClick={() => setText(example)}
                  className="block w-full rounded-md border border-border/60 px-2 py-1.5 text-left text-[11px] text-muted-foreground transition-colors hover:border-border hover:text-foreground"
                >
                  {example}
                </button>
              ))}
            </div>
          )}

          {error && (
            <p className="rounded-md border border-destructive/40 bg-destructive/10 px-2 py-1.5 text-[11px] text-destructive">
              {error}
            </p>
          )}

          <LiveStream agent={runningAgent} preview={streamPreview} />
          <PendingRepairCard countChanged={countChangedPlacements} />
          <SelectedDeviceCard />
        </div>
      </div>
    </aside>
  );
}

function LiveStream({ agent, preview }: { agent: string | null; preview: string }) {
  if (!agent) return null;
  return (
    <div className="rounded-md border border-primary/40 bg-primary/5 p-2">
      <div className="flex items-center gap-1.5">
        <span className="size-1.5 animate-pulse rounded-full bg-primary" />
        <span className="font-mono text-[10px] uppercase tracking-wider text-primary">{agent}</span>
      </div>
      {preview && (
        <pre className="mt-1.5 max-h-24 overflow-hidden whitespace-pre-wrap break-all font-mono text-[10px] leading-relaxed text-muted-foreground">
          {preview.slice(-320)}
        </pre>
      )}
    </div>
  );
}

function PendingRepairCard({
  countChanged,
}: {
  countChanged: (before: Design, after: Design) => number;
}) {
  const design = useRackStore((s) => s.design);
  const pendingRepair = useRackStore((s) => s.pendingRepair);
  const acceptPendingRepair = useRackStore((s) => s.acceptPendingRepair);
  const rejectPendingRepair = useRackStore((s) => s.rejectPendingRepair);

  if (!pendingRepair) return null;

  const changed = countChanged(design, pendingRepair.design);
  const accepted = pendingRepair.trace.some((s) => s.ok);

  return (
    <div className="rounded-md border border-primary/50 bg-card p-2.5">
      <p className="text-xs font-semibold">
        Review {changed} change{changed === 1 ? "" : "s"}
      </p>
      <div className="mt-1.5 space-y-1">
        {pendingRepair.trace.map((step) => (
          <p key={step.id} className="text-[11px] text-muted-foreground">
            {step.detail}
          </p>
        ))}
      </div>
      {!accepted && (
        <p className="mt-1.5 text-[11px] text-destructive">
          The Verifier couldn&apos;t confirm an improvement — review carefully.
        </p>
      )}
      <div className="mt-2 flex gap-2">
        <Button size="xs" className="flex-1" onClick={acceptPendingRepair}>
          Accept
        </Button>
        <Button size="xs" variant="outline" className="flex-1" onClick={rejectPendingRepair}>
          Reject
        </Button>
      </div>
    </div>
  );
}

function SelectedDeviceCard() {
  const design = useRackStore((s) => s.design);
  const selectedPlacementId = useRackStore((s) => s.selectedPlacementId);
  const removePlacement = useRackStore((s) => s.removePlacement);

  const selected = design.placements.find((p) => p.id === selectedPlacementId);
  const item = selected ? getCatalogItem(selected.catalogId) : undefined;
  if (!selected || !item) return null;

  const specs: [string, string][] = [
    ["Position", `U${selected.startU} · ${selected.face}`],
    ["Size", `${item.heightU}U · ${item.depthMm}mm deep`],
    ["Power", item.powerW > 0 ? `${item.powerW}W draw` : `${item.powerCapacityW ?? 0}W supply`],
    ["Weight", `${item.weightKg}kg`],
    ["Price", `$${item.priceUsd.toLocaleString()}`],
  ];

  return (
    <div className="rounded-md border border-border bg-card p-2.5">
      <p className="text-xs font-semibold">{item.name}</p>
      <dl className="mt-1.5 space-y-0.5">
        {specs.map(([label, value]) => (
          <div key={label} className="flex justify-between gap-2 text-[11px]">
            <dt className="text-muted-foreground">{label}</dt>
            <dd className="font-mono tabular text-foreground">{value}</dd>
          </div>
        ))}
      </dl>
      <Button
        size="xs"
        variant="destructive"
        className="mt-2 w-full"
        onClick={() => removePlacement(selected.id)}
      >
        Remove
      </Button>
    </div>
  );
}
