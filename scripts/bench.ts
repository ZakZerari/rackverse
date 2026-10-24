// Benchmark: does the lessons loop actually help RepairAgent on paired racks?
//   Config A = baseline (no lessons)
//   Config B = with lessons verified during a training pass (train seeds only)
//   Config C = "Mubit adapter" — a placeholder; only ever filled in by hand
//              after checking Try models in the Mubit console (see the
//              honesty principle in the brief — we never fabricate this).
//
// Run with: npm run bench -- --train-n 99 --held-out-n 50
// Each held-out seed uses one frozen architect design and one injected fault.
// Both repair arms receive that same broken rack. Every agent call is live via
// Mubit and paced under the provider rate limit; the full default can take
// well over an hour. Start with small flags to sanity-check the script.
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import pLimit from "p-limit";
import { readCallLog, type CallLogEntry } from "@/lib/callsLog";
import { createInMemoryLessonStore, type Lesson } from "@/lib/lessons";
import { designFromRequirements, repairOnly, type RepairLoopOptions, type TraceStep } from "@/lib/orchestrate";
import { breakDesign, generateRequirements } from "@/lib/scenarios";
import { catalogItemFor } from "@/lib/catalog";
import type { Design, Patch, Violation } from "@/lib/types";
import { hardViolations, validateDesign } from "@/lib/validate";

try {
  process.loadEnvFile(".env.local");
} catch {
  // .env.local may not exist; env vars could come from the shell instead.
}

const BENCH_RESULTS_PATH = join(process.cwd(), "data", "bench-results.json");
const CONCURRENCY = 4;

function parseFlag(name: string, fallback: number): number {
  const i = process.argv.indexOf(name);
  if (i === -1) return fallback;
  const v = Number(process.argv[i + 1]);
  return Number.isFinite(v) && v > 0 ? v : fallback;
}

interface ScenarioMetric {
  seed: number;
  firstRoundRepairPass: boolean;
  fullyRepaired: boolean;
  finalValid: boolean;
  repairAttempts: number;
  repairRounds: number;
  durationMs: number;
  rejectedAttempts: number;
}

