import { appendFileSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import OpenAI from "openai";
import { z } from "zod";

// The ONLY module in this app allowed to call an LLM. Every agent goes
// through `complete()` below, and every call is routed through Mubit.
// `npm run check:llm` greps the repo to enforce this.
//
// This points at Mubit's OpenAI-compatible route for Gemini (not the generic
// /openai/v1 route) so we can run on Gemini while still using the `openai`
// npm SDK everywhere, per the fixed stack. See MUBIT_NOTES.md.
export const MUBIT_BASE_URL = "https://api.mubit.ai/gemini/v1beta/openai";

const CALLS_LOG_PATH = join(process.cwd(), "data", "calls.jsonl");

let cachedClient: OpenAI | null = null;
export function getMubitClient(): OpenAI {
  if (cachedClient) return cachedClient;
  const apiKey = process.env.MUBIT_API_KEY;
  if (!apiKey) {
    throw new Error(
      "MUBIT_API_KEY is not set. Copy .env.example to .env.local and fill it in."
    );
  }
  cachedClient = new OpenAI({ baseURL: MUBIT_BASE_URL, apiKey });
  return cachedClient;
}

export function getMubitModel(): string {
  const model = process.env.MUBIT_MODEL;
  if (!model) {
    throw new Error(
      "MUBIT_MODEL is not set. Copy .env.example to .env.local and fill it in."
    );
  }
  return model;
}

export type StructuredMode = "json_schema" | "json_object";

// Detected lazily on the first call and cached for the process: some models
// behind Mubit reject response_format: json_schema, so we try it once and
// fall back to the universally-supported json_object mode.
let detectedMode: StructuredMode | null = null;
export function getDetectedStructuredMode(): StructuredMode | null {
  return detectedMode;
}
/** Test-only escape hatch so tests don't leak detected mode across cases. */
export function resetDetectedStructuredMode(): void {
  detectedMode = null;
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

function jsonSchemaName(agent: string): string {
  const safe = agent.replace(/[^a-zA-Z0-9_-]/g, "_").slice(0, 64);
  return safe.length > 0 ? safe : "Output";
}

function looksLikeUnsupportedResponseFormat(err: unknown): boolean {
  const message = err instanceof Error ? err.message : String(err);
  return /response_format|json_schema/i.test(message);
}

export interface CompleteArgs<T> {
  /** Agent name, e.g. "RequirementsAgent". Used for logging and the json_schema name. */
  agent: string;
  /** MUST be a constant string at the call site — never templated. Forms the Mubit task. */
  system: string;
  /** All variable/dynamic data (design, errors, lessons, requirements) goes here. */
  user: string;
  schema: z.ZodType<T>;
  /** Groups calls into one conversation/session in the Mubit console. */
  runId?: string;
  maxRetries?: number;
}

/**
 * Calls Mubit, enforces `schema` on the JSON response, and logs the call to
 * data/calls.jsonl. Retries up to `maxRetries` times on parse/validation
 * failure, feeding the error back to the model so it can correct itself.
 */
export async function complete<T>({
  agent,
  system,
  user,
  schema,
  runId,
  maxRetries = 2,
}: CompleteArgs<T>): Promise<T> {
  const client = getMubitClient();
  const model = getMubitModel();
  const schemaName = jsonSchemaName(agent);
  const jsonSchema = z.toJSONSchema(schema, { target: "draft-7" }) as Record<string, unknown>;
  delete jsonSchema.$schema;

  let userContent = user;
  let lastError: unknown;

  for (let attempt = 1; attempt <= maxRetries + 1; attempt++) {
    const startedAt = Date.now();
    const mode: StructuredMode = detectedMode ?? "json_schema";
    try {
      const completion = await client.chat.completions.create({
        model,
        messages: [
          { role: "system", content: system },
          { role: "user", content: userContent },
        ],
        response_format:
          mode === "json_schema"
            ? { type: "json_schema", json_schema: { name: schemaName, schema: jsonSchema, strict: false } }
            : { type: "json_object" },
        // Gemini's OpenAI-compat route 400s on unrecognized top-level fields,
        // including `metadata` — see MUBIT_NOTES.md. runId/agent are still
        // captured in our own calls.jsonl log below.
      });

      if (detectedMode === null) detectedMode = mode;

      const raw = completion.choices[0]?.message?.content ?? "";
      const parsedJson: unknown = JSON.parse(stripCodeFences(raw));
      const result = schema.parse(parsedJson);

      logCall({
        ts: new Date().toISOString(),
        agent,
        runId,
        latencyMs: Date.now() - startedAt,
        promptTokens: completion.usage?.prompt_tokens,
        completionTokens: completion.usage?.completion_tokens,
        ok: true,
        attempt,
        structuredMode: mode,
      });
      return result;
    } catch (err) {
      lastError = err;
      const latencyMs = Date.now() - startedAt;

      // If json_schema itself is the problem, fall back once and retry immediately
      // without burning a correction attempt.
      if (mode === "json_schema" && detectedMode === null && looksLikeUnsupportedResponseFormat(err)) {
        detectedMode = "json_object";
        logCall({ ts: new Date().toISOString(), agent, runId, latencyMs, ok: false, attempt, error: "json_schema unsupported, falling back to json_object" });
        attempt -= 1;
        continue;
      }

      logCall({
        ts: new Date().toISOString(),
        agent,
        runId,
        latencyMs,
        ok: false,
        attempt,
        error: err instanceof Error ? err.message : String(err),
      });

      // Feed the failure back to the model as corrective context for the next attempt.
      userContent = `${user}\n\nYour previous response was invalid: ${
        err instanceof Error ? err.message : String(err)
      }\nReturn ONLY valid JSON matching the required schema.`;
    }
  }

  throw lastError instanceof Error ? lastError : new Error(String(lastError));
}
