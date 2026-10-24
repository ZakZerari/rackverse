// Drives the four agent tasks past Mubit's adapter training threshold.
//
//   npm run train-adapters            -- fill every agent to the default goal
//   npm run train-adapters -- --goal 40
//   npm run train-adapters -- --agent RackEditor --agent RequirementsAgent
//   npm run train-adapters -- --dry-run
//
// What it is doing, and why, from Mubit's docs:
//
//   * "By default, a task first trains at 25 kept examples; the count your
//     console shows is the source of truth." We aim past 25 because "Not
//     every call becomes a kept example" and a task also needs spares to hold
//     back as test cases.
//   * Every failure state in the docs recovers the same way: "Send more calls
//     with new messages." So this sends DISTINCT scenarios from
//     src/lib/training/corpus.ts, never the same brief twice.
//   * Scenario text rides in the user message, which is none of the fields
//     that define a task ("instructions; tools; tool choice; output format;
//     model"). Any number of racks therefore lands on FOUR tasks — one per
//     agent. There is no adapter per rack, and corpus.test.ts pins that.
//
// Cost control: it reads what has already been sent on each agent's current
// task and only runs the work still needed, so a resumed run is cheap and an
// already-trained agent is skipped entirely.
import pLimit from "p-limit";
import { AGENT_LIST, type AgentName } from "@/lib/agents/registry";
import { catalogItemFor } from "@/lib/catalog";
import { isDailyQuotaError } from "@/lib/llm";
import { designFromPrompt, repairOnly } from "@/lib/orchestrate";
import { breakDesign } from "@/lib/scenarios";
import { designScenario, editScenario } from "@/lib/training/corpus";
import { baseDesignsNeeded, planTurns } from "@/lib/training/plan";
import {
  DEFAULT_GOAL,
  KEPT_EXAMPLE_THRESHOLD,
  readProgress,
  renderProgress,
} from "@/lib/training/progress";
import type { Design, Requirements } from "@/lib/types";
import { hardViolations, validateDesign } from "@/lib/validate";

try {
  process.loadEnvFile(".env.local");
} catch {
  // .env.local may not exist; env vars could come from the shell instead.
}

function flagValue(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i === -1 ? undefined : process.argv[i + 1];
}

function flagValues(name: string): string[] {
  const out: string[] = [];
  process.argv.forEach((arg, i) => {
    if (arg === `--${name}` && process.argv[i + 1]) out.push(process.argv[i + 1]);
  });
  return out;
}

const hasFlag = (name: string) => process.argv.includes(`--${name}`);

/** A fresh brief: RequirementsAgent + RackArchitect, and Repair if it slips. */
async function runDesignTurn(index: number): Promise<Design & { requirements: Requirements } | null> {
  const scenario = designScenario(index);
  const result = await designFromPrompt(scenario.prompt, { runId: `train-design-${index}` });
  return { ...result.design, requirements: result.requirements };
}

/** A follow-up on a real rack: RequirementsAgent + RackEditor. */
async function runAmendTurn(index: number, base: Design, requirements: Requirements): Promise<void> {
  const scenario = editScenario(index);
  await designFromPrompt(scenario.prompt, {
    runId: `train-amend-${index}`,
    currentDesign: base,
    currentRequirements: requirements,
    history: [{ user: "built this rack", outcome: `${base.placements.length} devices` }],
  });
}

/** Deliberate damage, then RepairAgent. Repair only fires on real violations,
 *  so the fault has to actually break something. */
async function runRepairTurn(index: number, base: Design, requirements: Requirements): Promise<void> {
  let broken = breakDesign(base, () => (index % 7) / 7);

  if (hardViolations(validateDesign(broken.design, requirements)).length === 0) {
    const target = base.placements.find((p) => (catalogItemFor(base, p.catalogId)?.heightU ?? 0) > 0);
    if (!target) return;
    broken = {
      fault: "out_of_bounds",
      description: "Pushed equipment past the top of the rack.",
      design: {
        ...base,
        version: base.version + 1,
        placements: base.placements.map((p) =>
          p.id === target.id ? { ...p, startU: base.rack.heightU + 2 } : p
        ),
      },
    };
  }

  await repairOnly(broken.design, requirements, { runId: `train-repair-${index}` });
}

