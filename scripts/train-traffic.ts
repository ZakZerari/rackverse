// Generates call volume for RackArchitect and RepairAgent so their Mubit
// tasks cross the adapter training threshold. Run with:
//   npm run train-traffic -- --n 60
//
// NOTE: Gemini-via-Mubit latency in this environment ranges ~20s-160s per
// call (see MUBIT_NOTES.md). A sequential run of 60 scenarios would take
// hours; p-limit(4) runs them concurrently, but a full run is still a
// long-lived background job, not a quick smoke test. Start small (--n 5)
// to sanity-check before committing to a full run.
import pLimit from "p-limit";
import { designFromRequirements, repairOnly } from "@/lib/orchestrate";
import { breakDesign, generateRequirements } from "@/lib/scenarios";

try {
  process.loadEnvFile(".env.local");
} catch {
  // .env.local may not exist; env vars could come from the shell instead.
}

function parseN(): number {
  const flagIndex = process.argv.indexOf("--n");
  if (flagIndex === -1) return 60;
  const value = Number(process.argv[flagIndex + 1]);
  return Number.isFinite(value) && value > 0 ? value : 60;
}

async function runOne(seed: number): Promise<"ok" | "failed"> {
  const runId = `train-${seed}`;
  const requirements = generateRequirements(seed);

  // RackArchitect call (always).
  const { design } = await designFromRequirements(requirements, { runId });

  // Guarantee RepairAgent also gets volume on scenarios the Architect
  // already got right the first time, by deliberately breaking the result
  // and repairing it again.
  const broken = breakDesign(design);
  if (broken.design !== design) {
    await repairOnly(broken.design, requirements, { runId: `${runId}-break` });
  }

  return "ok";
}

async function main() {
  if (!process.env.MUBIT_API_KEY || !process.env.MUBIT_MODEL) {
    console.error("Missing MUBIT_API_KEY or MUBIT_MODEL. Copy .env.example to .env.local and fill both in.");
    process.exit(1);
  }

  const n = parseN();
  // Gemini's free tier caps generate-content at 15 req/min per model, and
  // src/lib/llm.ts paces under that. Concurrency above ~2 just queues behind
  // the pacer while making the log harder to read.
  const limit = pLimit(Number(process.env.TRAIN_CONCURRENCY ?? 2));
  let ok = 0;
  let failed = 0;
  const startedAt = Date.now();

  console.log(
    `Running ${n} scenario(s) through RackArchitect + RepairAgent.\n` +
      `Paced under the free tier's 15 req/min cap, so expect roughly ${Math.ceil((n * 2) / 12)} minute(s).`
  );

  const tasks = Array.from({ length: n }, (_, i) => i + 1).map((seed) =>
    limit(async () => {
      try {
        await runOne(seed);
        ok += 1;
        console.log(`[${ok + failed}/${n}] seed ${seed} ok`);
      } catch (err) {
        failed += 1;
        console.error(`[${ok + failed}/${n}] seed ${seed} FAILED: ${err instanceof Error ? err.message : String(err)}`);
      }
    })
  );

  await Promise.all(tasks);

  const elapsedMin = ((Date.now() - startedAt) / 60000).toFixed(1);
  console.log(`\nDone in ${elapsedMin} min. ${ok} ok, ${failed} failed.`);
  console.log("Check the Mubit console for the RackArchitect and RepairAgent task example counts.");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
