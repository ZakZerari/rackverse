"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useDraggable, useDroppable } from "@dnd-kit/core";
import { AnimatePresence, motion } from "motion/react";
import { catalogItemFor } from "@/lib/catalog";
import { useRackStore } from "@/lib/store";
import type { Category, Placement } from "@/lib/types";
import { Rack3D } from "@/components/studio/Rack3D";

const U_PX = 24;
/** Width of the rail strip either side of the cavity, in px. */
const RAIL_PX = 11;

const CATEGORY_ACCENT: Record<Category, string> = {
  server: "var(--chart-1)",
  switch: "var(--chart-5)",
  storage: "var(--chart-3)",
  ups: "var(--chart-4)",
  pdu: "var(--chart-4)",
  patch: "var(--muted-foreground)",
  blank: "var(--border)",
};

/** Which categories get a perforated faceplate. Passive panels don't vent. */
const VENTED: Record<Category, boolean> = {
  server: true,
  switch: true,
  storage: true,
  ups: true,
  pdu: false,
  patch: false,
  blank: false,
};

function UScale({ heightU }: { heightU: number }) {
  const rows = useMemo(() => Array.from({ length: heightU }, (_, i) => heightU - i), [heightU]);
  return (
    <div className="shrink-0 select-none pr-1.5" style={{ width: 26 }}>
      {rows.map((u) => (
        <div
          key={u}
          className={`flex items-center justify-end font-mono text-[9px] tabular leading-none ${
            u % 5 === 0 || u === 1 ? "text-muted-foreground" : "text-transparent"
          }`}
          style={{ height: U_PX }}
        >
          {u}
        </div>
      ))}
    </div>
  );
}

/** One droppable rack unit. Invisible until something is dragged over it. */
function DropZone({ startU, heightU }: { startU: number; heightU: number }) {
  const { setNodeRef, isOver } = useDroppable({ id: `slot:${startU}`, data: { type: "slot", startU } });
  return (
    <div
      ref={setNodeRef}
      className={`absolute inset-x-0 transition-colors duration-150 ${
        isOver ? "bg-primary/25 shadow-[inset_0_0_0_1px_var(--primary)]" : ""
      }`}
      style={{ top: (heightU - startU) * U_PX, height: U_PX }}
    />
  );
}

function StatusLeds({ violated, compact }: { violated: boolean; compact: boolean }) {
  if (compact) return null;
  return (
    <span className="flex shrink-0 items-center gap-1 pr-0.5">
      <span
        className="size-[3px] rounded-full led-blink"
        style={{ backgroundColor: violated ? "var(--destructive)" : "var(--ok)" }}
      />
      <span className="size-[3px] rounded-full bg-[var(--chart-4)]/70" />
    </span>
  );
}

