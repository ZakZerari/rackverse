import { appendFileSync, mkdirSync } from "node:fs";
import { createHash } from "node:crypto";
import { dirname, join } from "node:path";
import OpenAI from "openai";
import { z } from "zod";
import { noopEmit, type EmitFn } from "@/lib/events";

// The ONLY module in this app allowed to call an LLM. Every agent goes through
// `complete()` below, and every call is routed through Mubit.
// `npm run check:llm` greps the repo to enforce this.
//
// This points at Mubit's OpenAI-compatible route for Gemini (not the generic
// /openai/v1 route) so we run on Gemini while still using the `openai` npm SDK
// everywhere, per the fixed stack. See MUBIT_NOTES.md.
export const MUBIT_BASE_URL = "https://api.mubit.ai/gemini/v1beta/openai";
/**
 * Changing this starts new Mubit tasks for every production agent — each
 * agent's task identity is (instructions, schema, model), so every task
 * forks and every adapter restarts from zero kept examples. See
 * MUBIT_NOTES.md "Model choice" for why this is gemini-3.8-flash rather than
 * the earlier gemini-3.5-flash-lite: on this account's free tier 3.8-flash
 * was throttled to ~105s/call (unusable); re-measured after billing was
 * enabled on the Gemini project, it runs ~18s/call with the same real
 * Architect workload — ~9x slower than flash-lite's ~2s, but reliably so
 * rather than randomly. Deliberately re-pinned for a stronger base model to
 * train adapters on, at that known latency cost.
 */
export const MUBIT_TASK_MODEL = "gemini-3.8-flash";

const CALLS_LOG_PATH = join(process.cwd(), "data", "calls.jsonl");

/**
 * Opt-in only. Gemini 3.x has thinking on by default, but the default model
 * (flash-lite) already defaults to minimal thinking, and "none" is rejected by
 * some 3.x models — so we send nothing unless explicitly configured.
 */
const REASONING_EFFORT = process.env.MUBIT_REASONING_EFFORT;

let cachedClient: OpenAI | null = null;
export function getMubitClient(): OpenAI {
  if (cachedClient) return cachedClient;
  const apiKey = process.env.MUBIT_API_KEY;
  if (!apiKey) {
    throw new Error("MUBIT_API_KEY is not set. Copy .env.example to .env.local and fill it in.");
  }
  cachedClient = new OpenAI({ baseURL: MUBIT_BASE_URL, apiKey, timeout: 240_000, maxRetries: 0 });
  return cachedClient;
}

export function getMubitModel(): string {
  const model = process.env.MUBIT_MODEL;
  if (!model) {
    throw new Error("MUBIT_MODEL is not set. Copy .env.example to .env.local and fill it in.");
  }
  if (model !== MUBIT_TASK_MODEL) {
    throw new Error(`MUBIT_MODEL=${model} would split agent training tasks. Use ${MUBIT_TASK_MODEL}; change the pinned task model in code only for an intentional migration.`);
  }
  return model;
}

function logCall(entry: Record<string, unknown>): void {
  try {
    mkdirSync(dirname(CALLS_LOG_PATH), { recursive: true });
    appendFileSync(CALLS_LOG_PATH, `${JSON.stringify(entry)}\n`);
  } catch {
    // Local call logging is best-effort and must never break an agent call.
  }
}

function stripCodeFences(text: string): string {
  const trimmed = text.trim();
  const fenced = trimmed.match(/^```(?:json)?\s*([\s\S]*?)\s*```$/i);
  return fenced ? fenced[1] : trimmed;
}

type JsonObject = Record<string, unknown>;

/**
 * Gemini's structured-output schema subset is narrower than full JSON Schema:
 * `oneOf` is not supported (Zod's discriminatedUnion emits exactly that), and
 * `const` isn't either. Rewrite both into forms Gemini does accept, rather
 * than silently shipping a schema it can't constrain against.
 */
