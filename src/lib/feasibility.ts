import type { Category, CatalogItem, Requirements } from "@/lib/types";

/**
 * Deterministically asks "could ANY design possibly satisfy these
 * requirements?" — before an agent spends calls trying.
 *
 * The bug this exists to fix: asked to hit a budget while keeping redundant
 * A/B power and a server count, RepairAgent oscillated forever between two
 * moves — cheap single-PSU servers (fixes budget, breaks redundancy) and
 * dual-PSU servers (fixes redundancy, breaks budget) — because no patch
 * exists that fixes both at once. The loop wasn't broken; the request was
 * unsatisfiable, and nothing ever told the user that. "AI proposes, code
 * decides" means code should decide THIS too, deterministically and before
 * burning a round trip, not discover it empirically after several.
 *
 * `estimateMinimumViableDesign` prices the cheapest possible pick for every
 * required category — the cheapest dual-PSU server when redundancy is asked
 * for, the cheapest PDU pair that can carry the load, enough of the cheapest
 * switch to cover the ports those picks need. That is a genuine LOWER BOUND:
 * nothing shaped like the brief can cost, draw, or occupy less. So if the
 * bound already exceeds a limit, every real design does too — this is a
 * sound proof of infeasibility, not a guess. It is NOT a lower bound on an
 * optimal design in general (a fuller search could trade categories against
 * each other), so a result UNDER a limit proves nothing and is never acted
 * on — callers only ever use this to detect genuine impossibility, never to
 * confirm feasibility.
 */

function cheapest(items: CatalogItem[]): CatalogItem | undefined {
  return items.reduce<CatalogItem | undefined>(
    (best, item) => (!best || item.priceUsd < best.priceUsd ? item : best),
    undefined
  );
}

export interface MinimumDesignEstimate {
  costUsd: number;
  powerW: number;
  heightU: number;
  weightKg: number;
  /** A required category with no catalog item at all — distinct from "too
   *  expensive": nothing can ever satisfy it. Not expected with the shipped
   *  catalog, which stocks every category; kept so this never silently
   *  prices a category at $0 instead of saying it can't be priced. */
  impossibleCategories: Category[];
  /** The server picked for the bound, so a caller can turn "$30,600 is over
   *  budget" into "that's $3,100 a head — about 6 would fit $25k, not 8". */
  server: { item: CatalogItem; qty: number } | null;
}

/** Outlets a device would draw on a PDU — mirrors validateDesign exactly. */
function outletsNeeded(item: CatalogItem): number {
  if (item.category === "server") return item.psuCount ?? 1;
  if (item.category === "switch" || item.category === "storage") return 1;
  return 0;
}

const SIMPLE_CATEGORIES: Category[] = ["ups", "patch", "blank"];

