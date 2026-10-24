// Generates call volume for RackArchitect and RepairAgent so their Mubit
// tasks cross the adapter training threshold. Run with:
//   npm run train-traffic -- --n 60
//
// Calls are paced under the configured provider quota. Each scenario makes
// at least one RackArchitect and one RepairAgent call against a real fault.
// Use --start to avoid repeating prior seeds, e.g. --n 30 --start 31.
import pLimit from "p-limit";
import { designFromRequirements, repairOnly } from "@/lib/orchestrate";
import { breakDesign, generateRequirements } from "@/lib/scenarios";
import { catalogItemFor } from "@/lib/catalog";
import { hardViolations, validateDesign } from "@/lib/validate";

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

function parseStart(): number {
  const flagIndex = process.argv.indexOf("--start");
  if (flagIndex === -1) return 1;
  const value = Number(process.argv[flagIndex + 1]);
  return Number.isInteger(value) && value > 0 ? value : 1;
}

async function runOne(seed: number): Promise<"verified" | "unrepaired"> {
  const runId = `train-${seed}`;
  const requirements = generateRequirements(seed);

  // RackArchitect call (always).
  const { design } = await designFromRequirements(requirements, { runId });

  // Guarantee RepairAgent also gets volume on scenarios the Architect
  // already got right the first time, by deliberately breaking the result
  // and repairing it again.
  let broken = breakDesign(design, () => (seed % 4) / 4);
  if (hardViolations(validateDesign(broken.design, requirements)).length === 0) {
    const target = design.placements.find((placement) => (catalogItemFor(design, placement.catalogId)?.heightU ?? 0) > 0);
    if (!target) throw new Error("Architect produced no rack-mounted equipment to challenge.");
    broken = { fault: "out_of_bounds", description: "Moved equipment beyond rack height.", design: {
      ...design, version: design.version + 1,
      placements: design.placements.map((placement) => placement.id === target.id
        ? { ...placement, startU: design.rack.heightU + 1 } : placement),
    } };
  }
  const repaired = await repairOnly(broken.design, requirements, { runId: `${runId}-break` });
  return hardViolations(validateDesign(repaired.design, requirements)).length === 0 ? "verified" : "unrepaired";
}

async function main() {
  if (!process.env.MUBIT_API_KEY || !process.env.MUBIT_MODEL) {
    console.error("Missing MUBIT_API_KEY or MUBIT_MODEL. Copy .env.example to .env.local and fill both in.");
    process.exit(1);
  }

  const n = parseN();
  const start = parseStart();
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

  const tasks = Array.from({ length: n }, (_, i) => start + i).map((seed) =>
    limit(async () => {
      try {
        const status = await runOne(seed);
        if (status === "verified") ok += 1;
        else failed += 1;
        console.log(`[${ok + failed}/${n}] seed ${seed} ${status}`);
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
