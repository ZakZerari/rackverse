import { z } from "zod";
import { equipmentSchema, rackSettingsSchema } from "@/lib/configuration";
import { RequirementsSchema } from "@/lib/schemas";
import type { Design, Requirements } from "@/lib/types";

/** Pre-RackOS namespace, kept so already-saved work still migrates. See FLEET_KEY. */
export const WORKSPACE_KEY = "rackverse.workspace.v1";

export const designSchema = z.object({
  rack: rackSettingsSchema.extend({ id: z.string().min(1) }),
  placements: z.array(z.object({
    id: z.string().min(1), catalogId: z.string().min(1), startU: z.number().int(),
    face: z.enum(["front", "rear"]), feed: z.enum(["A", "B"]).optional(),
  })),
  version: z.number().int().min(1),
  catalogOverrides: z.array(equipmentSchema).optional(),
});

const workspaceSchema = z.object({
  schemaVersion: z.literal(1),
  design: designSchema,
  requirements: RequirementsSchema,
  versions: z.array(designSchema).min(1).max(100),
});

export interface WorkspaceSnapshot {
  design: Design;
  requirements: Requirements;
  versions: Design[];
}

export function parseWorkspace(raw: string): WorkspaceSnapshot | null {
  try {
    const parsed = workspaceSchema.safeParse(JSON.parse(raw));
    if (!parsed.success) return null;
    return { design: parsed.data.design, requirements: parsed.data.requirements, versions: parsed.data.versions };
  } catch {
    return null;
  }
}

export function serializeWorkspace(snapshot: WorkspaceSnapshot): string {
  return JSON.stringify({ schemaVersion: 1, ...snapshot, versions: snapshot.versions.slice(-100) });
}
