"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useDraggable, useDroppable } from "@dnd-kit/core";
import { AnimatePresence, motion } from "motion/react";
import { getCatalogItem } from "@/data/catalog";
import { useRackStore } from "@/lib/store";
import type { Category, Placement } from "@/lib/types";
import { Rack3D } from "@/components/studio/Rack3D";

const U_PX = 22;

const CATEGORY_ACCENT: Record<Category, string> = {
  server: "var(--chart-1)",
  switch: "var(--chart-5)",
  storage: "var(--chart-3)",
  ups: "var(--chart-4)",
  pdu: "var(--chart-4)",
  patch: "var(--muted-foreground)",
  blank: "var(--border)",
};

function RowSlot({ startU }: { startU: number }) {
  const { setNodeRef, isOver } = useDroppable({ id: `slot:${startU}`, data: { type: "slot", startU } });
  const major = startU % 5 === 0;

  return (
    <div
      ref={setNodeRef}
      className={`relative flex items-center transition-colors ${isOver ? "bg-primary/20" : ""}`}
      style={{ height: U_PX }}
    >
      <div
        className={`w-9 shrink-0 pr-2 text-right font-mono text-[10px] tabular ${
          major ? "text-muted-foreground" : "text-muted-foreground/35"
        }`}
      >
        {major || startU === 1 ? startU : ""}
      </div>
      <div
        className={`h-full flex-1 border-t border-dashed ${
          major ? "border-border" : "border-border/35"
        }`}
      />
    </div>
  );
}

function PlacementBlock({ placement, violated }: { placement: Placement; violated: boolean }) {
  const item = getCatalogItem(placement.catalogId);
  const rackHeightU = useRackStore((s) => s.design.rack.heightU);
  const selectedPlacementId = useRackStore((s) => s.selectedPlacementId);
  const selectPlacement = useRackStore((s) => s.selectPlacement);
  const { attributes, listeners, setNodeRef, isDragging, transform } = useDraggable({
    id: `placement:${placement.id}`,
    data: { type: "placement", placementId: placement.id },
  });

  if (!item || item.heightU <= 0) return null;

  const topU = rackHeightU - (placement.startU + item.heightU - 1);
  const selected = selectedPlacementId === placement.id;
  const height = item.heightU * U_PX - 3;

  return (
    <motion.div
      ref={setNodeRef}
      {...listeners}
      {...attributes}
      // Slide in from the right as the Architect places each device; a tiny
      // per-U stagger makes a generated rack read as "being assembled".
      initial={{ opacity: 0, x: 24 }}
      animate={{ opacity: 1, x: 0 }}
      exit={{ opacity: 0, x: -16 }}
      transition={{
        type: "spring",
        stiffness: 420,
        damping: 34,
        delay: isDragging ? 0 : Math.min(placement.startU * 0.015, 0.3),
      }}
      onClick={(e) => {
        e.stopPropagation();
        selectPlacement(placement.id);
      }}
      className={`group absolute left-9 right-0 flex cursor-grab items-center gap-2 overflow-hidden rounded-[3px] border bg-card pl-0 pr-2 text-[11px] shadow-sm active:cursor-grabbing ${
        violated
          ? "border-destructive/70 ring-1 ring-destructive/40"
          : selected
            ? "border-primary ring-1 ring-primary/50"
            : "border-border hover:border-muted-foreground/50"
      } ${isDragging ? "opacity-40" : ""}`}
      style={{
        top: topU * U_PX + 1,
        height,
        transform: transform ? `translate3d(${transform.x}px, ${transform.y}px, 0)` : undefined,
        zIndex: isDragging ? 50 : selected ? 20 : 10,
      }}
      title={`${item.name} — U${placement.startU}${item.heightU > 1 ? `-U${placement.startU + item.heightU - 1}` : ""}`}
    >
      <span
        className="h-full w-1 shrink-0"
        style={{ backgroundColor: violated ? "var(--destructive)" : CATEGORY_ACCENT[item.category] }}
      />
      <span className="min-w-0 flex-1 truncate pl-1 font-medium text-foreground">{item.name}</span>
      {height >= 20 && (
        <span className="hidden shrink-0 font-mono text-[10px] tabular text-muted-foreground sm:inline">
          {item.powerW > 0 ? `${item.powerW}W` : ""}
        </span>
      )}
      <span className="shrink-0 rounded-sm bg-muted px-1 font-mono text-[10px] tabular text-muted-foreground">
        {item.heightU}U
      </span>
    </motion.div>
  );
}

