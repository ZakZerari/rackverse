import { encodeSSE, type RunEvent } from "@/lib/events";
import { designFromPrompt } from "@/lib/orchestrate";
import { RequirementsSchema } from "@/lib/schemas";
import { designSchema } from "@/lib/workspace";
import { hardViolations, validateDesign } from "@/lib/validate";
import { rackRunId, recordRackRun, validRackId } from "@/lib/rackRuns";
import type { HistoryEntry } from "@/lib/turn";

/**
 * Streams the whole run as Server-Sent Events so the Studio can show each
 * agent, token, validator result and verifier decision the moment it happens —
 * rather than blocking on a single response for the length of the pipeline.
 */
export async function POST(request: Request) {
  const body = (await request.json().catch(() => null)) as {
    text?: unknown; rackId?: unknown; currentDesign?: unknown; currentRequirements?: unknown; history?: HistoryEntry[];
  } | null;
  const text = typeof body?.text === "string" ? body.text.trim() : "";

  if (!text) {
    return Response.json({ error: 'Missing "text".' }, { status: 400 });
  }
  if (body?.rackId !== undefined && !validRackId(body.rackId)) {
    return Response.json({ error: "Invalid rack ID." }, { status: 400 });
  }
  const rackId = validRackId(body?.rackId) ? body.rackId : null;
  const runId = rackId ? rackRunId(rackId) : undefined;
  const requirements = body?.currentRequirements ? RequirementsSchema.safeParse(body.currentRequirements) : null;
  const design = body?.currentDesign ? designSchema.safeParse(body.currentDesign) : null;
  if (requirements?.success === false || design?.success === false) {
    return Response.json({ error: "Invalid current rack context." }, { status: 400 });
  }
  if (rackId && (!design?.success || design.data.rack.id !== rackId)) {
    return Response.json({ error: "Rack ID does not match the current design." }, { status: 400 });
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
        const result = await designFromPrompt(text, {
          runId,
          emit: send,
          currentDesign: design?.success ? design.data : undefined,
          currentRequirements: requirements?.success ? requirements.data : undefined,
          history: Array.isArray(body?.history) ? body.history.slice(-6) : [],
        });
        if (rackId && runId) {
          recordRackRun({ rackId, runId, kind: "design", timestamp: new Date().toISOString(), status: "completed",
            initialHardCount: result.trace.find((step) => step.label === "Validator")?.hardViolationCount,
            finalHardCount: hardViolations(validateDesign(result.design, result.requirements)).length });
        }
      } catch (err) {
        if (rackId && runId) recordRackRun({ rackId, runId, kind: "design", timestamp: new Date().toISOString(), status: "error" });
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