function PlacementBlock({
  placement,
  violated,
  advisory,
}: {
  placement: Placement;
  violated: boolean;
  advisory: boolean;
}) {
  const design = useRackStore((s) => s.design);
  const item = catalogItemFor(design, placement.catalogId);
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
  const height = item.heightU * U_PX - 2;
  const compact = height < 20;
  const accent = violated ? "var(--destructive)" : CATEGORY_ACCENT[item.category];

  return (
    <motion.div
      ref={setNodeRef}
      {...listeners}
      {...attributes}
      // Slides in from the front of the rack as the Architect racks it, with a
      // small per-U stagger so a generated design reads as being assembled
      // bottom-up rather than appearing all at once.
      initial={{ opacity: 0, x: 26, scaleY: 0.82 }}
      animate={{ opacity: 1, x: 0, scaleY: 1 }}
      exit={{ opacity: 0, x: -18, scaleY: 0.85 }}
      transition={{
        type: "spring",
        stiffness: 430,
        damping: 32,
        delay: isDragging ? 0 : Math.min(placement.startU * 0.014, 0.28),
      }}
      onClick={(e) => {
        e.stopPropagation();
        selectPlacement(placement.id);
      }}
      className={`group absolute inset-x-0 flex cursor-grab items-stretch overflow-hidden rounded-[2px] border text-[11px] active:cursor-grabbing device-face ${
        violated
          ? "border-destructive/70 ring-1 ring-destructive/40"
          : selected
            ? "border-primary ring-1 ring-primary/60"
            : advisory
              ? // Soft finding: worth noticing, not a failure. Amber hairline,
                // no ring — a warning shouldn't look like a breakage.
                "border-[var(--warn)]/45"
              : "border-black/60 hover:border-muted-foreground/60"
      } ${isDragging ? "opacity-40" : ""}`}
      style={{
        top: topU * U_PX + 1,
        height,
        backgroundColor: "var(--card)",
        transform: transform ? `translate3d(${transform.x}px, ${transform.y}px, 0)` : undefined,
        zIndex: isDragging ? 50 : selected ? 20 : 10,
      }}
      title={`${item.manufacturer} ${item.name} — U${placement.startU}${
        item.heightU > 1 ? `-U${placement.startU + item.heightU - 1}` : ""
      }`}
    >
      {/* Mounting ear, screws and all. */}
      <span className="device-ear w-[7px] shrink-0 border-r border-black/40 bg-black/20" />
      <span className="w-[3px] shrink-0" style={{ backgroundColor: accent }} />

      <span
        className={`relative flex min-w-0 flex-1 items-center gap-2 px-2 ${
          VENTED[item.category] ? "device-vents" : ""
        }`}
      >
        <span className="relative min-w-0 flex-1 truncate font-medium text-foreground">
          {!compact && <span className="text-muted-foreground">{item.manufacturer} </span>}
          {item.name}
        </span>
        {!compact && item.powerW > 0 && (
          <span className="relative hidden shrink-0 font-mono text-[10px] tabular text-muted-foreground sm:inline">
            {item.powerW}W
          </span>
        )}
        <StatusLeds violated={violated} compact={compact} />
        <span className="relative shrink-0 rounded-[2px] bg-black/30 px-1 font-mono text-[9px] tabular text-muted-foreground">
          {item.heightU}U
        </span>
      </span>

      <span className="device-ear w-[7px] shrink-0 border-l border-black/40 bg-black/20" />

      {/* One-shot flash on arrival, so a device the agents just racked is
          obvious in a rack that's otherwise already full. */}
      <motion.span
        aria-hidden
        className="pointer-events-none absolute inset-0"
        style={{ backgroundColor: accent }}
        initial={{ opacity: 0.4 }}
        animate={{ opacity: 0 }}
        transition={{ duration: 1.1, ease: "easeOut", delay: Math.min(placement.startU * 0.014, 0.28) }}
      />
    </motion.div>
  );
}

function ZeroUChip({ placement }: { placement: Placement }) {
  const design = useRackStore((s) => s.design);
  const item = catalogItemFor(design, placement.catalogId);
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
    <motion.button
      ref={setNodeRef}
      {...listeners}
      {...attributes}
      layout
      initial={{ opacity: 0, scale: 0.9 }}
      animate={{ opacity: 1, scale: 1 }}
      exit={{ opacity: 0, scale: 0.9 }}
      transition={{ type: "spring", stiffness: 500, damping: 34 }}
      onClick={(e) => {
        e.stopPropagation();
        selectPlacement(placement.id);
      }}
      onDoubleClick={(e) => {
        e.stopPropagation();
        setFeed(placement.id, nextFeed);
      }}
      className={`device-face flex items-center gap-1.5 rounded-[3px] border px-2 py-1 text-[11px] transition-colors ${
        violated
          ? "border-destructive/70"
          : selected
            ? "border-primary ring-1 ring-primary/50"
            : "border-black/50 hover:border-muted-foreground/50"
      } ${isDragging ? "opacity-40" : ""}`}
      style={{ backgroundColor: "var(--card)" }}
      title={`${item.name} — double-click to cycle power feed (currently ${placement.feed ?? "unassigned"})`}
    >
      <span
        className="size-1.5 rounded-full led-blink"
        style={{ backgroundColor: violated ? "var(--destructive)" : CATEGORY_ACCENT[item.category] }}
      />
      <span className="truncate">{item.name}</span>
      <span
        className={`rounded-sm px-1 font-mono text-[10px] ${
          placement.feed ? "bg-primary/15 text-primary" : "bg-muted text-muted-foreground"
        }`}
      >
        {placement.feed ? `FEED ${placement.feed}` : "NO FEED"}
      </span>
    </motion.button>
  );
}

