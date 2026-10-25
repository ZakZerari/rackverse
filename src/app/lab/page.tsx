"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import {
  Bar,
  BarChart,
  CartesianGrid,
  Legend,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import type { MubitConsoleSnapshot } from "@/lib/mubitConsoleSnapshot";

interface AgentStat {
  agent: string;
  count: number;
  successRatePct: number;
  avgLatencyMs: number;
}

interface RepairVerdict {
  timestamp: string;
  runId: string;
  mubitRequestId: string | null;
  round: number;
  candidate: number;
  suggestedRating: "Good" | "Bad";
  reason: string;
  hardBefore: number;
  hardAfter: number;
}

interface ConfigResult {
  label: string;
  n?: number;
  firstRoundRepairPassPct?: number;
  fullyRepairedPct?: number | null;
  avgRepairAttempts?: number;
  avgRepairRounds?: number;
  avgEndToEndMs?: number;
  rejectRatePct?: number;
  avgLatencyMs?: number | null;
  tokensPerValidDesign?: number | null;
  providerListCostPerValidatedRepairUsd?: number | null;
  note?: string;
}

interface BenchResults {
  generatedAt: string;
  trainSeeds: [number, number];
  heldOutSeeds: [number, number];
  lessonsLearnedFromTrain: number;
  comparisonDesignsShared?: boolean;
  pairedAttempt?: { status: string; confirmedPairs: number; requestedPairs: number; observedAt: string; reason: string };
  configs: { A: ConfigResult; B: ConfigResult; C: ConfigResult };
}

