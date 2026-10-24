import { encodeSSE, type RunEvent } from "@/lib/events";
import { repairOnly } from "@/lib/orchestrate";
import type { Design, Requirements } from "@/lib/types";
import { RequirementsSchema } from "@/lib/schemas";
import { designSchema } from "@/lib/workspace";
import { hardViolations, validateDesign } from "@/lib/validate";
import { rackRunId, recordRackRun, validRackId } from "@/lib/rackRuns";

/**
 * Streams the repair round as SSE, same as /api/design — so the Studio's
 * activity timeline reports the agent's real latency and the Verifier's real
 * decision, rather than a placeholder.
 */
export async function POST(request: Request) {
  const body = (await request.json().catch(() => null)) as {
    design?: Design;
    requirements?: Requirements;
    rackId?: unknown;
  } | null;

  if (!body?.design || !body?.requirements) {
    return Response.json({ error: 'Missing "design" or "requirements".' }, { status: 400 });
  }
  if (body.rackId !== undefined && !validRackId(body.rackId)) {
    return Response.json({ error: "Invalid rack ID." }, { status: 400 });
  }
  const rackId = validRackId(body.rackId) ? body.rackId : null;
  const runId = rackId ? rackRunId(rackId) : undefined;

  const parsedDesign = designSchema.safeParse(body.design);
  const parsedRequirements = RequirementsSchema.safeParse(body.requirements);
  if (!parsedDesign.success || !parsedRequirements.success) {
    return Response.json({ error: "Invalid design or requirements." }, { status: 400 });
  }
  if (rackId && parsedDesign.data.rack.id !== rackId) {
    return Response.json({ error: "Rack ID does not match the design." }, { status: 400 });
  }
  const design = parsedDesign.data;
  const requirements = parsedRequirements.data;
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
          runId,
          emit: (event) => {
            if (event.type !== "design:update") send(event);
          },
        });
        if (rackId && runId) recordRackRun({ rackId, runId, kind: "repair", timestamp: new Date().toISOString(),
          status: "completed", initialHardCount: hardViolations(validateDesign(design, requirements)).length,
          finalHardCount: hardViolations(validateDesign(result.design, requirements)).length,
          acceptedPatch: result.design !== design });
        send({
          type: "repair:proposed",
          design: result.design,
          accepted: result.design !== design,
          reason: result.trace.at(-1)?.detail ?? "No change proposed.",
        });
      } catch (err) {
        if (rackId && runId) recordRackRun({ rackId, runId, kind: "repair", timestamp: new Date().toISOString(), status: "error" });
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
