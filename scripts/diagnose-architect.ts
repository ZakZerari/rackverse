// Temporary diagnostic: pick a model on the REAL Architect workload, not a
// toy prompt. Measures latency, schema validity, and how many hard violations
// the deterministic validator finds in each model's proposed design.
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
const CANDIDATES = ["gemini-3.5-flash-lite", "gemini-3.1-flash-lite", "gemini-3.6-flash", "gemini-3.5-flash"];
const SEEDS = [1, 2, 3];

const jsonSchema = toGeminiJsonSchema(z.toJSONSchema(ArchitectOutputSchema, { target: "draft-7" }));

async function runOne(model: string, seed: number) {
  const requirements = generateRequirements(seed);
  const user = JSON.stringify({ requirements, catalog: CATALOG.map((c) => JSON.stringify(c)).join("\n") });
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
        json_schema: { name: "Architect", schema: jsonSchema as Record<string, unknown>, strict: false },
      },
    });

    const ms = Date.now() - started;
    const raw = res.choices[0]?.message?.content ?? "";
    const parsed = ArchitectOutputSchema.parse(JSON.parse(raw));
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
    const hard = hardViolations(validateDesign(design, requirements)).length;
    return { model, seed, ms, ok: true, placements: parsed.placements.length, hard, tokens: res.usage?.total_tokens };
  } catch (err) {
    return {
      model,
      seed,
      ms: Date.now() - started,
      ok: false,
      error: err instanceof Error ? err.message.slice(0, 100) : String(err),
    };
  }
}

async function main() {
  console.log(`Real Architect workload — ${CANDIDATES.length} models x ${SEEDS.length} seeds, concurrent.\n`);
  const results = await Promise.all(CANDIDATES.flatMap((m) => SEEDS.map((s) => runOne(m, s))));

  for (const model of CANDIDATES) {
    const rows = results.filter((r) => r.model === model);
    const okRows = rows.filter((r) => r.ok);
    const avgMs = rows.reduce((s, r) => s + r.ms, 0) / rows.length;
    const validFirstTry = okRows.filter((r) => "hard" in r && r.hard === 0).length;
    console.log(
      `${model.padEnd(26)} avg ${(avgMs / 1000).toFixed(1)}s  parsed ${okRows.length}/${rows.length}  valid-first-try ${validFirstTry}/${rows.length}`
    );
    for (const r of rows) {
      const detail = r.ok
        ? `${"placements" in r ? r.placements : "?"} placements, ${"hard" in r ? r.hard : "?"} hard violations, ${"tokens" in r ? r.tokens : "?"} tokens`
        : `ERROR ${"error" in r ? r.error : ""}`;
      console.log(`   seed ${r.seed}: ${(r.ms / 1000).toFixed(1)}s  ${detail}`);
    }
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
