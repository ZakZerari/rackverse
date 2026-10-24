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

## The free-tier rate limit, which explains almost everything

Running 30 training scenarios surfaced the constraint we'd been fighting blind all along. Google states it outright in the 429 body:

```
limit: 15, model: gemini-3.5-flash-lite
quotaId: GenerateRequestsPerMinutePerProjectPerModel-FreeTier
Please retry in 50.602284406s.
```

**15 generate-content requests per minute, per model, on the free tier.** That one fact accounts for:

- **The original "latency".** `gemini-3.8-flash` wasn't slow — the OpenAI SDK defaults to `maxRetries: 2` and silently retries 429s with backoff, so a rate-limited call *looked* like a 105-second response. (We now set `maxRetries: 0` and handle retries ourselves, visibly.)
- **The 1-of-14 keep rate.** A 429'd call never becomes a kept example. Most calls were failing, so almost nothing was eligible for training.
- **18 of 30 scenarios failing** at concurrency 4 — two sequential calls per scenario blows through 15/min immediately.

### What we do about it

`src/lib/llm.ts` now paces itself: a sliding 60-second window capped at `MUBIT_RPM` (default 12, leaving headroom under 15), shared by every call in the process. When it has to wait, it says so in the Copilot thread rather than looking hung.

On a 429 we honour **the server's own retry window** (`RetryInfo.retryDelay`, typically 25–50s) instead of our 4-second backoff ladder, capped at 65s. `retryAfterMs()` parses both the prose and the structured field, tested against the verbatim 429 we received.

`train-traffic` defaults to concurrency 2 (`TRAIN_CONCURRENCY` to override) and estimates its own runtime from the cap. Note the pacer is per-process, so the dev server and a script running together share the real quota but not the window — don't run large batches while demoing.

**If you upgrade the Gemini key to a paid tier, raise `MUBIT_RPM`** and these constraints largely disappear.

## Task fragmentation — why no adapter was training

The console showed **20 tasks for 3 agents**: `RackArchitect part of server`, `…part of server 2`, `3`, `4`, `6`, two `RequirementsAgent` variants, two `RepairAgent` variants, an unnamed `Task 5`. The busiest had 14 calls but **1 kept example** against a threshold of 25. Nothing could ever train.

**Cause: we forked the tasks ourselves.** Per `/guides/tasks-and-sessions`, calls form one task when they share *all* of: instructions, tools, tool choice, output format, model. Over the build we changed:

| Change | Forks? |
|---|---|
| `gemini-3.8-flash` → `gemini-3.5-flash-lite` | **Yes** — confirmed: *"the same instructions sent to two different models make two tasks"* (`/guides/model-ids`) |
| Rewrote the JSON schema (`oneOf`→`anyOf`) | **Probably** — "output format" counts, but the docs never define it. Inference. |
| Non-streaming → `stream: true` | **Unknown** — `stream` is in neither the identity list nor the exclusions. Undocumented. |
| Removed `metadata` | **No** — metadata only selects the *session*. |

Task names are literally the first words of the instructions, which is why they all read "…part of a server rack design system". The numeric suffix is undocumented; most likely disambiguation.

There is **no documented way to merge, rename, or re-point tasks**, and no task-management API. The fragmented ones are unrecoverable — the only move is to freeze identity and let clean tasks accumulate.

### What we did about it

- `src/lib/agents/registry.ts` is now the single place every identity-bearing field lives (instructions + schema per agent), with `taskFingerprint()` mirroring Mubit's documented normalisation (whitespace collapsed; numbers/dates/IDs don't split a task).
- `src/lib/agents/fingerprint.test.ts` **pins those fingerprints**. Change a prompt or schema and the suite fails with "this forks its Mubit task. Update the pin only if that's intended." It caught a real drift the first time it ran.
- We took **one final deliberate fork** to land everything at once (compact catalog format in the prompts, final schema, final model) — then froze. Expect exactly 3 new tasks from here, plus the smoke test's own.

### Keeping more examples

Documented rules only (`/concepts`):
- *"A call Mubit accepts for training or testing. Not every recorded call becomes a kept example."*
- The one hard exclusion: *"A call recorded without its request and reply is never a kept example"* — caused by `x-middleware-store: false` or `x-middleware-record: metadata|off`. We send neither.
- Some kept examples are deliberately withheld as test cases.
- Length matters: *"examples too long to train on → Send calls with shorter requests and answers."*

That last one was actionable. The catalog was being inlined as JSON into every Architect and Repair call at **~1,900 tokens**; it's now a pipe-delimited table at **~590 tokens** (3.2× smaller), which is the bulk of each request.

**Still unverified** (not in the docs, flagged rather than guessed): whether streaming suppresses keeping, whether failed/retried calls are excluded, and whether near-identical requests are deduped. If the keep rate stays low with clean tasks, streaming is the first thing to test — it's a one-line switch in `src/lib/llm.ts`.

## Model choice — this was the whole ballgame

We originally ran on `gemini-3.8-flash` and **every** call took 19-163s. A 44-token prompt returning 12 tokens took 137s. Latency didn't scale with token count, which ruled out generation being the bottleneck.

Diagnosis, in order:

1. **Not thinking.** `reasoning_effort: "none"` only halved a trivial call (108s → 53s), and `"low"` made no difference (115s). Gemini 3.x does have thinking on by default (3.8-flash defaults to `medium` and *rejects* `minimal`), but that wasn't the main cost.
2. **Not the schema or prompt size.** A plain "reply with ok" — no `response_format`, 44 tokens — still took 108s.
3. **Not the Mubit proxy.** This is the decisive test: probing eight models **concurrently**, through the same proxy, on the same key, in the same second:

   | model | latency |
   |---|---|
   | `gemini-3.5-flash-lite` | **1.1s** |
   | `gemini-flash-lite-latest` | 1.1s |
   | `gemini-3.1-flash-lite` | 1.3s |
   | `gemini-3.6-flash` | 1.9s |
   | `gemini-3.5-flash` | 2.6s |
   | `gemini-3.8-flash` | **105.1s** |

   Five models answered in ~1-3s while 3.8-flash took 105s. **`gemini-3.8-flash` is simply throttled to uselessness on this tier** — it's the newest/most contended model. We also saw bare `429 quota exceeded` and `503 high demand` from the larger models.

**Decision: `MUBIT_MODEL=gemini-3.5-flash-lite`.** On the *real* Architect workload (full catalog, real schema, 3 seeds) it averaged **2.2s**, parsed 3/3, and produced designs the deterministic validator passed 3/3 first try — so it's both the fastest *and* the most accurate option here. `npm run pick-model` re-runs that comparison if latency regresses mid-event.

Measured end-to-end after the switch: **prompt → rendered valid rack in ~4-6s** (was ~143s), and **Break → Repair → Verify in ~2-3s** (was ~163s).

### A real bug this uncovered

Gemini's structured-output schema subset does **not** include `oneOf`, and Zod ≥4.1.13 compiles `z.discriminatedUnion` to exactly that — so our `PatchSchema` (the RepairAgent's output contract) was being sent in a form Gemini can't constrain against. `toGeminiJsonSchema()` in `src/lib/llm.ts` now rewrites `oneOf`→`anyOf` and `const`→single-value `enum`, with tests in `src/lib/llm.test.ts` asserting nothing unsupported survives.

### Consequences for the batch scripts

`train-traffic` and `bench` were written when calls cost ~150s, so they take `--n` / `--train-n` / `--held-out-n` flags to keep sanity runs cheap. At ~2s/call those full runs are now genuinely practical rather than hour-long commitments.
