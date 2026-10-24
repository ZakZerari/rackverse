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

The main page is a fleet dashboard: create racks, review each rack's engineering checks and capacity, and open one to edit it. It also shows rack-scoped Mubit call counts, parsed replies, latency and deterministically verified run outcomes when calls have been recorded. Rack designs, conversations and version history are saved in browser storage; the earlier single-rack workspace migrates automatically. Mubit evidence is stored in this server's local JSONL logs, so it is separate from browser-saved designs.

In the Studio, **Rack settings** changes height, mounting depth, load rating and power budget. **Add equipment** creates a device with editable type, price, dimensions, weight, power, supply capacity, outlets, PSUs and network ports. Built-in devices can be edited and reset to their source specs. Edits update the checks, totals, views and AI catalog. On smaller screens, use the Equipment, Rack and Copilot tabs.

The **Break it** selector simulates a 30% utility power cut, a failed B-side PDU, or a 25% CapEx cut. Each change updates the saved rack or its requirements and immediately reruns deterministic checks. The Studio telemetry bar summarizes completed, rack-scoped repair runs: first-round pass rate, average rounds, end-to-end duration, and a token-based provider paid-tier list-price estimate per validated repair. It does not represent a Mubit invoice or adapter cost. Adapter comparisons stay blank until verified Mubit evaluation data are available. Fleet snapshots already persist per rack in local storage and flush on page exit, including design versions and conversation history.

## Architecture

```
prompt ─▶ RequirementsAgent ─▶ RackArchitect ─▶ validate() ─┬─ clean ─▶ done
                                                   ▲        │
                                                   │        └─ violations
                                              commit│                │
                                                    │                ▼
                                   verifyPatch() ◀──┴──── RepairAgent ×N (parallel)
```

- `src/lib/types.ts` — the shared `Design` model used by the editor, validator, agents, and exporter.
- `src/data/catalog.ts` — **generated**, 39 real devices (see Equipment data). Agents reference `catalogId`s only; they can never invent a device's specs.
- `src/lib/validate.ts` — the deterministic validator. Pure functions, heavily unit-tested. Source of truth for whether a design is valid — never the model.
- `src/lib/patch.ts` / `src/lib/verify.ts` — apply an AI-proposed patch to a *copy*, then deterministically accept or reject it.
- `src/lib/configuration.ts` / `src/lib/catalog.ts` — validate rack and equipment edits and resolve built-in versus user-edited specifications.
- `src/lib/llm.ts` — the **only** module that calls an LLM. Routes every call through Mubit, streams responses, and normalises our Zod schemas into Gemini's supported JSON-schema subset.
- `src/lib/agents/*` — RequirementsAgent, RackArchitect, RackEditor and RepairAgent. Each has one constant system prompt, one model and one output format.
- `src/lib/orchestrate.ts` — wires first designs and follow-up edits through agents, validator and verifier.
- `src/lib/events.ts` — the typed `RunEvent` stream (see below).
- `src/lib/fleet.ts` — browser-side rack collection, per-rack snapshots, and migration from the original single-rack workspace.
- `src/lib/rackRuns.ts` — rack-scoped local Mubit call and deterministic outcome summaries for the dashboard.

### Why there's no agent framework

No LangGraph, no LangChain — deliberately. The control flow here is a straight line with one bounded retry loop: `Requirements → Architect → validate → (repair ≤3 rounds)`. A graph runtime, checkpointer and state-channel abstraction buy nothing against that shape, and every layer added is latency and indirection between you and the thing that actually matters — the deterministic validator. The orchestrator is a plain async function you can read top to bottom in one sitting.

What the problem *did* need wasn't orchestration machinery, it was **observability**, so that's what got built: agents emit typed `RunEvent`s as work happens, the API route serialises them as Server-Sent Events, and the Studio renders each agent, validator result and verifier decision live. Nothing waits for the whole pipeline to finish before you see it.

### Parallel repair sampling

