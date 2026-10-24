# Mubit integration notes

Findings from skimming https://docs.mubit.ai (and its `/llms-full.txt`) before writing `src/lib/llm.ts`. Anything not confirmed here should be treated as unverified.

## Base URL & auth

- Generic OpenAI-compatible proxy: `https://api.mubit.ai/openai/v1`.
- **We actually run on Gemini**, per the team's choice, via Mubit's OpenAI-compatible route for Gemini specifically: `https://api.mubit.ai/gemini/v1beta/openai` (confirmed live — see Smoke test status below). This is a different base URL from the generic one above; everything else about the `openai` npm SDK usage is identical, so we still satisfy "exactly one module, one SDK" (`src/lib/llm.ts`, `MUBIT_BASE_URL`).
- Auth: pass the Mubit key as the OpenAI SDK's `apiKey`.
- Model: `gemini-3.8-flash` (the only model id Mubit's Gemini guide documents).
- There's also a *native* Gemini-SDK route documented (`https://api.mubit.ai/gemini`, via `google-genai`, not the `openai` package) — we deliberately don't use it, since the hackathon rule is one `openai`-SDK module.

```ts
const client = new OpenAI({ baseURL: "https://api.mubit.ai/gemini/v1beta/openai", apiKey: process.env.MUBIT_API_KEY });
```

**Gotcha (confirmed live, not just docs):** Gemini's OpenAI-compat shim 400s on `metadata` — `{"error":{"message":"Invalid JSON payload received. Unknown name \"metadata\": Cannot find field."}}`. So `src/lib/llm.ts` does NOT send `metadata` on this route (session grouping below is therefore unverified for Gemini specifically — our own `runId`/`agent` fields still land in `data/calls.jsonl` for local tracing).

## Sessions vs. tasks (this matters for our architecture)

These are two different, unrelated groupings — don't conflate them:

- **Session** (groups calls that belong to one conversation/run, for the console's log view): set via `metadata`, first of `metadata.thread_id`, `metadata.session_id`, `metadata.conversation_id` that's present. We use `session_id` with our own `runId`. Values over 200 chars get hashed. There is **no documented `agent` metadata field** — passing extra keys (we pass `agent`) is harmless but doesn't affect grouping.
- **Task** (what an adapter actually trains on): calls form one task when they share **all** of: instructions (system prompt), tools, tool choice, output format, and model. This is exactly why principle #4 in the brief (one constant system prompt per agent, one model, one output format, nothing dynamic in the system prompt) matters — it's the difference between each agent accumulating its own trainable task vs. silently fragmenting into many untrainable ones.

## Structured output

Docs don't explicitly confirm `response_format: json_schema` support versus `json_object` — it reads as a pass-through to the underlying provider. `src/lib/llm.ts` handles this defensively: it tries `json_schema` first, and if the very first call fails in a way that looks like an unsupported `response_format`, it falls back to `json_object` and remembers that for the rest of the process. Run `npm run smoke-mubit` once `.env.local` is filled in — it prints which mode actually worked, and that result gets appended below.

## Adapter training

- A task trains automatically once it reaches **25 kept examples** by default (console is the source of truth, this number can vary).
- "Kept example" = a call Mubit accepts for training/testing — not every recorded call is kept. Exact acceptance criteria aren't documented.
- This is why `npm run train-traffic` exists: it generates volume specifically for `RackArchitect` and `RepairAgent` so their tasks cross the training threshold during the hackathon.

## Try models (console feature)

- Lets you compare a passed adapter version side-by-side with the base provider model. You type only the user message; Mubit supplies the task's instructions.
- Calls made in Try models are explicitly "not stored · trains nothing" — they don't pollute the training loop. This is also why the Lab page's adapter row (Config C) is a placeholder pointing at the console rather than a number we compute ourselves — see the honesty principle in the brief.

## Feedback / outcome recording

- The console UI has a manual "Rate this reply: Good/Bad" control on individual calls. **No documented programmatic API** for submitting feedback or outcomes.
- Consequence: our "lessons learned" loop (`data/lessons.json`) is entirely local — a verified Repair patch gets appended locally and retrieved for future `RepairAgent` calls. We never claim this is a Mubit-side feature, and the Lab page says so explicitly.

## Errors

- Error responses name their code; the response carries the call's ID in the `x-middleware-request-id` header for support/debugging.
- No general rate limit numbers documented; there is a daily cap on "Try models" calls and on adapter training starts.

## Smoke test status

**PASSED.** `npm run smoke-mubit` against `https://api.mubit.ai/gemini/v1beta/openai`, model `gemini-3.8-flash`:

```
Mubit responded: { ok: true, note: 'Connection successful' }
Structured output mode that worked: json_schema
```

So `response_format: { type: "json_schema", ... }` works on this route — `src/lib/llm.ts` no longer needs to fall back to `json_object` for Gemini. (The call to Mubit's console to visually confirm the call landed there is still something a human needs to do — not something I can check myself.)
