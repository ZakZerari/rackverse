import { create } from "zustand";
import { applyPatch } from "@/lib/patch";
import type { Design, Face, Patch, Requirements, Violation } from "@/lib/types";
import { validateDesign } from "@/lib/validate";

export function defaultRequirements(): Requirements {
  return {
    rackHeightU: 42,
    powerBudgetW: 10000,
    redundantPower: false,
    required: [],
  };
}

export function defaultDesign(): Design {
  return {
    rack: {
      id: "rack-1",
      name: "Rack 1",
      heightU: 42,
      mountingDepthMm: 1000,
      maxLoadKg: 500,
      powerBudgetW: 10000,
    },
    placements: [],
    version: 1,
  };
}

interface RackStore {
  design: Design;
  requirements: Requirements;
  versions: Design[]; // committed history, oldest first
  selectedPlacementId: string | null;
  face: Face;

  violations: Violation[];
  revalidate: () => void;

  setFace: (face: Face) => void;
  selectPlacement: (id: string | null) => void;

  applyAndCommit: (patch: Patch) => Design;
  addPlacement: (catalogId: string, startU: number, face: Face, feed?: "A" | "B") => void;
  movePlacement: (placementId: string, newStartU: number, newFace?: Face) => void;
  removePlacement: (placementId: string) => void;
  replacePlacement: (placementId: string, newCatalogId: string) => void;
  setFeed: (placementId: string, feed: "A" | "B" | undefined) => void;

  setDesign: (design: Design) => void; // used by the orchestrator once agents exist
  setRequirements: (requirements: Requirements) => void;
  restoreVersion: (version: number) => void;
}

export const useRackStore = create<RackStore>((set, get) => ({
  design: defaultDesign(),
  requirements: defaultRequirements(),
  versions: [defaultDesign()],
  selectedPlacementId: null,
  face: "front",
  violations: [],

  revalidate: () => {
    const { design, requirements } = get();
    set({ violations: validateDesign(design, requirements) });
  },

  setFace: (face) => set({ face }),
  selectPlacement: (id) => set({ selectedPlacementId: id }),

  applyAndCommit: (patch) => {
    const { design, versions } = get();
    const next = applyPatch(design, patch);
    set({ design: next, versions: [...versions, next] });
    get().revalidate();
    return next;
  },

  addPlacement: (catalogId, startU, face, feed) => {
    get().applyAndCommit({ ops: [{ op: "add", catalogId, startU, face, feed }], rationale: "manual add" });
  },

  movePlacement: (placementId, newStartU, newFace) => {
    get().applyAndCommit({
      ops: [{ op: "move", placementId, newStartU, newFace }],
      rationale: "manual move",
    });
  },

  removePlacement: (placementId) => {
    const { selectedPlacementId } = get();
    get().applyAndCommit({ ops: [{ op: "remove", placementId }], rationale: "manual remove" });
    if (selectedPlacementId === placementId) set({ selectedPlacementId: null });
  },

  replacePlacement: (placementId, newCatalogId) => {
    get().applyAndCommit({
      ops: [{ op: "replace", placementId, newCatalogId }],
      rationale: "manual replace",
    });
  },

  setFeed: (placementId, feed) => {
    // Feed isn't part of the Patch schema (AI agents only set it on `add`), so
    // this manual-UI-only edit bypasses applyPatch and commits directly.
    const { design, versions } = get();
    const next: Design = {
      ...design,
      placements: design.placements.map((p) => (p.id === placementId ? { ...p, feed } : p)),
      version: design.version + 1,
    };
    set({ design: next, versions: [...versions, next] });
    get().revalidate();
  },

  setDesign: (design) => {
    const { versions } = get();
    set({ design, versions: [...versions, design] });
    get().revalidate();
  },

  setRequirements: (requirements) => {
    set({ requirements });
    get().revalidate();
  },

  restoreVersion: (version) => {
    const { versions, design } = get();
    const snapshot = versions.find((v) => v.version === version);
    if (!snapshot) return;
    const restored: Design = { ...snapshot, version: design.version + 1 };
    set({ design: restored, versions: [...versions, restored] });
    get().revalidate();
  },
}));
