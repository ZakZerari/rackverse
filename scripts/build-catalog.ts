// Regenerates src/data/catalog.ts from the NetBox device-type library.
//
//   npm run build-catalog
//
// Source: https://github.com/netbox-community/devicetype-library (CC0-1.0,
// public domain — no attribution required, though it's earned). Real
// manufacturers, models, rack units, depth class, weights, PSU and port
// counts. What the library does NOT carry, we estimate and label as such in
// each item's `estimated` array:
//   - priceUsd        — no open dataset of list prices exists at all.
//   - depthMm         — the library only has a boolean is_full_depth.
//   - powerW (some)   — only ~44% of rack devices publish maximum_draw;
//                       notably 0% of Dell/Cisco/Lenovo/Supermicro 2U+ servers.
//   - powerCapacityW  — derived from the inlet plug standard where absent.
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { parse } from "yaml";
import type { Category, EstimatedField } from "@/lib/types";

const RAW_BASE = "https://raw.githubusercontent.com/netbox-community/devicetype-library/master/device-types";
const OUT_PATH = join(process.cwd(), "src", "data", "catalog.ts");

interface Pick {
  /** "<Manufacturer>/<File-stem>" — the extension is probed (.yaml then .yml). */
  path: string;
  category: Category;
  /** Fallback watts when the library has no maximum_draw for this device. */
  estimatedPowerW?: number;
  /** Fallback supply capacity for UPS/PDU when the plug type doesn't settle it. */
  estimatedCapacityW?: number;
  priceUsd: number;
}

