// Shared design model. U1 is the bottom of the rack; a device with
// startU=10, heightU=2 occupies U10-U11 inclusive.

export type Face = "front" | "rear";

export type Category =
  | "server"
  | "switch"
  | "ups"
  | "pdu"
  | "storage"
  | "patch"
  | "blank";

/** Which numeric fields we estimated rather than read from the source data. */
export type EstimatedField = "depthMm" | "weightKg" | "powerW" | "powerCapacityW" | "priceUsd";

export interface CatalogItem {
  id: string;
  /** Manufacturer or a user-supplied label for custom equipment. */
  manufacturer: string;
  /** Real model name, e.g. "PowerEdge R640". */
  name: string;
  category: Category;
  heightU: number;
  depthMm: number;
  weightKg: number;
  /** Max power draw in watts. 0 for devices that only supply power (UPS/PDU). */
  powerW: number;
  /** For UPS/PDU: how much power this device can supply downstream. */
  powerCapacityW?: number;
  /** PDU outlet count. */
  outlets?: number;
  /** Servers: 1 or 2. A value of 2 means the server needs A+B feeds. */
  psuCount?: number;
  /** Switches: network ports provided. */
  netPorts?: number;
  /** Servers: NICs needing a switch port. */
  netPortsNeeded?: number;
  /** If true, this device occupies the full rack depth and blocks the opposite face. */
  fullDepth: boolean;
  priceUsd: number;
  /**
   * Provenance, because this tool's whole premise is not overclaiming.
   * `netbox` = source device from the CC0 NetBox device-type library;
   * `custom` = user-created device. `estimated` marks fields we estimated or
   * the user changed from source values.
   */
  source: "netbox" | "generic" | "custom";
  estimated: EstimatedField[];
}

export interface Placement {
  id: string;
  catalogId: string;
  startU: number;
  face: Face;
  /** Power feed, for PDUs/UPS only. */
  feed?: "A" | "B";
}

export interface Rack {
  id: string;
  name: string;
  heightU: number;
  mountingDepthMm: number;
  maxLoadKg: number;
  powerBudgetW: number;
}

export interface Design {
  rack: Rack;
  placements: Placement[];
  version: number;
  /** Custom devices and per-design overrides of built-in device specs. */
  catalogOverrides?: CatalogItem[];
}

export interface Requirements {
  rackHeightU: number;
  powerBudgetW: number;
  budgetUsd?: number;
  redundantPower: boolean;
  required: { category: Category; qty: number; notes?: string }[];
}

export type PatchOp =
  | { op: "add"; catalogId: string; startU: number; face: Face; feed?: "A" | "B" }
  | { op: "move"; placementId: string; newStartU: number; newFace?: Face }
  | { op: "remove"; placementId: string }
  | { op: "replace"; placementId: string; newCatalogId: string };

export interface Patch {
  ops: PatchOp[];
  rationale: string;
}

export type ErrorCode =
  | "UNKNOWN_CATALOG_ID"
  | "RACK_OUT_OF_BOUNDS"
  | "RACK_OVERLAP"
  | "DEPTH_EXCEEDED"
  | "WEIGHT_EXCEEDED"
  | "POWER_BUDGET_EXCEEDED"
  | "POWER_HEADROOM_LOW"
  | "PDU_OUTLETS_INSUFFICIENT"
  | "REDUNDANCY_SINGLE_FEED"
  | "REDUNDANCY_DEVICE_PSU"
  | "REDUNDANCY_FEED_OUTLETS_INSUFFICIENT"
  | "NETWORK_PORTS_INSUFFICIENT"
  | "BUDGET_EXCEEDED"
  | "REQUIREMENT_MISSING";

export interface Violation {
  code: ErrorCode;
  severity: "hard" | "soft";
  message: string;
  placementIds: string[];
  details?: Record<string, number | string>;
}

export type OptimisationObjective = "valid" | "cost" | "headroom" | "spareU";
