"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import {
  DndContext,
  DragOverlay,
  PointerSensor,
  useSensor,
  useSensors,
  type DragEndEvent,
  type DragStartEvent,
} from "@dnd-kit/core";
import { getCatalogItem } from "@/data/catalog";
import { useRackStore } from "@/lib/store";
import { CatalogPanel } from "@/components/studio/CatalogPanel";
import { RackElevation } from "@/components/studio/RackElevation";
import { CopilotPanel } from "@/components/studio/CopilotPanel";
import { BottomPanel } from "@/components/studio/BottomPanel";
import { VersionHistoryPanel } from "@/components/studio/VersionHistoryPanel";
import { Toolbar } from "@/components/studio/Toolbar";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";

export default function StudioPage() {
  const { face, addPlacement, movePlacement, selectedPlacementId, removePlacement, revalidate } =
    useRackStore();
  const [draggingLabel, setDraggingLabel] = useState<string | null>(null);

  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 4 } }));

  useEffect(() => {
    revalidate();
  }, [revalidate]);

  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      if ((e.key === "Delete" || e.key === "Backspace") && selectedPlacementId) {
        const target = e.target as HTMLElement | null;
        if (target && ["INPUT", "TEXTAREA"].includes(target.tagName)) return;
        removePlacement(selectedPlacementId);
      }
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [selectedPlacementId, removePlacement]);

  function handleDragStart(event: DragStartEvent) {
    const data = event.active.data.current as
      | { type: "catalog"; catalogId: string }
      | { type: "placement"; placementId: string }
      | undefined;
    if (!data) return;
    if (data.type === "catalog") {
      setDraggingLabel(getCatalogItem(data.catalogId)?.name ?? null);
    } else if (data.type === "placement") {
      const design = useRackStore.getState().design;
      const placement = design.placements.find((p) => p.id === data.placementId);
      setDraggingLabel(placement ? getCatalogItem(placement.catalogId)?.name ?? null : null);
    }
  }

  function handleDragEnd(event: DragEndEvent) {
    setDraggingLabel(null);
    const { active, over } = event;
    if (!over) return;

    const activeData = active.data.current as
      | { type: "catalog"; catalogId: string }
      | { type: "placement"; placementId: string }
      | undefined;
    const overData = over.data.current as { type: "slot"; startU: number } | undefined;
    if (!activeData || !overData || overData.type !== "slot") return;

    if (activeData.type === "catalog") {
      addPlacement(activeData.catalogId, overData.startU, face);
    } else if (activeData.type === "placement") {
      movePlacement(activeData.placementId, overData.startU, face);
    }
  }

  return (
    <DndContext id="studio-dnd" sensors={sensors} onDragStart={handleDragStart} onDragEnd={handleDragEnd}>
      <div className="flex h-screen flex-col">
        <header className="flex items-center justify-between border-b border-border px-4 py-2">
          <div className="flex items-center gap-2">
            <h1 className="text-sm font-bold">RackVerse</h1>
            <Badge variant="outline">Studio</Badge>
          </div>
          <div className="flex items-center gap-2">
            <Toolbar />
            <VersionHistoryPanel />
            <Button variant="outline" size="sm" nativeButton={false} render={<Link href="/lab" />}>
              Lab
            </Button>
          </div>
        </header>
        <div className="grid flex-1 grid-cols-[240px_1fr_280px] overflow-hidden">
          <CatalogPanel />
          <div className="flex flex-col overflow-hidden">
            <div className="flex-1 overflow-hidden">
              <RackElevation />
            </div>
            <div className="h-56 shrink-0">
              <BottomPanel />
            </div>
          </div>
          <CopilotPanel />
        </div>
      </div>
      <DragOverlay>
        {draggingLabel && (
          <div className="rounded-md border border-primary bg-card px-2 py-1 text-xs shadow-lg">
            {draggingLabel}
          </div>
        )}
      </DragOverlay>
    </DndContext>
  );
}