// Curated for category coverage and data completeness. Vendors chosen because
// they actually populate weight/draw (Cisco, HPE, Arista, Ubiquiti, APC, Eaton).
const PICKS: Pick[] = [
  // --- Servers: 1U (these genuinely publish maximum_draw) ---
  { path: "Dell/PowerEdge-R640", category: "server", priceUsd: 7200 },
  { path: "Dell/PowerEdge-R630", category: "server", estimatedPowerW: 495, priceUsd: 4800 },
  { path: "Supermicro/SYS-1027R-WRF", category: "server", priceUsd: 3100 },
  { path: "Fujitsu/primergy-rx2530-m6", category: "server", priceUsd: 6400 },
  { path: "HPE/ProLiant-DL360-Gen10", category: "server", estimatedPowerW: 800, priceUsd: 7600 },
  { path: "Dell/PowerEdge-R340", category: "server", estimatedPowerW: 350, priceUsd: 2300 },

  // --- Servers: 2U / 4U (library has weight+geometry, rarely watts) ---
  { path: "Dell/PowerEdge-R740", category: "server", estimatedPowerW: 1100, priceUsd: 11500 },
  { path: "Dell/PowerEdge-R750", category: "server", estimatedPowerW: 1400, priceUsd: 15800 },
  { path: "HPE/ProLiant-DL380-Gen10", category: "server", estimatedPowerW: 1200, priceUsd: 12400 },
  { path: "Supermicro/SYS-2029U-E1CR25M", category: "server", estimatedPowerW: 1300, priceUsd: 9800 },
  { path: "Dell/PowerEdge-R940", category: "server", estimatedPowerW: 2000, priceUsd: 28000 },
  // Real 4U 8-GPU chassis. No GPU-class server in the library publishes
  // maximum_draw, so the 3.2kW figure is ours and flagged as estimated.
  { path: "Supermicro/AS-4125GS-TNRT", category: "server", estimatedPowerW: 3200, priceUsd: 52000 },

  // --- Switches: 24-port ---
  { path: "Cisco/C1200-24P-4G", category: "switch", priceUsd: 1900 },
  { path: "Fortinet/FS-124E-FPOE", category: "switch", priceUsd: 2200 },
  { path: "Brocade/ICX-6450-24p", category: "switch", priceUsd: 1400 },
  { path: "Ubiquiti/USW-Pro-24-PoE", category: "switch", priceUsd: 1600 },

  // --- Switches: 48-port ---
  { path: "Arista/CCS-720DF-48Y-2F", category: "switch", priceUsd: 12500 },
  { path: "Alcatel-Lucent/OS6860-48", category: "switch", priceUsd: 6800 },
  { path: "Ubiquiti/USW-Pro-48-PoE", category: "switch", priceUsd: 2400 },
  { path: "Brocade/ICX-6430-48", category: "switch", priceUsd: 2100 },
  { path: "Juniper/EX4300-48T", category: "switch", estimatedPowerW: 350, priceUsd: 9200 },

  // --- UPS ---
  { path: "APC/SMC3000RMI2U", category: "ups", estimatedCapacityW: 2100, priceUsd: 1800 },
  { path: "APC/SRTG6KXLI-NCLI", category: "ups", estimatedCapacityW: 6000, priceUsd: 6900 },
  { path: "Eaton/5PX1500IRT", category: "ups", estimatedCapacityW: 1350, priceUsd: 1100 },
  { path: "Eaton/5PX2200IRT", category: "ups", estimatedCapacityW: 1980, priceUsd: 1650 },

  // --- PDUs: 0U vertical ---
  { path: "APC/AP7868", category: "pdu", estimatedCapacityW: 12500, priceUsd: 1500 },
  { path: "Eaton/EMAB33", category: "pdu", estimatedCapacityW: 22000, priceUsd: 2100 },
  { path: "Ubiquiti/USP-PDU-HD", category: "pdu", estimatedCapacityW: 7400, priceUsd: 1200 },

  // --- PDUs: 1U horizontal ---
  { path: "APC/AP4433", category: "pdu", estimatedCapacityW: 5500, priceUsd: 900 },

  // --- Storage ---
  { path: "HPE/hpe-msa-2040-lff-chassis-ac", category: "storage", priceUsd: 14000 },
  { path: "HPE/hpe-msa-2060-lff-chassis", category: "storage", estimatedPowerW: 580, priceUsd: 19500 },
  { path: "Dell/PowerVault-ME4024", category: "storage", estimatedPowerW: 560, priceUsd: 17000 },
  { path: "Synology/RS1221-plus", category: "storage", estimatedPowerW: 250, priceUsd: 2200 },

  // --- Patch panels and blanks (Generic/, unbranded by design) ---
  { path: "Generic/24-port-copper-patch-panel", category: "patch", priceUsd: 160 },
  { path: "Generic/48-port-copper-patch-panel", category: "patch", priceUsd: 240 },
  { path: "Generic/LC-12-port-fiber-patch-panel", category: "patch", priceUsd: 320 },
  { path: "Generic/Blanking-Panel-1U", category: "blank", priceUsd: 15 },
  { path: "Generic/Blanking-Panel-2U", category: "blank", priceUsd: 25 },
  { path: "Generic/Blanking-Panel-4U", category: "blank", priceUsd: 40 },
];

interface NetBoxDevice {
  manufacturer: string;
  model: string;
  slug: string;
  u_height: number;
  is_full_depth?: boolean;
  weight?: number;
  weight_unit?: "kg" | "g" | "lb" | "oz";
  "power-ports"?: { name: string; type?: string; maximum_draw?: number }[];
  "power-outlets"?: { name: string; type?: string }[];
  interfaces?: { name: string; type: string; mgmt_only?: boolean }[];
  "rear-ports"?: { name: string; type: string; positions?: number }[];
  "front-ports"?: { name: string; type: string }[];
}

const WEIGHT_TO_KG: Record<string, number> = { kg: 1, g: 0.001, lb: 0.45359237, oz: 0.02834952 };

/** Inlet plug standard -> continuous-load watts (amps x volts x 0.8 derate). */
const PLUG_CAPACITY_W: Record<string, number> = {
  "iec-60320-c14": 1840, // 10A @ 230V
  "iec-60320-c20": 2944, // 16A @ 230V
  "nema-5-15p": 1440, // 15A @ 120V
  "nema-5-20p": 1920, // 20A @ 120V
  "nema-l5-30p": 2880, // 30A @ 120V
  "nema-l6-20p": 3328, // 20A @ 208V
  "nema-l6-30p": 4992, // 30A @ 208V
  "iec-60309-2p-e-4h": 3680, // 16A @ 230V
  "iec-60309-2p-e-6h": 7360, // 32A @ 230V
  "iec-60309-3p-e-4h": 11040,
  "iec-60309-3p-e-6h": 22080,
};

