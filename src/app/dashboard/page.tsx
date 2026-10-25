"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ArrowRight, ArrowUpRight, Check, ChevronDown, Plus, Search, Trash2, X } from "lucide-react";
import { Brand } from "@/components/Brand";
import { MubitPerformance } from "@/components/dashboard/MubitPerformance";
import { RackThumbnail } from "@/components/dashboard/RackThumbnail";
import { useFleetStore, type RackRecord } from "@/lib/fleet";
import type { GatewayMetrics } from "@/lib/gatewayMetrics";
import type { MubitConsoleSnapshot } from "@/lib/mubitConsoleSnapshot";
import { designTotals } from "@/lib/summary";
import { defaultDesign } from "@/lib/store";
import { validateDesign } from "@/lib/validate";
import type { RackModelMetrics } from "@/lib/rackRuns";
import styles from "./dashboard.module.css";

type Filter = "all" | "attention" | "healthy" | "draft";
const SIZES = [24, 42, 48] as const;

interface Health {
  label: string;
  kind: "draft" | "attention" | "healthy";
  /** Placements in a hard violation, so the thumbnail can show the fault. */
  faultedIds: Set<string>;
}

function rackHealth(rack: RackRecord): Health {
  const hard = validateDesign(rack.design, rack.requirements).filter((v) => v.severity === "hard");
  const faultedIds = new Set(hard.flatMap((v) => v.placementIds));
  if (rack.design.placements.length === 0) return { label: "Draft", kind: "draft", faultedIds };
  if (hard.length > 0) {
    return { label: `${hard.length} issue${hard.length === 1 ? "" : "s"}`, kind: "attention", faultedIds };
  }
  return { label: "Checks passing", kind: "healthy", faultedIds };
}

function RackCard({
  rack,
  metrics,
  index,
  onDelete,
}: {
  rack: RackRecord;
  metrics?: RackModelMetrics;
  index: number;
  onDelete: () => void;
}) {
  const totals = designTotals(rack.design);
  const health = rackHealth(rack);
  const budget = rack.design.rack.powerBudgetW;
  const powerRatio = budget > 0 ? Math.min(100, Math.round((totals.powerW / budget) * 100)) : 0;

  return (
    // `rack-card` is a stable global hook so RackThumbnail can react to hover
    // across the module boundary.
    <article
      className={`${styles.rackCard} rack-card`}
      style={{ "--enter-delay": `${Math.min(index * 45, 360)}ms` } as React.CSSProperties}
    >
      <Link href={`/racks/${rack.id}`} className={styles.rackMain} aria-label={`Open ${rack.design.rack.name}`}>
        <div className={styles.thumb}>
          <RackThumbnail design={rack.design} violatedIds={health.faultedIds} />
        </div>

        <div className={styles.rackInfo}>
          <div className={styles.rackHeading}>
            <h3>{rack.design.rack.name}</h3>
            <ArrowUpRight size={17} className={styles.openIcon} />
          </div>

          <div className={styles.badges}>
            <span className={`${styles.health} ${styles[health.kind]}`}>
              <i />
              {health.label}
            </span>
            <span className={styles.sizeTag}>{rack.design.rack.heightU}U</span>
          </div>

          <div className={styles.powerRow}>
            <span className={styles.powerValue}>
              {(totals.powerW / 1000).toFixed(1)}
              <small> / {(budget / 1000).toFixed(1)} kW</small>
            </span>
            <i className={styles.powerTrack} data-hot={powerRatio > 80 ? "true" : undefined}>
              <b style={{ width: `${powerRatio}%` }} />
            </i>
          </div>

          <dl className={styles.facts}>
            <div>
              <dt>Space</dt>
              <dd>
                {totals.usedU}
                <small>/{rack.design.rack.heightU}U</small>
              </dd>
            </div>
            <div>
              <dt>Cost</dt>
              <dd>${(totals.costUsd / 1000).toFixed(1)}k</dd>
            </div>
            <div>
              <dt>Devices</dt>
              <dd>{totals.deviceCount}</dd>
            </div>
            {metrics?.calls ? (
              <div>
                <dt>Verified</dt>
                <dd>
                  {metrics.verifiedRuns}
                  <small>/{metrics.runs}</small>
                </dd>
              </div>
            ) : null}
          </dl>
        </div>
      </Link>

      <button
        type="button"
        className={styles.deleteRack}
        onClick={onDelete}
        aria-label={`Delete ${rack.design.rack.name}`}
        title="Delete rack"
      >
        <Trash2 size={14} />
      </button>
    </article>
  );
}

