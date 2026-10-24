import { z } from "zod";
import { CATALOG } from "@/data/catalog";
import type { CatalogItem, Design, Rack } from "@/lib/types";

export const rackSettingsSchema = z.object({
  name: z.string().trim().min(1).max(80),
  heightU: z.number().int().min(1).max(60),
  mountingDepthMm: z.number().int().min(100).max(2000),
  maxLoadKg: z.number().positive().max(10000),
  powerBudgetW: z.number().positive().max(100000),
});

export const equipmentSchema = z.object({
  id: z.string().min(1),
  manufacturer: z.string().trim().min(1).max(80),
  name: z.string().trim().min(1).max(120),
  category: z.enum(["server", "switch", "ups", "pdu", "storage", "patch", "blank"]),
  heightU: z.number().int().min(0).max(60),
  depthMm: z.number().int().min(1).max(2000),
  weightKg: z.number().min(0).max(10000),
  powerW: z.number().min(0).max(100000),
  powerCapacityW: z.number().min(0).max(100000).optional(),
  outlets: z.number().int().min(0).max(1000).optional(),
  psuCount: z.number().int().min(0).max(16).optional(),
  netPorts: z.number().int().min(0).max(1000).optional(),
  netPortsNeeded: z.number().int().min(0).max(1000).optional(),
  fullDepth: z.boolean(),
  priceUsd: z.number().min(0).max(10000000),
  source: z.enum(["netbox", "generic", "custom"]),
  estimated: z.array(z.enum(["depthMm", "weightKg", "powerW", "powerCapacityW", "priceUsd"])),
}).superRefine((item, ctx) => {
  if (item.heightU === 0 && item.category !== "pdu") {
    ctx.addIssue({ code: "custom", path: ["heightU"], message: "Only PDUs may be 0U." });
  }
  if ((item.category === "pdu" || item.category === "ups") && (!item.powerCapacityW || item.powerCapacityW <= 0)) {
    ctx.addIssue({ code: "custom", path: ["powerCapacityW"], message: "Power equipment needs a supply capacity." });
  }
  if (item.category === "pdu" && (!item.outlets || item.outlets <= 0)) {
    ctx.addIssue({ code: "custom", path: ["outlets"], message: "A PDU needs at least one outlet." });
  }
});

export function updateRack(design: Design, settings: Omit<Rack, "id">): Design {
  const rack = rackSettingsSchema.parse(settings);
  return { ...design, rack: { ...design.rack, ...rack }, version: design.version + 1 };
}

export function upsertEquipment(design: Design, candidate: CatalogItem): Design {
  const item = equipmentSchema.parse(candidate) as CatalogItem;
  if (CATALOG.some((base) => base.id === item.id) && item.source === "custom") {
    throw new Error("A custom ID cannot replace a built-in device.");
  }
  const old = design.catalogOverrides ?? [];
  return {
    ...design,
    catalogOverrides: [...old.filter((entry) => entry.id !== item.id), item],
    version: design.version + 1,
  };
}

export function removeEquipment(design: Design, id: string): Design {
  if (design.placements.some((placement) => placement.catalogId === id)) {
    throw new Error("Remove this equipment from the rack before deleting its catalog entry.");
  }
  if (CATALOG.some((item) => item.id === id)) {
    throw new Error("Built-in equipment cannot be deleted; reset its edits instead.");
  }
  return {
    ...design,
    catalogOverrides: (design.catalogOverrides ?? []).filter((item) => item.id !== id),
    version: design.version + 1,
  };
}

export function resetEquipment(design: Design, id: string): Design {
  if (!CATALOG.some((item) => item.id === id)) throw new Error("Only built-in equipment has source specs.");
  return {
    ...design,
    catalogOverrides: (design.catalogOverrides ?? []).filter((item) => item.id !== id),
    version: design.version + 1,
  };
}
