"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  DndContext,
  DragOverlay,
  PointerSensor,
  useSensor,
  useSensors,
  type DragEndEvent,
  type DragStartEvent,
} from "@dnd-kit/core";
import { catalogItemFor } from "@/lib/catalog";
import { useRackStore } from "@/lib/store";
import { useFleetStore } from "@/lib/fleet";
import { BottomPanel } from "@/components/studio/BottomPanel";
import { CatalogPanel } from "@/components/studio/CatalogPanel";
import { CopilotPanel } from "@/components/studio/CopilotPanel";
import { RackElevation } from "@/components/studio/RackElevation";
import { RackSettingsPanel } from "@/components/studio/RackSettingsPanel";
import { MubitTelemetryBar } from "@/components/studio/MubitTelemetryBar";
import { SummaryBar } from "@/components/studio/SummaryBar";
import { Toolbar } from "@/components/studio/Toolbar";
import { VersionHistoryPanel } from "@/components/studio/VersionHistoryPanel";
import { Button } from "@/components/ui/button";

export default function StudioPage({ rackId }: { rackId: string }) {
  const router = useRouter();
  const hydrated = useFleetStore((s) => s.hydrated);
  const activeRackId = useFleetStore((s) => s.activeRackId);
  const [pane, setPane] = useState<"equipment" | "rack" | "copilot">("rack");
  const face = useRackStore((s) => s.face);
  const addPlacement = useRackStore((s) => s.addPlacement);
  const movePlacement = useRackStore((s) => s.movePlacement);
  const removePlacement = useRackStore((s) => s.removePlacement);
  const selectedPlacementId = useRackStore((s) => s.selectedPlacementId);
  const [draggingLabel, setDraggingLabel] = useState<string | null>(null);

  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 4 } }));

  useEffect(() => {
    useFleetStore.getState().hydrate();
  }, []);

  useEffect(() => {
    if (!hydrated) return;
    const rack = useFleetStore.getState().racks.find((entry) => entry.id === rackId);
    if (!rack) { router.replace("/"); return; }
    useRackStore.getState().loadSnapshot(rack);
    useFleetStore.getState().setActiveRackId(rackId);
    const unsubscribe = useRackStore.subscribe((state) => {
      useFleetStore.getState().saveRack(rackId, {
        design: state.design, requirements: state.requirements,
        versions: state.versions, turns: state.turns,
      });
    });
    const flushOnLeave = () => useFleetStore.getState().flush();
    window.addEventListener("pagehide", flushOnLeave);
    return () => {
      window.removeEventListener("pagehide", flushOnLeave);
      if (useRackStore.getState().isRunning) {
        useRackStore.getState().applyEvent({ type: "run:error", error: "Stopped when leaving this rack." });
      }
      unsubscribe();
      useFleetStore.getState().flush();
      useFleetStore.getState().setActiveRackId(null);
    };
  }, [hydrated, rackId, router]);

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
      setDraggingLabel(catalogItemFor(useRackStore.getState().design, data.catalogId)?.name ?? null);
    } else {
      const placement = useRackStore.getState().design.placements.find((p) => p.id === data.placementId);
      setDraggingLabel(placement ? (catalogItemFor(useRackStore.getState().design, placement.catalogId)?.name ?? null) : null);
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

  if (!hydrated || activeRackId !== rackId) {
    return <div className="flex h-dvh items-center justify-center bg-background text-sm text-muted-foreground">Loading rack…</div>;
  }

  return (
    <DndContext id="studio-dnd" sensors={sensors} onDragStart={handleDragStart} onDragEnd={handleDragEnd}>
      {/* h-dvh + min-h-0 at every level is what makes the inner panels scroll
          instead of growing the page. */}
      <div className="flex h-dvh flex-col overflow-hidden">
        <header className="flex shrink-0 flex-wrap items-center justify-between gap-2 border-b border-border bg-panel px-3 py-2">
          <div className="flex items-baseline gap-2">
            <Link href="/" className="text-sm font-bold tracking-tight hover:text-primary">RackVerse</Link>
            <span className="hidden font-mono text-[10px] uppercase tracking-wider text-muted-foreground sm:inline">
              AI proposes · code decides
            </span>
          </div>
          <div className="flex items-center gap-1.5">
            <Button variant="ghost" size="sm" nativeButton={false} render={<Link href="/" />}>
              Dashboard
            </Button>
            <RackSettingsPanel />
            <Toolbar rackId={rackId} />
            <VersionHistoryPanel />
            <Button variant="ghost" size="sm" nativeButton={false} render={<Link href="/lab" />}>
              Lab
            </Button>
          </div>
        </header>

        <SummaryBar />
        <MubitTelemetryBar rackId={rackId} />

        <nav className="flex shrink-0 border-b border-border bg-panel lg:hidden" aria-label="Studio panels">
          {(["equipment", "rack", "copilot"] as const).map((name) => (
            <button key={name} onClick={() => setPane(name)}
              className={`flex-1 px-3 py-2 text-xs font-medium capitalize ${pane === name ? "border-b-2 border-primary text-foreground" : "text-muted-foreground"}`}>
              {name}
            </button>
          ))}
        </nav>

        <div className="grid min-h-0 flex-1 grid-cols-1 overflow-hidden lg:grid-cols-[260px_minmax(0,1fr)_320px]">
          <div className={`${pane === "equipment" ? "flex" : "hidden"} min-h-0 flex-col lg:flex`}><CatalogPanel /></div>

          <div className={`${pane === "rack" ? "grid" : "hidden"} min-h-0 grid-rows-[minmax(0,1fr)_minmax(140px,34%)] overflow-hidden lg:grid`}>
            <RackElevation />
            <BottomPanel />
          </div>

          <div className={`${pane === "copilot" ? "flex" : "hidden"} min-h-0 flex-col lg:flex`}><CopilotPanel rackId={rackId} /></div>
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
