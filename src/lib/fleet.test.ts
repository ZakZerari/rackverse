import { afterEach, describe, expect, it } from "vitest";
import { migrateWorkspace, newRackRecord, parseFleet, serializeFleet, useFleetStore } from "@/lib/fleet";
import { serializeWorkspace } from "@/lib/workspace";

afterEach(() => { useFleetStore.getState().flush(); });

describe("multi-rack workspace", () => {
  it("migrates the existing single-rack workspace without dropping its design or history", () => {
    const rack = newRackRecord("rack-1", "Existing rack", "2026-10-24T12:00:00.000Z");
    const old = serializeWorkspace({ design: rack.design, requirements: rack.requirements, versions: rack.versions });
    const migrated = migrateWorkspace(old, "2026-10-24T13:00:00.000Z");
    expect(migrated).toHaveLength(1);
    expect(migrated?.[0]).toMatchObject({ id: "rack-1", design: rack.design, requirements: rack.requirements });
    expect(parseFleet(serializeFleet(migrated!))).toEqual(migrated);
  });

  it("keeps racks separate when one is edited", () => {
    const first = newRackRecord("rack-a", "A");
    const second = newRackRecord("rack-b", "B");
    useFleetStore.setState({ racks: [first, second], hydrated: true });
    const nextDesign = { ...first.design, rack: { ...first.design.rack, name: "Changed A" }, version: 2 };
    useFleetStore.getState().saveRack("rack-a", {
      design: nextDesign, requirements: first.requirements, versions: [first.design, nextDesign], turns: [],
    });
    const racks = useFleetStore.getState().racks;
    expect(racks.find((rack) => rack.id === "rack-a")?.design.rack.name).toBe("Changed A");
    expect(racks.find((rack) => rack.id === "rack-b")).toEqual(second);
  });

  it("rejects corrupt saved collections instead of loading partial rack data", () => {
    expect(parseFleet("broken")).toBeNull();
    expect(parseFleet(JSON.stringify({ schemaVersion: 2, racks: [{ id: "rack-a" }] }))).toBeNull();
  });
});
