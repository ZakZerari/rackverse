// One real authenticated call through Mubit, to confirm the integration works
// end to end before anything else is built on top of it. Run with:
//   npm run smoke-mubit
import { z } from "zod";
import { complete } from "@/lib/llm";

try {
  process.loadEnvFile(".env.local");
} catch {
  // .env.local may not exist yet; env vars could also come from the shell.
}

const SmokeSchema = z.object({
  ok: z.boolean(),
  note: z.string(),
});

const SYSTEM = "You are a connectivity smoke test. Always respond with JSON only, matching the required schema. Never include prose or code fences.";

async function main() {
  if (!process.env.MUBIT_API_KEY || !process.env.MUBIT_MODEL) {
    console.error(
      "Missing MUBIT_API_KEY or MUBIT_MODEL. Copy .env.example to .env.local and fill both in, then re-run `npm run smoke-mubit`."
    );
    process.exit(1);
  }

  console.log(`Calling Mubit at model "${process.env.MUBIT_MODEL}"...`);
  const result = await complete({
    agent: "SmokeTest",
    system: SYSTEM,
    user: 'Reply with {"ok": true, "note": "<a short confirmation message>"}.',
    schema: SmokeSchema,
    runId: "smoke-test",
    recordForTraining: false,
  });

  console.log("Mubit responded:", result);
  console.log("\nSmoke test PASSED. This diagnostic call opted out of recording so it does not create a training task.");
}

main().catch((err) => {
  console.error("\nMubit smoke test FAILED:", err);
  process.exit(1);
});
