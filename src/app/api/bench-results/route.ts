import { readFileSync } from "node:fs";
import { join } from "node:path";
import { NextResponse } from "next/server";
import { io } from "next/cache";

const BENCH_RESULTS_PATH = join(process.cwd(), "data", "bench-results.json");

export async function GET() {
  await io();
  try {
    const raw = readFileSync(BENCH_RESULTS_PATH, "utf-8");
    return NextResponse.json({ available: true, results: JSON.parse(raw) });
  } catch {
    return NextResponse.json({ available: false });
  }
}
