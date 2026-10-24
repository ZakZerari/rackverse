import { CATALOG } from "@/data/catalog";
import type { CatalogItem, Design } from "@/lib/types";

/** User equipment and edits to built-in equipment travel with the design. */
export function catalogFor(design: Design): CatalogItem[] {
  const overrides = new Map((design.catalogOverrides ?? []).map((item) => [item.id, item]));
  return [
    ...CATALOG.map((item) => overrides.get(item.id) ?? item),
    ...(design.catalogOverrides ?? []).filter((item) => !CATALOG.some((base) => base.id === item.id)),
  ];
}

export function catalogItemFor(design: Design, id: string): CatalogItem | undefined {
  return design.catalogOverrides?.find((item) => item.id === id) ?? CATALOG.find((item) => item.id === id);
}

function workloadTags(item: CatalogItem): string {
  const tags: string[] = [];
  if (item.source === "custom") tags.push(item.name.replace(/[|\r\n]+/g, " ").slice(0, 40));
  if (item.id === "supermicro-as-4125gs-tnrt" || /\bgpu\b/i.test(item.name)) tags.push("gpu", "ai");
  if (item.category === "server" && item.heightU === 1) tags.push("dense");
  if (item.category === "server" && item.priceUsd <= 3500) tags.push("budget");
  if (item.category === "storage" && /synology|nas/i.test(`${item.manufacturer} ${item.name}`)) tags.push("nas");
  if (item.category === "switch" && /poe/i.test(item.name)) tags.push("poe");
  return tags.join(",");
}

export function catalogSummaryFor(design?: Design): string {
  const header = "id|cat|tags|U|depth_mm|kg|draw_W|supply_W|outlets|psu|ports|needs_ports|full_depth|usd";
  return [header, ...(design ? catalogFor(design) : CATALOG).map((item) => [
    item.id, item.category, workloadTags(item), item.heightU,
    item.depthMm, item.weightKg, item.powerW || "", item.powerCapacityW ?? "",
    item.outlets ?? "", item.psuCount ?? "", item.netPorts ?? "",
    item.netPortsNeeded ?? "", item.fullDepth ? "Y" : "N", item.priceUsd,
  ].join("|"))].join("\n");
}
