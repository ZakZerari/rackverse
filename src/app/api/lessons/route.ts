import { NextResponse } from "next/server";
import { countStoredLessons } from "@/lib/lessons";

export async function GET() {
  return NextResponse.json({ count: countStoredLessons() });
}
