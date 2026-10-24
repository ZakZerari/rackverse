"use client";

import { useMemo, useState } from "react";
import { useDraggable } from "@dnd-kit/core";
import { CATALOG } from "@/data/catalog";
import type { Category } from "@/lib/types";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";

const CATEGORY_LABELS: Record<Category, string> = {
  server: "Servers",
  switch: "Switches",
  ups: "UPS",
  pdu: "PDUs",
  storage: "Storage",
  patch: "Patch Panels",
  blank: "Blanks",
};

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
      className={`cursor-grab rounded-md border border-border bg-card px-2.5 py-2 text-xs active:cursor-grabbing ${
        isDragging ? "opacity-40" : "hover:border-primary/50"
      }`}
    >
      <div className="flex items-center justify-between gap-2">
        <span className="font-medium text-foreground">{item.name}</span>
        <Badge variant="secondary" className="shrink-0">
          {item.heightU}U
        </Badge>
      </div>
      <div className="mt-1 flex flex-wrap gap-x-2 text-muted-foreground">
        <span>{item.powerW}W</span>
        <span>{item.weightKg}kg</span>
        <span>${item.priceUsd.toLocaleString()}</span>
      </div>
    </div>
  );
}

export function CatalogPanel() {
  const [query, setQuery] = useState("");

  const grouped = useMemo(() => {
    const q = query.trim().toLowerCase();
    const filtered = q
      ? CATALOG.filter((c) => c.name.toLowerCase().includes(q) || c.id.includes(q))
      : CATALOG;
    const groups = new Map<Category, string[]>();
    for (const item of filtered) {
      const list = groups.get(item.category) ?? [];
      list.push(item.id);
      groups.set(item.category, list);
    }
    return groups;
  }, [query]);

  return (
    <div className="flex h-full flex-col border-r border-border">
      <div className="border-b border-border p-3">
        <h2 className="mb-2 text-sm font-semibold">Equipment Catalog</h2>
        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search catalog..."
          className="w-full rounded-md border border-input bg-background px-2.5 py-1.5 text-xs outline-none focus:ring-1 focus:ring-ring"
        />
      </div>
      <ScrollArea className="flex-1">
        <div className="space-y-4 p-3">
          {[...grouped.entries()].map(([category, ids]) => (
            <div key={category}>
              <h3 className="mb-1.5 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
                {CATEGORY_LABELS[category]}
              </h3>
              <div className="space-y-1.5">
                {ids.map((id) => (
                  <CatalogCard key={id} catalogId={id} />
                ))}
              </div>
            </div>
          ))}
          {grouped.size === 0 && (
            <p className="text-xs text-muted-foreground">No matching equipment.</p>
          )}
        </div>
      </ScrollArea>
    </div>
  );
}
