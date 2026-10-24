import { describe, expect, it } from "vitest";
import { useRackStore } from "@/lib/store";

describe("copilot retry timeline", () => {
  it("keeps one running agent row and clears partial output during a temporary retry", () => {
    const store = useRackStore.getState();
    store.clearConversation();
    store.beginTurn("amend", "add a server");
    store.applyEvent({ type: "agent:start", agent: "RackEditor", note: "Editing your rack…" });
    store.applyEvent({ type: "agent:token", agent: "RackEditor", text: "partial reply" });
    store.applyEvent({ type: "agent:retry", agent: "RackEditor", note: "Model temporarily unavailable. Retrying…" });

    const running = useRackStore.getState().turns.at(-1)?.items;
    expect(running).toHaveLength(1);
    expect(running?.[0]).toMatchObject({ kind: "agent", status: "running", output: "", note: "Model temporarily unavailable. Retrying…" });

    store.applyEvent({ type: "agent:token", agent: "RackEditor", text: '{"ops":[],"rationale":"No change"}' });
    store.applyEvent({ type: "agent:done", agent: "RackEditor", latencyMs: 5500 });
    const done = useRackStore.getState().turns.at(-1)?.items;
    expect(done).toHaveLength(1);
    expect(done?.[0]).toMatchObject({ kind: "agent", status: "ok", rationale: "No change" });
  });

  it("marks interrupted turns clearly when a saved rack is restored after refresh", () => {
    const store = useRackStore.getState();
    store.clearConversation();
    store.beginTurn("repair", "Auto-repair");
    store.applyEvent({ type: "agent:start", agent: "RepairAgent", note: "Working…" });
    const snapshot = useRackStore.getState();
    store.loadSnapshot({ design: snapshot.design, requirements: snapshot.requirements,
      versions: snapshot.versions, turns: snapshot.turns });
    expect(useRackStore.getState().turns.at(-1)).toMatchObject({
      status: "error", error: "Interrupted by page refresh.",
      items: [{ kind: "agent", status: "error", error: "Interrupted by page refresh." }],
    });
    expect(useRackStore.getState().isRunning).toBe(false);
  });
});