function toMetric(seed: number, trace: TraceStep[], finalHardCount: number, durationMs: number): ScenarioMetric {
  const repairSteps = trace.filter((t) => t.label.startsWith("RepairAgent"));
  const repairRounds = Math.max(0, ...repairSteps.map((step) =>
    Number(/^RepairAgent \(round (\d+),/.exec(step.label)?.[1] ?? 0)));
  return {
    seed,
    firstRoundRepairPass: repairRounds === 1 && finalHardCount === 0,
    fullyRepaired: finalHardCount === 0,
    finalValid: finalHardCount === 0,
    repairAttempts: repairSteps.length,
    repairRounds,
    durationMs,
    rejectedAttempts: repairSteps.filter((t) => !t.ok).length,
  };
}

async function runTrainSeeds(
  seeds: number[],
  benchmarkRunId: string,
  lessonOpts: {
    getLessons: (violations: Violation[]) => Lesson[];
    onLessonLearned: (violations: Violation[], patch: Patch, improvement: string) => void;
  }
): Promise<void> {
  const limit = pLimit(CONCURRENCY);
  let done = 0;
  const tasks = seeds.map((seed) =>
    limit(async () => {
      const requirements = generateRequirements(seed);
      const runId = `bench-${benchmarkRunId}-train-${seed}`;
      const repairOpts: RepairLoopOptions = {
        runId,
        getLessons: lessonOpts.getLessons,
        onLessonLearned: lessonOpts.onLessonLearned,
      };
      await designFromRequirements(requirements, repairOpts);
      done += 1;
      console.log(`[train] ${done}/${seeds.length} (seed ${seed})`);
    })
  );
  await Promise.all(tasks);
}

function brokenHeldOut(design: Design, seed: number, requirements: ReturnType<typeof generateRequirements>): Design {
  const fault = breakDesign(design, () => ((seed * 7) % 100) / 100).design;
  if (hardViolations(validateDesign(fault, requirements)).length > 0) return fault;
  const target = design.placements.find((placement) => (catalogItemFor(design, placement.catalogId)?.heightU ?? 0) > 0);
  if (!target) throw new Error(`Seed ${seed} produced no rack-mounted equipment.`);
  return { ...design, version: design.version + 1, placements: design.placements.map((placement) =>
    placement.id === target.id ? { ...placement, startU: design.rack.heightU + 1 } : placement) };
}

/** One architect layout and one physical fault per seed, shared by both repair arms. */
async function runHeldOut(
  seeds: number[],
  benchmarkRunId: string,
  getLessonsB: (violations: Violation[]) => Lesson[]
): Promise<{ A: ScenarioMetric[]; B: ScenarioMetric[] }> {
  const limit = pLimit(CONCURRENCY);
  let done = 0;
  const pairs = await Promise.all(seeds.map((seed) => limit(async () => {
    const requirements = generateRequirements(seed);
    const initial = await designFromRequirements(requirements, { runId: `bench-${benchmarkRunId}-shared-${seed}`, maxAttempts: 0 });
    const broken = brokenHeldOut(initial.design, seed, requirements);
    const runArm = async (label: "A" | "B", getLessons: (v: Violation[]) => Lesson[]) => {
      const startedAt = Date.now();
      const result = await repairOnly(broken, requirements, {
        runId: `bench-${benchmarkRunId}-${label}-${seed}`, getLessons, onLessonLearned: () => {},
      });
      return toMetric(seed, result.trace, hardViolations(validateDesign(result.design, requirements)).length,
        Date.now() - startedAt);
    };
    // Alternate call order to limit provider-time bias between the two arms.
    let A: ScenarioMetric;
    let B: ScenarioMetric;
    if (seed % 2 === 0) {
      B = await runArm("B", getLessonsB);
      A = await runArm("A", () => []);
    } else {
      A = await runArm("A", () => []);
      B = await runArm("B", getLessonsB);
    }
    done += 1;
    console.log(`[paired] ${done}/${seeds.length} (seed ${seed})`);
    return { A, B };
  })));
  return { A: pairs.map((pair) => pair.A), B: pairs.map((pair) => pair.B) };
}

function aggregate(label: string, benchmarkRunId: string, metrics: ScenarioMetric[], calls: CallLogEntry[]) {
  const n = metrics.length;
  const firstRoundRepairPassPct = (metrics.filter((m) => m.firstRoundRepairPass).length / n) * 100;
  const fullyRepairedPct = (metrics.filter((m) => m.fullyRepaired).length / n) * 100;
  const avgRepairAttempts = metrics.reduce((s, m) => s + m.repairAttempts, 0) / n;
  const avgRepairRounds = metrics.reduce((s, m) => s + m.repairRounds, 0) / n;
  const avgEndToEndMs = metrics.reduce((s, m) => s + m.durationMs, 0) / n;
  const totalRepairAttempts = metrics.reduce((s, m) => s + m.repairAttempts, 0);
  const totalRejected = metrics.reduce((s, m) => s + m.rejectedAttempts, 0);
  const rejectRatePct = totalRepairAttempts > 0 ? (totalRejected / totalRepairAttempts) * 100 : 0;

  const relevantCalls = calls.filter((c) => c.runId?.startsWith(`bench-${benchmarkRunId}-${label}-`));
  const avgLatencyMs =
    relevantCalls.length > 0 ? relevantCalls.reduce((s, c) => s + c.latencyMs, 0) / relevantCalls.length : null;
  const totalTokens = relevantCalls.reduce((s, c) => s + (c.promptTokens ?? 0) + (c.completionTokens ?? 0), 0);
  const validDesigns = metrics.filter((m) => m.finalValid).length;
  const tokensPerValidDesign = validDesigns > 0 ? totalTokens / validDesigns : null;
  const priceable = relevantCalls.length > 0 && relevantCalls.every((call) =>
    call.model === "gemini-3.5-flash-lite" && call.promptTokens !== undefined && call.completionTokens !== undefined);
  const providerListCostPerValidatedRepairUsd = priceable && validDesigns > 0
    ? relevantCalls.reduce((sum, call) => sum +
      ((call.promptTokens ?? 0) * 0.3 + (call.completionTokens ?? 0) * 2.5) / 1_000_000, 0) / validDesigns : null;

  return {
    n,
    firstRoundRepairPassPct: round(firstRoundRepairPassPct),
    fullyRepairedPct: round(fullyRepairedPct),
    avgRepairAttempts: round(avgRepairAttempts),
    avgRepairRounds: round(avgRepairRounds),
    avgEndToEndMs: Math.round(avgEndToEndMs),
    rejectRatePct: round(rejectRatePct),
    avgLatencyMs: avgLatencyMs === null ? null : Math.round(avgLatencyMs),
    tokensPerValidDesign: tokensPerValidDesign === null ? null : Math.round(tokensPerValidDesign),
    providerListCostPerValidatedRepairUsd: providerListCostPerValidatedRepairUsd === null ? null
      : Math.round(providerListCostPerValidatedRepairUsd * 1_000_000) / 1_000_000,
  };
}

function round(n: number): number {
  return Math.round(n * 10) / 10;
}

async function main() {
  if (!process.env.MUBIT_API_KEY || !process.env.MUBIT_MODEL) {
    console.error("Missing MUBIT_API_KEY or MUBIT_MODEL. Copy .env.example to .env.local and fill both in.");
    process.exit(1);
  }

  const trainN = parseFlag("--train-n", 99);
  const heldOutN = parseFlag("--held-out-n", 50);
  const benchmarkRunId = Date.now().toString(36);
  const trainSeeds = Array.from({ length: trainN }, (_, i) => i + 1);
  const heldOutSeeds = Array.from({ length: heldOutN }, (_, i) => 1000 + i);

  console.log(`Training pass: ${trainN} scenario(s) (seeds 1-${trainN}), building the verified-lessons store...`);
  const trainLessons = createInMemoryLessonStore();
  await runTrainSeeds(trainSeeds, benchmarkRunId, {
    getLessons: trainLessons.getRelevantLessons,
    onLessonLearned: trainLessons.recordLesson,
  });
  console.log(`Training pass done — ${trainLessons.size()} verified lesson(s) learned from train seeds.\n`);

  console.log(`Paired A/B repair comparison: ${heldOutN} held-out rack(s), each broken once and repaired twice...`);
  const { A: metricsA, B: metricsB } = await runHeldOut(heldOutSeeds, benchmarkRunId, trainLessons.getRelevantLessons);

  const calls = readCallLog();
  const results = {
    generatedAt: new Date().toISOString(),
    benchmarkRunId,
    trainSeeds: [trainSeeds[0], trainSeeds[trainSeeds.length - 1]],
    heldOutSeeds: [heldOutSeeds[0], heldOutSeeds[heldOutSeeds.length - 1]],
    lessonsLearnedFromTrain: trainLessons.size(),
    comparisonDesignsShared: true,
    armOrderBalanced: true,
    configs: {
      A: { label: "Baseline (no lessons)", ...aggregate("A", benchmarkRunId, metricsA, calls) },
      B: { label: "With verified lessons", ...aggregate("B", benchmarkRunId, metricsB, calls) },
      C: {
        label: "Mubit adapter",
        note: "Verify in Mubit console — Try models. Not computed locally; never claimed without manual verification.",
      },
    },
  };

  mkdirSync(dirname(BENCH_RESULTS_PATH), { recursive: true });
  writeFileSync(BENCH_RESULTS_PATH, JSON.stringify(results, null, 2));

  console.log("\n=== Results ===");
  console.log(JSON.stringify(results, null, 2));
  console.log(`\nWrote ${BENCH_RESULTS_PATH}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
