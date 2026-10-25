"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { ArrowUpRight, RotateCcw, Zap } from "lucide-react";
import { useFleetStore } from "@/lib/fleet";
import { createDemoRack } from "@/lib/demoRack";
import { applyChaosPreset } from "@/lib/scenarios";
import { designTotals } from "@/lib/summary";
import { hardViolations, validateDesign } from "@/lib/validate";
import styles from "./landing.module.css";

const base = createDemoRack();
const rows = [
  { u: "42", label: "RESERVED CAPACITY", kind: "empty" },
  { u: "32", label: "FUTURE EXPANSION", kind: "empty" },
  { u: "24", label: "FUTURE EXPANSION", kind: "empty" },
  { u: "16", label: "CABLE MANAGEMENT", kind: "empty" },
  { u: "09", label: "AIR GAP", kind: "empty" },
  { u: "08", label: "SYNOLOGY / STORAGE", kind: "storage" },
  { u: "07", label: "BROCADE / 48 PORT", kind: "switch" },
  { u: "06", label: "COMPUTE NODE 06", kind: "server" },
  { u: "05", label: "COMPUTE NODE 05", kind: "server" },
  { u: "04", label: "COMPUTE NODE 04", kind: "server" },
  { u: "03", label: "COMPUTE NODE 03", kind: "server" },
  { u: "02", label: "COMPUTE NODE 02", kind: "server" },
  { u: "01", label: "COMPUTE NODE 01", kind: "server" },
] as const;

export function RackPreview() {
  const router = useRouter();
  const [powerCut, setPowerCut] = useState(false);
  const [opening, setOpening] = useState(false);
  const scenario = powerCut ? applyChaosPreset(base.design, base.requirements, "power_cut") : base;
  const hard = hardViolations(validateDesign(scenario.design, scenario.requirements));
  const totals = designTotals(scenario.design);

  function openScenario() {
    if (opening) return;
    setOpening(true);
    const fleet = useFleetStore.getState();
    fleet.hydrate();
    const id = fleet.createRack("Power cut demonstration");
    const startingRack = createDemoRack(id, "Power cut demonstration");
    const damaged = applyChaosPreset(startingRack.design, startingRack.requirements, "power_cut");
    fleet.saveRack(id, {
      design: damaged.design,
      requirements: damaged.requirements,
      versions: [startingRack.design, damaged.design],
      turns: [],
    });
    fleet.flush();
    router.push(`/racks/${id}`);
  }

  return (
    <div className={styles.preview} aria-label="Interactive rack validation preview">
      <div className={styles.previewChrome}>
        <div className={styles.chromeLeft}><span className={styles.chromeOrb} /> RACKOS / LIVE SCHEMATIC</div>
        <div className={styles.chromeRight}>RV–042 <span>·</span> 42U</div>
      </div>

      <div className={styles.previewScene}>
        <div className={styles.sonarRingOne} aria-hidden="true" />
        <div className={styles.sonarRingTwo} aria-hidden="true" />
        <div className={styles.sonarRingThree} aria-hidden="true" />
        <div className={styles.scanBeam} aria-hidden="true" />
        <div className={styles.verticalMeasure} aria-hidden="true">42U<br />↑</div>
        <div className={`${styles.rackBody} ${powerCut ? styles.rackBodyFault : ""}`}>
          <div className={styles.rackInner}>
            {rows.map((row) => (
              <div key={row.u} className={`${styles.rackRow} ${styles[`rackRow_${row.kind}`]}`}>
                <span className={styles.rackU}>U{row.u}</span>
                <span className={styles.rackRowLabel}>{row.label}</span>
                {row.kind !== "empty" && <span className={styles.rackLeds} aria-hidden="true"><i /><i /><i /></span>}
              </div>
            ))}
          </div>
          <div className={styles.rackFeet}><span /><span /></div>
        </div>
        <div className={styles.feedRailA}><span>FEED A</span><i /></div>
        <div className={styles.feedRailB}><span>FEED B</span><i /></div>
        <div className={styles.sceneTag}>DESIGN / REV 01 <span>·</span> FRONT ELEVATION</div>
      </div>

      <div className={styles.previewStatus} aria-live="polite">
        <div className={styles.previewStatusTop}>
          <span className={styles.previewEyebrow}>DETERMINISTIC CHECK</span>
          <span className={`${styles.statusPill} ${powerCut ? styles.statusPillFault : ""}`}>
            <span /> {hard.length === 0 ? "READY TO REVIEW" : `${hard.length} HARD ISSUE${hard.length === 1 ? "" : "S"}`}
          </span>
        </div>
        <div className={styles.previewMetricRow}>
          <div><span>LOAD</span><strong>{(totals.powerW / 1000).toFixed(2)} <small>kW</small></strong></div>
          <div><span>POWER LIMIT</span><strong>{(scenario.design.rack.powerBudgetW / 1000).toFixed(2)} <small>kW</small></strong></div>
          <div><span>VIOLATIONS</span><strong className={powerCut ? styles.faultNumber : ""}>{hard.length.toString().padStart(2, "0")}</strong></div>
        </div>
        <div className={styles.previewControls}>
          <button type="button" className={styles.faultToggle} onClick={() => setPowerCut((value) => !value)}>
            {powerCut ? <RotateCcw size={14} /> : <Zap size={14} />}
            {powerCut ? "Restore utility" : "Cut utility power −30%"}
          </button>
          <button type="button" className={styles.previewOpen} onClick={openScenario} disabled={opening}>
            {opening ? "Opening…" : "Repair in Studio"} <ArrowUpRight size={15} />
          </button>
        </div>
        <p className={styles.previewFootnote}>Real catalog equipment · real validator · power cut creates a saved rack for repair</p>
      </div>
    </div>
  );
}
