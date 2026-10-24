import { readFileSync } from "node:fs";
import { join } from "node:path";
import { io } from "next/cache";

const SNAPSHOT_PATH = join(process.cwd(), "data", "mubit-console-snapshot.json");

export async function GET() {
  await io();
  try {
    return Response.json({ available: true, snapshot: JSON.parse(readFileSync(SNAPSHOT_PATH, "utf8")) }, {
      headers: { "Cache-Control": "no-store" },
    });
  } catch {
    return Response.json({ available: false });
  }
}
