import { NextResponse } from "next/server";
import { io } from "next/cache";
import { countStoredLessons } from "@/lib/lessons";

export async function GET() {
  await io();
  return NextResponse.json({ count: countStoredLessons() }, { headers: { "Cache-Control": "no-store" } });
}
