"use client";

import { useState } from "react";
import { readSSE } from "@/lib/events";
import { useRackStore } from "@/lib/store";
import { Button } from "@/components/ui/button";

export function Toolbar() {
  const design = useRackStore((s) => s.design);
  const requirements = useRackStore((s) => s.requirements);
  const breakIt = useRackStore((s) => s.breakIt);
  const applyEvent = useRackStore((s) => s.applyEvent);
  const isRunning = useRackStore((s) => s.isRunning);
  const hardCount = useRackStore((s) => s.violations.filter((v) => v.severity === "hard").length);
  const [repairing, setRepairing] = useState(false);

  async function handleAutoRepair() {
    if (repairing) return;
    setRepairing(true);
    try {
      const res = await fetch("/api/repair", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ design, requirements }),
      });
      if (!res.ok || !res.body) {
        const body = (await res.json().catch(() => ({}))) as { error?: string };
        throw new Error(body.error ?? `Repair failed (${res.status}).`);
      }
      for await (const event of readSSE(res.body)) {
        applyEvent(event);
      }
    } catch (err) {
      applyEvent({
        type: "agent:error",
        agent: "RepairAgent",
        attempt: 1,
        error: err instanceof Error ? err.message : String(err),
      });
    } finally {
      setRepairing(false);
    }
  }

  const busy = repairing || isRunning;

  return (
    <div className="flex items-center gap-1.5">
      <Button
        variant="outline"
        size="sm"
        onClick={breakIt}
        disabled={busy || design.placements.length === 0}
        title="Inject a realistic fault into the current design"
      >
        Break it
      </Button>
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
