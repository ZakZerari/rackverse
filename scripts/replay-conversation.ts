// Replays a multi-turn conversation through the real agents, so the thing we
// claim to have fixed — follow-up turns silently discarding the rack — can be
// checked against the live model rather than only against mocks.
//
//   npm run replay -- "first message" "second message" "third message"
//
// Defaults to the exchange a user reported, where "make it better" rebuilt an
// empty rack and threw away everything they had.
import { designFromPrompt } from "@/lib/orchestrate";
import { catalogItemFor } from "@/lib/catalog";
import { compactHistory, planTurn, summariseRequirements, type HistoryEntry } from "@/lib/turn";
import { hardViolations, validateDesign } from "@/lib/validate";
import type { Design, Requirements } from "@/lib/types";

try {
  process.loadEnvFile(".env.local");
} catch {
  // .env.local may not exist; env vars could come from the shell instead.
}

const DEFAULT_MESSAGES = [
  "I want a rack to run ai models easily but cheapest one possible",
  "make it better",
  "bro why you removed everything",
];

function describe(design: Design): string {
  if (design.placements.length === 0) return "EMPTY RACK";
  const names = design.placements.map((placement) => {
    const item = catalogItemFor(design, placement.catalogId);
    return item ? `${item.name} (U${placement.startU}, $${item.priceUsd.toLocaleString()})` : `?${placement.catalogId}`;
  });
  return `${design.placements.length} devices — ${names.join(", ")}`;
}

async function main() {
  const messages = process.argv.slice(2).filter((arg) => !arg.startsWith("--"));
  const script = messages.length > 0 ? messages : DEFAULT_MESSAGES;

  let design: Design | undefined;
  let requirements: Requirements | undefined;
  const history: HistoryEntry[] = [];

  for (const [index, message] of script.entries()) {
    const plan = planTurn(design ?? null, message);
    console.log(`\n${"=".repeat(72)}\nTURN ${index + 1}: "${message}"\n  route: ${plan.mode} — ${plan.reason}`);

    const started = Date.now();
    // A warn note (e.g. the feasibility guard) carries the one fact a
    // follow-up might reference — "ok drop it" needs an "it" — so it has to
    // win the turn's `outcome`, the same precedence store.ts gives it for
    // the real UI. Mirroring that here is the point: this script exists to
    // catch exactly this class of bug against the live model, not just
    // pretty-print a run.
    let warnDetail: string | undefined;
    const result = await designFromPrompt(message, {
      currentDesign: design,
      currentRequirements: requirements,
      // compactHistory, not the raw array: the browser client truncates
      // before sending, so replaying with the untruncated array would miss
      // exactly the bug class this script exists to catch (a long outcome
      // silently cut mid-sentence).
      history: compactHistory(history),
      emit: (event) => {
        if (event.type === "agent:done") console.log(`  · ${event.agent} ${(event.latencyMs / 1000).toFixed(1)}s`);
        if (event.type === "agent:error") console.log(`  ! ${event.agent} ${event.error}`);
        if (event.type === "verifier:decision") console.log(`  · Verifier ${event.accepted ? "accepted" : "REJECTED"} — ${event.reason}`);
        if (event.type === "note") {
          console.log(`  ⚠ ${event.label}: ${event.detail}`);
          if (event.tone === "warn") warnDetail = event.detail;
        }
      },
    });

    design = result.design;
    requirements = result.requirements;
    const hard = hardViolations(validateDesign(design, requirements)).length;
    const outcome =
      warnDetail ?? `${design.placements.length} devices · ${hard === 0 ? "all checks passing" : `${hard} hard violation(s)`}`;
    history.push({ user: message, outcome });

    console.log(`  brief: ${summariseRequirements(requirements)}`);
    console.log(`  rack:  ${describe(design)}`);
    console.log(`  took:  ${((Date.now() - started) / 1000).toFixed(1)}s · ${outcome}`);
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
