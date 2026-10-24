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
import { BottomPanel } from "@/components/studio/BottomPanel";
import { CatalogPanel } from "@/components/studio/CatalogPanel";
import { CopilotPanel } from "@/components/studio/CopilotPanel";
import { RackElevation } from "@/components/studio/RackElevation";
import { SummaryBar } from "@/components/studio/SummaryBar";
import { Toolbar } from "@/components/studio/Toolbar";
import { VersionHistoryPanel } from "@/components/studio/VersionHistoryPanel";
import { Button } from "@/components/ui/button";

export default function StudioPage() {
  const face = useRackStore((s) => s.face);
  const addPlacement = useRackStore((s) => s.addPlacement);
  const movePlacement = useRackStore((s) => s.movePlacement);
  const removePlacement = useRackStore((s) => s.removePlacement);
  const selectedPlacementId = useRackStore((s) => s.selectedPlacementId);
  const revalidate = useRackStore((s) => s.revalidate);
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
    } else {
      const placement = useRackStore.getState().design.placements.find((p) => p.id === data.placementId);
      setDraggingLabel(placement ? (getCatalogItem(placement.catalogId)?.name ?? null) : null);
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
    } else {
      movePlacement(activeData.placementId, overData.startU, face);
    }
  }

  return (
    <DndContext id="studio-dnd" sensors={sensors} onDragStart={handleDragStart} onDragEnd={handleDragEnd}>
      {/* h-dvh + min-h-0 at every level is what makes the inner panels scroll
          instead of growing the page. */}
      <div className="flex h-dvh flex-col overflow-hidden">
        <header className="flex shrink-0 items-center justify-between border-b border-border bg-panel px-3 py-2">
          <div className="flex items-baseline gap-2">
            <h1 className="text-sm font-bold tracking-tight">RackVerse</h1>
            <span className="font-mono text-[10px] uppercase tracking-wider text-muted-foreground">
              AI proposes · code decides
            </span>
          </div>
          <div className="flex items-center gap-1.5">
            <Toolbar />
            <VersionHistoryPanel />
            <Button variant="ghost" size="sm" nativeButton={false} render={<Link href="/lab" />}>
              Lab
            </Button>
          </div>
        </header>

        <SummaryBar />

        <div className="grid min-h-0 flex-1 grid-cols-[210px_minmax(0,1fr)_280px] overflow-hidden">
          <CatalogPanel />

          <div className="grid min-h-0 grid-rows-[minmax(0,1fr)_minmax(140px,34%)] overflow-hidden">
            <RackElevation />
            <BottomPanel />
          </div>

          <CopilotPanel />
        </div>
      </div>

      <DragOverlay dropAnimation={null}>
        {draggingLabel && (
          <div className="rounded-md border border-primary bg-card px-2 py-1 text-[11px] shadow-lg">
            {draggingLabel}
          </div>
        )}
      </DragOverlay>
    </DndContext>
  );
}
