"use client";

import { useEffect, useRef, useState } from "react";
import { AnimatePresence, motion } from "motion/react";
import { catalogItemFor } from "@/lib/catalog";
import type { TimelineItem, Turn } from "@/lib/conversation";
import { readSSE } from "@/lib/events";
import { useRackStore } from "@/lib/store";
import { useFleetStore } from "@/lib/fleet";
import { compactHistory, planTurn } from "@/lib/turn";
import type { Design } from "@/lib/types";
import { Button } from "@/components/ui/button";
import { EquipmentEditor } from "@/components/studio/EquipmentEditor";
import { Textarea } from "@/components/ui/textarea";

const EXAMPLES = [
  "42U rack, 8 servers, redundant A/B power, 2 switches, $60k budget",
  "Small 24U edge rack: 3 low-power servers, 1 switch, under $15k",
  "GPU training rack — 4 GPU servers, redundant power, 48U, 20kW",
];

export function CopilotPanel({ rackId }: { rackId: string }) {
  const turns = useRackStore((s) => s.turns);
  const isRunning = useRackStore((s) => s.isRunning);
  const beginTurn = useRackStore((s) => s.beginTurn);
  const applyEvent = useRackStore((s) => s.applyEvent);

  const [text, setText] = useState("");
  const abortRef = useRef<AbortController | null>(null);
  const threadRef = useRef<HTMLDivElement>(null);

  // Follow the conversation as it streams.
  useEffect(() => {
    const el = threadRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [turns]);

  useEffect(() => () => abortRef.current?.abort(), []);

  async function handleSend() {
    const prompt = text.trim();
    if (!prompt || isRunning) return;
    setText("");
    const context = useRackStore.getState();
    // Same router the server runs, so the turn is never labelled "amend" while
    // the backend rebuilds from scratch (or the reverse).
    beginTurn(planTurn(context.design, prompt).mode, prompt);

    const controller = new AbortController();
    abortRef.current = controller;

    try {
      const res = await fetch("/api/design", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          text: prompt,
          rackId,
          currentDesign: context.design,
          currentRequirements: context.requirements,
          history: compactHistory(
            context.turns.map((turn) => ({ user: turn.prompt, outcome: turn.summary ?? "In progress" }))
          ),
        }),
        signal: controller.signal,
      });
      if (!res.ok || !res.body) {
        const body = (await res.json().catch(() => ({}))) as { error?: string };
        throw new Error(body.error ?? `Request failed (${res.status}).`);
      }
      for await (const event of readSSE(res.body)) {
        if (useFleetStore.getState().activeRackId !== rackId) break;
        applyEvent(event);
      }
    } catch (err) {
      if (err instanceof DOMException && err.name === "AbortError") return;
      if (useFleetStore.getState().activeRackId !== rackId) return;
      applyEvent({ type: "run:error", error: err instanceof Error ? err.message : String(err) });
    } finally {
      abortRef.current = null;
    }
  }

  return (
    <aside className="flex min-h-0 flex-1 flex-col border-l border-border bg-panel">
      <header className="flex shrink-0 items-center justify-between border-b border-border px-3 py-2">
        <div>
          <h2 className="text-xs font-semibold">Copilot</h2>
          <p className="text-[11px] text-muted-foreground">Agents propose · code decides</p>
        </div>
        {turns.length > 0 && (
          <Button size="xs" variant="ghost" onClick={() => useRackStore.getState().clearConversation()}>
            Clear
          </Button>
        )}
      </header>

      <div ref={threadRef} className="scroll-region flex-1">
        <div className="space-y-3 p-3">
          {turns.length === 0 && <EmptyState onPick={setText} />}
          {turns.map((turn) => (
            <TurnBlock key={turn.id} turn={turn} />
          ))}
          <PendingRepairCard />
          <SelectedDeviceCard />
        </div>
      </div>

      <div className="shrink-0 space-y-2 border-t border-border p-3">
        <Textarea
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault();
              handleSend();
            }
          }}
          placeholder="Describe a rack…  (Enter to send)"
          rows={2}
          className="resize-none text-xs"
        />
        <div className="flex gap-2">
          <Button size="sm" className="flex-1" disabled={isRunning || !text.trim()} onClick={handleSend}>
            {isRunning ? "Working…" : "Send"}
          </Button>
          {isRunning && (
            <Button
              size="sm"
              variant="outline"
              onClick={() => {
                abortRef.current?.abort();
                applyEvent({ type: "run:error", error: "Cancelled." });
              }}
            >
              Stop
            </Button>
          )}
        </div>
      </div>
    </aside>
  );
}

