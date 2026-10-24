// Zod schemas for everything an AI agent is allowed to return. Agents never
// see or produce `id`/`version` fields — the orchestrator assigns those.
import { z } from "zod";

export const CategorySchema = z.enum([
  "server",
  "switch",
  "ups",
  "pdu",
  "storage",
  "patch",
  "blank",
]);

export const FaceSchema = z.enum(["front", "rear"]);
export const FeedSchema = z.enum(["A", "B"]);

export const RequirementsSchema = z.object({
  rackHeightU: z.number().int().min(1).max(60),
  powerBudgetW: z.number().min(0),
  budgetUsd: z.number().min(0).optional(),
  redundantPower: z.boolean(),
  required: z.array(
    z.object({
      category: CategorySchema,
      qty: z.number().int().min(0),
      notes: z.string().optional(),
    })
  ),
});

export const PlacementInputSchema = z.object({
  catalogId: z.string(),
  startU: z.number().int(),
  face: FaceSchema,
  feed: FeedSchema.optional(),
});

export const ArchitectOutputSchema = z.object({
  rackName: z.string(),
  mountingDepthMm: z.number().min(0),
  maxLoadKg: z.number().min(0),
  placements: z.array(PlacementInputSchema),
  rationale: z.string(),
});

export const PatchOpSchema = z.discriminatedUnion("op", [
  z.object({
    op: z.literal("add"),
    catalogId: z.string(),
    startU: z.number().int(),
    face: FaceSchema,
    feed: FeedSchema.optional(),
  }),
  z.object({
    op: z.literal("move"),
    placementId: z.string(),
    newStartU: z.number().int(),
    newFace: FaceSchema.optional(),
  }),
  z.object({
    op: z.literal("remove"),
    placementId: z.string(),
  }),
  z.object({
    op: z.literal("replace"),
    placementId: z.string(),
    newCatalogId: z.string(),
  }),
]);

export const PatchSchema = z.object({
  ops: z.array(PatchOpSchema),
  rationale: z.string(),
});
