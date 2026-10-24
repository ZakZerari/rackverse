import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Design, Requirements } from "@/lib/types";

vi.mock("@/lib/orchestrate", () => ({ designFromPrompt: vi.fn() }));
vi.mock("@/lib/rackRuns", () => ({
  validRackId: (id: unknown) => typeof id === "string" && /^[a-z0-9-]+$/.test(id),
  rackRunId: (id: string) => `rack:${id}:test-run`,
  recordRackRun: vi.fn(),
}));

import { designFromPrompt } from "@/lib/orchestrate";
import { recordRackRun } from "@/lib/rackRuns";
import { POST } from "@/app/api/design/route";

const requirements: Requirements = { rackHeightU: 24, powerBudgetW: 3000, redundantPower: false, required: [] };
const design: Design = { rack: { id: "rack-a", name: "A", heightU: 24, mountingDepthMm: 1000,
  maxLoadKg: 500, powerBudgetW: 3000 }, placements: [], version: 1 };

beforeEach(() => {
  vi.mocked(designFromPrompt).mockReset();
  vi.mocked(recordRackRun).mockReset();
});

describe("rack-scoped design route", () => {
  it("records a validated outcome under the same run ID sent to Mubit agents", async () => {
    vi.mocked(designFromPrompt).mockResolvedValue({ design, requirements, trace: [
      { id: "validator", label: "Validator", detail: "No violations", ok: true, hardViolationCount: 0 },
    ] });
    const response = await POST(new Request("http://localhost/api/design", { method: "POST",
      body: JSON.stringify({ text: "build a rack", rackId: "rack-a", currentDesign: design, currentRequirements: requirements }) }));
    await response.text();
    expect(response.status).toBe(200);
    expect(vi.mocked(designFromPrompt).mock.calls[0][1]).toMatchObject({ runId: "rack:rack-a:test-run" });
    expect(recordRackRun).toHaveBeenCalledWith(expect.objectContaining({ rackId: "rack-a", runId: "rack:rack-a:test-run",
      kind: "design", status: "completed", finalHardCount: 0 }));
  });

  it("rejects a malformed rack ID before starting an agent", async () => {
    const response = await POST(new Request("http://localhost/api/design", { method: "POST",
      body: JSON.stringify({ text: "build", rackId: "rack:a" }) }));
    expect(response.status).toBe(400);
    expect(designFromPrompt).not.toHaveBeenCalled();
  });

  it("rejects a rack ID that does not belong to the submitted design", async () => {
    const response = await POST(new Request("http://localhost/api/design", { method: "POST",
      body: JSON.stringify({ text: "build", rackId: "rack-b", currentDesign: design, currentRequirements: requirements }) }));
    expect(response.status).toBe(400);
    expect(designFromPrompt).not.toHaveBeenCalled();
  });
});
