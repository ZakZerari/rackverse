"use client";

import { useState } from "react";
import { useRackStore, type ActivityEntry } from "@/lib/store";
import type { Violation } from "@/lib/types";

type Tab = "checks" | "activity";

const STATUS_STYLE: Record<ActivityEntry["status"], string> = {
  running: "bg-primary/15 text-primary",
  ok: "bg-[var(--ok)]/15 text-[var(--ok)]",
  rejected: "bg-[var(--warn)]/15 text-[var(--warn)]",
  error: "bg-destructive/15 text-destructive",
};

export function BottomPanel() {
  const violations = useRackStore((s) => s.violations);
  const activity = useRackStore((s) => s.activity);
  const isRunning = useRackStore((s) => s.isRunning);
  const [tab, setTab] = useState<Tab>("checks");

  const hardCount = violations.filter((v) => v.severity === "hard").length;
  const softCount = violations.length - hardCount;

  return (
    <section className="flex min-h-0 flex-col border-t border-border bg-panel">
      <header className="flex shrink-0 items-center gap-1 border-b border-border px-2 py-1.5">
        <TabButton active={tab === "checks"} onClick={() => setTab("checks")}>
          Engineering checks
          {hardCount > 0 && (
            <span className="ml-1.5 rounded-sm bg-destructive/20 px-1 font-mono text-[10px] text-destructive">
              {hardCount}
            </span>
          )}
          {hardCount === 0 && softCount > 0 && (
            <span className="ml-1.5 rounded-sm bg-[var(--warn)]/20 px-1 font-mono text-[10px] text-[var(--warn)]">
              {softCount}
            </span>
          )}
        </TabButton>
        <TabButton active={tab === "activity"} onClick={() => setTab("activity")}>
          Agent activity
          {isRunning && <span className="ml-1.5 size-1.5 animate-pulse rounded-full bg-primary" />}
          {!isRunning && activity.length > 0 && (
            <span className="ml-1.5 font-mono text-[10px] text-muted-foreground">{activity.length}</span>
          )}
        </TabButton>

        <div className="ml-auto pr-1">
          {violations.length === 0 ? (
            <span className="flex items-center gap-1.5 font-mono text-[10px] uppercase tracking-wider text-[var(--ok)]">
              <span className="size-1.5 rounded-full bg-[var(--ok)]" />
              all checks passing
            </span>
          ) : (
            <span className="flex items-center gap-1.5 font-mono text-[10px] uppercase tracking-wider text-muted-foreground">
              <span className={`size-1.5 rounded-full ${hardCount > 0 ? "bg-destructive" : "bg-[var(--warn)]"}`} />
              {hardCount} hard · {softCount} soft
            </span>
          )}
        </div>
      </header>

      <div className="scroll-region flex-1">
        {tab === "checks" ? <ChecksList violations={violations} /> : <ActivityList activity={activity} />}
      </div>
    </section>
  );
}

function TabButton({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      onClick={onClick}
      className={`flex items-center rounded-md px-2.5 py-1 text-[11px] font-medium transition-colors ${
        active ? "bg-secondary text-foreground" : "text-muted-foreground hover:text-foreground"
      }`}
    >
      {children}
    </button>
  );
}

function ChecksList({ violations }: { violations: Violation[] }) {
  if (violations.length === 0) {
    return (
      <p className="p-3 text-[11px] text-muted-foreground">
        No violations. Every rule in <span className="font-mono">src/lib/validate.ts</span> runs on every edit —
        deterministic code, not the model.
      </p>
    );
  }

  return (
    <ul className="divide-y divide-border/60">
      {violations.map((v, i) => (
        <li key={`${v.code}-${i}`} className="flex items-start gap-2 px-3 py-2">
          <span
            className={`mt-0.5 shrink-0 rounded-sm px-1 font-mono text-[10px] uppercase ${
              v.severity === "hard"
                ? "bg-destructive/15 text-destructive"
                : "bg-[var(--warn)]/15 text-[var(--warn)]"
            }`}
          >
            {v.severity}
          </span>
          <div className="min-w-0">
            <p className="font-mono text-[11px] text-foreground">{v.code}</p>
            <p className="text-[11px] text-muted-foreground">{v.message}</p>
          </div>
        </li>
      ))}
    </ul>
  );
}

function ActivityList({ activity }: { activity: ActivityEntry[] }) {
  if (activity.length === 0) {
    return (
      <p className="p-3 text-[11px] text-muted-foreground">
        Every agent call, validator result and verifier decision shows up here live as it happens.
      </p>
    );
  }

  return (
    <ul className="divide-y divide-border/60">
      {activity.map((entry) => (
        <li key={entry.id} className="flex items-start gap-2 px-3 py-2">
          <span className={`mt-0.5 shrink-0 rounded-sm px-1 font-mono text-[10px] ${STATUS_STYLE[entry.status]}`}>
            {entry.status === "running" ? "···" : entry.status}
          </span>
          <div className="min-w-0 flex-1">
            <p className="text-[11px] font-medium text-foreground">{entry.label}</p>
            <p className="text-[11px] text-muted-foreground">{entry.detail}</p>
          </div>
          {entry.latencyMs !== undefined && (
            <span className="shrink-0 font-mono text-[10px] tabular text-muted-foreground">
              {(entry.latencyMs / 1000).toFixed(1)}s
              {entry.tokens ? ` · ${entry.tokens}tok` : ""}
            </span>
          )}
        </li>
      ))}
    </ul>
  );
}