Each repair round samples `REPAIR_CANDIDATES` patches **concurrently** and keeps the first one the deterministic Verifier accepts. Sequential retries cost one round trip each; sampling costs one round trip total and gives the Verifier a choice rather than a single take-it-or-leave-it proposal. You can watch both candidates land in the activity timeline.

## Equipment data

The catalog is **real hardware**, not invented placeholders: Dell PowerEdge, HPE ProLiant, Supermicro, Arista, Cisco, Juniper, APC, Eaton, Synology and friends. `npm run build-catalog` regenerates `src/data/catalog.ts` from the [NetBox device-type library](https://github.com/netbox-community/devicetype-library) — **CC0-1.0, public domain**, ~12,400 device types, actively maintained. No attribution is required; it's given because it's earned.

From that source, verbatim: manufacturer, model, rack units, full-depth flag, weight, PSU count, and port counts (27/39 devices have a real published `maximum_draw`, 34/39 a real weight).

What the library does **not** carry, we estimate — and every item records exactly which fields those are in an `estimated` array, surfaced in the UI with an `est` marker next to the value:

| Field | Why estimated |
|---|---|
| `priceUsd` | No open dataset of list prices exists, anywhere. All prices are ours. |
| `depthMm` | The library only records a full-depth boolean, not millimetres. |
| `powerW` | Only ~44% of rack devices publish `maximum_draw` — notably **0%** of Dell/Cisco/Lenovo/Supermicro 2U+ servers, and no GPU-class server at all. |
| `powerCapacityW` | Derived from the inlet plug standard (amps × volts × 0.8 derate) where absent. |

Two traps worth knowing if you extend the picks: `weight_unit` is usually grams or pounds rather than kg, and multiple `power-ports` are *redundant feeds*, so draw must be aggregated with `max()`, never summed.

## Performance

Prompt → rendered, validated rack in **~4-6s**; Break → Repair → Verify in **~2-3s**. It was ~143s and ~163s respectively before we discovered that `gemini-3.8-flash` is throttled to ~105s/call on this tier while five sibling models answer in 1-3s. [MUBIT_NOTES.md](./MUBIT_NOTES.md) has the full diagnosis; `npm run pick-model` re-runs the comparison on the real workload if latency ever regresses.

## Honesty

Local metrics (the benchmark on `/lab`, call logs, lessons learned) are reported as local metrics. Nothing is claimed as a Mubit adapter result unless it's been verified in the Mubit console's "Try models".

The Mubit Tasks/Adapters status shown in the dashboard, Studio and Lab comes from a dated, user-provided console snapshot in `data/mubit-console-snapshot.json`. It records 26 learning tasks, zero live tasks, and RepairAgent v1 below its quality target (60% on 15 tests versus 85%). This is training evidence, not adapter inference telemetry. The corrected paired A/B benchmark was stopped by the provider's daily free-tier quota after three confirmed held-out pairs; the older unpaired result is labeled preliminary in `/lab`.

Production agent traffic uses one pinned Gemini model and a stable request format so calls for different racks build the same four Mubit tasks. The `pick-model` diagnostic opts out of Mubit recording. Temporary provider 503s are retried with progress shown in the Copilot; a final failure is shown plainly. See [MUBIT_NOTES.md](./MUBIT_NOTES.md) for the task audit and [TESTING.md](./TESTING.md) for verification.

The fleet dashboard shows Mubit-routed provider calls, schema-valid replies, call latency, and rack runs that finished with zero hard design issues. New call records capture Mubit's `x-middleware-request-id`, so the dashboard can count gateway-confirmed responses. Existing records without that header still count as local call history. Adapter comparisons are a separate console workflow; the app does not label provider calls as adapter inference.

## Verification

`npm test` covers individual rules, property tests, complete racks, editing, browser storage, orchestration and Mubit task fingerprints. The benchmark uses realistic workload profiles; a reference-build test proves 200 training seeds and 50 held-out seeds admit a rack with no hard violations using real catalog devices. See [TESTING.md](./TESTING.md) for the live Mubit evaluation procedure and metric limits.
