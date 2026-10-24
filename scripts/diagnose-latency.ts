// Temporary diagnostic: where is the latency actually coming from?
// Uses the shared Mubit client from src/lib/llm.ts so `npm run check:llm` still passes.
import { getMubitClient } from "@/lib/llm";

try {
  process.loadEnvFile(".env.local");
} catch {
  // env may come from the shell
}

const client = getMubitClient();
const MODEL = process.env.MUBIT_MODEL ?? "gemini-3.8-flash";

async function time<T>(label: string, fn: () => Promise<T>): Promise<void> {
  const started = Date.now();
  try {
    const result = await fn();
    const ms = Date.now() - started;
    const preview = JSON.stringify(result).slice(0, 160);
    console.log(`${String(ms).padStart(7)}ms  ${label}\n           -> ${preview}`);
  } catch (err) {
    const ms = Date.now() - started;
    console.log(`${String(ms).padStart(7)}ms  ${label}\n           -> ERROR ${err instanceof Error ? err.message.slice(0, 200) : String(err)}`);
  }
}

async function main() {
  console.log(`model: ${MODEL}\n`);

  console.log("--- available models ---");
  try {
    const models = await client.models.list();
    console.log(models.data.map((m) => m.id).join("\n"));
  } catch (err) {
    console.log(`models.list() failed: ${err instanceof Error ? err.message : String(err)}`);
  }

  console.log("\n--- latency probes (trivial prompt) ---");
  const trivial = [{ role: "user" as const, content: "Reply with the single word: ok" }];

  await time("plain, no response_format", () =>
    client.chat.completions.create({ model: MODEL, messages: trivial }).then((r) => r.choices[0]?.message?.content)
  );

  await time('reasoning_effort: "none"', () =>
    client.chat.completions
      .create({ model: MODEL, messages: trivial, reasoning_effort: "none" })
      .then((r) => r.choices[0]?.message?.content)
  );

  await time('reasoning_effort: "low"', () =>
    client.chat.completions
      .create({ model: MODEL, messages: trivial, reasoning_effort: "low" })
      .then((r) => r.choices[0]?.message?.content)
  );

  await time("thinking_budget: 0 via extra body key", () =>
    client.chat.completions
      .create({
        model: MODEL,
        messages: trivial,
        // non-standard passthrough for Gemini's OpenAI-compat layer
        extra_body: { google: { thinking_config: { thinking_budget: 0 } } },
      } as never)
      .then((r) => (r as { choices: { message: { content: string | null } }[] }).choices[0]?.message?.content)
  );

  await time("json_schema (simple 2-field object)", () =>
    client.chat.completions
      .create({
        model: MODEL,
        messages: [{ role: "user", content: 'Reply with {"ok": true, "note": "hi"}' }],
        response_format: {
          type: "json_schema",
          json_schema: {
            name: "Probe",
            schema: {
              type: "object",
              properties: { ok: { type: "boolean" }, note: { type: "string" } },
              required: ["ok", "note"],
            },
          },
        },
      })
      .then((r) => r.choices[0]?.message?.content)
  );

  await time("streaming first-token latency", async () => {
    const started = Date.now();
    const stream = await client.chat.completions.create({ model: MODEL, messages: trivial, stream: true });
    let firstTokenMs: number | null = null;
    let text = "";
    for await (const chunk of stream) {
      const delta = chunk.choices[0]?.delta?.content;
      if (delta) {
        if (firstTokenMs === null) firstTokenMs = Date.now() - started;
        text += delta;
      }
    }
    return { firstTokenMs, text };
  });
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
