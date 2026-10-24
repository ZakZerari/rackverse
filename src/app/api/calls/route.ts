import { NextResponse } from "next/server";
import { io } from "next/cache";
import { readCallLog } from "@/lib/callsLog";
import { gatewayMetrics } from "@/lib/gatewayMetrics";

export async function GET() {
  await io();
  return NextResponse.json(gatewayMetrics(readCallLog()), { headers: { "Cache-Control": "no-store" } });
}
