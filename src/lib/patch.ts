import type { Design, Patch, Placement } from "@/lib/types";

let counter = 0;
export function genPlacementId(): string {
  counter += 1;
  return `pl-${Date.now().toString(36)}-${counter}`;
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
    version: design.version + 1,
  };
}
