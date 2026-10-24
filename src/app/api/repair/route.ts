import { NextResponse } from "next/server";
import { repairOnly } from "@/lib/orchestrate";
import type { Design, Requirements } from "@/lib/types";

export async function POST(request: Request) {
  const body = (await request.json().catch(() => null)) as {
    design?: Design;
    requirements?: Requirements;
  } | null;

  if (!body?.design || !body?.requirements) {
    return NextResponse.json({ error: 'Missing "design" or "requirements".' }, { status: 400 });
  }

  try {
    const result = await repairOnly(body.design, body.requirements);
    return NextResponse.json(result);
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : String(err) },
      { status: 500 }
    );
  }
}
