# Mubit integration notes

## Current task and 503 audit (October 2026)

[Mubit's task rules](https://docs.mubit.ai/guides/tasks-and-sessions) group calls by **instructions, tools, tool choice, output format, and model**. The rack name, design, catalog entries, conversation, repair feedback, and retry message are user-message data; changing those does not create a new task. Task names are the first words of the instructions. A numbered suffix in the console is therefore evidence of several tasks with similar names, not evidence that Mubit created an agent for each physical server. The screenshot alone cannot identify which historical field changed.

Production now keeps one fixed model ID (`gemini-3.5-flash-lite`) and refuses a mismatched `MUBIT_MODEL`, shares one response-format builder between the actual request and the fingerprint test, and keeps every agent's instructions constant. `pick-model` and `smoke-mubit` use `x-middleware-record: off`, per the [API reference](https://docs.mubit.ai/reference/api), so diagnostic calls cannot add more task fragments or training examples. Their requests still reach the provider, but do not appear as kept examples. Deliberately changing a prompt, model, or output format still starts a new task; existing console tasks cannot be merged by this app.

New local call records include a `taskKey` hash of the task-defining request fields and `recordForTraining`. Equal keys across racks show that this app sent the same task identity; the key is not a Mubit task ID, and older records have no key. Mubit's console remains the source of truth for task count and kept examples.

The reported `503 ... high demand ... UNAVAILABLE` matches a **provider capacity response** passed through Mubit; this is an inference from its body and Mubit's documented error format, not an adapter-training status. A separate `503` saying the gateway could not check a key is a Mubit gateway error. [Mubit's troubleshooting guide](https://docs.mubit.ai/troubleshooting) says to retry temporary 5xx responses and honor `retry-after` where present. The app now retries with backoff while keeping the same task identity, shows retry progress instead of raw JSON, and reports a clear final error if capacity does not recover. Repair candidates run in sequence with verifier feedback to avoid sending duplicate simultaneous requests.

Training is still controlled by Mubit: by default a task first trains at 25 **kept** examples, not 25 app calls; its Tasks page is the source of truth. “Reviewing examples” means the threshold was reached and Mubit is processing them. A passing adapter is evaluated separately in Try models; app calls are forwarded to the provider. See [Create your first adapter](https://docs.mubit.ai/guides/first-adapter).

Every RepairAgent candidate now receives a local verifier verdict with its round, hard-violation counts, reason, and gateway request ID when available. `/lab` presents Good/Bad **suggestions** for manual review. [Requests](https://docs.mubit.ai/guides/requests) documents a Good/Bad console control but no feedback API or guaranteed effect on the kept-example pool. We therefore do not claim rejected patches are excluded from adapter training. The `x-middleware-request-id` header is also distinct from the console's own request ID.

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

**Gotcha (confirmed live, not just docs):** Gemini's OpenAI-compat shim 400s on `metadata` — `{"error":{"message":"Invalid JSON payload received. Unknown name \"metadata\": Cannot find field."}}`. So `src/lib/llm.ts` does NOT send `metadata` on this route. Our `runId` and `agent` fields remain in `data/calls.jsonl` for local tracing only.

## Sessions vs. tasks (this matters for our architecture)

These are two different, unrelated groupings — don't conflate them:

- **Session** (groups calls for testing and console navigation): Mubit can read supported metadata fields on some providers. Its [Tasks and sessions guide](https://docs.mubit.ai/guides/tasks-and-sessions) lists **none for Gemini** and says it derives a session from the start of the conversation. This app does not send session metadata; local `runId` does not affect Mubit grouping.
- **Task** (what an adapter actually trains on): calls form one task when they share **all** of: instructions (system prompt), tools, tool choice, output format, and model. This is exactly why principle #4 in the brief (one constant system prompt per agent, one model, one output format, nothing dynamic in the system prompt) matters — it's the difference between each agent accumulating its own trainable task vs. silently fragmenting into many untrainable ones.

## Structured output

The Gemini-compatible route accepted `response_format: json_schema` in the live smoke test below. Production keeps this format fixed; switching formats during normal traffic would fragment the Mubit task.

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

So `response_format: { type: "json_schema", ... }` works on this route — `src/lib/llm.ts` does not fall back to `json_object` for Gemini. New smoke calls opt out of Mubit recording to avoid creating diagnostic tasks.

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

- `src/lib/agents/registry.ts` lists the identity-bearing fields for each agent, and `taskFingerprint()` hashes the actual output format sent by `src/lib/llm.ts`. Its local instruction hash is deliberately conservative; Mubit may normalize some differences it flags.
- `src/lib/agents/fingerprint.test.ts` **pins those fingerprints**. Change a prompt or schema and the suite fails with "this forks its Mubit task. Update the pin only if that's intended." It caught a real drift the first time it ran.
- The compact catalog format, schema, and model were changed together and then pinned. A later deliberate RackEditor addition created a fourth production task. Smoke tests now opt out of recording.

### The second deliberate fork, and a fourth task

Conversational editing forced one more identity change. Taken deliberately and all at once, rather than drip-fed:

- **A fourth agent, `RackEditor`.** Follow-up messages had nowhere to go, so every one of them re-ran the full design pipeline from an empty rack. The obvious shortcut — route edits through `RepairAgent` — would have been the wrong call for *training*: RepairAgent answers "the validator found these violations", RackEditor answers "a person asked for this change". Same output schema, unrelated inputs. One task holding both would feed its adapter two distributions and teach it neither. Four clean tasks beat three clean plus one confused.
- **All three existing prompts forked once more** — a `tags` column in the catalog table (so "run AI models" can actually reach the GPU chassis) plus explicit redundant-power rules. Every pin in `fingerprint.test.ts` moved in the same commit, which is exactly what the pins are for: the fork is a decision with a diff attached, not an accident.

Cost: four tasks restart from zero kept examples. That was already true of the three — the console's 20 fragments are unrecoverable either way — so the only question was whether to pay it now or later, and later is strictly worse.

**Console snapshot supplied October 24:** 26 tasks, all in learning, none live. `RackArchitect part of server 7` showed 24 of 25 examples. `RepairAgent part of server 3` had a Qwen3-4B-Instruct-2507 v1 graded below target: 60% match on 15 test cases versus 85% required. That is evidence that training occurred, but not that a usable adapter passed or served requests. The snapshot is stored in `data/mubit-console-snapshot.json`; current app calls still need to be mapped to console tasks by Mubit, since the local task hash is not a Mubit task ID.

### Keeping more examples

Documented rules only (`/concepts`):
- *"A call Mubit accepts for training or testing. Not every recorded call becomes a kept example."*
- The one hard exclusion: *"A call recorded without its request and reply is never a kept example"* — caused by `x-middleware-store: false` or `x-middleware-record: metadata|off`. Production agent calls send neither; diagnostic scripts deliberately send `off` because their calls should not train adapters.
- Some kept examples are deliberately withheld as test cases.
- Length matters: *"examples too long to train on → Send calls with shorter requests and answers."*

That last one was actionable, and measuring the actual prompt composition found two offenders rather than one:

| part of the RepairAgent prompt | before | after |
|---|---|---|
| lessons | 727 tok | **131 tok** |
| catalog | 1,900 tok | **592 tok** |
| design | 307 tok | 307 tok |
| violations | 307 tok | 307 tok |
| requirements | 53 tok | 53 tok |

The catalog was inlined as JSON; it's now a pipe-delimited table. Lessons were sent as full records — verbatim context blob plus prose — and were quietly the *largest* single chunk, growing with the store (41 lessons at the time of measuring). They're now rendered as `violation codes => ops that fixed it`, which is both 5.5× smaller and a clearer signal. Measured live: RepairAgent prompts went 3,009 → 2,559 tokens and no longer grow as lessons accumulate.

**Still unverified** (not in the docs, flagged rather than guessed): whether streaming suppresses keeping, whether failed/retried calls are excluded, and whether near-identical requests are deduped. If the keep rate stays low with clean tasks, streaming is the first thing to test — it's a one-line switch in `src/lib/llm.ts`.

## The trainer job

`npm run train-adapters` fills every agent task past the training threshold.
`--dry-run` shows the plan, `--goal N` moves the target, `--agent X` narrows it.

What the docs pinned down, and what each fact changed:

| Documented | Consequence for the job |
| --- | --- |
| "By default, a task first trains at 25 kept examples; the count your console shows is the source of truth." | Goal is 34 recorded calls, not 25 — "Not every call becomes a kept example", and a task also needs spares to hold back as test cases. |
| Every failure state recovers with "Send more calls with new messages." | The corpus generates **distinct** briefs. Re-sending one prompt is worthless. |
| "Gemini \| None: Mubit uses the start of the conversation" (session field table) | We cannot set a session on Gemini, so the session comes from the opening message. Briefs must differ in WORDS — Mubit's grouping already ignores "numbers, dates, times and IDs", so two briefs differing only in a server count are one brief. |
| "Mubit sets a task's test cases aside by session." | Follow-up turns are spread over several base racks. Twenty edits against one rack would be twenty near-identical openings, i.e. one session. |
| A task is calls sharing "instructions; tools; tool choice; output format; model". | Scenario text rides in the user message and touches none of them, so N racks collapse to 4 tasks — one per agent. `corpus.test.ts` pins this. |
| "There is no Mubit model ID: you can't send a call to an adapter by naming it as the model." | **Nothing in our code can route to an adapter.** The app keeps sending `gemini-3.5-flash-lite`; enabling an adapter is a console action. "Use the adapter" is not a code change. |

### One task per agent, measured

Task identity was frozen on 2026-10-24 at 20:26. Every call since, across more
than a hundred different racks, lands on exactly four task keys:

| Agent | Local task key | Recorded calls |
| --- | --- | --- |
| RackArchitect | `68e4bc4653f462fd` | 123 |
| RepairAgent | `7378aa0fc57c7b55` | 111 |
| RequirementsAgent | `2bb2d335bb93ae7b` | 61 |
| RackEditor | `51280a9ab53334e6` | 52 |

Four agents, four tasks, any number of racks. That is the generalisation
holding, and it is measured from `data/calls.jsonl`, not assumed.

**These are calls we sent, not kept examples.** Mubit decides what it keeps and
the console count is the source of truth; this table is only a local proxy
that tells the trainer where to spend its next calls.

## The daily quota, which is the real ceiling

The 15 req/min cap has a second half nobody mentions until you hit it:

```
Quota exceeded for metric: generativelanguage.googleapis.com/generate_content_free_tier_requests,
limit: 500, model: gemini-3.5-flash-lite,
description: Generate content requests per day limit exceeded on Free Tier.
Please retry in 9h3m36s.
```

**500 generate-content requests per day per model**, and both caps arrive as a
429 — only the body tells them apart. That matters twice over:

- The per-minute 429 is worth waiting out; this one is not, and treating it as
  transient makes every call burn its retry budget sleeping against a wall.
  `isDailyQuotaError()` separates them and `isTransientError()` excludes it.
- A training run is bounded at roughly 500 calls a day on the free tier, which
  is ~250 turns. Enough to fill four tasks from zero, but not twice in a day.

The trainer stops on the first daily-quota error instead of failing every
remaining turn against the same wall, and resumes from what is already
recorded when re-run.

### Resolved: the key moved to a paid tier

A Gemini Advanced / Google One AI Premium subscription does **not** raise API
quotas — it buys the consumer app, not `generativelanguage.googleapis.com`.
The API tier is a property of the Google Cloud project behind the key. Once
billing was enabled on that project the daily wall disappeared, and the
per-minute cap went with it:

| | Free tier | After billing |
| --- | --- | --- |
| Burst of 8 calls, unpaced | 429 | 8/8, ~500ms each |
| 22 training turns | ~4 min (pacer-bound) | **12 seconds** |

`MUBIT_RPM` is now 60 in `.env.local` instead of the free-tier-safe default of
12. That single number was throttling every run — including the Studio UI — to
a limit that no longer exists.

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
