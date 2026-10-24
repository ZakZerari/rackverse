import { NextResponse } from "next/server";
import { designFromPrompt } from "@/lib/orchestrate";

export async function POST(request: Request) {
  const body = (await request.json().catch(() => null)) as { text?: unknown } | null;
  const text = typeof body?.text === "string" ? body.text.trim() : "";

  if (!text) {
    return NextResponse.json({ error: 'Missing "text".' }, { status: 400 });
  }

  try {
    const result = await designFromPrompt(text);
    return NextResponse.json(result);
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : String(err) },
      { status: 500 }
    );
  }
}
