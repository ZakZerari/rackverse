"use client";

import { catalogItemFor } from "@/lib/catalog";
import type { Category, Design } from "@/lib/types";
import styles from "./RackThumbnail.module.css";

/**
 * A rack card's portrait: the real elevation, at true U positions, in
 * miniature.
 *
 * The previous card art was the same sixteen-slot graphic for every rack, so
 * a 48U GPU cluster and an empty 24U edge box were indistinguishable at a
 * glance — decoration where the one thing a fleet view owes you is "which
 * rack is this?". Here the silhouette is the rack: heights, gaps, categories
 * and faults all read from the design itself.
 */

const CATEGORY_TONE: Record<Category, string> = {
  server: styles.server,
  switch: styles.switchDevice,
  storage: styles.storage,
  ups: styles.ups,
  pdu: styles.pdu,
  patch: styles.patch,
  blank: styles.blank,
};

export interface RackThumbnailProps {
  design: Design;
  /** Placements in a hard violation — drawn in the fault tone. */
  violatedIds?: Set<string>;
  /** Decorative in a card; the card's link already carries the label. */
  label?: string;
}

export function RackThumbnail({ design, violatedIds, label }: RackThumbnailProps) {
  const heightU = Math.max(design.rack.heightU, 1);

  const mounted = design.placements
    .map((placement) => {
      const item = catalogItemFor(design, placement.catalogId);
      if (!item || item.heightU <= 0) return null;
      // U1 is the bottom, so a device's distance from the top is measured
      // from the unit above its highest occupied U.
      const topU = heightU - (placement.startU + item.heightU - 1);
      return {
        id: placement.id,
        category: item.category,
        topPct: (topU / heightU) * 100,
        heightPct: (item.heightU / heightU) * 100,
        faulted: violatedIds?.has(placement.id) ?? false,
      };
    })
    .filter((device): device is NonNullable<typeof device> => device !== null);

  // 0U gear (vertical PDUs) hangs off the rails rather than consuming units.
  const sideMounted = design.placements.filter((placement) => {
    const item = catalogItemFor(design, placement.catalogId);
    return item !== undefined && item.heightU <= 0;
  }).length;

  return (
    <div className={styles.frame} aria-hidden="true" data-empty={mounted.length === 0}>
      <span className={styles.rail} />
      <div className={styles.cavity}>
        {mounted.map((device) => (
          <span
            key={device.id}
            className={[styles.device, CATEGORY_TONE[device.category], device.faulted ? styles.faulted : ""]
              .filter(Boolean)
              .join(" ")}
            style={{ top: `${device.topPct}%`, height: `calc(${device.heightPct}% - 1px)` }}
          >
            <i className={styles.led} />
          </span>
        ))}
        {mounted.length === 0 && <span className={styles.emptyHint} />}
      </div>
      <span className={styles.rail} data-side={sideMounted > 0 ? "fed" : undefined} />
      {label && <span className={styles.label}>{label}</span>}
    </div>
  );
}
