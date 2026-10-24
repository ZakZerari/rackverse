import { CATALOG } from "@/data/catalog";
import type { CatalogItem } from "@/lib/types";

/**
 * Test devices picked by *property*, not by hardcoded id. src/data/catalog.ts
 * is generated from the NetBox library, so ids change whenever the catalog is
 * rebuilt — selecting by shape keeps the tests meaningful across rebuilds and
 * makes each test's actual requirement ("a 1U full-depth server") explicit.
 */
function pick(label: string, predicate: (item: CatalogItem) => boolean): CatalogItem {
  const found = CATALOG.find(predicate);
  if (!found) throw new Error(`No catalog item matches the "${label}" fixture — update the catalog or the fixture.`);
  return found;
}

export const SERVER_1U = pick(
  "1U full-depth server",
  (i) => i.category === "server" && i.heightU === 1 && i.fullDepth
);

export const SERVER_2U = pick("2U server", (i) => i.category === "server" && i.heightU === 2);

export const SERVER_BIG = pick(
  "tall, power-hungry server",
  (i) => i.category === "server" && i.heightU >= 3
);

export const SWITCH_1U = pick(
  "1U switch that isn't full depth",
  (i) => i.category === "switch" && i.heightU === 1 && !i.fullDepth
);

/** 0U so it never collides in the U stack, with the most outlets available. */
export const PDU_0U = [...CATALOG]
  .filter((i) => i.category === "pdu" && i.heightU === 0 && (i.outlets ?? 0) > 0)
  .sort((a, b) => (b.outlets ?? 0) - (a.outlets ?? 0))[0];

export const PATCH_1U = pick("1U patch panel", (i) => i.category === "patch" && i.heightU === 1);

/** A 1U device that does NOT block the opposite face, for overlap tests. */
export const SHALLOW_1U = pick(
  "1U non-full-depth device",
  (i) => i.heightU === 1 && !i.fullDepth && i.category !== "pdu"
);
