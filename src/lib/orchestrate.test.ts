import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Design, Requirements } from "@/lib/types";
import type { RunEvent } from "@/lib/events";

vi.mock("@/lib/agents/requirements", () => ({ runRequirementsAgent: vi.fn() }));
vi.mock("@/lib/agents/architect", () => ({ runArchitect: vi.fn() }));
vi.mock("@/lib/agents/editor", () => ({ runRackEditor: vi.fn() }));
vi.mock("@/lib/agents/repair", () => ({ runRepairAgent: vi.fn() }));

import { runRequirementsAgent } from "@/lib/agents/requirements";
import { runArchitect } from "@/lib/agents/architect";
import { runRackEditor } from "@/lib/agents/editor";
import { runRepairAgent } from "@/lib/agents/repair";
import { designFromPrompt } from "@/lib/orchestrate";

const mockRequirements = vi.mocked(runRequirementsAgent);
const mockArchitect = vi.mocked(runArchitect);
const mockEditor = vi.mocked(runRackEditor);
const mockRepair = vi.mocked(runRepairAgent);

const requirements: Requirements = { rackHeightU: 24, powerBudgetW: 3000, redundantPower: false, required: [] };
const current: Design = {
  rack: { id: "rack-1", name: "Edge rack", heightU: 24, mountingDepthMm: 1000, maxLoadKg: 500, powerBudgetW: 3000 },
  placements: [{ id: "pdu", catalogId: "apc-ap7868", startU: 1, face: "rear" }],
  version: 3,
};

beforeEach(() => {
  mockRequirements.mockReset();
  mockArchitect.mockReset();
  mockEditor.mockReset();
  mockRepair.mockReset();
  mockRequirements.mockResolvedValue(requirements);
  mockArchitect.mockResolvedValue({ rackName: "Edge rack", mountingDepthMm: 1000, maxLoadKg: 500, placements: [], rationale: "Empty rack" });
  mockEditor.mockResolvedValue({ ops: [], rationale: "No equipment changes needed" });
  mockRepair.mockResolvedValue({ ops: [], rationale: "No fix" });
});

describe("Mubit agent orchestration with deterministic checks", () => {
  it("sends structured first-turn context and builds a new rack", async () => {
    const events: RunEvent[] = [];
    const result = await designFromPrompt("24U edge rack", { emit: (event) => events.push(event) });
    expect(mockRequirements).toHaveBeenCalledWith(expect.objectContaining({
      message: "24U edge rack", history: [], current: null,
    }), expect.anything());
    expect(mockArchitect).toHaveBeenCalledOnce();
    expect(mockEditor).not.toHaveBeenCalled();
    expect(result.design.rack.heightU).toBe(24);
    expect(events.at(-1)).toMatchObject({ type: "run:done", mode: "design" });
  });

  it("keeps user-selected rack dimensions and custom equipment for a new design", async () => {
    const empty: Design = {
      ...current,
      rack: { ...current.rack, name: "My edge rack", mountingDepthMm: 900, maxLoadKg: 600 },
      placements: [],
      catalogOverrides: [{ id: "custom-blank", manufacturer: "Site", name: "Air panel",
        category: "blank", heightU: 1, depthMm: 100, weightKg: 0.2, powerW: 0,
        fullDepth: false, priceUsd: 40, source: "custom", estimated: [] }],
    };
    const result = await designFromPrompt("add gear", { currentDesign: empty, currentRequirements: requirements });
    expect(mockRequirements).toHaveBeenCalledWith(expect.objectContaining({ current: requirements }), expect.anything());
    expect(result.design.rack).toMatchObject({ name: "My edge rack", heightU: 24, mountingDepthMm: 900, maxLoadKg: 600 });
    expect(result.design.catalogOverrides).toEqual(empty.catalogOverrides);
  });

  it("uses the existing rack for a follow-up and preserves its devices", async () => {
    mockEditor.mockResolvedValue({ ops: [{ op: "add", catalogId: "generic-blanking-panel-1u", startU: 1, face: "front" }], rationale: "Added blanking panel" });
    const events: RunEvent[] = [];
    const result = await designFromPrompt("add a blanking panel", {
      currentDesign: current, currentRequirements: requirements,
      history: [{ user: "build an edge rack", outcome: "one PDU" }],
      emit: (event) => events.push(event),
    });
    expect(mockRequirements).toHaveBeenCalledWith(expect.objectContaining({
      current: requirements, history: [{ user: "build an edge rack", outcome: "one PDU" }],
    }), expect.anything());
    expect(mockArchitect).not.toHaveBeenCalled();
    expect(mockEditor).toHaveBeenCalledOnce();
    expect(result.design.placements.map((placement) => placement.catalogId)).toEqual([
      "apc-ap7868", "generic-blanking-panel-1u",
    ]);
    expect(events.at(-1)).toMatchObject({ type: "run:done", mode: "amend" });
  });

  it("re-asks the editor once when its patch names something that does not exist", async () => {
    mockEditor
      .mockResolvedValueOnce({ ops: [{ op: "remove", placementId: "pl-imaginary" }], rationale: "Removed it" })
      .mockResolvedValueOnce({
        ops: [{ op: "add", catalogId: "generic-blanking-panel-1u", startU: 2, face: "front" }],
        rationale: "Added a blanking panel",
      });

    const result = await designFromPrompt("tidy it up", {
      currentDesign: current,
      currentRequirements: requirements,
    });

    expect(mockEditor).toHaveBeenCalledTimes(2);
    expect(mockEditor.mock.calls[1][0]).toMatchObject({
      previousAttemptProblems: [expect.stringContaining("pl-imaginary")],
    });
    expect(result.design.placements).toHaveLength(2);
  });

  it("applies nothing when the editor is still incoherent on the retry", async () => {
    // `applyPatch` treats an unknown placementId as a no-op, so without this
    // gate the agent reports a change the rack never received.
    mockEditor.mockResolvedValue({ ops: [{ op: "remove", placementId: "pl-imaginary" }], rationale: "Removed it" });
    const events: RunEvent[] = [];

    const result = await designFromPrompt("delete the thing", {
      currentDesign: current,
      currentRequirements: requirements,
      emit: (event) => events.push(event),
    });

    expect(mockEditor).toHaveBeenCalledTimes(2);
    expect(mockRepair).not.toHaveBeenCalled();
    expect(result.design.placements).toEqual(current.placements);
    expect(events).toContainEqual(
      expect.objectContaining({ type: "verifier:decision", accepted: false, reason: expect.stringContaining("pl-imaginary") })
    );
  });

  it("publishes the running brief so the Requirements step is never just \"Responded.\"", async () => {
    const events: RunEvent[] = [];
    await designFromPrompt("24U edge rack", { emit: (event) => events.push(event) });
    expect(events).toContainEqual(
      expect.objectContaining({ type: "requirements:update", summary: "24U · 3kW" })
    );
  });

  it("rolls back an edit that leaves a new engineering violation after repair", async () => {
    mockEditor.mockResolvedValue({ ops: [
      { op: "add", catalogId: "generic-blanking-panel-1u", startU: 1, face: "front" },
      { op: "add", catalogId: "generic-blanking-panel-1u", startU: 1, face: "front" },
    ], rationale: "Bad overlapping change" });
    const events: RunEvent[] = [];
    const result = await designFromPrompt("add panels", {
      currentDesign: current, currentRequirements: requirements, emit: (event) => events.push(event),
    });
    expect(result.design.placements).toEqual(current.placements);
    expect(events).toContainEqual(expect.objectContaining({ type: "verifier:decision", accepted: false }));
  });
});
