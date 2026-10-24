"use client";

import { useRackStore } from "@/lib/store";
import { getCatalogItem } from "@/data/catalog";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

export function CopilotPanel() {
  const selectedPlacementId = useRackStore((s) => s.selectedPlacementId);
  const design = useRackStore((s) => s.design);
  const selected = design.placements.find((p) => p.id === selectedPlacementId);
  const selectedItem = selected ? getCatalogItem(selected.catalogId) : undefined;

  return (
    <div className="flex h-full flex-col gap-3 border-l border-border p-3">
      <Card>
        <CardHeader>
          <CardTitle className="text-sm">AI Copilot</CardTitle>
        </CardHeader>
        <CardContent className="text-xs text-muted-foreground">
          Describe a rack in plain English and a team of agents will build it — arriving once
          RequirementsAgent and RackArchitect are wired up.
        </CardContent>
      </Card>

      {selectedItem && selected && (
        <Card>
          <CardHeader>
            <CardTitle className="text-sm">{selectedItem.name}</CardTitle>
          </CardHeader>
          <CardContent className="space-y-1 text-xs text-muted-foreground">
            <p>U{selected.startU} · {selected.face}</p>
            <p>{selectedItem.heightU}U · {selectedItem.powerW}W · {selectedItem.weightKg}kg</p>
            <p>${selectedItem.priceUsd.toLocaleString()}</p>
            <p className="pt-1 text-[11px]">Press Delete to remove.</p>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