async function fetchDevice(stem: string): Promise<NetBoxDevice | null> {
  // 397 files use .yml rather than .yaml, and 49 directories contain spaces.
  const encoded = stem.split("/").map(encodeURIComponent).join("/");
  for (const ext of [".yaml", ".yml"]) {
    const res = await fetch(`${RAW_BASE}/${encoded}${ext}`);
    if (res.ok) return parse(await res.text()) as NetBoxDevice;
  }
  return null;
}

function slugify(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/(^-|-$)/g, "");
}

/** Estimated, since the library only records a full-depth boolean. */
function estimateDepthMm(device: NetBoxDevice, category: Category): number {
  if (category === "patch" || category === "blank") return 120;
  if (category === "pdu") return device.u_height === 0 ? 140 : 320;
  if (device.is_full_depth) return category === "server" || category === "storage" ? 780 : 700;
  return category === "switch" ? 460 : 520;
}

function buildItem(device: NetBoxDevice, pick: Pick) {
  const estimated: EstimatedField[] = ["priceUsd", "depthMm"];

  const powerPorts = device["power-ports"] ?? [];
  const draws = powerPorts.map((p) => p.maximum_draw).filter((d): d is number => typeof d === "number");
  // max(), not sum(): multiple power ports are redundant feeds, not additive load.
  const realDraw = draws.length > 0 ? Math.max(...draws) : undefined;

  const isSupplier = pick.category === "pdu" || pick.category === "ups";
  const isPassive = pick.category === "patch" || pick.category === "blank";
  let powerW = 0;
  if (!isSupplier && !isPassive) {
    if (realDraw !== undefined) {
      powerW = realDraw;
    } else {
      // A powered device must never land on 0W — that would hand the planner
      // free capacity and quietly invalidate every power check downstream.
      powerW = pick.estimatedPowerW ?? defaultPowerW(pick.category, device.u_height);
      estimated.push("powerW");
    }
  }

  let powerCapacityW: number | undefined;
  if (isSupplier) {
    const inletType = powerPorts[0]?.type;
    const fromPlug = inletType ? PLUG_CAPACITY_W[inletType] : undefined;
    powerCapacityW = fromPlug ?? pick.estimatedCapacityW;
    if (fromPlug === undefined) estimated.push("powerCapacityW");
  }

  const weightKg =
    device.weight !== undefined && device.weight_unit
      ? Math.round(device.weight * (WEIGHT_TO_KG[device.weight_unit] ?? 1) * 10) / 10
      : undefined;
  if (weightKg === undefined) estimated.push("weightKg");

  const dataPorts = (device.interfaces ?? []).filter((i) => !i.mgmt_only);


  const model = stripManufacturerPrefix(device.manufacturer, device.model);
  const base = {
    id: slugify(`${device.manufacturer}-${model}`),
    manufacturer: device.manufacturer,
    name: model,
    category: pick.category,
    heightU: device.u_height,
    depthMm: estimateDepthMm(device, pick.category),
    weightKg: weightKg ?? fallbackWeight(pick.category, device.u_height),
    powerW,
    fullDepth: device.is_full_depth === true,
    priceUsd: pick.priceUsd,
    source: "netbox" as const,
    estimated,
  };

  return {
    ...base,
    ...(powerCapacityW !== undefined ? { powerCapacityW } : {}),
    ...(pick.category === "pdu" ? { outlets: (device["power-outlets"] ?? []).length } : {}),
    ...(pick.category === "server" || pick.category === "storage"
      ? { psuCount: Math.max(1, powerPorts.length), netPortsNeeded: Math.max(1, dataPorts.length) }
      : {}),
    ...(pick.category === "switch" ? { netPorts: dataPorts.length } : {}),
  };
}

function fallbackWeight(category: Category, heightU: number): number {
  if (category === "patch") return 2.5;
  if (category === "blank") return 0.4 * Math.max(1, heightU);
  return Math.max(2, heightU * 9);
}

