import { io } from "next/cache";
import { readRepairVerdicts } from "@/lib/repairVerdicts";

export async function GET() {
  await io();
  const verdicts = readRepairVerdicts();
  return Response.json({
    total: verdicts.length,
    improved: verdicts.filter((verdict) => verdict.suggestedRating === "Good").length,
    fullyRepaired: verdicts.filter((verdict) => verdict.suggestedRating === "Good" && verdict.hardAfter === 0).length,
    rejected: verdicts.filter((verdict) => verdict.suggestedRating === "Bad").length,
    verdicts: verdicts.slice(-25).reverse(),
  }, {
    headers: { "Cache-Control": "no-store" },
  });
}
