import { create } from "zustand";
import { z } from "zod";
import type { Turn } from "@/lib/conversation";
import { defaultDesign, defaultRequirements } from "@/lib/store";
import type { Design, Requirements } from "@/lib/types";
import { designSchema, parseWorkspace, WORKSPACE_KEY } from "@/lib/workspace";
import { RequirementsSchema } from "@/lib/schemas";

export const FLEET_KEY = "rackverse.fleet.v2";

export interface RackRecord {
  id: string;
  design: Design;
  requirements: Requirements;
  versions: Design[];
  turns: Turn[];
  createdAt: string;
  updatedAt: string;
}

export type RackSnapshot = Pick<RackRecord, "design" | "requirements" | "versions" | "turns">;

const rackRecordSchema = z.object({
  id: z.string().min(1).max(100),
  design: designSchema,
  requirements: RequirementsSchema,
  versions: z.array(designSchema).min(1).max(100),
  turns: z.array(z.object({
    id: z.string(), kind: z.enum(["design", "amend", "repair", "break"]),
    prompt: z.string(), items: z.array(z.unknown()),
    status: z.enum(["running", "done", "error"]),
    summary: z.string().optional(), error: z.string().optional(), startedAt: z.number(),
  })).max(40),
  createdAt: z.iso.datetime(),
  updatedAt: z.iso.datetime(),
});

const fleetSchema = z.object({ schemaVersion: z.literal(2), racks: z.array(rackRecordSchema) });

export function parseFleet(raw: string): RackRecord[] | null {
  try {
    const result = fleetSchema.safeParse(JSON.parse(raw));
    return result.success ? result.data.racks as unknown as RackRecord[] : null;
  } catch {
    return null;
  }
}

export function serializeFleet(racks: RackRecord[]): string {
  return JSON.stringify({ schemaVersion: 2, racks: racks.map((rack) => ({
    ...rack, versions: rack.versions.slice(-100), turns: rack.turns.slice(-40),
  })) });
}

export function migrateWorkspace(raw: string, now = new Date().toISOString()): RackRecord[] | null {
  const old = parseWorkspace(raw);
  if (!old) return null;
  const id = old.design.rack.id;
  return [{ id, ...old, turns: [], createdAt: now, updatedAt: now }];
}

export function newRackRecord(id: string, name: string, now = new Date().toISOString()): RackRecord {
  const design = defaultDesign(id, name);
  return { id, design, requirements: defaultRequirements(), versions: [design], turns: [], createdAt: now, updatedAt: now };
}

function writeFleet(racks: RackRecord[]): void {
  try { localStorage.setItem(FLEET_KEY, serializeFleet(racks)); } catch { /* Editing still works without browser storage. */ }
}

let saveTimer: ReturnType<typeof setTimeout> | undefined;
function scheduleSave(getRacks: () => RackRecord[]): void {
  if (saveTimer) clearTimeout(saveTimer);
  saveTimer = setTimeout(() => { writeFleet(getRacks()); saveTimer = undefined; }, 300);
}

interface FleetStore {
  racks: RackRecord[];
  hydrated: boolean;
  activeRackId: string | null;
  hydrate: () => void;
  createRack: (name?: string) => string;
  setActiveRackId: (id: string | null) => void;
  saveRack: (id: string, snapshot: RackSnapshot) => void;
  removeRack: (id: string) => void;
  flush: () => void;
}

export const useFleetStore = create<FleetStore>((set, get) => ({
  racks: [], hydrated: false, activeRackId: null,
  hydrate: () => {
    if (get().hydrated) return;
    let racks: RackRecord[] = [];
    try {
      const saved = localStorage.getItem(FLEET_KEY);
      const old = localStorage.getItem(WORKSPACE_KEY);
      racks = (saved ? parseFleet(saved) : null) ?? (old ? migrateWorkspace(old) : null) ?? [];
    } catch { /* Local storage can be unavailable. */ }
    set({ racks, hydrated: true });
    if (racks.length > 0) writeFleet(racks);
  },
  createRack: (name) => {
    if (!get().hydrated) get().hydrate();
    const id = `rack-${crypto.randomUUID()}`;
    const rack = newRackRecord(id, name?.trim() || `Rack ${get().racks.length + 1}`);
    const racks = [...get().racks, rack];
    set({ racks });
    writeFleet(racks);
    return id;
  },
  setActiveRackId: (id) => set({ activeRackId: id }),
  saveRack: (id, snapshot) => {
    const current = get().racks.find((rack) => rack.id === id);
    if (!current) return;
    const racks = get().racks.map((rack) => rack.id === id ? {
      ...rack, ...snapshot, versions: snapshot.versions.slice(-100), turns: snapshot.turns.slice(-40),
      updatedAt: new Date().toISOString(),
    } : rack);
    set({ racks });
    scheduleSave(() => get().racks);
  },
  removeRack: (id) => {
    const racks = get().racks.filter((rack) => rack.id !== id);
    set({ racks, activeRackId: get().activeRackId === id ? null : get().activeRackId });
    writeFleet(racks);
  },
  flush: () => {
    if (saveTimer) { clearTimeout(saveTimer); saveTimer = undefined; }
    writeFleet(get().racks);
  },
}));
