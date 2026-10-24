import { encodeSSE, type RunEvent } from "@/lib/events";
import { designFromPrompt } from "@/lib/orchestrate";

/**
 * Streams the whole run as Server-Sent Events so the Studio can show each
 * agent, token, validator result and verifier decision the moment it happens —
 * rather than blocking on a single response for the length of the pipeline.
 */
export async function POST(request: Request) {
  const body = (await request.json().catch(() => null)) as { text?: unknown } | null;
  const text = typeof body?.text === "string" ? body.text.trim() : "";

  if (!text) {
    return Response.json({ error: 'Missing "text".' }, { status: 400 });
  }

  const encoder = new TextEncoder();
  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      let closed = false;
      const send = (event: RunEvent) => {
        if (closed) return;
        try {
          controller.enqueue(encoder.encode(encodeSSE(event)));
        } catch {
          closed = true;
        }
      };

      try {
        await designFromPrompt(text, { emit: send });
      } catch (err) {
        send({ type: "run:error", error: err instanceof Error ? err.message : String(err) });
      } finally {
        closed = true;
        controller.close();
      }
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream; charset=utf-8",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no",
    },
  });
}
