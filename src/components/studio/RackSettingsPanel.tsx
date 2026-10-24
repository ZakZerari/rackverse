"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetTrigger } from "@/components/ui/sheet";
import { useRackStore } from "@/lib/store";
import type { Rack } from "@/lib/types";

type Settings = Omit<Rack, "id">;

export function RackSettingsPanel() {
  const rack = useRackStore((s) => s.design.rack);
  const save = useRackStore((s) => s.updateRackSettings);
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState<Settings>({ ...rack });
  const [error, setError] = useState("");

  function numberField(label: string, key: keyof Settings, unit: string, min: number, max: number) {
    return (
      <label className="block space-y-1 text-xs" key={key}>
        <span className="font-medium">{label} <span className="text-muted-foreground">({unit})</span></span>
        <input type="number" min={min} max={max} step="any" value={draft[key]}
          onChange={(event) => setDraft((current) => ({ ...current, [key]: Number(event.target.value) }))}
          className="w-full rounded-md border border-input bg-background px-3 py-2 font-mono outline-none focus:border-ring" />
      </label>
    );
  }

  return (
    <Sheet open={open} onOpenChange={(next) => { setOpen(next); if (next) { setDraft({ ...rack }); setError(""); } }}>
      <SheetTrigger render={<Button variant="outline" size="sm" />}>Rack settings</SheetTrigger>
      <SheetContent side="right" className="sm:max-w-md">
        <SheetHeader>
          <SheetTitle>Rack settings</SheetTitle>
          <p className="text-xs text-muted-foreground">Changing capacity or size rechecks every installed device. Existing equipment stays in place so you can resolve any new violations.</p>
        </SheetHeader>
        <form className="scroll-region flex-1 space-y-4 px-4 pb-4" onSubmit={(event) => {
          event.preventDefault();
          try { save(draft); setOpen(false); } catch (cause) { setError(cause instanceof Error ? cause.message : String(cause)); }
        }}>
          <label className="block space-y-1 text-xs"><span className="font-medium">Name</span>
            <input value={draft.name} maxLength={80} onChange={(event) => setDraft((current) => ({ ...current, name: event.target.value }))}
              className="w-full rounded-md border border-input bg-background px-3 py-2 outline-none focus:border-ring" />
          </label>
          {numberField("Rack height", "heightU", "U", 1, 60)}
          {numberField("Mounting depth", "mountingDepthMm", "mm", 100, 2000)}
          {numberField("Maximum load", "maxLoadKg", "kg", 1, 10000)}
          {numberField("Power budget", "powerBudgetW", "W", 1, 100000)}
          {error && <p role="alert" className="text-xs text-destructive">{error}</p>}
          <Button type="submit" className="w-full">Save rack settings</Button>
        </form>
      </SheetContent>
    </Sheet>
  );
}
