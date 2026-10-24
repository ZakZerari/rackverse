"use client";

import { useState } from "react";
import { CATALOG } from "@/data/catalog";
import { Button } from "@/components/ui/button";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { useRackStore } from "@/lib/store";
import type { CatalogItem, Category } from "@/lib/types";

const CATEGORIES: Category[] = ["server", "switch", "storage", "ups", "pdu", "patch", "blank"];

function blankEquipment(): CatalogItem {
  return {
    id: `custom-${crypto.randomUUID()}`, manufacturer: "Custom", name: "New equipment", category: "server",
    heightU: 1, depthMm: 700, weightKg: 15, powerW: 300, priceUsd: 1000,
    psuCount: 1, netPortsNeeded: 1, fullDepth: true, source: "custom", estimated: [],
  };
}

export function EquipmentEditor({ item, open, onOpenChange }: {
  item: CatalogItem | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const save = useRackStore((s) => s.saveEquipment);
  const remove = useRackStore((s) => s.deleteEquipment);
  const reset = useRackStore((s) => s.resetEquipment);
  const design = useRackStore((s) => s.design);
  const [draft, setDraft] = useState<CatalogItem>(() => item ? { ...item } : blankEquipment());
  const [error, setError] = useState("");
  const isBuiltIn = !!item && CATALOG.some((base) => base.id === item.id);
  const isOverride = !!item && !!design.catalogOverrides?.some((entry) => entry.id === item.id);

  function field(label: string, key: keyof CatalogItem, optional = false) {
    const value = draft[key];
    return (
      <label key={key} className="block space-y-1 text-xs">
        <span className="font-medium">{label}</span>
        <input type="number" min="0" step={key === "weightKg" || key === "priceUsd" ? "any" : "1"}
          value={typeof value === "number" ? value : ""}
          placeholder={optional ? "Not applicable" : undefined}
          onChange={(event) => setDraft((current) => ({ ...current, [key]: event.target.value === "" && optional ? undefined : Number(event.target.value) }))}
          className="w-full rounded-md border border-input bg-background px-3 py-2 font-mono outline-none focus:border-ring" />
      </label>
    );
  }

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="right" className="sm:max-w-lg">
        <SheetHeader>
          <SheetTitle>{item ? "Edit equipment" : "Add equipment"}</SheetTitle>
          <p className="text-xs text-muted-foreground">Specs and price are used by all rack checks. Editing an installed device recalculates the current design.</p>
        </SheetHeader>
        <form className="scroll-region flex-1 space-y-4 px-4 pb-6" onSubmit={(event) => {
          event.preventDefault();
          try {
            const base = CATALOG.find((entry) => entry.id === draft.id);
            const estimated = base
              ? (["depthMm", "weightKg", "powerW", "powerCapacityW", "priceUsd"] as const).filter((key) =>
                  draft[key] !== base[key] || draft.estimated.includes(key))
              : draft.estimated;
            save({ ...draft, estimated });
            onOpenChange(false);
          } catch (cause) { setError(cause instanceof Error ? cause.message : String(cause)); }
        }}>
          <div className="grid grid-cols-2 gap-3">
            {(["manufacturer", "name"] as const).map((key) => <label key={key} className="block space-y-1 text-xs">
              <span className="font-medium capitalize">{key}</span>
              <input value={draft[key]} onChange={(event) => setDraft((current) => ({ ...current, [key]: event.target.value }))}
                className="w-full rounded-md border border-input bg-background px-3 py-2 outline-none focus:border-ring" />
            </label>)}
          </div>
          <label className="block space-y-1 text-xs"><span className="font-medium">Component type</span>
            <select value={draft.category} onChange={(event) => setDraft((current) => ({ ...current, category: event.target.value as Category }))}
              className="w-full rounded-md border border-input bg-background px-3 py-2">
              {CATEGORIES.map((category) => <option key={category} value={category}>{category}</option>)}
            </select>
          </label>
          <div className="grid grid-cols-2 gap-3">
            {field("Rack units (U)", "heightU")}
            {field("Depth (mm)", "depthMm")}
            {field("Weight (kg)", "weightKg")}
            {field("Power draw (W)", "powerW")}
            {field("Price (USD)", "priceUsd")}
            {field("Supply capacity (W)", "powerCapacityW", true)}
            {field("PDU outlets", "outlets", true)}
            {field("Power supplies", "psuCount", true)}
            {field("Network ports provided", "netPorts", true)}
            {field("Network ports needed", "netPortsNeeded", true)}
          </div>
          <label className="flex items-center gap-2 text-xs"><input type="checkbox" checked={draft.fullDepth}
            onChange={(event) => setDraft((current) => ({ ...current, fullDepth: event.target.checked }))} /> Full depth; blocks the opposite face</label>
          <p className="text-[11px] text-muted-foreground">ID: {draft.id}. Built-in source values are preserved until you edit them here; edited values are your own estimates.</p>
          {error && <p role="alert" className="text-xs text-destructive">{error}</p>}
          <Button type="submit" className="w-full">Save equipment</Button>
          {item && !isBuiltIn && <Button type="button" variant="destructive" className="w-full" onClick={() => {
            try { remove(item.id); onOpenChange(false); } catch (cause) { setError(cause instanceof Error ? cause.message : String(cause)); }
          }}>Delete custom equipment</Button>}
          {isBuiltIn && isOverride && <Button type="button" variant="outline" className="w-full" onClick={() => {
            if (item) { reset(item.id); onOpenChange(false); }
          }}>Reset to source specs</Button>}
        </form>
      </SheetContent>
    </Sheet>
  );
}
