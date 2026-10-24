import { readCallLog } from "@/lib/callsLog";
import { rackMetrics, readRackRuns, validRackId } from "@/lib/rackRuns";
import { io } from "next/cache";

export async function GET(request: Request) {
  const ids = [...new Set(new URL(request.url).searchParams.get("ids")?.split(",") ?? [])];
  if (ids.length > 100 || ids.some((id) => !validRackId(id))) {
    return Response.json({ error: "Invalid rack IDs." }, { status: 400 });
  }
  await io();
  return Response.json({ metrics: rackMetrics(ids, readCallLog(), readRackRuns()) }, {
    headers: { "Cache-Control": "no-store" },
  });
}