function ZeroUChip({ placement }: { placement: Placement }) {
  const item = getCatalogItem(placement.catalogId);
  const selectedPlacementId = useRackStore((s) => s.selectedPlacementId);
  const selectPlacement = useRackStore((s) => s.selectPlacement);
  const setFeed = useRackStore((s) => s.setFeed);
  const violatedIds = useRackStore((s) => s.violatedPlacementIds);
  const { attributes, listeners, setNodeRef, isDragging } = useDraggable({
    id: `placement:${placement.id}`,
    data: { type: "placement", placementId: placement.id },
  });

  if (!item) return null;
  const selected = selectedPlacementId === placement.id;
  const violated = violatedIds.has(placement.id);
  const nextFeed = placement.feed === undefined ? "A" : placement.feed === "A" ? "B" : undefined;

  return (
    <button
      ref={setNodeRef}
      {...listeners}
      {...attributes}
      onClick={(e) => {
        e.stopPropagation();
        selectPlacement(placement.id);
      }}
      onDoubleClick={(e) => {
        e.stopPropagation();
        setFeed(placement.id, nextFeed);
      }}
      className={`flex items-center gap-1.5 rounded-[3px] border bg-card px-2 py-1 text-[11px] transition-colors ${
        violated
          ? "border-destructive/70"
          : selected
            ? "border-primary ring-1 ring-primary/50"
            : "border-border hover:border-muted-foreground/50"
      } ${isDragging ? "opacity-40" : ""}`}
      title={`${item.name} — double-click to cycle power feed (currently ${placement.feed ?? "unassigned"})`}
    >
      <span className="size-1.5 rounded-full" style={{ backgroundColor: CATEGORY_ACCENT[item.category] }} />
      <span className="truncate">{item.name}</span>
      <span
        className={`rounded-sm px-1 font-mono text-[10px] ${
          placement.feed ? "bg-primary/15 text-primary" : "bg-muted text-muted-foreground"
        }`}
      >
        {placement.feed ? `FEED ${placement.feed}` : "NO FEED"}
      </span>
    </button>
  );
}

function ZeroUTray() {
  const face = useRackStore((s) => s.face);
  const placements = useRackStore((s) => s.design.placements);
  const { setNodeRef, isOver } = useDroppable({ id: "slot:0u", data: { type: "slot", startU: 1 } });

  const zeroU = placements.filter((p) => {
    const item = getCatalogItem(p.catalogId);
    return item && item.heightU <= 0 && p.face === face;
  });

  return (
    <div
      ref={setNodeRef}
      className={`mt-3 rounded-md border border-dashed p-2.5 transition-colors ${
        isOver ? "border-primary bg-primary/10" : "border-border"
      }`}
    >
      <p className="mb-2 font-mono text-[10px] uppercase tracking-wider text-muted-foreground">
        0U side-mount · {face}
      </p>
      <div className="flex flex-wrap gap-1.5">
        {zeroU.map((p) => (
          <ZeroUChip key={p.id} placement={p} />
        ))}
        {zeroU.length === 0 && (
          <p className="text-[11px] text-muted-foreground/70">Drop PDUs here — they don&apos;t consume rack units.</p>
        )}
      </div>
    </div>
  );
}