function EmptyState({ onPick }: { onPick: (text: string) => void }) {
  return (
    <div className="space-y-2">
      <p className="text-[11px] text-muted-foreground">
        Describe a rack in plain English. Agents propose a design; the deterministic validator decides whether
        it&apos;s legal.
      </p>
      {EXAMPLES.map((example) => (
        <button
          key={example}
          onClick={() => onPick(example)}
          className="block w-full rounded-md border border-border/60 px-2 py-1.5 text-left text-[11px] text-muted-foreground transition-colors hover:border-border hover:text-foreground"
        >
          {example}
        </button>
      ))}
    </div>
  );
}

function TurnBlock({ turn }: { turn: Turn }) {
  return (
    <motion.div initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} className="space-y-2">
      <div className="flex justify-end">
        <p className="max-w-[90%] rounded-lg rounded-br-sm bg-secondary px-2.5 py-1.5 text-[11px] text-secondary-foreground">
          {turn.prompt}
        </p>
      </div>

      <div className="space-y-1.5 rounded-lg rounded-bl-sm border border-border bg-card/60 p-2">
        <AnimatePresence initial={false}>
          {turn.items.map((item) => (
            <TimelineRow key={item.id} item={item} />
          ))}
        </AnimatePresence>

        {turn.status === "running" && turn.items.length === 0 && (
          <p className="text-[11px] text-muted-foreground">Starting…</p>
        )}
        {turn.summary && (
          <p className="border-t border-border/60 pt-1.5 text-[11px] font-medium text-foreground">{turn.summary}</p>
        )}
        {turn.error && <p className="text-[11px] text-destructive">{turn.error}</p>}
      </div>
    </motion.div>
  );
}

function TimelineRow({ item }: { item: TimelineItem }) {
  const [open, setOpen] = useState(false);

  if (item.kind === "validator") {
    const clean = item.hardCount === 0;
    return (
      <Row
        dot={clean ? "ok" : "bad"}
        label="Validator"
        detail={
          clean
            ? "No violations."
            : `${item.hardCount} hard, ${item.violations.length - item.hardCount} soft`
        }
      >
        {!clean && (
          <ul className="mt-1 space-y-0.5">
            {item.violations.slice(0, 6).map((v, i) => (
              <li key={`${v.code}-${i}`} className="font-mono text-[10px] text-muted-foreground">
                {v.code}
              </li>
            ))}
          </ul>
        )}
      </Row>
    );
  }

  if (item.kind === "verifier") {
    return (
      <Row
        dot={item.accepted ? "ok" : "bad"}
        label="Verifier"
        detail={item.reason}
        meta={`${item.hardBefore} → ${item.hardAfter}`}
      />
    );
  }

  if (item.kind === "note") {
    return <Row dot={item.tone === "warn" ? "bad" : "ok"} label={item.label} detail={item.detail} />;
  }

  // Agent step — its reasoning stays here permanently once the run finishes.
  const detail =
    item.status === "error"
      ? (item.error ?? "Failed.")
      : (item.rationale ?? (item.status === "running" ? item.note : "Responded."));

  return (
    <Row
      dot={item.status === "running" ? "run" : item.status === "ok" ? "ok" : "bad"}
      label={item.agent}
      detail={detail}
      meta={
        item.latencyMs !== undefined
          ? `${(item.latencyMs / 1000).toFixed(1)}s${item.tokens ? ` · ${item.tokens}tok` : ""}`
          : undefined
      }
    >
      {item.output.length > 0 && (
        <>
          <button
            onClick={() => setOpen((v) => !v)}
            className="mt-1 font-mono text-[10px] text-muted-foreground underline-offset-2 hover:text-foreground hover:underline"
          >
            {open ? "hide raw output" : `raw output (${item.output.length} chars)`}
          </button>
          {open && (
            <pre className="mt-1 max-h-48 overflow-auto whitespace-pre-wrap break-all rounded bg-background/60 p-1.5 font-mono text-[10px] leading-relaxed text-muted-foreground">
              {item.output}
            </pre>
          )}
          {item.status === "running" && !open && (
            <pre className="mt-1 max-h-16 overflow-hidden whitespace-pre-wrap break-all font-mono text-[10px] leading-relaxed text-muted-foreground/70">
              {item.output.slice(-200)}
            </pre>
          )}
        </>
      )}
    </Row>
  );
}

