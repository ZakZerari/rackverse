// Benchmark: does the lessons loop actually help RepairAgent?
//   Config A = baseline (no lessons)
//   Config B = with lessons verified during a training pass (train seeds only)
//   Config C = "Mubit adapter" — a placeholder; only ever filled in by hand
//              after checking Try models in the Mubit console (see the
//              honesty principle in the brief — we never fabricate this).
//
// Run with: npm run bench -- --train-n 99 --held-out-n 50
// NOTE: like train-traffic, each scenario is a real, slow Mubit call (see
// MUBIT_NOTES.md). The full default (99 train + 2x50 held-out = ~200 runs)
// easily takes over an hour even at concurrency 4. Start with small numbers
// (--train-n 3 --held-out-n 3) to sanity-check the script first.
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import pLimit from "p-limit";
import { readCallLog, type CallLogEntry } from "@/lib/callsLog";
import { createInMemoryLessonStore, type Lesson } from "@/lib/lessons";
import { designFromRequirements, type RepairLoopOptions, type TraceStep } from "@/lib/orchestrate";
import { generateRequirements } from "@/lib/scenarios";
import type { Patch, Violation } from "@/lib/types";
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
  firstAttemptValid: boolean;
  fullyRepaired: boolean;
  finalValid: boolean;
  repairAttempts: number;
  rejectedAttempts: number;
}

function toMetric(seed: number, trace: TraceStep[], finalHardCount: number): ScenarioMetric {
  const validatorStep = trace.find((t) => t.label === "Validator");
  const firstAttemptValid = (validatorStep?.hardViolationCount ?? 0) === 0;
  const repairSteps = trace.filter((t) => t.label.startsWith("RepairAgent"));
  return {
    seed,
    firstAttemptValid,
    fullyRepaired: !firstAttemptValid && finalHardCount === 0,
    finalValid: finalHardCount === 0,
    repairAttempts: repairSteps.length,
    rejectedAttempts: repairSteps.filter((t) => !t.ok).length,
  };
}

async function runSeeds(
  seeds: number[],
  labelPrefix: string,
  lessonOpts: {
    getLessons: (violations: Violation[]) => Lesson[];
    onLessonLearned: (violations: Violation[], patch: Patch, improvement: string) => void;
  }
): Promise<ScenarioMetric[]> {
  const limit = pLimit(CONCURRENCY);
  let done = 0;
  const tasks = seeds.map((seed) =>
    limit(async () => {
      const requirements = generateRequirements(seed);
      const runId = `bench-${labelPrefix}-${seed}`;
      const repairOpts: RepairLoopOptions = {
        runId,
        getLessons: lessonOpts.getLessons,
        onLessonLearned: lessonOpts.onLessonLearned,
      };
      const { design, trace } = await designFromRequirements(requirements, repairOpts);
      const finalHard = hardViolations(validateDesign(design, requirements)).length;
      done += 1;
      console.log(`[${labelPrefix}] ${done}/${seeds.length} (seed ${seed})`);
      return toMetric(seed, trace, finalHard);
    })
  );
  return Promise.all(tasks);
}

function aggregate(label: string, metrics: ScenarioMetric[], calls: CallLogEntry[]) {
  const n = metrics.length;
  const firstAttemptValidPct = (metrics.filter((m) => m.firstAttemptValid).length / n) * 100;
  const invalidOnes = metrics.filter((m) => !m.firstAttemptValid);
  const fullyRepairedPct =
    invalidOnes.length > 0 ? (invalidOnes.filter((m) => m.fullyRepaired).length / invalidOnes.length) * 100 : null;
  const avgRepairAttempts =
    invalidOnes.length > 0 ? invalidOnes.reduce((s, m) => s + m.repairAttempts, 0) / invalidOnes.length : 0;
  const totalRepairAttempts = metrics.reduce((s, m) => s + m.repairAttempts, 0);
  const totalRejected = metrics.reduce((s, m) => s + m.rejectedAttempts, 0);
  const rejectRatePct = totalRepairAttempts > 0 ? (totalRejected / totalRepairAttempts) * 100 : 0;

  const relevantCalls = calls.filter((c) => c.runId?.startsWith(`bench-${label}-`));
  const avgLatencyMs =
    relevantCalls.length > 0 ? relevantCalls.reduce((s, c) => s + c.latencyMs, 0) / relevantCalls.length : null;
  const totalTokens = relevantCalls.reduce((s, c) => s + (c.promptTokens ?? 0) + (c.completionTokens ?? 0), 0);
  const validDesigns = metrics.filter((m) => m.finalValid).length;
  const tokensPerValidDesign = validDesigns > 0 ? totalTokens / validDesigns : null;

  return {
    n,
    firstAttemptValidPct: round(firstAttemptValidPct),
    fullyRepairedPct: fullyRepairedPct === null ? null : round(fullyRepairedPct),
    avgRepairAttempts: round(avgRepairAttempts),
    rejectRatePct: round(rejectRatePct),
    avgLatencyMs: avgLatencyMs === null ? null : Math.round(avgLatencyMs),
    tokensPerValidDesign: tokensPerValidDesign === null ? null : Math.round(tokensPerValidDesign),
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
  const trainSeeds = Array.from({ length: trainN }, (_, i) => i + 1);
  const heldOutSeeds = Array.from({ length: heldOutN }, (_, i) => 1000 + i);

  console.log(`Training pass: ${trainN} scenario(s) (seeds 1-${trainN}), building the verified-lessons store...`);
  const trainLessons = createInMemoryLessonStore();
  await runSeeds(trainSeeds, "train", {
    getLessons: trainLessons.getRelevantLessons,
    onLessonLearned: trainLessons.recordLesson,
  });
  console.log(`Training pass done — ${trainLessons.size()} verified lesson(s) learned from train seeds.\n`);

  console.log(`Config A (baseline, no lessons): ${heldOutN} held-out scenario(s)...`);
  const metricsA = await runSeeds(heldOutSeeds, "A", { getLessons: () => [], onLessonLearned: () => {} });

  console.log(`\nConfig B (with verified lessons): ${heldOutN} held-out scenario(s)...`);
  const metricsB = await runSeeds(heldOutSeeds, "B", {
    getLessons: trainLessons.getRelevantLessons,
    onLessonLearned: () => {}, // held-out repairs never feed back into the lesson store
  });

  const calls = readCallLog();
  const results = {
    generatedAt: new Date().toISOString(),
    trainSeeds: [trainSeeds[0], trainSeeds[trainSeeds.length - 1]],
    heldOutSeeds: [heldOutSeeds[0], heldOutSeeds[heldOutSeeds.length - 1]],
    lessonsLearnedFromTrain: trainLessons.size(),
    configs: {
      A: { label: "Baseline (no lessons)", ...aggregate("A", metricsA, calls) },
      B: { label: "With verified lessons", ...aggregate("B", metricsB, calls) },
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
