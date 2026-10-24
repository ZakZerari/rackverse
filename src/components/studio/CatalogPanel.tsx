"use client";

import { useMemo, useState } from "react";
import { useDraggable } from "@dnd-kit/core";
import { CATALOG } from "@/data/catalog";
import type { Category } from "@/lib/types";

const CATEGORY_LABELS: Record<Category, string> = {
  server: "Servers",
  switch: "Switches",
  storage: "Storage",
  ups: "UPS",
  pdu: "PDUs",
  patch: "Patch panels",
  blank: "Blanks",
};

const CATEGORY_ACCENT: Record<Category, string> = {
  server: "var(--chart-1)",
  switch: "var(--chart-5)",
  storage: "var(--chart-3)",
  ups: "var(--chart-4)",
  pdu: "var(--chart-4)",
  patch: "var(--muted-foreground)",
  blank: "var(--border)",
};

const ORDER: Category[] = ["server", "switch", "storage", "ups", "pdu", "patch", "blank"];

function CatalogCard({ catalogId }: { catalogId: string }) {
  const item = CATALOG.find((c) => c.id === catalogId)!;
  const { attributes, listeners, setNodeRef, isDragging } = useDraggable({
    id: `catalog:${item.id}`,
    data: { type: "catalog", catalogId: item.id },
  });

  return (
    <div
      ref={setNodeRef}
      {...listeners}
      {...attributes}
      className={`group flex cursor-grab items-center gap-2 rounded-md border border-border bg-card px-2 py-1.5 transition-colors active:cursor-grabbing ${
        isDragging ? "opacity-40" : "hover:border-muted-foreground/50"
      }`}
    >
      <span className="h-6 w-0.5 shrink-0 rounded-full" style={{ backgroundColor: CATEGORY_ACCENT[item.category] }} />
      <div className="min-w-0 flex-1">
        <p className="truncate text-[11px] font-medium text-foreground">{item.name}</p>
        <p className="font-mono text-[10px] tabular text-muted-foreground">
          {item.heightU}U
          {item.powerW > 0 ? ` · ${item.powerW}W` : ""}
          {item.powerCapacityW ? ` · ${item.powerCapacityW}W cap` : ""}
          {item.netPorts ? ` · ${item.netPorts}p` : ""}
          {item.outlets ? ` · ${item.outlets} out` : ""}
        </p>
      </div>
      <span className="shrink-0 font-mono text-[10px] tabular text-muted-foreground">
        ${(item.priceUsd / 1000).toFixed(item.priceUsd >= 1000 ? 1 : 2)}k
      </span>
    </div>
  );
}

export function CatalogPanel() {
  const [query, setQuery] = useState("");

  const grouped = useMemo(() => {
    const q = query.trim().toLowerCase();
    const filtered = q ? CATALOG.filter((c) => c.name.toLowerCase().includes(q) || c.id.includes(q)) : CATALOG;
    return ORDER.map((category) => ({
      category,
      items: filtered.filter((c) => c.category === category),
    })).filter((group) => group.items.length > 0);
  }, [query]);

  return (
    <aside className="flex min-h-0 flex-col border-r border-border bg-panel">
      <header className="shrink-0 space-y-2 border-b border-border px-3 py-2">
        <div className="flex items-baseline justify-between">
          <h2 className="text-xs font-semibold">Equipment</h2>
          <span className="font-mono text-[10px] text-muted-foreground">{CATALOG.length} items</span>
        </div>
        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search…"
          className="w-full rounded-md border border-input bg-background px-2 py-1 text-[11px] outline-none transition-colors placeholder:text-muted-foreground focus:border-ring"
        />
      </header>

      <div className="scroll-region flex-1">
        <div className="space-y-3 p-2">
          {grouped.map(({ category, items }) => (
            <div key={category}>
              <h3 className="mb-1 px-1 font-mono text-[10px] uppercase tracking-wider text-muted-foreground">
                {CATEGORY_LABELS[category]}
              </h3>
              <div className="space-y-1">
                {items.map((item) => (
                  <CatalogCard key={item.id} catalogId={item.id} />
                ))}
              </div>
            </div>
          ))}
          {grouped.length === 0 && <p className="px-1 text-[11px] text-muted-foreground">No matches.</p>}
        </div>
      </div>
    </aside>
  );
}