function Row({
  dot,
  label,
  detail,
  meta,
  children,
}: {
  dot: "ok" | "bad" | "run";
  label: string;
  detail: string;
  meta?: string;
  children?: React.ReactNode;
}) {
  const dotClass =
    dot === "ok"
      ? "bg-[var(--ok)]"
      : dot === "bad"
        ? "bg-[var(--warn)]"
        : "bg-primary animate-pulse";

  return (
    <motion.div initial={{ opacity: 0, x: -4 }} animate={{ opacity: 1, x: 0 }} className="flex gap-2">
      <span className={`mt-1.5 size-1.5 shrink-0 rounded-full ${dotClass}`} />
      <div className="min-w-0 flex-1">
        <div className="flex items-baseline justify-between gap-2">
          <span className="text-[11px] font-medium text-foreground">{label}</span>
          {meta && <span className="shrink-0 font-mono text-[10px] tabular text-muted-foreground">{meta}</span>}
        </div>
        <p className="text-[11px] leading-snug text-muted-foreground">{detail}</p>
        {children}
      </div>
    </motion.div>
  );
}

function countChangedPlacements(before: Design, after: Design): number {
  const beforeById = new Map(before.placements.map((p) => [p.id, p]));
  const afterById = new Map(after.placements.map((p) => [p.id, p]));
  let changed = 0;
  for (const id of new Set([...beforeById.keys(), ...afterById.keys()])) {
    const a = beforeById.get(id);
    const b = afterById.get(id);
    if (!a || !b || JSON.stringify(a) !== JSON.stringify(b)) changed += 1;
  }
  return changed;
}

function PendingRepairCard() {
  const design = useRackStore((s) => s.design);
  const pendingRepair = useRackStore((s) => s.pendingRepair);
  const acceptPendingRepair = useRackStore((s) => s.acceptPendingRepair);
  const rejectPendingRepair = useRackStore((s) => s.rejectPendingRepair);

  if (!pendingRepair) return null;
  const changed = countChangedPlacements(design, pendingRepair.design);

  return (
    <div className="rounded-md border border-primary/50 bg-card p-2.5">
      <p className="text-xs font-semibold">
        Review {changed} change{changed === 1 ? "" : "s"}
      </p>
      {pendingRepair.trace.map((step) => (
        <p key={step.id} className="mt-1 text-[11px] text-muted-foreground">
          {step.detail}
        </p>
      ))}
      <div className="mt-2 flex gap-2">
        <Button size="xs" className="flex-1" onClick={acceptPendingRepair}>
          Accept
        </Button>
        <Button size="xs" variant="outline" className="flex-1" onClick={rejectPendingRepair}>
          Reject
        </Button>
      </div>
    </div>
  );
}

function SelectedDeviceCard() {
  const [editing, setEditing] = useState(false);
  const design = useRackStore((s) => s.design);
  const selectedPlacementId = useRackStore((s) => s.selectedPlacementId);
  const removePlacement = useRackStore((s) => s.removePlacement);

  const selected = design.placements.find((p) => p.id === selectedPlacementId);
  const item = selected ? catalogItemFor(design, selected.catalogId) : undefined;
  if (!selected || !item) return null;

  const specs: [string, string, boolean][] = [
    ["Position", `U${selected.startU} · ${selected.face}`, false],
    ["Size", `${item.heightU}U · ${item.depthMm}mm`, item.estimated.includes("depthMm")],
    [
      "Power",
      item.powerW > 0 ? `${item.powerW}W draw` : `${item.powerCapacityW ?? 0}W supply`,
      item.estimated.includes("powerW") || item.estimated.includes("powerCapacityW"),
    ],
    ["Weight", `${item.weightKg}kg`, item.estimated.includes("weightKg")],
    ["Price", `$${item.priceUsd.toLocaleString()}`, item.estimated.includes("priceUsd")],
  ];

  return (
    <div className="rounded-md border border-border bg-card p-2.5">
      <p className="text-xs font-semibold">
        <span className="text-muted-foreground">{item.manufacturer}</span> {item.name}
      </p>
      <dl className="mt-1.5 space-y-0.5">
        {specs.map(([label, value, isEstimated]) => (
          <div key={label} className="flex justify-between gap-2 text-[11px]">
            <dt className="text-muted-foreground">{label}</dt>
            <dd className="font-mono tabular text-foreground">
              {value}
              {isEstimated && <span className="ml-1 text-[9px] text-[var(--warn)]">est</span>}
            </dd>
          </div>
        ))}
      </dl>
      <p className="mt-1.5 border-t border-border/60 pt-1.5 text-[10px] leading-snug text-muted-foreground">
        {item.source === "custom" ? "User-defined equipment." : "Source: NetBox device-type library (CC0)."}
        {item.estimated.length > 0 && ` Fields marked "est" are estimates or user edits.`}
      </p>
      <Button size="xs" variant="outline" className="mt-2 w-full" onClick={() => setEditing(true)}>Edit specs and price</Button>
      <Button size="xs" variant="destructive" className="mt-2 w-full" onClick={() => removePlacement(selected.id)}>
        Remove
      </Button>
      {editing && <EquipmentEditor item={item} open={editing} onOpenChange={setEditing} />}
    </div>
  );
}