export function toGeminiJsonSchema(schema: unknown): unknown {
  if (Array.isArray(schema)) return schema.map(toGeminiJsonSchema);
  if (schema === null || typeof schema !== "object") return schema;

  const out: JsonObject = {};
  for (const [key, value] of Object.entries(schema as JsonObject)) {
    if (key === "$schema") continue;
    if (key === "oneOf") {
      out.anyOf = toGeminiJsonSchema(value);
      continue;
    }
    if (key === "const") {
      out.enum = [value];
      continue;
    }
    out[key] = toGeminiJsonSchema(value);
  }
  return out;
}

function jsonSchemaName(agent: string): string {
  const safe = agent.replace(/[^a-zA-Z0-9_-]/g, "_").slice(0, 64);
  return safe.length > 0 ? safe : "Output";
}

/** The exact output format sent to Mubit; also fingerprinted by the task guard. */
export function mubitResponseFormat(agent: string, schema: z.ZodType<unknown>) {
  return {
    type: "json_schema" as const,
    json_schema: {
      name: jsonSchemaName(agent),
      schema: toGeminiJsonSchema(z.toJSONSchema(schema, { target: "draft-7" })) as JsonObject,
      strict: false,
    },
  };
}

/** Local audit key for the fields Mubit says define a task; not a Mubit task ID. */
export function mubitTaskKey(system: string, responseFormat: ReturnType<typeof mubitResponseFormat>, model: string): string {
  const identity = JSON.stringify({
    instructions: system.replace(/\s+/g, " ").trim(),
    tools: [],
    toolChoice: null,
    outputFormat: responseFormat,
    model,
  });
  return createHash("sha256").update(identity).digest("hex").slice(0, 16);
}

/**
 * Gateway hiccups (429 rate limit, 5xx, dropped connection) are worth waiting
 * out; a schema violation is not — that one needs corrective feedback, not
 * patience. Telling them apart stops us burning correction attempts on
 * problems the model never caused.
 */
export function status(err: unknown): number | undefined {
  return (err as { status?: number } | null)?.status;
}

/**
 * A 429 for the per-DAY quota rather than the per-minute one.
 *
 * Gemini's free tier caps generate-content at 500 requests per day per model
 * on top of the 15/min limit, and both arrive as the same status code. The
 * daily one is not worth waiting out — its own retry hint is hours away — so
 * it must not count as transient, or a call burns its whole retry budget
 * sleeping against a wall. Matched on Google's metric name and wording.
 */
export function isDailyQuotaError(err: unknown): boolean {
  // Walks `cause`: by the time a caller sees this, `complete()` has already
  // wrapped the provider error in a user-facing one, and the sentence that
  // identifies the daily cap only exists on the original underneath.
  for (let current: unknown = err, depth = 0; current && depth < 5; depth++) {
    const message = current instanceof Error ? current.message : String(current);
    if (/requests per day|per day limit|_free_tier_requests|PerDay/i.test(message)) return true;
    current = (current as { cause?: unknown }).cause;
  }
  return false;
}

export function isTransientError(err: unknown): boolean {
  if ((err as { headers?: Headers } | null)?.headers?.get?.("x-should-retry") === "false") return false;
  if (isDailyQuotaError(err)) return false;
  const code = status(err);
  if (typeof code === "number") return code === 408 || code === 409 || code === 429 || code >= 500;
  const message = err instanceof Error ? err.message : String(err);
  return /ECONNRESET|ETIMEDOUT|EAI_AGAIN|socket hang up|fetch failed|network/i.test(message);
}

const TRANSIENT_BACKOFF_MS = [2000, 5000, 10000, 20000];

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Gemini's free tier allows 15 generate-content requests per minute per model
 * ("GenerateRequestsPerMinutePerProjectPerModel-FreeTier", limit: 15). Going
 * over doesn't just fail the call — a 429'd call never becomes a kept
 * training example, which is what was starving the adapters. So we pace
 * ourselves under the cap rather than discovering it the hard way.
 *
 * Sliding 60s window, shared by every call in this process. Scripts and the
 * dev server are separate processes with separate windows, so keep script
 * concurrency modest.
 */