function ZeroUTray() {
  const design = useRackStore((s) => s.design);
  const face = useRackStore((s) => s.face);
  const placements = useRackStore((s) => s.design.placements);
  const { setNodeRef, isOver } = useDroppable({ id: "slot:0u", data: { type: "slot", startU: 1 } });

  const zeroU = placements.filter((p) => {
    const item = catalogItemFor(design, p.catalogId);
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
        <AnimatePresence initial={false}>
          {zeroU.map((p) => (
            <ZeroUChip key={p.id} placement={p} />
          ))}
        </AnimatePresence>
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
  const advisoryIds = useRackStore((s) => s.advisoryPlacementIds);
  const isRunning = useRackStore((s) => s.isRunning);
  const runningAgent = useRackStore((s) => s.runningAgent);

  const [view, setView] = useState<"2d" | "3d">("2d");
  const heightU = design.rack.heightU;
  const facePlacements = design.placements.filter((p) => p.face === face);

  // Racks fill bottom-up, so a freshly generated design is off-screen at the
  // top of a tall rack. Bring the populated region into view.
  const scrollRef = useRef<HTMLDivElement>(null);
  const topmostUsedU = facePlacements.reduce((max, p) => {
    const item = catalogItemFor(design, p.catalogId);
    if (!item || item.heightU <= 0) return max;
    return Math.max(max, p.startU + item.heightU - 1);
  }, 0);

  // Keyed on the occupied extent, not the version: moving a device inside the
  // existing range shouldn't yank the viewport mid-drag. Instant, because a
  // smooth scroll gets interrupted by the re-render that follows a run.
  useEffect(() => {
    const el = scrollRef.current;
    if (!el || topmostUsedU === 0) return;
    const topOfEquipmentPx = (heightU - topmostUsedU) * U_PX;
    el.scrollTop = Math.max(0, topOfEquipmentPx - U_PX * 2);
  }, [topmostUsedU, heightU]);

  return (
    <section className="flex min-h-0 flex-col">
      <header className="flex shrink-0 items-center justify-between gap-2 border-b border-border bg-panel px-3 py-2">
        <div className="flex min-w-0 items-baseline gap-2">
          <h2 className="truncate text-xs font-semibold">{design.rack.name}</h2>
          <span className="font-mono text-[10px] tabular text-muted-foreground">
            {heightU}U · {design.rack.mountingDepthMm}mm · v{design.version}
          </span>
          <AnimatePresence>
            {isRunning && (
              <motion.span
                initial={{ opacity: 0, y: -3 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -3 }}
                className="flex shrink-0 items-center gap-1.5 rounded-full border border-primary/40 bg-primary/10 px-2 py-0.5 font-mono text-[9px] uppercase tracking-wider text-primary"
              >
                <span className="relative flex size-1.5">
                  <span className="ping-ring absolute inset-0 rounded-full bg-primary" />
                  <span className="relative size-1.5 rounded-full bg-primary" />
                </span>
                {runningAgent ?? "working"}
              </motion.span>
            )}
          </AnimatePresence>
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
          <div className="mx-auto" style={{ maxWidth: 420, ["--u-px" as string]: `${U_PX}px` }}>
            <div
              className={`rack-shell rounded-md border border-black/60 p-1 transition-shadow ${
                isRunning ? "work-glow" : ""
              }`}
            >
              {/* Top cap — vented, with the rack's own label, like a real one. */}
              <div className="device-vents relative mb-1 flex h-4 items-center justify-center rounded-[2px] border border-black/50 bg-black/25">
                <span className="relative font-mono text-[8px] uppercase tracking-[0.2em] text-muted-foreground/70">
                  {design.rack.name}
                </span>
              </div>

              <div className="flex">
                <UScale heightU={heightU} />

                <div className="flex flex-1 overflow-hidden rounded-[2px]">
                  <div className="rack-rail shrink-0" style={{ width: RAIL_PX }} />

                  <div
                    className="rack-cavity rack-u-guides relative flex-1 overflow-hidden"
                    style={{ height: heightU * U_PX }}
                  >
                    {Array.from({ length: heightU }, (_, i) => i + 1).map((u) => (
                      <DropZone key={u} startU={u} heightU={heightU} />
                    ))}

                    <AnimatePresence initial={false}>
                      {facePlacements.map((p) => (
                        <PlacementBlock
                          key={p.id}
                          placement={p}
                          violated={violatedIds.has(p.id)}
                          advisory={advisoryIds.has(p.id)}
                        />
                      ))}
                    </AnimatePresence>

                    {/* Scan line while agents hold the design. There's no honest
                        progress number to show, so this says "busy", nothing more. */}
                    {isRunning && (
                      <div
                        aria-hidden
                        className="rack-scan pointer-events-none absolute inset-x-0 top-0 h-6 bg-gradient-to-b from-transparent via-primary/25 to-transparent"
                        style={{ zIndex: 30 }}
                      />
                    )}
                  </div>

                  <div className="rack-rail shrink-0" style={{ width: RAIL_PX }} />
                </div>
              </div>

              <div className="mt-1 h-2 rounded-[2px] border border-black/50 bg-black/25" />
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