export function estimateMinimumViableDesign(
  requirements: Requirements,
  catalog: CatalogItem[]
): MinimumDesignEstimate {
  const impossibleCategories: Category[] = [];
  const qtyOf = (category: Category) =>
    requirements.required.find((r) => r.category === category)?.qty ?? 0;

  // Servers: dual-PSU only if redundant power was asked for — the one choice
  // that interacts with everything else (power, outlets, PDU selection).
  const serverQty = qtyOf("server");
  const serverPool = requirements.redundantPower
    ? catalog.filter((item) => item.category === "server" && (item.psuCount ?? 1) >= 2)
    : catalog.filter((item) => item.category === "server");
  const server = serverQty > 0 ? cheapest(serverPool) : undefined;
  if (serverQty > 0 && !server) impossibleCategories.push("server");

  const storageQty = qtyOf("storage");
  const storage = storageQty > 0 ? cheapest(catalog.filter((item) => item.category === "storage")) : undefined;
  if (storageQty > 0 && !storage) impossibleCategories.push("storage");

  // Everything else requested stacks in without touching power/port/outlet math.
  let simpleCostUsd = 0;
  let simpleHeightU = 0;
  let simpleWeightKg = 0;
  let simplePowerW = 0;
  for (const category of SIMPLE_CATEGORIES) {
    const qty = qtyOf(category);
    if (qty <= 0) continue;
    const pick = cheapest(catalog.filter((item) => item.category === category));
    if (!pick) {
      impossibleCategories.push(category);
      continue;
    }
    simpleCostUsd += pick.priceUsd * qty;
    simpleHeightU += Math.max(pick.heightU, 0) * qty;
    simpleWeightKg += pick.weightKg * qty;
    simplePowerW += pick.powerW * qty;
  }

  // Switches: the validator enforces NETWORK_PORTS_INSUFFICIENT regardless of
  // whether "switch" appears in `required`, so the port math runs even when
  // the brief never mentions one — same reasoning the Architect/Editor already
  // follow.
  const portsNeeded =
    (server ? (server.netPortsNeeded ?? 0) * serverQty : 0) +
    (storage ? (storage.netPortsNeeded ?? 0) * storageQty : 0);
  const cheapestSwitch = cheapest(catalog.filter((item) => item.category === "switch"));
  const switchQtyForPorts =
    cheapestSwitch && portsNeeded > 0 ? Math.ceil(portsNeeded / Math.max(1, cheapestSwitch.netPorts ?? 1)) : 0;
  const switchQty = Math.max(qtyOf("switch"), switchQtyForPorts);
  if (switchQty > 0 && !cheapestSwitch) impossibleCategories.push("switch");

  const totalPowerW =
    (server ? server.powerW * serverQty : 0) +
    (storage ? storage.powerW * storageQty : 0) +
    (cheapestSwitch ? cheapestSwitch.powerW * switchQty : 0) +
    simplePowerW;

  // PDUs: same reasoning as switches — always priced in, never gated on
  // `required` mentioning "pdu", because validateDesign never gates on that
  // either (PDU_OUTLETS_INSUFFICIENT and the two REDUNDANCY_* codes fire on
  // outlet/capacity math alone).
  const dualPsuServerCount = requirements.redundantPower && server ? serverQty : 0;
  let pduCostUsd = 0;
  let pduHeightU = 0;
  if (requirements.redundantPower) {
    // One PDU model, used on both feeds: it must carry the WHOLE load alone
    // (a surviving feed covers for a dead one) and give every dual-PSU
    // server its own outlet on each side.
    const pdu = cheapest(
      catalog.filter(
        (item) =>
          item.category === "pdu" &&
          (item.powerCapacityW ?? 0) >= totalPowerW &&
          (item.outlets ?? 0) >= dualPsuServerCount
      )
    );
    if (pdu) {
      pduCostUsd = pdu.priceUsd * 2;
      pduHeightU = Math.max(pdu.heightU, 0) * 2;
    } else if (dualPsuServerCount > 0 || totalPowerW > 0) {
      impossibleCategories.push("pdu");
    }
  } else {
    const outletsRequired =
      (server ? outletsNeeded(server) * serverQty : 0) +
      (storage ? outletsNeeded(storage) * storageQty : 0) +
      (cheapestSwitch ? switchQty : 0);
    if (outletsRequired > 0) {
      const pdu = cheapest(catalog.filter((item) => item.category === "pdu" && (item.outlets ?? 0) > 0));
      if (pdu) {
        const units = Math.ceil(outletsRequired / (pdu.outlets ?? 1));
        pduCostUsd = pdu.priceUsd * units;
        pduHeightU = Math.max(pdu.heightU, 0) * units;
      } else {
        impossibleCategories.push("pdu");
      }
    }
  }

  const costUsd =
    (server ? server.priceUsd * serverQty : 0) +
    (storage ? storage.priceUsd * storageQty : 0) +
    (cheapestSwitch ? cheapestSwitch.priceUsd * switchQty : 0) +
    simpleCostUsd +
    pduCostUsd;

  const heightU =
    (server ? Math.max(server.heightU, 0) * serverQty : 0) +
    (storage ? Math.max(storage.heightU, 0) * storageQty : 0) +
    (cheapestSwitch ? Math.max(cheapestSwitch.heightU, 0) * switchQty : 0) +
    simpleHeightU +
    pduHeightU;

  const weightKg =
    (server ? server.weightKg * serverQty : 0) +
    (storage ? storage.weightKg * storageQty : 0) +
    (cheapestSwitch ? cheapestSwitch.weightKg * switchQty : 0) +
    simpleWeightKg;

  return {
    costUsd,
    powerW: totalPowerW,
    heightU,
    weightKg,
    impossibleCategories,
    server: server ? { item: server, qty: serverQty } : null,
  };
}

