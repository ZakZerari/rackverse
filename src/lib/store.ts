import { create } from "zustand";
import type { RunEvent } from "@/lib/events";
import type { RepairOnlyResult } from "@/lib/orchestrate";
import { applyPatch } from "@/lib/patch";
import { breakDesign } from "@/lib/scenarios";
import type { Design, Face, Patch, Requirements, Violation } from "@/lib/types";
import { validateDesign } from "@/lib/validate";

export function defaultRequirements(): Requirements {
  return { rackHeightU: 42, powerBudgetW: 10000, redundantPower: false, required: [] };
}

export function defaultDesign(): Design {
  return {
    rack: {
      id: "rack-1",
      name: "Untitled Rack",
      heightU: 42,
      mountingDepthMm: 1000,
      maxLoadKg: 500,
      powerBudgetW: 10000,
    },
    placements: [],
    version: 1,
  };
}

/** One entry in the live Agent Activity timeline. */
export interface ActivityEntry {
  id: string;
  label: string;
  detail: string;
  status: "running" | "ok" | "rejected" | "error";
  latencyMs?: number;
  tokens?: number;
}

interface RackStore {
  design: Design;
  requirements: Requirements;
  versions: Design[];
  selectedPlacementId: string | null;
  face: Face;

  violations: Violation[];
  violatedPlacementIds: Set<string>;
  revalidate: () => void;

  // Live run state, driven by streamed RunEvents.
  activity: ActivityEntry[];
  isRunning: boolean;
  runningAgent: string | null;
  streamPreview: string;
  applyEvent: (event: RunEvent) => void;
  clearActivity: () => void;

  setFace: (face: Face) => void;
  selectPlacement: (id: string | null) => void;

  applyAndCommit: (patch: Patch) => Design;
  addPlacement: (catalogId: string, startU: number, face: Face, feed?: "A" | "B") => void;
  movePlacement: (placementId: string, newStartU: number, newFace?: Face) => void;
  removePlacement: (placementId: string) => void;
  setFeed: (placementId: string, feed: "A" | "B" | undefined) => void;

  setDesign: (design: Design) => void;
  setRequirements: (requirements: Requirements) => void;
  restoreVersion: (version: number) => void;

  breakIt: () => void;
  pendingRepair: RepairOnlyResult | null;
  setPendingRepair: (result: RepairOnlyResult | null) => void;
  acceptPendingRepair: () => void;
  rejectPendingRepair: () => void;
}