function defaultPowerW(category: Category, heightU: number): number {
  if (category === "switch") return 150;
  if (category === "storage") return 300 * Math.max(1, heightU / 2);
  return 400 * Math.max(1, heightU);
}

/** Models are sometimes stored with the vendor already in the string ("HPE MSA 2040"). */
function stripManufacturerPrefix(manufacturer: string, model: string): string {
  const prefix = `${manufacturer} `;
  return model.toLowerCase().startsWith(prefix.toLowerCase()) ? model.slice(prefix.length) : model;
}

function serialise(items: ReturnType<typeof buildItem>[]): string {
  const header = `import type { CatalogItem } from "@/lib/types";

// GENERATED by \`npm run build-catalog\` — do not edit by hand.
//
// Real hardware from the NetBox device-type library
// (https://github.com/netbox-community/devicetype-library), CC0-1.0 public
// domain. Manufacturer, model, rack units, full-depth flag, weight, PSU count
// and port counts come straight from that data.
//
// Each item's \`estimated\` array lists what we filled in ourselves, because the
// library doesn't carry it: prices (no open dataset of list prices exists),
// depth in mm (the library only has a full-depth boolean), power draw for the
// ~56% of rack devices that don't publish maximum_draw, and supply capacity
// where the inlet plug standard didn't settle it.

export const CATALOG: CatalogItem[] = ${JSON.stringify(items, null, 2)};

export function getCatalogItem(id: string): CatalogItem | undefined {
  return CATALOG.find((item) => item.id === id);
}

/** Compact summary for LLM prompts — ids and specs, no prose. */
export function catalogSummary(): string {
  return CATALOG.map((c) =>
    JSON.stringify({
      id: c.id,
      name: \`\${c.manufacturer} \${c.name}\`,
      category: c.category,
      heightU: c.heightU,
      depthMm: c.depthMm,
      weightKg: c.weightKg,
      powerW: c.powerW,
      ...(c.powerCapacityW ? { powerCapacityW: c.powerCapacityW } : {}),
      ...(c.outlets ? { outlets: c.outlets } : {}),
      ...(c.psuCount ? { psuCount: c.psuCount } : {}),
      ...(c.netPorts ? { netPorts: c.netPorts } : {}),
      ...(c.netPortsNeeded ? { netPortsNeeded: c.netPortsNeeded } : {}),
      fullDepth: c.fullDepth,
      priceUsd: c.priceUsd,
    })
  ).join("\\n");
}
`;
  return header;
}

async function main() {
  console.log(`Fetching ${PICKS.length} device types from the NetBox library (CC0-1.0)...\n`);

  const settled = await Promise.all(
    PICKS.map(async (pick) => {
      const device = await fetchDevice(pick.path);
      return { pick, device };
    })
  );

  const items: ReturnType<typeof buildItem>[] = [];
  const missing: string[] = [];

  for (const { pick, device } of settled) {
    if (!device) {
      missing.push(pick.path);
      continue;
    }
    const item = buildItem(device, pick);
    items.push(item);
    const flags = item.estimated.length > 0 ? `  est: ${item.estimated.join(",")}` : "";
    console.log(
      `  ${item.manufacturer} ${item.name}`.padEnd(46) +
        `${item.heightU}U ${String(item.powerW).padStart(4)}W ${String(item.weightKg).padStart(5)}kg${flags}`
    );
  }

  if (missing.length > 0) {
    console.log(`\n${missing.length} not found (path or extension wrong):`);
    for (const m of missing) console.log(`  ${m}`);
  }

  items.sort((a, b) => a.category.localeCompare(b.category) || a.heightU - b.heightU);
  writeFileSync(OUT_PATH, serialise(items));

  const realPower = items.filter((i) => !i.estimated.includes("powerW")).length;
  const realWeight = items.filter((i) => !i.estimated.includes("weightKg")).length;
  console.log(
    `\nWrote ${items.length} items to src/data/catalog.ts` +
      `\n  real power draw: ${realPower}/${items.length}` +
      `\n  real weight:     ${realWeight}/${items.length}` +
      `\n  prices + depth are estimated for all (no open source for either).`
  );
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
