import type { Design, Requirements, Violation } from "@/lib/types";

/**
 * Everything the orchestrator does, as it happens. The orchestrator emits
 * these synchronously as work completes; the API route serialises them to
 * SSE; the Studio renders them live. Nothing waits for the whole run to
 * finish before the user sees it.
 */
export type RunEvent =
  | { type: "run:start"; runId: string }
  | { type: "agent:start"; agent: string; note: string }
  | { type: "agent:token"; agent: string; text: string }
  | {
      type: "agent:done";
      agent: string;
      latencyMs: number;
      promptTokens?: number;
      completionTokens?: number;
      note?: string;
    }
  | { type: "agent:error"; agent: string; attempt: number; error: string }
  | { type: "validator:result"; violations: Violation[]; hardCount: number }
  | { type: "verifier:decision"; accepted: boolean; reason: string; hardBefore: number; hardAfter: number }
  | { type: "design:update"; design: Design }
  | { type: "run:done"; design: Design; requirements: Requirements }
  /** A repair result awaiting the user's Accept/Reject — never auto-applied. */
  | { type: "repair:proposed"; design: Design; accepted: boolean; reason: string }
  | { type: "run:error"; error: string };

export type EmitFn = (event: RunEvent) => void;

/** A no-op emitter, for callers that don't care about live progress (scripts, tests). */
export const noopEmit: EmitFn = () => {};

export function encodeSSE(event: RunEvent): string {
  return `data: ${JSON.stringify(event)}\n\n`;
}

/**
 * Parses an SSE byte stream into RunEvents. Used by the browser — we POST a
 * prompt, so EventSource (GET-only) isn't an option.
 */
export async function* readSSE(body: ReadableStream<Uint8Array>): AsyncGenerator<RunEvent> {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });

    const chunks = buffer.split("\n\n");
    buffer = chunks.pop() ?? "";
    for (const chunk of chunks) {
      const line = chunk.trim();
      if (!line.startsWith("data:")) continue;
      try {
        yield JSON.parse(line.slice(5).trim()) as RunEvent;
      } catch {
        // a partial/garbled frame is not worth killing the stream over
      }
    }
  }
}