export default function LabPage() {
  const [agents, setAgents] = useState<AgentStat[]>([]);
  const [totalCalls, setTotalCalls] = useState(0);
  const [lessonsCount, setLessonsCount] = useState(0);
  const [bench, setBench] = useState<BenchResults | null>(null);
  const [benchChecked, setBenchChecked] = useState(false);
  const [repairVerdicts, setRepairVerdicts] = useState<RepairVerdict[]>([]);
  const [verdictCounts, setVerdictCounts] = useState({ total: 0, improved: 0, fullyRepaired: 0, rejected: 0 });
  const [mubitSnapshot, setMubitSnapshot] = useState<MubitConsoleSnapshot | null>(null);

  useEffect(() => {
    fetch("/api/calls")
      .then((r) => r.json())
      .then((body) => {
        setAgents(body.agents ?? []);
        setTotalCalls(body.totalCalls ?? 0);
      });
    fetch("/api/lessons")
      .then((r) => r.json())
      .then((body) => setLessonsCount(body.count ?? 0));
    fetch("/api/bench-results")
      .then((r) => r.json())
      .then((body) => {
        setBench(body.available ? body.results : null);
        setBenchChecked(true);
      });
    fetch("/api/repair-verdicts", { cache: "no-store" })
      .then((r) => r.json())
      .then((body: { verdicts?: RepairVerdict[]; total?: number; improved?: number; fullyRepaired?: number; rejected?: number }) => {
        setRepairVerdicts(body.verdicts ?? []);
        setVerdictCounts({ total: body.total ?? 0, improved: body.improved ?? 0,
          fullyRepaired: body.fullyRepaired ?? 0, rejected: body.rejected ?? 0 });
      })
      .catch(() => {});
    fetch("/api/mubit-console-snapshot", { cache: "no-store" })
      .then((r) => r.json())
      .then((body: { available?: boolean; snapshot?: MubitConsoleSnapshot }) =>
        setMubitSnapshot(body.available ? body.snapshot ?? null : null))
      .catch(() => {});
  }, []);

  const chartData = bench
    ? [
        {
          metric: "First-round repair %",
          A: bench.configs.A.firstRoundRepairPassPct,
          B: bench.configs.B.firstRoundRepairPassPct,
        },
        {
          metric: "Fully repaired %",
          A: bench.configs.A.fullyRepairedPct ?? 0,
          B: bench.configs.B.fullyRepairedPct ?? 0,
        },
        {
          metric: "Reject rate %",
          A: bench.configs.A.rejectRatePct,
          B: bench.configs.B.rejectRatePct,
        },
      ]
    : [];

  return (
    <div className="mx-auto max-w-5xl space-y-6 p-6">
      <header className="flex items-center justify-between">
        <div>
          <h1 className="text-lg font-bold">RackOS Lab</h1>
          <p className="text-sm text-muted-foreground">
            What&apos;s actually measured, locally vs. Mubit-verified.
          </p>
        </div>
        <Button variant="outline" size="sm" nativeButton={false} render={<Link href="/dashboard" />}>
          Dashboard
        </Button>
      </header>

      <Card className="border-amber-700/40 bg-amber-950/10">
        <CardContent className="pt-4 text-sm">
          <strong>Evidence sources:</strong> rack checks, call logs and A/B benchmark figures are computed locally.
          The Mubit console status below comes from a user-provided snapshot at its stated time.
          No passed adapter comparison is available, so Config C has no latency, cost or pass-rate figures.
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Per-agent call stats</CardTitle>
        </CardHeader>
        <CardContent>
          <p className="mb-3 text-sm text-muted-foreground">
            {totalCalls} call(s) logged in data/calls.jsonl since this app started.
          </p>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Agent</TableHead>
                <TableHead>Calls</TableHead>
                <TableHead>Success rate</TableHead>
                <TableHead>Avg latency</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {agents.map((a) => (
                <TableRow key={a.agent}>
                  <TableCell className="font-medium">{a.agent}</TableCell>
                  <TableCell>{a.count}</TableCell>
                  <TableCell>{a.successRatePct}%</TableCell>
                  <TableCell>{(a.avgLatencyMs / 1000).toFixed(1)}s</TableCell>
                </TableRow>
              ))}
              {agents.length === 0 && (
                <TableRow>
                  <TableCell colSpan={4} className="text-center text-muted-foreground">
                    No calls yet — generate or repair a rack in the Studio first.
                  </TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Mubit tasks</CardTitle>
        </CardHeader>
        <CardContent className="space-y-2 text-sm text-muted-foreground">
          <p>
            Mubit groups calls into a <strong>task</strong> when they share the same model,
            instructions (system prompt), tools, tool choice, and output format. Each agent above
            uses one pinned system prompt and model. Historical task variants remain in Mubit;
            the local fingerprint proves what this app sent, while the console decides actual grouping.
          </p>
          <p>
            By default a task starts training an adapter once it reaches <strong>25 kept
            examples</strong>. Open your Mubit console&apos;s Tasks view to see each agent&apos;s
            live example count and, once a version has trained, compare it against the base
            model with <strong>Try models</strong>.
          </p>
        </CardContent>
      </Card>

      {mubitSnapshot && <Card>
        <CardHeader><CardTitle>Mubit console snapshot</CardTitle></CardHeader>
        <CardContent className="space-y-3 text-xs">
          <p className="text-muted-foreground">{mubitSnapshot.source} · captured {new Date(mubitSnapshot.capturedAt).toLocaleString()} · {mubitSnapshot.tasksTotal} tasks, {mubitSnapshot.learningTasks} learning, {mubitSnapshot.liveTasks} live.</p>
          <div className="rounded-md border border-[var(--warn)]/40 bg-[var(--warn)]/10 px-3 py-2">
            <strong>{mubitSnapshot.adapter.task} {mubitSnapshot.adapter.version}: {mubitSnapshot.adapter.status}</strong>
            <span className="ml-2">{mubitSnapshot.adapter.qualityPct}% quality on {mubitSnapshot.adapter.testCases} tests · target {mubitSnapshot.adapter.targetPct}% · {mubitSnapshot.adapter.baseModel}</span>
          </div>
          <Table><TableHeader><TableRow><TableHead>Selected task</TableHead><TableHead>Status</TableHead><TableHead>Calls · 7d</TableHead><TableHead>Console examples</TableHead></TableRow></TableHeader>
            <TableBody>{mubitSnapshot.tasks.map((task) => <TableRow key={task.name}>
              <TableCell className="font-medium">{task.name}</TableCell><TableCell>{task.status}</TableCell>
              <TableCell className="font-mono">{task.calls7d}</TableCell>
              <TableCell className="font-mono">{task.kept === null ? "Not shown" : `${task.kept}/${task.needed}`}</TableCell>
            </TableRow>)}</TableBody></Table>
          <a href={mubitSnapshot.consoleUrl} target="_blank" rel="noopener noreferrer" className="inline-block text-primary hover:underline">Open Mubit console ↗</a>
        </CardContent>
      </Card>}

      <Card>
        <CardHeader>
          <CardTitle>Lessons learned (local)</CardTitle>
        </CardHeader>
        <CardContent className="flex items-center gap-3">
          <Badge variant="secondary" className="text-base">
            {lessonsCount}
          </Badge>
          <p className="text-sm text-muted-foreground">
            verified Repair patches saved to data/lessons.json and fed back into future
            RepairAgent calls. Local only — see MUBIT_NOTES.md for why.
          </p>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Repair verdicts for Mubit Requests review</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="flex flex-wrap gap-3 font-mono text-xs"><span>{verdictCounts.total} proposals checked</span>
            <span>{verdictCounts.improved} reduced hard issues</span>
            <span className="text-[var(--ok)]">{verdictCounts.fullyRepaired} ended with zero hard issues</span>
            <span className="text-destructive">{verdictCounts.rejected} rejected</span></div>
          <p className="text-xs text-muted-foreground">
            The deterministic verifier suggests Good or Bad for each proposal and keeps its Mubit request ID.
            These are local verdicts. Mubit Requests offers manual Good/Bad ratings; its docs do not specify
            an API or guarantee that ratings filter adapter examples. Match calls by time and request details.
          </p>
          <div className="max-h-64 overflow-auto">
            <Table>
              <TableHeader><TableRow>
                <TableHead>When</TableHead><TableHead>Suggested</TableHead><TableHead>Hard checks</TableHead>
                <TableHead>Mubit request ID</TableHead><TableHead>Verifier reason</TableHead>
              </TableRow></TableHeader>
              <TableBody>
                {repairVerdicts.map((verdict, index) => <TableRow key={`${verdict.runId}-${verdict.round}-${verdict.candidate}-${index}`}>
                  <TableCell className="whitespace-nowrap text-xs">{new Date(verdict.timestamp).toLocaleTimeString()}</TableCell>
                  <TableCell className={verdict.suggestedRating === "Good" ? "text-[var(--ok)]" : "text-destructive"}>{verdict.suggestedRating}</TableCell>
                  <TableCell className="font-mono text-xs">{verdict.hardBefore} → {verdict.hardAfter}</TableCell>
                  <TableCell className="max-w-40 truncate font-mono text-[10px]" title={verdict.mubitRequestId ?? undefined}>{verdict.mubitRequestId ?? "Unavailable"}</TableCell>
                  <TableCell className="max-w-64 truncate text-xs" title={verdict.reason}>{verdict.reason}</TableCell>
                </TableRow>)}
                {repairVerdicts.length === 0 && <TableRow><TableCell colSpan={5} className="text-center text-xs text-muted-foreground">No repair candidates verified yet.</TableCell></TableRow>}
              </TableBody>
            </Table>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>{bench?.comparisonDesignsShared ? "Benchmark — paired repairs on the held-out set" : "Benchmark — preliminary unpaired run"}</CardTitle>
        </CardHeader>
        <CardContent>
          {!benchChecked && <p className="text-sm text-muted-foreground">Loading...</p>}
          {benchChecked && !bench && (
            <p className="text-sm text-muted-foreground">
              No benchmark results yet. Run <code className="rounded bg-muted px-1">npm run bench</code>{" "}
              (see the script&apos;s header comment — it makes real Mubit calls and can take a
              while) to populate data/bench-results.json.
            </p>
          )}
          {bench && (
            <div className="space-y-4">
              {!bench.comparisonDesignsShared && <p className="rounded-md border border-[var(--warn)]/40 bg-[var(--warn)]/10 px-3 py-2 text-xs">
                The two arms regenerated their starting racks independently. Their difference cannot be attributed
                to local lessons. A corrected paired run is required before claiming a repair improvement.
                {bench.pairedAttempt && ` The corrected run confirmed ${bench.pairedAttempt.confirmedPairs}/${bench.pairedAttempt.requestedPairs} pairs before stopping: ${bench.pairedAttempt.reason}`}
              </p>}
              <p className="text-xs text-muted-foreground">
                Train seeds {bench.trainSeeds[0]}-{bench.trainSeeds[1]} ({bench.lessonsLearnedFromTrain}{" "}
                lesson(s) learned) · held-out seeds {bench.heldOutSeeds[0]}-{bench.heldOutSeeds[1]} ·
                {bench.comparisonDesignsShared ? " identical starting faults in A/B ·" : " independent starting racks (legacy run) ·"}
                generated {new Date(bench.generatedAt).toLocaleString()}
              </p>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Config</TableHead>
                    <TableHead>n</TableHead>
                    <TableHead>1st-round repair</TableHead>
                    <TableHead>Fully repaired</TableHead>
                    <TableHead>Avg repair attempts</TableHead>
                    <TableHead>Avg rounds</TableHead>
                    <TableHead>Reject rate</TableHead>
                    <TableHead>End-to-end</TableHead>
                    <TableHead>Provider list $ / valid repair</TableHead>
                    <TableHead>Tokens / valid design</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {(["A", "B"] as const).map((key) => {
                    const c = bench.configs[key];
                    return (
                      <TableRow key={key}>
                        <TableCell className="font-medium">{c.label}</TableCell>
                        <TableCell>{c.n}</TableCell>
                        <TableCell>{c.firstRoundRepairPassPct == null ? "—" : `${c.firstRoundRepairPassPct}%`}</TableCell>
                        <TableCell>{c.fullyRepairedPct === null ? "—" : `${c.fullyRepairedPct}%`}</TableCell>
                        <TableCell>{c.avgRepairAttempts}</TableCell>
                        <TableCell>{c.avgRepairRounds ?? "—"}</TableCell>
                        <TableCell>{c.rejectRatePct}%</TableCell>
                        <TableCell>{c.avgEndToEndMs ? `${(c.avgEndToEndMs / 1000).toFixed(1)}s` : "—"}</TableCell>
                        <TableCell>{c.providerListCostPerValidatedRepairUsd == null ? "—" : `$${c.providerListCostPerValidatedRepairUsd.toFixed(4)}`}</TableCell>
                        <TableCell>{c.tokensPerValidDesign ?? "—"}</TableCell>
                      </TableRow>
                    );
                  })}
                  <TableRow>
                    <TableCell className="font-medium">{bench.configs.C.label}</TableCell>
                    <TableCell colSpan={9} className="text-muted-foreground italic">
                      {bench.configs.C.note}
                    </TableCell>
                  </TableRow>
                </TableBody>
              </Table>

              {bench.comparisonDesignsShared && <div className="h-64 w-full">
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={chartData}>
                    <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" />
                    <XAxis dataKey="metric" tick={{ fontSize: 11 }} stroke="var(--muted-foreground)" />
                    <YAxis tick={{ fontSize: 11 }} stroke="var(--muted-foreground)" />
                    <Tooltip
                      contentStyle={{
                        background: "var(--popover)",
                        border: "1px solid var(--border)",
                        fontSize: 12,
                      }}
                    />
                    <Legend wrapperStyle={{ fontSize: 12 }} />
                    <Bar dataKey="A" name="A: baseline" fill="var(--chart-2)" />
                    <Bar dataKey="B" name="B: with lessons" fill="var(--chart-1)" />
                  </BarChart>
                </ResponsiveContainer>
              </div>}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
