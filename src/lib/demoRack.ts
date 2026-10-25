import type { Design, Requirements } from "@/lib/types";

/** A plausible small production rack shared by the landing demo and engineering tests. */
export function createDemoRack(id = "rack-demo", name = "Production virtualization"): {
  design: Design;
  requirements: Requirements;
} {
  const placements = Array.from({ length: 6 }, (_, index) => ({
    id: `server-${index + 1}`,
    catalogId: "supermicro-superserver-1027r-wrf",
    startU: index + 1,
    face: "front" as const,
  }));
  return {
    design: {
      rack: { id, name, heightU: 42, mountingDepthMm: 1000, maxLoadKg: 500, powerBudgetW: 6000 },
      placements: [
        ...placements,
        { id: "switch", catalogId: "brocade-icx-6430-48", startU: 7, face: "front" },
        { id: "storage", catalogId: "synology-rs1221", startU: 8, face: "front" },
        { id: "pdu-a", catalogId: "apc-ap7868", startU: 1, face: "rear", feed: "A" },
        { id: "pdu-b", catalogId: "apc-ap7868", startU: 1, face: "rear", feed: "B" },
      ],
      version: 1,
    },
    requirements: {
      rackHeightU: 42,
      powerBudgetW: 6000,
      budgetUsd: 40000,
      redundantPower: true,
      required: [
        { category: "server", qty: 6 },
        { category: "switch", qty: 1 },
        { category: "storage", qty: 1 },
      ],
    },
  };
}
