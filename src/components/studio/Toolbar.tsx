"use client";

import { useState } from "react";
import { useRackStore } from "@/lib/store";
import type { RepairOnlyResult } from "@/lib/orchestrate";
import { Button } from "@/components/ui/button";

export function Toolbar() {
  const design = useRackStore((s) => s.design);
  const requirements = useRackStore((s) => s.requirements);
  const breakIt = useRackStore((s) => s.breakIt);
  const setPendingRepair = useRackStore((s) => s.setPendingRepair);
  const appendTrace = useRackStore((s) => s.appendTrace);
  const hardViolationCount = useRackStore(
    (s) => s.violations.filter((v) => v.severity === "hard").length
  );
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
      const body = (await res.json()) as RepairOnlyResult & { error?: string };
      if (!res.ok) throw new Error(body.error ?? "Repair failed.");
      setPendingRepair(body);
    } catch (err) {
      appendTrace([
        {
          id: `repair-error-${Date.now()}`,
          label: "Auto-repair",
          detail: err instanceof Error ? err.message : String(err),
          ok: false,
        },
      ]);
    } finally {
      setRepairing(false);
    }
  }

  return (
    <div className="flex items-center gap-2">
      <Button variant="outline" size="sm" onClick={breakIt} disabled={design.placements.length === 0}>
        Break it
      </Button>
      <Button
        variant="outline"
        size="sm"
        onClick={handleAutoRepair}
        disabled={repairing || hardViolationCount === 0}
      >
        {repairing ? "Repairing..." : "Auto-repair"}
      </Button>
    </div>
  );
}