export default function DashboardPage() {
  const router = useRouter();
  const racks = useFleetStore((state) => state.racks);
  const hydrated = useFleetStore((state) => state.hydrated);
  const [loadedMetrics, setLoadedMetrics] = useState<{ key: string; metrics: Record<string, RackModelMetrics> } | null>(null);
  const [gateway, setGateway] = useState<GatewayMetrics | null>(null);
  const [mubitSnapshot, setMubitSnapshot] = useState<MubitConsoleSnapshot | null>(null);
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState<Filter>("all");
  const [createOpen, setCreateOpen] = useState(false);
  const [name, setName] = useState("");
  const [size, setSize] = useState<(typeof SIZES)[number]>(42);
  const dialogRef = useRef<HTMLDialogElement>(null);
  const ids = racks.map((rack) => rack.id).join(",");

  useEffect(() => {
    useFleetStore.getState().hydrate();
  }, []);

  useEffect(() => {
    fetch("/api/calls", { cache: "no-store" })
      .then((response) => response.json())
      .then((data) => setGateway(data))
      .catch(() => {});
    fetch("/api/mubit-console-snapshot", { cache: "no-store" })
      .then((response) => response.json())
      .then((body: { available?: boolean; snapshot?: MubitConsoleSnapshot }) =>
        setMubitSnapshot(body.available ? body.snapshot ?? null : null)
      )
      .catch(() => {});
  }, []);

  useEffect(() => {
    if (!hydrated || !ids) return;
    const controller = new AbortController();
    fetch(`/api/rack-metrics?ids=${encodeURIComponent(ids)}`, { signal: controller.signal, cache: "no-store" })
      .then((response) => response.json())
      .then((data: { metrics?: Record<string, RackModelMetrics> }) => {
        if (!controller.signal.aborted) setLoadedMetrics({ key: ids, metrics: data.metrics ?? {} });
      })
      .catch(() => {});
    return () => controller.abort();
  }, [hydrated, ids]);

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;
    if (createOpen && !dialog.open) dialog.showModal();
    if (!createOpen && dialog.open) dialog.close();
  }, [createOpen]);

  function createRack(event: React.FormEvent) {
    event.preventDefault();
    const fleet = useFleetStore.getState();
    const id = fleet.createRack(name);
    // Read the record back from a fresh snapshot: `createRack` has already
    // committed, and the closure's copy predates it.
    const rack = useFleetStore.getState().racks.find((item) => item.id === id);
    if (rack) {
      const design = { ...rack.design, rack: { ...rack.design.rack, heightU: size } };
      fleet.saveRack(id, {
        design,
        requirements: { ...rack.requirements, rackHeightU: size },
        versions: [design],
        turns: [],
      });
      fleet.flush();
    }
    setCreateOpen(false);
    setName("");
    setSize(42);
    router.push(`/racks/${id}`);
  }

  const healthyCount = racks.filter((rack) => rackHealth(rack).kind === "healthy").length;
  const issueCount = racks.filter((rack) => rackHealth(rack).kind === "attention").length;
  const metrics = loadedMetrics?.key === ids ? loadedMetrics.metrics : {};
  const verifiedRuns = racks.reduce((total, rack) => total + (metrics[rack.id]?.verifiedRuns ?? 0), 0);
  const totalRuns = racks.reduce((total, rack) => total + (metrics[rack.id]?.runs ?? 0), 0);

  const visibleRacks = [...racks]
    .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
    .filter((rack) => {
      if (filter !== "all" && rackHealth(rack).kind !== filter) return false;
      return rack.design.rack.name.toLowerCase().includes(query.trim().toLowerCase());
    });

  /** Preview for the create dialog, so the size choice is visible, not abstract. */
  const previewDesign = useMemo(() => defaultDesign("preview", name || "New rack"), [name]);
  const sizedPreview = useMemo(
    () => ({ ...previewDesign, rack: { ...previewDesign.rack, heightU: size } }),
    [previewDesign, size]
  );

  return (
    <main className={styles.page}>
      <header className={styles.nav}>
        <div className={styles.navInner}>
          <Brand compact />
          <nav aria-label="Workspace navigation">
            <Link href="/" className={styles.navQuiet}>
              About RackOS
            </Link>
            <Link href="/lab" className={styles.navQuiet}>
              Model lab <ArrowUpRight size={14} />
            </Link>
          </nav>
        </div>
      </header>

      <div className={styles.shell}>
        {/* One compact bar instead of a full-height hero: on a workspace the
            racks are the content, and everything above them is overhead. */}
        <section className={styles.command} aria-labelledby="workspace-title">
          <div className={styles.commandGlow} aria-hidden="true" />
          <div className={styles.commandTop}>
            <div>
              <p className={styles.eyebrow}>RACKOS / WORKSPACE</p>
              <h1 id="workspace-title">
                Every rack, <em>in view.</em>
              </h1>
            </div>
            <button
              type="button"
              className={styles.createButton}
              onClick={() => setCreateOpen(true)}
              disabled={!hydrated}
            >
              <Plus size={17} /> New rack
            </button>
          </div>

          <div className={styles.commandBottom}>
            <div className={styles.stats} role="status">
              <span>
                <strong>{hydrated ? racks.length : "—"}</strong> racks
              </span>
              <span className={styles.statOk}>
                <strong>{hydrated ? healthyCount : "—"}</strong> passing
              </span>
              <span className={issueCount > 0 ? styles.statWarn : undefined}>
                <strong>{hydrated ? issueCount : "—"}</strong> need attention
              </span>
            </div>

            <div className={styles.tools}>
              <label className={styles.search}>
                <Search size={15} />
                <input
                  type="search"
                  value={query}
                  onChange={(event) => setQuery(event.target.value)}
                  placeholder="Find a rack"
                  aria-label="Find a rack"
                />
              </label>
              <label className={styles.filter}>
                <select
                  value={filter}
                  onChange={(event) => setFilter(event.target.value as Filter)}
                  aria-label="Filter racks"
                >
                  <option value="all">All racks</option>
                  <option value="healthy">Checks passing</option>
                  <option value="attention">Needs attention</option>
                  <option value="draft">Drafts</option>
                </select>
                <ChevronDown size={14} />
              </label>
            </div>
          </div>
        </section>

        <section className={styles.gallery} aria-label="Rack library">
          {!hydrated ? (
            <div className={styles.empty}>
              <p>Loading your racks…</p>
            </div>
          ) : racks.length === 0 ? (
            <div className={styles.empty}>
              <div className={styles.emptyArt}>
                <RackThumbnail design={defaultDesign("empty", "Empty")} />
              </div>
              <p className={styles.sectionLabel}>A BLANK CANVAS</p>
              <h3>Your first rack starts here.</h3>
              <p>Choose a cabinet size, then add equipment or ask the agents to sketch a design.</p>
              <button type="button" onClick={() => setCreateOpen(true)}>
                Create a rack <ArrowRight size={16} />
              </button>
            </div>
          ) : visibleRacks.length === 0 ? (
            <div className={styles.empty}>
              <h3>No racks match that view.</h3>
              <p>Try another name or filter.</p>
              <button
                type="button"
                onClick={() => {
                  setQuery("");
                  setFilter("all");
                }}
              >
                Show all racks <ArrowRight size={16} />
              </button>
            </div>
          ) : (
            <div className={styles.rackGrid}>
              {visibleRacks.map((rack, index) => (
                <RackCard
                  key={rack.id}
                  rack={rack}
                  index={index}
                  metrics={metrics[rack.id]}
                  onDelete={() => {
                    if (
                      window.confirm(
                        `Delete ${rack.design.rack.name}? Its saved design and history will be removed from this browser.`
                      )
                    ) {
                      useFleetStore.getState().removeRack(rack.id);
                    }
                  }}
                />
              ))}
            </div>
          )}
        </section>

        <div className={styles.evidence}>
          <MubitPerformance
            gateway={gateway}
            verifiedRuns={verifiedRuns}
            totalRuns={totalRuns}
            snapshot={mubitSnapshot}
          />
          <p>Engineering checks use saved catalog specifications and estimates, not live rack sensor data.</p>
        </div>
      </div>

      <dialog
        ref={dialogRef}
        className={styles.dialog}
        onClose={() => setCreateOpen(false)}
        aria-labelledby="new-rack-title"
      >
        <form onSubmit={createRack}>
          <div className={styles.dialogHead}>
            <span className={styles.sectionLabel}>NEW / WORKSPACE</span>
            <button type="button" onClick={() => setCreateOpen(false)} aria-label="Close dialog">
              <X size={18} />
            </button>
          </div>

          <h2 id="new-rack-title">
            Give your next rack
            <br />
            <em>a place to begin.</em>
          </h2>

          <div className={styles.dialogBody}>
            <div className={styles.dialogPreview} aria-hidden="true">
              <RackThumbnail design={sizedPreview} />
              <span>{size}U cabinet</span>
            </div>

            <div className={styles.dialogFields}>
              <label className={styles.nameLabel}>
                Rack name
                <input
                  autoFocus
                  value={name}
                  onChange={(event) => setName(event.target.value)}
                  maxLength={80}
                  placeholder="e.g. London edge cluster"
                />
              </label>

              <fieldset className={styles.sizePicker}>
                <legend>Cabinet height</legend>
                <div>
                  {SIZES.map((height) => (
                    <label key={height} className={size === height ? styles.sizeSelected : ""}>
                      <input
                        type="radio"
                        name="rack-size"
                        value={height}
                        checked={size === height}
                        onChange={() => setSize(height)}
                      />
                      <span>{height}U</span>
                      {size === height && <Check size={14} />}
                    </label>
                  ))}
                </div>
              </fieldset>

              <button type="submit" className={styles.dialogSubmit}>
                Create rack <ArrowUpRight size={17} />
              </button>
            </div>
          </div>
        </form>
      </dialog>
    </main>
  );
}
