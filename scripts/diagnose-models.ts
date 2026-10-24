// Temporary diagnostic: is the latency per-model, or a flat proxy queue?
// Fires all candidates CONCURRENTLY so the whole probe costs ~one round trip.
import { getMubitClient } from "@/lib/llm";

try {
  process.loadEnvFile(".env.local");
} catch {
  // env may come from the shell
}

const client = getMubitClient();

const CANDIDATES = [
  "gemini-3.8-flash",
  "gemini-3.6-flash",
  "gemini-3.5-flash",
  "gemini-3.5-flash-lite",
  "gemini-3.1-flash-lite",
  "gemini-flash-lite-latest",
  "gemini-2.5-flash-lite",
  "gemini-2.5-flash",
];

async function probe(model: string) {
  const started = Date.now();
  try {
    const stream = await client.chat.completions.create({
      model,
      messages: [{ role: "user", content: "Reply with the single word: ok" }],
      stream: true,
      stream_options: { include_usage: true },
    });
    let ttft: number | null = null;
    let text = "";
    for await (const chunk of stream) {
      const delta = chunk.choices[0]?.delta?.content;
      if (delta) {
        if (ttft === null) ttft = Date.now() - started;
        text += delta;
      }
    }
    return { model, totalMs: Date.now() - started, ttftMs: ttft, text: text.trim().slice(0, 30) };
  } catch (err) {
    return {
      model,
      totalMs: Date.now() - started,
      ttftMs: null,
      error: err instanceof Error ? err.message.slice(0, 120) : String(err),
    };
  }
}

async function main() {
  console.log(`Probing ${CANDIDATES.length} models concurrently (streaming, trivial prompt)...\n`);
  const results = await Promise.all(CANDIDATES.map(probe));
  results.sort((a, b) => a.totalMs - b.totalMs);

  console.log("total     ttft      model                         result");
  for (const r of results) {
    const total = `${(r.totalMs / 1000).toFixed(1)}s`.padStart(8);
    const ttft = (r.ttftMs === null ? "—" : `${(r.ttftMs / 1000).toFixed(1)}s`).padStart(8);
    const detail = "error" in r && r.error ? `ERROR ${r.error}` : `"${r.text}"`;
    console.log(`${total}  ${ttft}  ${r.model.padEnd(28)}  ${detail}`);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
