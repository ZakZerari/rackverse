// Picks MUBIT_MODEL on evidence rather than vibes.
//
// Why this exists: we originally ran on `gemini-3.8-flash` and every call took
// 19-163s. Probing all models CONCURRENTLY through the same proxy and key
// showed it wasn't the proxy, the schema or the prompt — 3.8-flash alone was
// throttled to ~105s while five other models answered in 1-3s. Re-run this if
// latency regresses mid-event; availability on this tier moves around.
//
//   npm run pick-model
import { CATALOG } from "@/data/catalog";
import { RACK_ARCHITECT_SYSTEM } from "@/lib/agents/architect";
import { getMubitClient, toGeminiJsonSchema } from "@/lib/llm";
import { ArchitectOutputSchema } from "@/lib/schemas";
import { generateRequirements } from "@/lib/scenarios";
import type { Design } from "@/lib/types";
import { hardViolations, validateDesign } from "@/lib/validate";
import { z } from "zod";

try {
  process.loadEnvFile(".env.local");
} catch {
  // env may come from the shell
}

const client = getMubitClient();
const CANDIDATES = [
  "gemini-3.5-flash-lite",
  "gemini-3.1-flash-lite",
  "gemini-flash-lite-latest",
  "gemini-3.6-flash",
  "gemini-3.5-flash",
  "gemini-3.8-flash",
];
const SEEDS = [1, 2, 3];

const jsonSchema = toGeminiJsonSchema(
  z.toJSONSchema(ArchitectOutputSchema, { target: "draft-7" })
) as Record<string, unknown>;

interface Outcome {
  model: string;
  seed: number;
  ms: number;
  ok: boolean;
  hard?: number;
  error?: string;
}

/** One real Architect call: same system prompt, catalog and schema as production. */
async function runOne(model: string, seed: number): Promise<Outcome> {
  const requirements = generateRequirements(seed);
  const user = JSON.stringify({
    requirements,
    catalog: CATALOG.map((c) => JSON.stringify(c)).join("\n"),
  });
  const started = Date.now();

  try {
    const res = await client.chat.completions.create({
      model,
      messages: [
        { role: "system", content: RACK_ARCHITECT_SYSTEM },
        { role: "user", content: user },
      ],
      response_format: {
        type: "json_schema",
        json_schema: { name: "Architect", schema: jsonSchema, strict: false },
      },
    });

    const parsed = ArchitectOutputSchema.parse(JSON.parse(res.choices[0]?.message?.content ?? ""));
    const design: Design = {
      rack: {
        id: "r",
        name: parsed.rackName,
        heightU: requirements.rackHeightU,
        mountingDepthMm: parsed.mountingDepthMm,
        maxLoadKg: parsed.maxLoadKg,
        powerBudgetW: requirements.powerBudgetW,
      },
      placements: parsed.placements.map((p, i) => ({ id: `p${i}`, ...p })),
      version: 1,
    };

    return {
      model,
      seed,
      ms: Date.now() - started,
      ok: true,
      hard: hardViolations(validateDesign(design, requirements)).length,
    };
  } catch (err) {
    return {
      model,
      seed,
      ms: Date.now() - started,
      ok: false,
      error: err instanceof Error ? err.message.slice(0, 90) : String(err),
    };
  }
}

async function main() {
  if (!process.env.MUBIT_API_KEY) {
    console.error("Missing MUBIT_API_KEY. Copy .env.example to .env.local and fill it in.");
    process.exit(1);
  }

  console.log(`Real Architect workload — ${CANDIDATES.length} models x ${SEEDS.length} seeds, all concurrent.\n`);
  const results = await Promise.all(CANDIDATES.flatMap((m) => SEEDS.map((s) => runOne(m, s))));

  const summary = CANDIDATES.map((model) => {
    const rows = results.filter((r) => r.model === model);
    const parsed = rows.filter((r) => r.ok);
    return {
      model,
      avgMs: rows.reduce((s, r) => s + r.ms, 0) / rows.length,
      parsed: parsed.length,
      validFirstTry: parsed.filter((r) => r.hard === 0).length,
      total: rows.length,
      errors: rows.filter((r) => !r.ok).map((r) => r.error),
    };
  }).sort((a, b) => b.validFirstTry - a.validFirstTry || a.avgMs - b.avgMs);

  console.log("avg      parsed  valid-1st  model");
  for (const s of summary) {
    console.log(
      `${`${(s.avgMs / 1000).toFixed(1)}s`.padStart(7)}  ${`${s.parsed}/${s.total}`.padStart(6)}  ${`${s.validFirstTry}/${s.total}`.padStart(9)}  ${s.model}`
    );
    for (const e of s.errors) if (e) console.log(`         ${e}`);
  }

  const best = summary[0];
  console.log(`\nRecommended: MUBIT_MODEL=${best.model} (${(best.avgMs / 1000).toFixed(1)}s avg)`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