export interface InfeasibilityReport {
  /** Plain-English, user-facing. Always non-empty when this type is returned. */
  reasons: string[];
  /** Concrete relaxations computed from the same bound, not guessed. */
  suggestions: string[];
  minCostUsd: number;
}

/**
 * Returns a report only when the requirements are PROVABLY unsatisfiable —
 * the lower bound itself breaks a limit. Returns null otherwise, including
 * whenever the bound merely looks tight: a null here is not a claim that a
 * real design exists, only that this check found no proof it can't.
 */
export function explainInfeasibility(
  requirements: Requirements,
  catalog: CatalogItem[]
): InfeasibilityReport | null {
  const min = estimateMinimumViableDesign(requirements, catalog);
  const reasons: string[] = [];
  const suggestions: string[] = [];

  if (min.impossibleCategories.length > 0) {
    reasons.push(`No catalog equipment exists for: ${min.impossibleCategories.join(", ")}.`);
  }

  const overBudget = requirements.budgetUsd !== undefined && min.costUsd > requirements.budgetUsd;
  if (overBudget) {
    const budgetUsd = requirements.budgetUsd as number;
    reasons.push(
      `Even the cheapest valid configuration costs about $${Math.round(min.costUsd).toLocaleString()} — ` +
        `$${Math.round(min.costUsd - budgetUsd).toLocaleString()} over the $${budgetUsd.toLocaleString()} budget.`
    );

    if (requirements.redundantPower) {
      const withoutRedundancy = estimateMinimumViableDesign({ ...requirements, redundantPower: false }, catalog);
      if (withoutRedundancy.costUsd < min.costUsd) {
        suggestions.push(
          withoutRedundancy.costUsd <= budgetUsd
            ? `Dropping redundant A/B power would bring the minimum to about $${Math.round(withoutRedundancy.costUsd).toLocaleString()} — within budget.`
            : `Dropping redundant A/B power would bring the minimum to about $${Math.round(withoutRedundancy.costUsd).toLocaleString()} — still over budget.`
        );
      }
    }

    if (min.server && min.server.qty > 0) {
      const perServerUsd = min.server.item.priceUsd;
      const serverWord = requirements.redundantPower ? "dual-PSU server" : "server";
      const fixedCostUsd = min.costUsd - perServerUsd * min.server.qty;
      const maxServers = Math.max(0, Math.floor((budgetUsd - fixedCostUsd) / perServerUsd));
      if (maxServers === 0) {
        // "fits about 0 instead of N" reads like a bug report, not an answer —
        // say plainly that no count of this device fits at all.
        suggestions.push(
          `Even a single $${perServerUsd.toLocaleString()} ${serverWord} doesn't fit in a $${budgetUsd.toLocaleString()} budget once the rest of the build is paid for.`
        );
      } else if (maxServers < min.server.qty) {
        suggestions.push(
          `At $${perServerUsd.toLocaleString()} for the cheapest ${serverWord}, the budget fits about ${maxServers} instead of ${min.server.qty}.`
        );
      }
    }
  }

  if (min.powerW > requirements.powerBudgetW) {
    reasons.push(
      `Even the lowest-draw configuration needs about ${(min.powerW / 1000).toFixed(1)}kW, ` +
        `more than the ${(requirements.powerBudgetW / 1000).toFixed(1)}kW power budget.`
    );
  }

  if (min.heightU > requirements.rackHeightU) {
    reasons.push(
      `Even the most compact configuration needs about ${min.heightU}U, more than the ${requirements.rackHeightU}U rack.`
    );
  }

  if (reasons.length === 0) return null;
  return { reasons, suggestions, minCostUsd: min.costUsd };
}
