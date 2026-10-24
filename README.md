# RackVerse

A multi-agent AI server-rack designer, built for Mubit "Night Shift" (London).

Describe a rack in plain English ("42U rack, 8 servers, redundant A/B power, 2 switches, $60k budget") and a team of specialist AI agents proposes a design. **Deterministic TypeScript code — not AI — validates it** against engineering rules (power, weight, depth, redundancy, ports, budget). If it fails, a Repair Agent sees the exact error codes and proposes a patch; a deterministic Verifier only accepts the patch if it strictly improves things with no regressions. Verified fixes are saved as lessons and fed back into future repairs. Every LLM call goes through [Mubit](https://mubit.ai).

**The AI proposes, code decides.**

## Status

Early build, in progress. See [MUBIT_NOTES.md](./MUBIT_NOTES.md) for what's actually been verified against the Mubit API vs. assumed.

## Getting started

```bash
npm install
cp .env.example .env.local   # fill in MUBIT_API_KEY and MUBIT_MODEL
npm run smoke-mubit          # confirms the Mubit connection works
npm test                     # runs the validator's unit + property tests
npm run check:llm            # enforces that only src/lib/llm.ts talks to an LLM
npm run dev                  # http://localhost:3000
```

## Architecture

- `src/lib/types.ts` — the shared `Design` model used by the editor, validator, agents, and exporter.
- `src/data/catalog.ts` — ~25 illustrative rack equipment items (servers, switches, UPS, PDUs, storage, patch panels, blanks).
- `src/lib/validate.ts` — the deterministic validator. Pure functions, heavily unit-tested. This is the source of truth for whether a design is valid, never the AI.
- `src/lib/patch.ts` / `src/lib/verify.ts` — applies an AI-proposed patch to a *copy* of the design, then deterministically accepts or rejects it.
- `src/lib/llm.ts` — the **only** module that calls an LLM. Routes every call through Mubit.
- `src/lib/agents/*` — RequirementsAgent, RackArchitect, RepairAgent, OptimisationAgent. Each has one constant system prompt, one model, one output format, so Mubit groups each agent into a stable, trainable task.
- `src/lib/orchestrate.ts` — the ~100-line async function that wires agents → validator → verifier together.

## Honesty

Local metrics (the benchmark on `/lab`, call logs, lessons learned) are reported as local metrics. Nothing is claimed as a Mubit adapter result unless it's been verified in the Mubit console's "Try models".