const RPM_LIMIT = Number(process.env.MUBIT_RPM ?? 12);
let recentRequests: number[] = [];

async function acquireRateLimitSlot(onWait?: (ms: number) => void): Promise<void> {
  for (;;) {
    const now = Date.now();
    recentRequests = recentRequests.filter((t) => now - t < 60_000);
    if (recentRequests.length < RPM_LIMIT) {
      recentRequests.push(now);
      return;
    }
    const waitMs = 60_000 - (now - recentRequests[0]) + 50;
    onWait?.(waitMs);
    await sleep(waitMs);
  }
}

/**
 * A 429 from Gemini may carry a retry delay in the response header,
 * RetryInfo, or message. Prefer that delay to the local backoff ladder.
 */
export function retryAfterMs(err: unknown): number | null {
  const header = (err as { headers?: Headers } | null)?.headers?.get?.("retry-after");
  if (header) {
    const seconds = Number(header);
    if (Number.isFinite(seconds) && seconds >= 0) return Math.ceil(seconds * 1000);
    const date = Date.parse(header);
    if (Number.isFinite(date)) return Math.max(0, date - Date.now());
  }
  const message = err instanceof Error ? err.message : String(err);
  const fromProse = message.match(/retry in ([0-9.]+)s/i);
  if (fromProse) return Math.ceil(Number(fromProse[1]) * 1000);
  const fromRetryInfo = message.match(/"retryDelay"\s*:\s*"([0-9.]+)s"/);
  if (fromRetryInfo) return Math.ceil(Number(fromRetryInfo[1]) * 1000);
  return null;
}

export function userFacingModelError(err: unknown): string {
  const code = status(err);
  if (code === 503 || code === 502 || code === 504) return "The model service is temporarily busy. Please try again in a moment.";
  if (isDailyQuotaError(err)) return "The provider's daily request quota is used up. It resets at midnight Pacific.";
  if (code === 429) return "The model request limit was reached. Please try again shortly.";
  return err instanceof Error ? err.message : String(err);
}

export interface CompleteArgs<T> {
  /** Agent name, e.g. "RequirementsAgent". Used for logging and the schema name. */
  agent: string;
  /** MUST be a constant string at the call site — never templated. Forms the Mubit task. */
  system: string;
  /** All variable/dynamic data (design, errors, lessons, requirements) goes here. */
  user: string;
  schema: z.ZodType<T>;
  /** Groups calls into one run in our own logs. */
  runId?: string;
  /** Default 1 — each retry costs a full round trip, which is expensive here. */
  maxRetries?: number;
  /** Receives live progress (agent start/token/done) for the Studio's UI. */
  emit?: EmitFn;
  /** Human-readable note shown in the activity timeline when the call starts. */
  note?: string;
  /** Diagnostics only: send through Mubit without creating a training task. */
  recordForTraining?: boolean;
}

/**
 * Calls Mubit (streaming), enforces `schema` on the JSON response, emits live
 * progress events, and logs the call to data/calls.jsonl. Streams so the UI can
 * show tokens as they arrive instead of staring at a spinner.
 */
