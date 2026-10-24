import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Design, Requirements } from "@/lib/types";

vi.mock("@/lib/llm", () => ({ complete: vi.fn() }));

import { complete } from "@/lib/llm";
import { RACK_ARCHITECT_SYSTEM, runArchitect } from "@/lib/agents/architect";
import { RACK_EDITOR_SYSTEM, runRackEditor } from "@/lib/agents/editor";
import { REPAIR_AGENT_SYSTEM, runRepairAgent } from "@/lib/agents/repair";
import { REQUIREMENTS_AGENT_SYSTEM, runRequirementsAgent } from "@/lib/agents/requirements";
import { ArchitectOutputSchema, PatchSchema, RequirementsSchema } from "@/lib/schemas";

const mockComplete = vi.mocked(complete);

function requirements(): Requirements {
  return { rackHeightU: 42, powerBudgetW: 10000, redundantPower: false, required: [] };
}

function design(): Design {
  return {
    rack: { id: "r1", name: "R", heightU: 42, mountingDepthMm: 1000, maxLoadKg: 500, powerBudgetW: 10000 },
    placements: [],
    version: 1,
  };
}

beforeEach(() => {
  mockComplete.mockReset();
  mockComplete.mockImplementation(() => Promise.resolve({}) as never);
});

describe("each agent's system prompt is a stable, constant string (so Mubit groups it into one task)", () => {
  it("RequirementsAgent sends the exact same system prompt regardless of input", async () => {
    await runRequirementsAgent({ message: "42U rack with 8 servers", history: [], current: null });
    await runRequirementsAgent({ message: "a tiny edge rack with one switch and a budget of $5k", history: [], current: null });

    const systems = mockComplete.mock.calls.map((call) => call[0].system);
    expect(systems[0]).toBe(REQUIREMENTS_AGENT_SYSTEM);
    expect(systems[1]).toBe(REQUIREMENTS_AGENT_SYSTEM);
    expect(systems[0]).toBe(systems[1]);
    expect(mockComplete.mock.calls.every(([call]) => call.schema === RequirementsSchema)).toBe(true);
  });

  it("RackArchitect sends the exact same system prompt regardless of input", async () => {
    await runArchitect(requirements());
    await runArchitect({ ...requirements(), rackHeightU: 24, redundantPower: true });

    const systems = mockComplete.mock.calls.map((call) => call[0].system);
    expect(systems[0]).toBe(RACK_ARCHITECT_SYSTEM);
    expect(systems[1]).toBe(RACK_ARCHITECT_SYSTEM);
    expect(mockComplete.mock.calls.every(([call]) => call.schema === ArchitectOutputSchema)).toBe(true);
  });

  it("RepairAgent sends the exact same system prompt regardless of input", async () => {
    await runRepairAgent({ design: design(), violations: [], requirements: requirements(), lessons: [] });
    await runRepairAgent({
      design: { ...design(), version: 9 },
      violations: [{ code: "WEIGHT_EXCEEDED", severity: "hard", message: "too heavy", placementIds: [] }],
      requirements: requirements(),
      lessons: [],
    });

    const systems = mockComplete.mock.calls.map((call) => call[0].system);
    expect(systems[0]).toBe(REPAIR_AGENT_SYSTEM);
    expect(systems[1]).toBe(REPAIR_AGENT_SYSTEM);
    expect(mockComplete.mock.calls.every(([call]) => call.schema === PatchSchema)).toBe(true);
  });

  it("RackEditor sends a stable prompt while user changes remain in the user message", async () => {
    await runRackEditor({ request: "add a server", history: [], requirements: requirements(), design: design() });
    await runRackEditor({ request: "make it cheaper", history: [], requirements: requirements(), design: design() });
    expect(mockComplete.mock.calls.map(([call]) => call.system)).toEqual([RACK_EDITOR_SYSTEM, RACK_EDITOR_SYSTEM]);
    expect(mockComplete.mock.calls.every(([call]) => call.schema === PatchSchema)).toBe(true);
  });

  it("custom equipment is available to Architect and Repair without changing task instructions", async () => {
    const customDesign: Design = { ...design(), catalogOverrides: [{
      id: "custom-1", manufacturer: "Site", name: "Compute Node", category: "server", heightU: 2,
      depthMm: 700, weightKg: 20, powerW: 500, priceUsd: 4500, fullDepth: true,
      netPortsNeeded: 2, source: "custom", estimated: [],
    }] };
    await runArchitect(requirements(), { catalogDesign: customDesign });
    await runRepairAgent({ design: customDesign, violations: [], requirements: requirements(), lessons: [] });
    expect(mockComplete.mock.calls[0][0].user).toContain("custom-1|server");
    expect(mockComplete.mock.calls[1][0].user).toContain("custom-1|server");
    expect(mockComplete.mock.calls[0][0].system).toBe(RACK_ARCHITECT_SYSTEM);
    expect(mockComplete.mock.calls[1][0].system).toBe(REPAIR_AGENT_SYSTEM);
  });

  it("all four agents use distinct system prompts from one another", () => {
    const unique = new Set([REQUIREMENTS_AGENT_SYSTEM, RACK_ARCHITECT_SYSTEM, RACK_EDITOR_SYSTEM, REPAIR_AGENT_SYSTEM]);
    expect(unique.size).toBe(4);
  });
});
