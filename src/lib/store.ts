import { create } from "zustand";
import { removeEquipment, resetEquipment, updateRack, upsertEquipment } from "@/lib/configuration";
import {
  extractRationale,
  newTurn,
  type TimelineItem,
  type Turn,
  type TurnKind,
} from "@/lib/conversation";
import type { RunEvent } from "@/lib/events";
import type { RepairOnlyResult } from "@/lib/orchestrate";
import { applyPatch } from "@/lib/patch";
import { breakDesign } from "@/lib/scenarios";
import type { CatalogItem, Design, Face, Patch, Rack, Requirements, Violation } from "@/lib/types";
import { validateDesign } from "@/lib/validate";

export function defaultRequirements(): Requirements {
  return { rackHeightU: 42, powerBudgetW: 10000, redundantPower: false, required: [] };
}

export function defaultDesign(id = "rack-1", name = "Untitled Rack"): Design {
  return {
    rack: {
      id,
      name,
      heightU: 42,
      mountingDepthMm: 1000,
      maxLoadKg: 500,
      powerBudgetW: 10000,
    },
    placements: [],
    version: 1,
  };
}

/** Flattened view of all turns, for the bottom Agent Activity timeline. */
export interface ActivityEntry {
  id: string;
  label: string;
  detail: string;
  status: "running" | "ok" | "rejected" | "error";
  latencyMs?: number;
  tokens?: number;
}

