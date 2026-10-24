import { appendFileSync, mkdirSync } from "node:fs";
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
}: CompleteArgs<T>): Promise<T> {
  const client = getMubitClient();
  const model = getMubitModel();
  const jsonSchema = toGeminiJsonSchema(z.toJSONSchema(schema, { target: "draft-7" })) as JsonObject;

  let userContent = user;
  let lastError: unknown;

  for (let attempt = 1; attempt <= maxRetries + 1; attempt++) {
    const startedAt = Date.now();
    emit({ type: "agent:start", agent, note: note ?? (attempt > 1 ? `Retry ${attempt - 1}…` : "Thinking…") });

    try {
      const stream = await client.chat.completions.create({
        model,
        messages: [
          { role: "system", content: system },
          { role: "user", content: userContent },
        ],
        response_format: {
          type: "json_schema",
          json_schema: { name: jsonSchemaName(agent), schema: jsonSchema, strict: false },
        },
        ...(REASONING_EFFORT && REASONING_EFFORT !== "default"
          ? { reasoning_effort: REASONING_EFFORT as "none" | "minimal" | "low" | "medium" | "high" }
          : {}),
        stream: true,
        stream_options: { include_usage: true },
      });

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
        runId,
        latencyMs,
        promptTokens,
        completionTokens,
        ok: true,
        attempt,
      });
      emit({ type: "agent:done", agent, latencyMs, promptTokens, completionTokens });
      return result;
    } catch (err) {
      lastError = err;
      const latencyMs = Date.now() - startedAt;
      const message = err instanceof Error ? err.message : String(err);

      logCall({
        ts: new Date().toISOString(),
        agent,
        runId,
        latencyMs,
        ok: false,
        attempt,
        error: message,
      });
      emit({ type: "agent:error", agent, attempt, error: message });

      // Feed the failure back as corrective context for the next attempt.
      userContent = `${user}\n\nYour previous response was invalid: ${message}\nReturn ONLY valid JSON matching the required schema.`;
    }
  }

  throw lastError instanceof Error ? lastError : new Error(String(lastError));
}