async function main() {
  if (!process.env.MUBIT_API_KEY || !process.env.MUBIT_MODEL) {
    console.error("Missing MUBIT_API_KEY or MUBIT_MODEL. Copy .env.example to .env.local and fill both in.");
    process.exit(1);
  }

  const goal = Number(flagValue("goal") ?? DEFAULT_GOAL);
  const only = flagValues("agent") as AgentName[];
  const dryRun = hasFlag("dry-run");

  const before = readProgress();
  console.log(`\nMubit adapter trainer — target ${goal} recorded calls per task ` +
    `(Mubit trains at ${KEPT_EXAMPLE_THRESHOLD} KEPT examples; not every call is kept).\n`);
  console.log("Before:");
  console.log(renderProgress(before, goal));

  const deficits = {} as Record<AgentName, number>;
  for (const agent of AGENT_LIST) {
    const row = before.find((r) => r.agent === agent.name);
    const wanted = only.length > 0 && !only.includes(agent.name) ? 0 : goal - (row?.sent ?? 0);
    deficits[agent.name] = Math.max(0, wanted);
  }

  const plan = planTurns(deficits);

  const designTurns = baseDesignsNeeded(plan);

  const totalTurns = designTurns + plan.amend + plan.repair;
  // Paced under Gemini's free-tier 15 req/min by src/lib/llm.ts.
  const estimatedCalls = totalTurns * 2;

  console.log(
    `\nPlan: ${designTurns} design · ${plan.amend} amend · ${plan.repair} repair` +
      `  (~${estimatedCalls} calls, roughly ${Math.ceil(estimatedCalls / 12)} min at the paced rate)\n`
  );

  if (totalTurns === 0) {
    console.log("Every task is already at the goal. Nothing to send.");
    return;
  }
  if (dryRun) {
    console.log("--dry-run: stopping before sending anything.");
    return;
  }

  const limit = pLimit(Number(process.env.TRAIN_CONCURRENCY ?? 2));
  const startedAt = Date.now();
  let done = 0;
  let failed = 0;

  /**
   * The provider's daily quota is a wall, not a hiccup: every remaining turn
   * would fail the same way. Stop the run the first time we see it rather
   * than printing the same error dozens of times.
   */
  let quotaExhausted: string | null = null;
  const noteFailure = (err: unknown): string => {
    if (isDailyQuotaError(err) && !quotaExhausted) {
      const retry = (err instanceof Error ? err.message : String(err)).match(/retry in ([0-9hms.]+)/i);
      quotaExhausted = retry ? `provider daily quota exhausted — resets in ${retry[1]}` : "provider daily quota exhausted";
    }
    return err instanceof Error ? err.message.slice(0, 90) : String(err);
  };
  const tick = (label: string) => {
    done += 1;
    const mins = ((Date.now() - startedAt) / 60000).toFixed(1);
    console.log(`[${done}/${totalTurns}] ${label}  (${mins} min elapsed)`);
  };

  // Design turns first: amend and repair both need a real rack to work on,
  // and these produce them.
  const designs: { design: Design; requirements: Requirements }[] = [];
  const designJobs = Array.from({ length: designTurns },
    (_, i) => limit(async () => {
      if (quotaExhausted) return;
      try {
        const result = await runDesignTurn(i);
        if (result) {
          const { requirements, ...design } = result;
          designs.push({ design, requirements });
        }
        tick(`design ${i}`);
      } catch (err) {
        failed += 1;
        tick(`design ${i} FAILED: ${noteFailure(err)}`);
      }
    })
  );
  await Promise.all(designJobs);

  if (quotaExhausted) {
    console.error(`\nStopped: ${quotaExhausted}.`);
    console.error("Nothing more can be sent until it resets. Re-run this job then — it resumes from what is already recorded.");
    console.log("\nProgress at the point it stopped:");
    console.log(renderProgress(readProgress(), goal));
    process.exit(1);
  }

  if (designs.length === 0) {
    console.error("\nNo design turn succeeded, so there is no rack to amend or repair. Stopping.");
    process.exit(1);
  }

  const pickBase = (i: number) => designs[i % designs.length];

  const followUps = [
    ...Array.from({ length: plan.amend }, (_, i) => limit(async () => {
      if (quotaExhausted) return;
      const base = pickBase(i);
      try {
        await runAmendTurn(i, base.design, base.requirements);
        tick(`amend ${i}`);
      } catch (err) {
        failed += 1;
        tick(`amend ${i} FAILED: ${noteFailure(err)}`);
      }
    })),
    ...Array.from({ length: plan.repair }, (_, i) => limit(async () => {
      if (quotaExhausted) return;
      const base = pickBase(i);
      try {
        await runRepairTurn(i, base.design, base.requirements);
        tick(`repair ${i}`);
      } catch (err) {
        failed += 1;
        tick(`repair ${i} FAILED: ${noteFailure(err)}`);
      }
    })),
  ];
  await Promise.all(followUps);

  const after = readProgress();
  if (quotaExhausted) console.log(`\nStopped early: ${quotaExhausted}.`);
  console.log(`\nAfter (${((Date.now() - startedAt) / 60000).toFixed(1)} min, ${failed} turn(s) failed):`);
  console.log(renderProgress(after, goal));

  console.log(
    "\nThese are calls we recorded, not kept examples. Mubit decides what it keeps, " +
      "and the console's per-task count is the source of truth.\n" +
      "Check Tasks in the console: each agent should show ONE task collecting examples."
  );
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
