import { encodeSSE, type RunEvent } from "@/lib/events";
import { repairOnly } from "@/lib/orchestrate";
import type { Design, Requirements } from "@/lib/types";

/**
 * Streams the repair round as SSE, same as /api/design — so the Studio's
 * activity timeline reports the agent's real latency and the Verifier's real
 * decision, rather than a placeholder.
 */
export async function POST(request: Request) {
  const body = (await request.json().catch(() => null)) as {
    design?: Design;
    requirements?: Requirements;
  } | null;

  if (!body?.design || !body?.requirements) {
    return Response.json({ error: 'Missing "design" or "requirements".' }, { status: 400 });
  }

  const { design, requirements } = body;
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
        // Swallow design:update — an Auto-repair is reviewed by the user
        // before it touches the Studio's design, unlike a fresh generation.
        const result = await repairOnly(design, requirements, {
          emit: (event) => {
            if (event.type !== "design:update") send(event);
          },
        });
        send({
          type: "repair:proposed",
          design: result.design,
          accepted: result.design !== design,
          reason: result.trace.at(-1)?.detail ?? "No change proposed.",
        });
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
