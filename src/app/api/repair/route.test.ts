import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Design, Requirements } from "@/lib/types";

vi.mock("@/lib/orchestrate", () => ({ repairOnly: vi.fn() }));
vi.mock("@/lib/rackRuns", () => ({
  validRackId: (id: unknown) => typeof id === "string" && /^[a-z0-9-]+$/.test(id),
  rackRunId: (id: string) => `rack:${id}:repair-test`,
  recordRackRun: vi.fn(),
}));

import { repairOnly } from "@/lib/orchestrate";
import { recordRackRun } from "@/lib/rackRuns";
import { POST } from "@/app/api/repair/route";

const requirements: Requirements = { rackHeightU: 24, powerBudgetW: 3000, redundantPower: false, required: [] };
const broken: Design = { rack: { id: "rack-a", name: "A", heightU: 24, mountingDepthMm: 1000,
  maxLoadKg: 500, powerBudgetW: 3000 },
  placements: [{ id: "bad", catalogId: "missing-device", startU: 1, face: "front" }], version: 1 };

beforeEach(() => {
  vi.mocked(repairOnly).mockReset();
  vi.mocked(recordRackRun).mockReset();
});

describe("rack-scoped repair route", () => {
  it("records before and after checks for a verified repair proposal", async () => {
    const fixed: Design = { ...broken, placements: [], version: 2 };
    vi.mocked(repairOnly).mockResolvedValue({ design: fixed, trace: [
      { id: "repair", label: "RepairAgent (round 1, candidate 1)", detail: "Removed unknown device", ok: true },
    ] });
    const response = await POST(new Request("http://localhost/api/repair", { method: "POST",
      body: JSON.stringify({ rackId: "rack-a", design: broken, requirements }) }));
    const output = await response.text();
    expect(output).toContain("repair:proposed");
    expect(vi.mocked(repairOnly).mock.calls[0][2]).toMatchObject({ runId: "rack:rack-a:repair-test" });
    expect(recordRackRun).toHaveBeenCalledWith(expect.objectContaining({ rackId: "rack-a", kind: "repair",
      initialHardCount: 1, finalHardCount: 0, acceptedPatch: true,
      repairRounds: 1, firstRoundPassed: true, durationMs: expect.any(Number) }));
  });
});