export function flattenActivity(turns: Turn[]): ActivityEntry[] {
  return turns.flatMap((turn) =>
    turn.items.map((item): ActivityEntry => {
      switch (item.kind) {
        case "agent":
          return {
            id: item.id,
            label: item.agent,
            detail: item.rationale ?? item.error ?? item.note,
            status: item.status === "running" ? "running" : item.status === "ok" ? "ok" : "error",
            latencyMs: item.latencyMs,
            tokens: item.tokens,
          };
        case "validator":
          return {
            id: item.id,
            label: "Validator",
            detail:
              item.violations.length === 0
                ? "No violations."
                : `${item.hardCount} hard, ${item.violations.length - item.hardCount} soft.`,
            status: item.hardCount === 0 ? "ok" : "rejected",
          };
        case "verifier":
          return {
            id: item.id,
            label: "Verifier",
            detail: item.reason,
            status: item.accepted ? "ok" : "rejected",
          };
        case "note":
          return {
            id: item.id,
            label: item.label,
            detail: item.detail,
            status: item.tone === "warn" ? "rejected" : "ok",
          };
      }
    })
  );
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

  // The Copilot conversation, driven by streamed RunEvents.
  turns: Turn[];
  isRunning: boolean;
  runningAgent: string | null;
  beginTurn: (kind: TurnKind, prompt: string) => void;
  applyEvent: (event: RunEvent) => void;
  clearConversation: () => void;

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
  updateRackSettings: (settings: Omit<Rack, "id">) => void;
  saveEquipment: (item: CatalogItem) => void;
  deleteEquipment: (id: string) => void;
  resetEquipment: (id: string) => void;
  loadSnapshot: (snapshot: { design: Design; requirements: Requirements; versions: Design[]; turns: Turn[] }) => void;

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

  turns: [],
  isRunning: false,
  runningAgent: null,

  revalidate: () => {
    const { design, requirements } = get();
    const violations = validateDesign(design, requirements);
    set({
      violations,
      violatedPlacementIds: new Set(violations.flatMap((v) => v.placementIds)),
    });
  },

  beginTurn: (kind, prompt) => set((s) => ({ turns: [...s.turns, newTurn(kind, prompt)], isRunning: true })),

  applyEvent: (event) => {
    const uid = (prefix: string) => `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;

    /** All timeline mutation goes through the turn currently in flight. */
    const patchCurrentTurn = (fn: (turn: Turn) => Turn) =>
      set((s) => {
        if (s.turns.length === 0) return s;
        const turns = [...s.turns];
        turns[turns.length - 1] = fn(turns[turns.length - 1]);
        return { turns };
      });

    const addItem = (item: TimelineItem) =>
      patchCurrentTurn((turn) => ({ ...turn, items: [...turn.items, item] }));

    /** Update the most recent still-running step for this agent. */
    const patchRunningAgent = (agent: string, fn: (item: TimelineItem & { kind: "agent" }) => TimelineItem) =>
      patchCurrentTurn((turn) => {
        const index = turn.items.findLastIndex(
          (i) => i.kind === "agent" && i.agent === agent && i.status === "running"
        );
        if (index === -1) return turn;
        const items = [...turn.items];
        items[index] = fn(items[index] as TimelineItem & { kind: "agent" });
        return { ...turn, items };
      });

    switch (event.type) {
      case "run:start":
        set({ isRunning: true, runningAgent: null });
        break;

      case "agent:start":
        set({ runningAgent: event.agent });
        addItem({
          kind: "agent",
          id: uid(event.agent),
          agent: event.agent,
          note: event.note,
          status: "running",
          output: "",
        });
        break;

      case "agent:token":
        // Appended in full — this is what keeps an agent's reasoning on screen
        // after it finishes, instead of vanishing with the spinner.
        patchRunningAgent(event.agent, (item) => ({ ...item, output: item.output + event.text }));
        break;

      case "agent:done":
        patchRunningAgent(event.agent, (item) => ({
          ...item,
          status: "ok",
          rationale: extractRationale(item.output),
          latencyMs: event.latencyMs,
          tokens: (event.promptTokens ?? 0) + (event.completionTokens ?? 0),
        }));
        set({ runningAgent: null });
        break;

      case "agent:error":
        patchRunningAgent(event.agent, (item) => ({ ...item, status: "error", error: event.error }));
        set({ runningAgent: null });
        break;

      case "requirements:update":
        // Land the brief on the Requirements step itself. Its schema has no
        // `rationale`, so the row would otherwise just say "Responded.".
        set({ requirements: event.requirements });
        patchCurrentTurn((turn) => {
          const index = turn.items.findLastIndex((i) => i.kind === "agent" && i.agent === "RequirementsAgent");
          if (index === -1) return turn;
          const items = [...turn.items];
          items[index] = { ...(items[index] as TimelineItem & { kind: "agent" }), rationale: event.summary };
          return { ...turn, items };
        });
        get().revalidate();
        break;

      case "validator:result":
        addItem({
          kind: "validator",
          id: uid("validator"),
          violations: event.violations,
          hardCount: event.hardCount,
        });
        break;

      case "verifier:decision":
        addItem({
          kind: "verifier",
          id: uid("verifier"),
          accepted: event.accepted,
          reason: event.reason,
          hardBefore: event.hardBefore,
          hardAfter: event.hardAfter,
        });
        break;

      case "design:update":
        set({ design: event.design });
        get().revalidate();
        break;

      case "run:done": {
        set({
          design: event.design,
          requirements: event.requirements,
          versions: event.mode === "amend" ? [...get().versions, event.design] : [event.design],
          selectedPlacementId: null,
          isRunning: false,
          runningAgent: null,
        });
        get().revalidate();
        const hard = get().violations.filter((v) => v.severity === "hard").length;
        patchCurrentTurn((turn) => ({
          ...turn,
          status: "done",
          summary: `${event.design.placements.length} devices · ${
            hard === 0 ? "all checks passing" : `${hard} hard violation(s)`
          }`,
        }));
        break;
      }

      case "repair:proposed":
        set({
          pendingRepair: {
            design: event.design,
            trace: [{ id: uid("repair"), label: "RepairAgent", detail: event.reason, ok: event.accepted }],
          },
          isRunning: false,
          runningAgent: null,
        });
        patchCurrentTurn((turn) => ({
          ...turn,
          status: "done",
          summary: event.accepted ? "Patch ready for review" : "No usable patch found",
        }));
        break;

      case "run:error":
        addItem({ kind: "note", id: uid("error"), label: "Run failed", detail: event.error, tone: "warn" });
        patchCurrentTurn((turn) => ({ ...turn, status: "error", error: event.error }));
        set({ isRunning: false, runningAgent: null });
        break;
    }
  },

  clearConversation: () => set({ turns: [] }),

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

  updateRackSettings: (settings) => {
    const next = updateRack(get().design, settings);
    set((state) => ({
      design: next,
      requirements: { ...state.requirements, rackHeightU: next.rack.heightU, powerBudgetW: next.rack.powerBudgetW },
      versions: [...state.versions, next],
    }));
    get().revalidate();
  },

  saveEquipment: (item) => {
    const next = upsertEquipment(get().design, item);
    set((state) => ({ design: next, versions: [...state.versions, next] }));
    get().revalidate();
  },

  deleteEquipment: (id) => {
    const next = removeEquipment(get().design, id);
    set((state) => ({ design: next, versions: [...state.versions, next] }));
    get().revalidate();
  },

  resetEquipment: (id) => {
    const next = resetEquipment(get().design, id);
    set((state) => ({ design: next, versions: [...state.versions, next] }));
    get().revalidate();
  },

  loadSnapshot: (snapshot) => {
    set({
      design: snapshot.design, requirements: snapshot.requirements, versions: snapshot.versions,
      turns: snapshot.turns, selectedPlacementId: null, face: "front",
      isRunning: false, runningAgent: null, pendingRepair: null,
    });
    get().revalidate();
  },

  pendingRepair: null,
  setPendingRepair: (result) => set({ pendingRepair: result }),

  breakIt: () => {
    const { design, versions } = get();
    const result = breakDesign(design);
    const turn = newTurn("break", "Break it");
    turn.status = "done";
    turn.items = [
      {
        kind: "note",
        id: `break-${Date.now()}`,
        label: "Fault injected",
        detail: result.description,
        tone: "warn",
      },
    ];
    set({
      design: result.design,
      versions: [...versions, result.design],
      turns: [...get().turns, turn],
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
    const turn = newTurn("repair", "Reject patch");
    turn.status = "done";
    turn.summary = "Discarded by user — design left unchanged.";
    set((s) => ({ pendingRepair: null, turns: [...s.turns, turn] }));
  },
}));
