"use client";

import { useEffect, useRef, useState } from "react";
import { readSSE } from "@/lib/events";
import { useRackStore } from "@/lib/store";
import { useFleetStore } from "@/lib/fleet";
import { Button } from "@/components/ui/button";

export function Toolbar({ rackId }: { rackId: string }) {
  const design = useRackStore((s) => s.design);
  const requirements = useRackStore((s) => s.requirements);
  const applyChaos = useRackStore((s) => s.applyChaos);
  const applyEvent = useRackStore((s) => s.applyEvent);
  const isRunning = useRackStore((s) => s.isRunning);
  const hardCount = useRackStore((s) => s.violations.filter((v) => v.severity === "hard").length);
  const [repairing, setRepairing] = useState(false);
  const abortRef = useRef<AbortController | null>(null);

  useEffect(() => () => abortRef.current?.abort(), []);

  async function handleAutoRepair() {
    if (repairing) return;
    setRepairing(true);
    const controller = new AbortController();
    abortRef.current = controller;
    useRackStore.getState().beginTurn("repair", `Auto-repair ${hardCount} violation(s)`);
    try {
      const res = await fetch("/api/repair", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ design, requirements, rackId }),
        signal: controller.signal,
      });
      if (!res.ok || !res.body) {
        const body = (await res.json().catch(() => ({}))) as { error?: string };
        throw new Error(body.error ?? `Repair failed (${res.status}).`);
      }
      for await (const event of readSSE(res.body)) {
        if (useFleetStore.getState().activeRackId !== rackId) break;
        applyEvent(event);
      }
    } catch (err) {
      if (err instanceof DOMException && err.name === "AbortError") return;
      if (useFleetStore.getState().activeRackId !== rackId) return;
      applyEvent({
        type: "agent:error",
        agent: "RepairAgent",
        attempt: 1,
        error: err instanceof Error ? err.message : String(err),
      });
    } finally {
      abortRef.current = null;
      setRepairing(false);
    }
  }

  const busy = repairing || isRunning;

  return (
    <div className="flex items-center gap-1.5">
      <select
        aria-label="Break it: choose workload drift"
        className="h-8 max-w-[180px] rounded-md border border-border bg-background px-2 text-xs text-foreground disabled:opacity-50"
        defaultValue=""
        disabled={busy || design.placements.length === 0}
        onChange={(event) => {
          if (event.target.value) applyChaos(event.target.value as "power_cut" | "pdu_failure" | "capex_slash");
          event.target.value = "";
        }}
      >
        <option value="" disabled>Break it…</option>
        <option value="power_cut">⚡ Utility power cut (−30%)</option>
        <option value="pdu_failure">🔥 Failed B-side PDU</option>
        <option value="capex_slash">💰 CFO CapEx slash (−25%)</option>
      </select>
      <Button
        variant={hardCount > 0 ? "default" : "outline"}
        size="sm"
        onClick={handleAutoRepair}
        disabled={busy || hardCount === 0}
        title="Run the Repair Agent, then let the deterministic Verifier judge its patch"
      >
        {repairing ? "Repairing…" : "Auto-repair"}
      </Button>
    </div>
  );
}