export async function complete<T>({
  agent,
  system,
  user,
  schema,
  runId,
  maxRetries = 1,
  emit = noopEmit,
  note,
  recordForTraining = true,
}: CompleteArgs<T>): Promise<T> {
  if (!recordForTraining && agent !== "SmokeTest") {
    throw new Error("Only the connectivity smoke test may opt out of Mubit training records.");
  }
  const client = getMubitClient();
  const model = getMubitModel();
  const responseFormat = mubitResponseFormat(agent, schema);
  const taskKey = mubitTaskKey(system, responseFormat, model);

  let userContent = user;
  let lastError: unknown;
  let transientRetries = 0;
  let requestAttempts = 0;
  const callStartedAt = Date.now();

  emit({ type: "agent:start", agent, note: note ?? "Thinking…" });

  for (let attempt = 1; attempt <= maxRetries + 1; attempt++) {
    await acquireRateLimitSlot((waitMs) =>
      emit({ type: "agent:retry", agent, note: `Waiting ${Math.ceil(waitMs / 1000)}s for the model request limit…` })
    );
    const startedAt = Date.now();
    requestAttempts += 1;
    let mubitRequestId: string | null = null;

    try {
      const { data: stream, response } = await client.chat.completions.create({
        model,
        messages: [
          { role: "system", content: system },
          { role: "user", content: userContent },
        ],
        response_format: responseFormat,
        ...(REASONING_EFFORT && REASONING_EFFORT !== "default"
          ? { reasoning_effort: REASONING_EFFORT as "none" | "minimal" | "low" | "medium" | "high" }
          : {}),
        stream: true,
        stream_options: { include_usage: true },
      }, recordForTraining ? undefined : { headers: { "x-middleware-record": "off" } }).withResponse();
      mubitRequestId = response.headers.get("x-middleware-request-id");

      let raw = "";
      let promptTokens: number | undefined;
      let completionTokens: number | undefined;

      for await (const chunk of stream) {
        const delta = chunk.choices[0]?.delta?.content;
        if (delta) {
          raw += delta;
          emit({ type: "agent:token", agent, text: delta });
        }
        if (chunk.usage) {
          promptTokens = chunk.usage.prompt_tokens;
          completionTokens = chunk.usage.completion_tokens;
        }
      }

      const parsedJson: unknown = JSON.parse(stripCodeFences(raw));
      const result = schema.parse(parsedJson);
      const latencyMs = Date.now() - startedAt;

      logCall({
        ts: new Date().toISOString(),
        agent,
        model,
        taskKey,
        recordForTraining,
        mubitRequestId,
        runId,
        latencyMs,
        promptTokens,
        completionTokens,
        ok: true,
        attempt,
      });
      emit({ type: "agent:done", agent, latencyMs: Date.now() - callStartedAt, promptTokens, completionTokens });
      return result;
    } catch (err) {
      lastError = err;
      const latencyMs = Date.now() - startedAt;
      const message = err instanceof Error ? err.message : String(err);
      const transient = isTransientError(err);
      mubitRequestId ??= (err as { headers?: Headers } | null)?.headers?.get?.("x-middleware-request-id") ?? null;

      logCall({
        ts: new Date().toISOString(),
        agent,
        model,
        taskKey,
        recordForTraining,
        mubitRequestId,
        runId,
        latencyMs,
        ok: false,
        attempt,
        transient,
        error: message,
      });
      if (transient) {
        // The gateway or a quota, not the model. Wait it out without
        // consuming a correction attempt or polluting the prompt with a bogus
        // "your response was invalid" note.
        if (transientRetries >= TRANSIENT_BACKOFF_MS.length) break;
        // A long Retry-After is a request to stop for now, not to retry early.
        const serverDelay = retryAfterMs(err);
        if (serverDelay !== null && serverDelay > 120_000) break;
        const waitMs = serverDelay ?? TRANSIENT_BACKOFF_MS[transientRetries];
        emit({ type: "agent:retry", agent, note: `Model temporarily unavailable. Retrying in ${Math.ceil(waitMs / 1000)}s…` });
        await sleep(waitMs);
        transientRetries += 1;
        attempt -= 1;
        continue;
      }

      // Only a malformed model reply benefits from corrective feedback.
      // Retrying a rejected API request wastes quota and cannot fix the body.
      if (!(err instanceof SyntaxError || err instanceof z.ZodError) || attempt > maxRetries) break;
      userContent = `${user}\n\nYour previous response was invalid: ${message}\nReturn ONLY valid JSON matching the required schema.`;
      emit({ type: "agent:retry", agent, note: "Checking the response and retrying…" });
    }
  }

  const failure = userFacingModelError(lastError);
  emit({ type: "agent:error", agent, attempt: requestAttempts, error: failure });
  throw new Error(failure, { cause: lastError });
}