export const useRackStore = create<RackStore>((set, get) => ({
  design: defaultDesign(),
  requirements: defaultRequirements(),
  versions: [defaultDesign()],
  selectedPlacementId: null,
  face: "front",
  violations: [],
  violatedPlacementIds: new Set(),

  activity: [],
  isRunning: false,
  runningAgent: null,
  streamPreview: "",

  revalidate: () => {
    const { design, requirements } = get();
    const violations = validateDesign(design, requirements);
    set({
      violations,
      violatedPlacementIds: new Set(violations.flatMap((v) => v.placementIds)),
    });
  },

  applyEvent: (event) => {
    const push = (entry: ActivityEntry) => set((s) => ({ activity: [...s.activity, entry] }));
    const finishRunning = (agent: string, patch: Partial<ActivityEntry>) =>
      set((s) => {
        const index = [...s.activity].reverse().findIndex((a) => a.label === agent && a.status === "running");
        if (index === -1) return s;
        const realIndex = s.activity.length - 1 - index;
        const activity = [...s.activity];
        activity[realIndex] = { ...activity[realIndex], ...patch };
        return { activity };
      });

    switch (event.type) {
      case "run:start":
        set({ isRunning: true, runningAgent: null, streamPreview: "" });
        break;

      case "agent:start":
        set({ runningAgent: event.agent, streamPreview: "" });
        push({
          id: `${event.agent}-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
          label: event.agent,
          detail: event.note,
          status: "running",
        });
        break;

      case "agent:token":
        set((s) => ({ streamPreview: (s.streamPreview + event.text).slice(-600) }));
        break;

      case "agent:done":
        finishRunning(event.agent, {
          status: "ok",
          detail: event.note ?? "Responded.",
          latencyMs: event.latencyMs,
          tokens: (event.promptTokens ?? 0) + (event.completionTokens ?? 0),
        });
        set({ runningAgent: null, streamPreview: "" });
        break;

      case "agent:error":
        finishRunning(event.agent, { status: "error", detail: event.error });
        set({ runningAgent: null });
        break;

      case "validator:result":
        push({
          id: `validator-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
          label: "Validator",
          detail:
            event.violations.length === 0
              ? "No violations."
              : `${event.hardCount} hard, ${event.violations.length - event.hardCount} soft.`,
          status: event.hardCount === 0 ? "ok" : "rejected",
        });
        break;

      case "verifier:decision":
        push({
          id: `verifier-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
          label: "Verifier",
          detail: event.reason,
          status: event.accepted ? "ok" : "rejected",
        });
        break;

      case "design:update":
        set({ design: event.design });
        get().revalidate();
        break;

      case "run:done":
        set({
          design: event.design,
          requirements: event.requirements,
          versions: [event.design],
          selectedPlacementId: null,
          isRunning: false,
          runningAgent: null,
          streamPreview: "",
        });
        get().revalidate();
        break;

      case "repair:proposed":
        set({
          pendingRepair: {
            design: event.design,
            trace: [
              {
                id: `repair-${Date.now()}`,
                label: "RepairAgent",
                detail: event.reason,
                ok: event.accepted,
              },
            ],
          },
          isRunning: false,
          runningAgent: null,
          streamPreview: "",
        });
        break;

      case "run:error":
        push({
          id: `error-${Date.now()}`,
          label: "Run failed",
          detail: event.error,
          status: "error",
        });
        set({ isRunning: false, runningAgent: null, streamPreview: "" });
        break;
    }
  },

  clearActivity: () => set({ activity: [] }),

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
    get().applyAndCommit({ ops: [{ op: "move", placementId, newStartU, newFace }], rationale: "manual move" });
  },

  removePlacement: (placementId) => {
    const { selectedPlacementId } = get();
    get().applyAndCommit({ ops: [{ op: "remove", placementId }], rationale: "manual remove" });
    if (selectedPlacementId === placementId) set({ selectedPlacementId: null });
  },

  setFeed: (placementId, feed) => {
    // Feed isn't part of the Patch schema (agents only set it on `add`), so this
    // manual-only edit commits directly instead of going through applyPatch.
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
    set({ design, versions: [design], selectedPlacementId: null });
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

  pendingRepair: null,
  setPendingRepair: (result) => set({ pendingRepair: result }),

  breakIt: () => {
    const { design, versions } = get();
    const result = breakDesign(design);
    set({
      design: result.design,
      versions: [...versions, result.design],
      activity: [
        ...get().activity,
        { id: `break-${Date.now()}`, label: "Break it", detail: result.description, status: "rejected" },
      ],
    });
    get().revalidate();
  },

  acceptPendingRepair: () => {
    const { pendingRepair, design, versions } = get();
    if (!pendingRepair) return;
    if (pendingRepair.design !== design) {
      set({ design: pendingRepair.design, versions: [...versions, pendingRepair.design] });
    }
    set({ pendingRepair: null });
    get().revalidate();
  },

  rejectPendingRepair: () => {
    if (!get().pendingRepair) return;
    set((s) => ({
      pendingRepair: null,
      activity: [
        ...s.activity,
        {
          id: `reject-${Date.now()}`,
          label: "Auto-repair",
          detail: "Discarded by user — design left unchanged.",
          status: "rejected",
        },
      ],
    }));
  },
}));