export function RackElevation() {
  const design = useRackStore((s) => s.design);
  const face = useRackStore((s) => s.face);
  const setFace = useRackStore((s) => s.setFace);
  const selectPlacement = useRackStore((s) => s.selectPlacement);
  const violatedIds = useRackStore((s) => s.violatedPlacementIds);

  const [view, setView] = useState<"2d" | "3d">("2d");
  const rows = useMemo(
    () => Array.from({ length: design.rack.heightU }, (_, i) => design.rack.heightU - i),
    [design.rack.heightU]
  );
  const facePlacements = design.placements.filter((p) => p.face === face);

  // Racks fill bottom-up, so a freshly generated design is off-screen at the
  // top of a tall rack. Bring the populated region into view.
  const scrollRef = useRef<HTMLDivElement>(null);
  const topmostUsedU = facePlacements.reduce((max, p) => {
    const item = getCatalogItem(p.catalogId);
    if (!item || item.heightU <= 0) return max;
    return Math.max(max, p.startU + item.heightU - 1);
  }, 0);

  // Keyed on the occupied extent, not the version: moving a device inside the
  // existing range shouldn't yank the viewport mid-drag. Instant, because a
  // smooth scroll gets interrupted by the re-render that follows a run.
  useEffect(() => {
    const el = scrollRef.current;
    if (!el || topmostUsedU === 0) return;
    const topOfEquipmentPx = (design.rack.heightU - topmostUsedU) * U_PX;
    el.scrollTop = Math.max(0, topOfEquipmentPx - U_PX * 2);
  }, [topmostUsedU, design.rack.heightU]);

  return (
    <section className="flex min-h-0 flex-col">
      <header className="flex shrink-0 items-center justify-between gap-2 border-b border-border bg-panel px-3 py-2">
        <div className="flex min-w-0 items-baseline gap-2">
          <h2 className="truncate text-xs font-semibold">{design.rack.name}</h2>
          <span className="font-mono text-[10px] tabular text-muted-foreground">
            {design.rack.heightU}U · {design.rack.mountingDepthMm}mm · v{design.version}
          </span>
        </div>

        <div className="flex shrink-0 items-center gap-1.5">
          <Segmented
            options={[
              { value: "2d", label: "2D" },
              { value: "3d", label: "3D" },
            ]}
            value={view}
            onChange={(v) => setView(v as "2d" | "3d")}
          />
          {view === "2d" && (
            <Segmented
              options={[
                { value: "front", label: "Front" },
                { value: "rear", label: "Rear" },
              ]}
              value={face}
              onChange={(v) => setFace(v as "front" | "rear")}
            />
          )}
        </div>
      </header>

      {view === "3d" ? (
        <div className="relative min-h-0 flex-1">
          <Rack3D />
        </div>
      ) : (
        <div ref={scrollRef} className="scroll-region flex-1 p-4" onClick={() => selectPlacement(null)}>
          <div className="mx-auto" style={{ maxWidth: 380 }}>
            <div className="relative rounded-md border border-border bg-panel/60 p-1.5">
              <div className="relative" style={{ height: design.rack.heightU * U_PX }}>
                {rows.map((u) => (
                  <RowSlot key={u} startU={u} />
                ))}
                <AnimatePresence initial={false}>
                  {facePlacements.map((p) => (
                    <PlacementBlock key={p.id} placement={p} violated={violatedIds.has(p.id)} />
                  ))}
                </AnimatePresence>
              </div>
            </div>
            <ZeroUTray />
          </div>
        </div>
      )}
    </section>
  );
}

function Segmented({
  options,
  value,
  onChange,
}: {
  options: { value: string; label: string }[];
  value: string;
  onChange: (value: string) => void;
}) {
  return (
    <div className="flex rounded-md border border-border p-0.5">
      {options.map((option) => (
        <button
          key={option.value}
          onClick={() => onChange(option.value)}
          className="relative rounded-[4px] px-2.5 py-0.5 text-[11px] transition-colors"
        >
          {value === option.value && (
            <motion.span
              layoutId={`segmented-${options.map((o) => o.value).join("-")}`}
              className="absolute inset-0 rounded-[4px] bg-secondary"
              transition={{ type: "spring", stiffness: 500, damping: 38 }}
            />
          )}
          <span className={`relative ${value === option.value ? "text-foreground" : "text-muted-foreground"}`}>
            {option.label}
          </span>
        </button>
      ))}
    </div>
  );
}
