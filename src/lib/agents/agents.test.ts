import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Design, Requirements } from "@/lib/types";

vi.mock("@/lib/llm", () => ({ complete: vi.fn() }));

import { complete } from "@/lib/llm";
import { RACK_ARCHITECT_SYSTEM, runArchitect } from "@/lib/agents/architect";
import { REPAIR_AGENT_SYSTEM, runRepairAgent } from "@/lib/agents/repair";
import { REQUIREMENTS_AGENT_SYSTEM, runRequirementsAgent } from "@/lib/agents/requirements";

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
    await runRequirementsAgent("42U rack with 8 servers");
    await runRequirementsAgent("a tiny edge rack with one switch and a budget of $5k");

    const systems = mockComplete.mock.calls.map((call) => call[0].system);
    expect(systems[0]).toBe(REQUIREMENTS_AGENT_SYSTEM);
    expect(systems[1]).toBe(REQUIREMENTS_AGENT_SYSTEM);
    expect(systems[0]).toBe(systems[1]);
  });

  it("RackArchitect sends the exact same system prompt regardless of input", async () => {
    await runArchitect(requirements());
    await runArchitect({ ...requirements(), rackHeightU: 24, redundantPower: true });

    const systems = mockComplete.mock.calls.map((call) => call[0].system);
    expect(systems[0]).toBe(RACK_ARCHITECT_SYSTEM);
    expect(systems[1]).toBe(RACK_ARCHITECT_SYSTEM);
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
  });

  it("all three agents use distinct system prompts from one another", () => {
    const unique = new Set([REQUIREMENTS_AGENT_SYSTEM, RACK_ARCHITECT_SYSTEM, REPAIR_AGENT_SYSTEM]);
    expect(unique.size).toBe(3);
  });
});
