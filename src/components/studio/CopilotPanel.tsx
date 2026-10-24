"use client";

import { useState } from "react";
import { getCatalogItem } from "@/data/catalog";
import { useRackStore } from "@/lib/store";
import type { DesignFromPromptResult } from "@/lib/orchestrate";
import type { Design } from "@/lib/types";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Textarea } from "@/components/ui/textarea";

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

const PLACEHOLDER = '42U rack, 8 servers, redundant A/B power, 2 switches, $60k budget';

export function CopilotPanel() {
  const selectedPlacementId = useRackStore((s) => s.selectedPlacementId);
  const design = useRackStore((s) => s.design);
  const setDesign = useRackStore((s) => s.setDesign);
  const setRequirements = useRackStore((s) => s.setRequirements);
  const appendTrace = useRackStore((s) => s.appendTrace);

  const [text, setText] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const selected = design.placements.find((p) => p.id === selectedPlacementId);
  const selectedItem = selected ? getCatalogItem(selected.catalogId) : undefined;

  async function handleGenerate() {
    if (!text.trim() || loading) return;
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/design", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text }),
      });
      const body = (await res.json()) as DesignFromPromptResult & { error?: string };
      if (!res.ok) throw new Error(body.error ?? "Failed to generate a design.");

      setDesign(body.design);
      setRequirements(body.requirements);
      appendTrace(body.trace);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="flex h-full flex-col gap-3 border-l border-border p-3">
      <Card>
        <CardHeader>
          <CardTitle className="text-sm">AI Copilot</CardTitle>
        </CardHeader>
        <CardContent className="space-y-2">
          <Textarea
            value={text}
            onChange={(e) => setText(e.target.value)}
            placeholder={PLACEHOLDER}
            rows={4}
            className="text-xs"
          />
          <Button size="sm" className="w-full" disabled={loading || !text.trim()} onClick={handleGenerate}>
            {loading ? "Designing..." : "Generate rack"}
          </Button>
          {error && <p className="text-xs text-destructive">{error}</p>}
        </CardContent>
      </Card>

      <PendingRepairCard />

      {selectedItem && selected && (
        <Card>
          <CardHeader>
            <CardTitle className="text-sm">{selectedItem.name}</CardTitle>
          </CardHeader>
          <CardContent className="space-y-1 text-xs text-muted-foreground">
            <p>
              U{selected.startU} · {selected.face}
            </p>
            <p>
              {selectedItem.heightU}U · {selectedItem.powerW}W · {selectedItem.weightKg}kg
            </p>
            <p>${selectedItem.priceUsd.toLocaleString()}</p>
            <p className="pt-1 text-[11px]">Press Delete to remove.</p>
          </CardContent>
        </Card>
      )}

      <Card className="flex-1 overflow-hidden">
        <CardHeader>
          <CardTitle className="text-sm">Trace</CardTitle>
        </CardHeader>
        <CardContent className="h-full overflow-hidden p-0">
          <ScrollArea className="h-full px-4 pb-4">
            <TraceList />
          </ScrollArea>
        </CardContent>
      </Card>
    </div>
  );
}

function PendingRepairCard() {
  const design = useRackStore((s) => s.design);
  const pendingRepair = useRackStore((s) => s.pendingRepair);
  const acceptPendingRepair = useRackStore((s) => s.acceptPendingRepair);
  const rejectPendingRepair = useRackStore((s) => s.rejectPendingRepair);

  if (!pendingRepair) return null;

  const changed = countChangedPlacements(design, pendingRepair.design);
  const accepted = pendingRepair.trace.some((s) => s.ok);

  return (
    <Card className="border-primary/50">
      <CardHeader>
        <CardTitle className="text-sm">Review {changed} change{changed === 1 ? "" : "s"}</CardTitle>
      </CardHeader>
      <CardContent className="space-y-2">
        {pendingRepair.trace.map((step) => (
          <p key={step.id} className="text-xs text-muted-foreground">
            {step.detail}
          </p>
        ))}
        {!accepted && (
          <p className="text-xs text-destructive">
            The Verifier couldn&apos;t confirm an improvement — review carefully before accepting.
          </p>
        )}
        <div className="flex gap-2 pt-1">
          <Button size="sm" className="flex-1" onClick={acceptPendingRepair}>
            Accept
          </Button>
          <Button size="sm" variant="outline" className="flex-1" onClick={rejectPendingRepair}>
            Reject
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}

function TraceList() {
  const trace = useRackStore((s) => s.trace);
  if (trace.length === 0) {
    return <p className="text-xs text-muted-foreground">Agent steps will appear here once you generate a rack.</p>;
  }
  return (
    <div className="space-y-2">
      {trace.map((step) => (
        <div key={step.id} className="text-xs">
          <p className={`font-medium ${step.ok ? "text-foreground" : "text-destructive"}`}>{step.label}</p>
          <p className="text-muted-foreground">{step.detail}</p>
        </div>
      ))}
    </div>
  );
}
