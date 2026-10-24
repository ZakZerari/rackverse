"use client";

import { useMemo } from "react";
import { useDraggable, useDroppable } from "@dnd-kit/core";
import { getCatalogItem } from "@/data/catalog";
import { useRackStore } from "@/lib/store";
import type { Placement } from "@/lib/types";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";

const U_PX = 18;

function RowSlot({ startU }: { startU: number }) {
  const { setNodeRef, isOver } = useDroppable({
    id: `slot:${startU}`,
    data: { type: "slot", startU },
  });
  return (
    <div
      ref={setNodeRef}
      className={`flex items-center border-b border-border/60 pl-8 text-[9px] text-muted-foreground/50 ${
        isOver ? "bg-primary/10" : ""
      }`}
      style={{ height: U_PX }}
    >
      {startU % 2 === 0 ? `U${startU}` : ""}
    </div>
  );
}

function PlacementBlock({ placement, violated }: { placement: Placement; violated: boolean }) {
  const item = getCatalogItem(placement.catalogId);
  const { design, selectedPlacementId, selectPlacement } = useRackStore();
  const { attributes, listeners, setNodeRef, isDragging, transform } = useDraggable({
    id: `placement:${placement.id}`,
    data: { type: "placement", placementId: placement.id },
  });

  if (!item || item.heightU <= 0) return null;

  const topU = design.rack.heightU - (placement.startU + item.heightU - 1);
  const selected = selectedPlacementId === placement.id;

  const categoryColor: Record<string, string> = {
    server: "bg-sky-950/60 border-sky-700/60",
    switch: "bg-violet-950/60 border-violet-700/60",
    ups: "bg-amber-950/60 border-amber-700/60",
    pdu: "bg-amber-950/40 border-amber-700/40",
    storage: "bg-emerald-950/60 border-emerald-700/60",
    patch: "bg-zinc-800/60 border-zinc-600/60",
    blank: "bg-zinc-900/40 border-zinc-700/30",
  };

  return (
    <div
      ref={setNodeRef}
      {...listeners}
      {...attributes}
      onClick={(e) => {
        e.stopPropagation();
        selectPlacement(placement.id);
      }}
      className={`absolute left-8 right-1 flex cursor-grab items-center justify-between rounded-sm border px-2 text-[11px] active:cursor-grabbing ${
        categoryColor[item.category] ?? "bg-card border-border"
      } ${selected ? "ring-2 ring-primary" : ""} ${
        violated ? "outline outline-2 outline-destructive" : ""
      } ${isDragging ? "opacity-40" : ""}`}
      style={{
        top: topU * U_PX,
        height: item.heightU * U_PX - 2,
        transform: transform ? `translate3d(${transform.x}px, ${transform.y}px, 0)` : undefined,
        zIndex: isDragging ? 50 : undefined,
      }}
      title={item.name}
    >
      <span className="truncate font-medium">{item.name}</span>
      <span className="shrink-0 text-muted-foreground">{item.heightU}U</span>
    </div>
  );
}

function ZeroUTray() {
  const { design, face, selectedPlacementId, selectPlacement } = useRackStore();
  const { setNodeRef, isOver } = useDroppable({ id: "slot:0u", data: { type: "slot", startU: 1 } });

  const zeroUPlacements = design.placements.filter((p) => {
    const item = getCatalogItem(p.catalogId);
    return item && item.heightU <= 0 && p.face === face;
  });

  return (
    <div
      ref={setNodeRef}
      className={`mt-2 min-h-14 rounded-md border border-dashed border-border p-2 ${isOver ? "bg-primary/10" : ""}`}
    >
      <p className="mb-1.5 text-[10px] uppercase tracking-wide text-muted-foreground">
        Side-mount (0U) — {face}
      </p>
      <div className="flex flex-wrap gap-1.5">
        {zeroUPlacements.map((p) => {
          const item = getCatalogItem(p.catalogId)!;
          const selected = selectedPlacementId === p.id;
          return (
            <ZeroUChip key={p.id} placement={p} name={item.name} selected={selected} onSelect={() => selectPlacement(p.id)} />
          );
        })}
        {zeroUPlacements.length === 0 && (
          <p className="text-[11px] text-muted-foreground">Drop PDUs here.</p>
        )}
      </div>
    </div>
  );
}

function ZeroUChip({
  placement,
  name,
  selected,
  onSelect,
}: {
  placement: Placement;
  name: string;
  selected: boolean;
  onSelect: () => void;
}) {
  const { attributes, listeners, setNodeRef, isDragging } = useDraggable({
    id: `placement:${placement.id}`,
    data: { type: "placement", placementId: placement.id },
  });
  const setFeed = useRackStore((s) => s.setFeed);
  const nextFeed = placement.feed === undefined ? "A" : placement.feed === "A" ? "B" : undefined;

  return (
    <button
      ref={setNodeRef}
      {...listeners}
      {...attributes}
      onClick={(e) => {
        e.stopPropagation();
        onSelect();
      }}
      onDoubleClick={(e) => {
        e.stopPropagation();
        setFeed(placement.id, nextFeed);
      }}
      className={`rounded border px-2 py-1 text-[11px] ${
        selected ? "ring-2 ring-primary" : ""
      } ${isDragging ? "opacity-40" : ""} bg-amber-950/40 border-amber-700/40`}
      title={`${name} — double-click to cycle feed (currently ${placement.feed ?? "none"})`}
    >
      {name} {placement.feed ? `· Feed ${placement.feed}` : ""}
    </button>
  );
}

export function RackElevation() {
  const { design, face, setFace, violations, selectPlacement } = useRackStore();
  const rows = useMemo(
    () => Array.from({ length: design.rack.heightU }, (_, i) => design.rack.heightU - i),
    [design.rack.heightU]
  );

  const violatedPlacementIds = useMemo(
    () => new Set(violations.flatMap((v) => v.placementIds)),
    [violations]
  );

  const facePlacements = design.placements.filter((p) => p.face === face);

  return (
    <div className="flex h-full flex-col">
      <div className="flex items-center justify-between border-b border-border p-2">
        <h2 className="text-sm font-semibold">
          {design.rack.name} — {design.rack.heightU}U
        </h2>
        <Tabs value={face} onValueChange={(v) => setFace(v as "front" | "rear")}>
          <TabsList>
            <TabsTrigger value="front">Front</TabsTrigger>
            <TabsTrigger value="rear">Rear</TabsTrigger>
          </TabsList>
        </Tabs>
      </div>
      <div className="flex-1 overflow-auto p-3" onClick={() => selectPlacement(null)}>
        <div
          className="relative mx-auto border border-border bg-background/40"
          style={{ width: 280, height: design.rack.heightU * U_PX }}
        >
          {rows.map((u) => (
            <RowSlot key={u} startU={u} />
          ))}
          {facePlacements.map((p) => (
            <PlacementBlock key={p.id} placement={p} violated={violatedPlacementIds.has(p.id)} />
          ))}
        </div>
        <div className="mx-auto" style={{ width: 280 }}>
          <ZeroUTray />
        </div>
      </div>
    </div>
  );
}
