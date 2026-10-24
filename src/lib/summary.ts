import { getCatalogItem } from "@/data/catalog";
import type { Design } from "@/lib/types";

export interface DesignTotals {
  powerW: number;
  weightKg: number;
  costUsd: number;
  usedU: number;
  deviceCount: number;
  outletsRequired: number;
  outletsSupplied: number;
  portsRequired: number;
  portsSupplied: number;
}

/** Live roll-up for the Studio's summary bar. Pure, cheap, recomputed on every edit. */
export function designTotals(design: Design): DesignTotals {
  const totals: DesignTotals = {
    powerW: 0,
    weightKg: 0,
    costUsd: 0,
    usedU: 0,
    deviceCount: 0,
    outletsRequired: 0,
    outletsSupplied: 0,
    portsRequired: 0,
    portsSupplied: 0,
  };

  for (const placement of design.placements) {
    const item = getCatalogItem(placement.catalogId);
    if (!item) continue;
    totals.deviceCount += 1;
    totals.powerW += item.powerW;
    totals.weightKg += item.weightKg;
    totals.costUsd += item.priceUsd;
    totals.usedU += Math.max(0, item.heightU);
    totals.portsRequired += item.netPortsNeeded ?? 0;
    if (item.category === "switch") totals.portsSupplied += item.netPorts ?? 0;
    if (item.category === "pdu") totals.outletsSupplied += item.outlets ?? 0;
    if (item.category === "server") totals.outletsRequired += item.psuCount ?? 1;
    if (item.category === "switch" || item.category === "storage") totals.outletsRequired += 1;
  }

  return totals;
}
