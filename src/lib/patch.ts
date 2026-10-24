import { catalogItemFor } from "@/lib/catalog";
import type { Design, Patch, Placement } from "@/lib/types";

let counter = 0;
export function genPlacementId(): string {
  counter += 1;
  return `pl-${Date.now().toString(36)}-${counter}`;
}

/**
 * Ops that refer to something that doesn't exist, described plainly enough to
 * hand straight back to the agent.
 *
 * A hallucinated placementId is worse than an error: `applyPatch` silently
 * does nothing for it, so the user asks for a change, the agent reports having
 * made it, and the rack is untouched. A hallucinated catalogId is louder — it
 * becomes an UNKNOWN_CATALOG_ID violation — but by then the edit has already
 * been applied. Catching both before applying is what lets us re-ask with the
 * specific problem instead of guessing.
 */
export function patchCoherenceProblems(design: Design, patch: Patch): string[] {
  const known = new Set(design.placements.map((p) => p.id));
  const problems: string[] = [];

  for (const op of patch.ops) {
    if (op.op !== "add" && !known.has(op.placementId)) {
      problems.push(`op "${op.op}" refers to placementId "${op.placementId}", which is not in the design.`);
    }
    const catalogId = op.op === "add" ? op.catalogId : op.op === "replace" ? op.newCatalogId : null;
    if (catalogId !== null && !catalogItemFor(design, catalogId)) {
      problems.push(`op "${op.op}" refers to catalog id "${catalogId}", which is not in the catalog.`);
    }
  }

  return problems;
}

/** Applies a patch to a COPY of the design. Never mutates the input. */
export function applyPatch(design: Design, patch: Patch): Design {
  let placements: Placement[] = design.placements.map((p) => ({ ...p }));

  for (const op of patch.ops) {
    switch (op.op) {
      case "add":
        placements.push({
          id: genPlacementId(),
          catalogId: op.catalogId,
          startU: op.startU,
          face: op.face,
          feed: op.feed,
        });
        break;
      case "move":
        placements = placements.map((p) =>
          p.id === op.placementId
            ? { ...p, startU: op.newStartU, face: op.newFace ?? p.face }
            : p
        );
        break;
      case "remove":
        placements = placements.filter((p) => p.id !== op.placementId);
        break;
      case "replace":
        placements = placements.map((p) =>
          p.id === op.placementId ? { ...p, catalogId: op.newCatalogId } : p
        );
        break;
    }
  }

  return {
    rack: { ...design.rack },
    placements,
    catalogOverrides: design.catalogOverrides?.map((item) => ({ ...item })),
    version: design.version + 1,
  };
}
