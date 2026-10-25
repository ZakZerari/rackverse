import { beforeEach, describe, expect, it } from "vitest";
import { useRackStore } from "@/lib/store";
import type { Design, Requirements } from "@/lib/types";

const requirements: Requirements = {
  rackHeightU: 42, powerBudgetW: 10000, budgetUsd: 25000, redundantPower: true,
  required: [{ category: "server", qty: 8 }],
};

const design: Design = {
  rack: { id: "rack-1", name: "Edge rack", heightU: 42, mountingDepthMm: 1000, maxLoadKg: 500, powerBudgetW: 10000 },
  placements: [],
  version: 2,
};

describe("the turn summary a 'can't fit that' warning leaves behind", () => {
  beforeEach(() => {
    useRackStore.setState({ turns: [], isRunning: false, runningAgent: null });
  });

  /**
   * This is the actual bug a user hit: "Can't fit that: ...dropping
   * redundant A/B power would fit the budget" was shown once, then silently
   * discarded — run:done always overwrote the turn summary with a generic
   * device count, so the NEXT turn's history carried none of it. "ok drop
   * it" then had no "it" to resolve. The fix: a warn note from this turn
   * becomes the summary, not the generic line.
   */
  it("keeps the warning as the summary instead of overwriting it with a device count", () => {
    const store = useRackStore.getState();
    store.beginTurn("amend", "stay under 25k");
    store.applyEvent({
      type: "note",
      label: "Can't fit that",
      detail: "Even the cheapest valid configuration costs about $30,600 — $5,600 over the $25,000 budget.",
      tone: "warn",
    });
    store.applyEvent({ type: "run:done", design, requirements, mode: "amend" });

    const turn = useRackStore.getState().turns.at(-1);
    expect(turn?.summary).toBe(
      "Even the cheapest valid configuration costs about $30,600 — $5,600 over the $25,000 budget."
    );
    // Specifically not the generic fallback that used to stomp it.
    expect(turn?.summary).not.toMatch(/devices? ·/);
  });

  it("falls back to the generic device-count summary when there was no warning", () => {
    const store = useRackStore.getState();
    store.beginTurn("amend", "add two servers");
    store.applyEvent({
      type: "run:done",
      design: { ...design, placements: [{ id: "p1", catalogId: "x", startU: 1, face: "front" }] },
      requirements,
      mode: "amend",
    });

    const turn = useRackStore.getState().turns.at(-1);
    expect(turn?.summary).toMatch(/devices? ·/);
  });

  it("ignores a neutral note — only a warning pre-empts the summary", () => {
    const store = useRackStore.getState();
    store.beginTurn("amend", "add a patch panel");
    store.applyEvent({ type: "note", label: "FYI", detail: "Nothing to worry about.", tone: "neutral" });
    store.applyEvent({ type: "run:done", design, requirements, mode: "amend" });

    const turn = useRackStore.getState().turns.at(-1);
    expect(turn?.summary).toMatch(/devices? ·/);
  });
});
