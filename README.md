# RackOS

**A multi-agent AI server-rack designer where the AI proposes and deterministic code decides.**

Built for Mubit "Night Shift" (London) — and built *on* Mubit, not just plugged into it. Every LLM call this app makes, for every agent, for every rack, goes through exactly one gateway module and lands on exactly one Mubit task per agent. That's not an implementation detail; it's the point — see [Why Mubit is the point, not a dependency](#why-mubit-is-the-point-not-a-dependency).

Describe a rack in plain English —

> "42U rack, 8 servers, redundant A/B power, 2 switches, $60k budget"

— and four specialist agents turn that into a real layout, drawn from a catalog of **39 real, named pieces of hardware** (Dell PowerEdge, HPE ProLiant, Supermicro, Cisco, Arista, APC, Eaton, Synology — not placeholders). A deterministic TypeScript validator then checks it against the engineering rules that actually matter: power budget, weight, mounting depth, port count, PDU outlets, redundant-feed capacity, and cost. If it's wrong, a Repair agent sees the exact violation codes and proposes a fix; a deterministic Verifier accepts that fix only if it strictly improves the design with no regressions. And if the request itself is impossible — a budget $5,600 below what the cheapest valid configuration could ever cost — **code proves that before any agent is asked to try**, and says so with real numbers instead of grinding in circles.

No agent ever decides whether a rack is valid. No agent ever decides when it's done. Code does both, every time.

---

## Table of contents

- [Why this exists](#why-this-exists)
- [Why Mubit is the point, not a dependency](#why-mubit-is-the-point-not-a-dependency)
- [Quickstart](#quickstart)
- [What you get](#what-you-get)
- [Architecture](#architecture)
- [The four agents](#the-four-agents)
- [Why there's no agent framework](#why-theres-no-agent-framework)
- [Equipment data](#equipment-data)
- [Performance](#performance)
- [Honesty](#honesty)
- [Verification](#verification)
- [Project layout](#project-layout)
- [Further reading](#further-reading)

---

## Why this exists

A rack is a system, not a parts list. Eight servers, two switches, and a PDU can each be individually fine and collectively illegal — overlapping rack units, a feed that can't survive losing its partner, a budget blown by tens of thousands of dollars before anyone notices. An LLM asked to "design a rack" will cheerfully produce something that looks plausible and is quietly wrong in three ways at once. RackOS's answer is architectural, not promotional: **let the model propose, and make something else — deterministic, testable, boring code — decide.**

That split is enforced everywhere in this codebase, not just claimed in prose:

- Agents only ever emit a **proposal** — structured JSON matching a Zod schema. They never compute their own "valid" verdict; they can't, because validity isn't a thing they're asked to judge.
- `src/lib/validate.ts` is the **only** source of truth for whether a design is legal. It's pure, synchronous, has zero dependency on any model, and is exercised by property-based tests — not just hand-picked examples.
- `src/lib/verify.ts` is the **only** thing that decides whether a repair patch gets applied. It re-validates before and after, requires a strict improvement with no new or worsened violations, and rolls back otherwise. An agent cannot talk its way into a bad patch landing.
- `src/lib/feasibility.ts` goes one layer further: before any agent is even called, it computes a genuine mathematical lower bound on cost, power, and height for a given brief. If that floor already breaks a limit, nothing can fix it — so nothing is asked to. This exists because early testing showed agents grinding forever on literally impossible requests (8 redundant-power servers under a budget that can't even fit 6 of them), proposing the same two doomed trade-offs over and over. Code now proves impossibility in milliseconds, for free, instead of discovering it empirically after a dozen wasted calls.

## Why Mubit is the point, not a dependency

Most projects bolt an LLM provider in through whatever SDK is fastest to import. This one didn't, because the brief wasn't "call an LLM" — it was "build this *through* Mubit, so its learning layer can watch, group, and eventually improve what these agents do." That shaped real architectural decisions, not just a `baseURL` string:

**One module, no exceptions.** `src/lib/llm.ts` is the *only* file in this entire codebase allowed to call a language model. Every one of the four agents, every script, every diagnostic tool routes through its single `complete()` function. This isn't a style preference — `npm run check:llm` statically scans the repo and fails the build if anything else so much as imports an LLM SDK. Mubit sits in front of every token this app ever generates, with no side door.

**One stable task per agent, by design.** Mubit groups calls into a *task* by exactly five things: instructions, tools, tool choice, output format, and model. Each of RackOS's four agents has **one constant, never-templated system prompt** and **one fixed Zod schema** — variable content goes only in the user message, never the instructions. Why this matters: change a prompt by one word and the task forks, and the old one stops accumulating examples forever. So identity lives in exactly one file (`src/lib/agents/registry.ts`), is fingerprinted from a hash of the real instructions and schema, and is pinned by a test (`fingerprint.test.ts`) that fails loudly — *"this forks its Mubit task"* — the instant anyone changes a prompt without meaning to. Four agents, four tasks, permanently, no matter how many thousands of different racks get designed.

**Built to actually reach the adapter-training threshold — not just to send traffic.** Mubit trains an adapter once a task crosses a kept-example threshold, and not every call becomes a kept example: failed calls, overlong prompts, and near-duplicate sessions don't count. Knowing that drove real engineering, not just hope:
- `src/lib/training/corpus.ts` generates thousands of distinct, realistic rack briefs — different workloads, sites, constraints, and phrasing — because Mubit derives a session from the *start of a conversation*, and near-identical openings collapse into one session whose test cases get held back together. Variety isn't a nice-to-have; it's what makes volume actually count toward training.
- `npm run train-adapters` (`scripts/train-adapters.ts`) is a purpose-built job that reads what's already been sent per agent from the local call log, computes the deficit to a target, and sends exactly the mix of design/edit/repair turns needed to close it — never re-sending what's already there, never wasting a call on an agent already past target.
- The prompts themselves were shrunk specifically to survive Mubit's training pipeline: the catalog went from a ~1,900-token JSON blob to a ~590-token pipe-delimited table, and "lessons" (verified past fixes fed back into future repairs) went from 727 tokens of raw context down to ~130 tokens of `violation → fix shape` — because overlong examples get skipped during training, and a skipped example is a wasted call.
- Every outbound call is paced under the provider's real rate limits (the sliding-window limiter in `src/lib/llm.ts`), because a rate-limited call never becomes a kept example either — pacing isn't just a latency concern here, it's directly a training-data concern.

**The model is pinned deliberately, and trade-offs are measured, not assumed.** `MUBIT_TASK_MODEL` in `src/lib/llm.ts` is one constant that every agent's task identity depends on. Changing it is a real decision with a real cost — every task forks, every adapter resets to zero kept examples — so it's never done casually. `npm run pick-model` re-runs a real production workload against every candidate model, concurrently, through the same Mubit proxy and key, before the pin is ever touched. That process has already caught a model being silently throttled to uselessness on one quota tier and perfectly fine on another — the honest, re-measured numbers are in [MUBIT_NOTES.md](./MUBIT_NOTES.md) rather than asserted from memory.

**Nothing is claimed about adapter quality unless Mubit itself says so.** See [Honesty](#honesty) — "the adapter helped" is treated as a claim that needs console evidence, exactly like any other engineering claim needs a test.

The result: this isn't an app that happens to call Mubit. It's an app whose identity-stability, prompt-size, pacing, and training-volume engineering exist *because* the goal was always to come out the other side with four real, usable, evidence-backed Mubit adapters — not just four agents that happen to work today.

## Quickstart

```bash
npm install
cp .env.example .env.local      # fill in MUBIT_API_KEY (see MUBIT_NOTES.md for the pinned model)
npm run smoke-mubit             # confirms the Mubit connection actually works
npm test                        # 163 tests: validator rules, property tests, orchestration, Mubit task stability
npm run check:llm               # enforces that ONLY src/lib/llm.ts talks to an LLM
npm run dev                     # http://localhost:3000
```

Once it's running:

```bash
npm run pick-model              # evidence-based model comparison, through Mubit, before touching the pin
npm run train-adapters          # sends exactly the traffic needed to push every agent's task toward training
npm run replay -- "42U rack, 8 servers, redundant A/B power, 2 switches, $25k budget" "ok drop it"
                                 # replays a real multi-turn conversation against the live model —
                                 # the harness this project actually uses to prove a fix fixes something
npm run build-catalog           # regenerates the real-hardware catalog from NetBox's public data
```

## What you get

- **`/`** — the landing page: the problem, the agent workflow, the Mubit learning layer, and an interactive 42U rack preview using the real catalog and validator. A simulated power cut shows the resulting hard violation live, and **Repair in Studio** turns that exact scenario into a saved rack you can fix yourself.
- **`/dashboard`** — the fleet view: every saved rack as a real miniature elevation (true unit positions and categories, not a generic icon), health status, power/space/cost at a glance, search and filtering, and a **New rack** dialog with a live cabinet-size preview.
- **`/racks/[id]`** (the Studio) — the actual editor. A 2D elevation with real rack-rail detail, a 3D view, drag-and-drop equipment placement, and a conversational Copilot where every agent call, validator result, and verifier decision streams live as it happens — not after the whole pipeline finishes. **Break it** simulates a power cut, a failed PDU, or a budget cut, so you can watch the repair loop work on a real failure.
- **`/lab`** — the benchmark surface: realistic workload profiles, a reference build proving hundreds of seeds admit a zero-violation rack with real hardware, and the honestly-labeled gap between local verification and actual Mubit adapter evidence.

Designs, conversations, and version history persist in browser storage per rack; Mubit call evidence lives in this server's local JSONL logs, kept deliberately separate from what's saved in the browser.

## Architecture

```
prompt ─▶ RequirementsAgent ─▶ RackArchitect ─▶ validate() ─┬─ clean ─▶ done
                                                   ▲        │
                                                   │        └─ violations
                                              commit│                │
                                                    │                ▼
                                   verifyPatch() ◀──┴──── RepairAgent ×N (parallel)

follow-up ─▶ RequirementsAgent ─▶ explainInfeasibility()? ─┬─ impossible ─▶ explained, no agent called
                                                            └─ possible ──▶ RackEditor ─▶ validate() ─▶ …
```

| File | What it owns |
|---|---|
| `src/lib/types.ts` | The shared `Design` model every agent, the validator, and the exporter all use. |
| `src/data/catalog.ts` | **Generated.** 39 real devices (see [Equipment data](#equipment-data)). Agents reference a `catalogId` only — they can never invent specs. |
| `src/lib/validate.ts` | The deterministic validator. Pure functions, property-tested, the sole authority on legality. |
| `src/lib/feasibility.ts` | Proves a brief *mathematically impossible* before any agent is asked to solve it. A sound lower bound, never a feasibility guarantee. |
| `src/lib/patch.ts` / `src/lib/verify.ts` | Apply a proposed patch to a copy; accept it only on strict, regression-free improvement. |
| `src/lib/llm.ts` | **The only module allowed to call an LLM.** Mubit routing, streaming, rate pacing, Gemini schema rewriting — all in one place, enforced by `check:llm`. |
| `src/lib/agents/registry.ts` | Every agent's constant instructions and schema, in one file — because that tuple *is* its Mubit task identity. |
| `src/lib/agents/*.ts` | The four agents themselves (below). |
| `src/lib/training/*.ts` | The scenario corpus and the deficit-aware trainer that pushes real Mubit task volume. |
| `src/lib/orchestrate.ts` | Wires first designs and follow-up edits through agents, the feasibility gate, the validator, and the verifier. |
| `src/lib/events.ts` | The typed `RunEvent` stream the Studio renders live. |
| `src/lib/fleet.ts` | Browser-side rack collection and per-rack snapshots. |

## The four agents

Each has exactly one job, one constant system prompt, and one Mubit task — on purpose. Folding two jobs into one agent would feed its adapter two different input shapes and teach it neither well.

| Agent | Job | Never does |
|---|---|---|
| **RequirementsAgent** | Turns a brief — and the conversation so far — into structured, checkable requirements, carrying them forward turn to turn and changing only what actually changed. | Touch the design itself. |
| **RackArchitect** | Lays out a full rack from scratch: which real catalog device goes where, on which face and feed. | Edit an existing rack — that's RackEditor's job. |
| **RackEditor** | Applies a specific conversational request to an existing rack: "add two servers," "drop redundant power," "swap the switch." | Rebuild from zero, or touch equipment the user didn't ask about. |
| **RepairAgent** | Given the exact violations a deterministic validator found, proposes the smallest patch that fixes them — informed by compact "lessons" from past verified fixes. | Decide whether its own patch is good enough. That's `verifyPatch()`'s job, always. |

## Why there's no agent framework

No LangGraph, no LangChain — deliberately. The control flow is a straight line with one bounded retry loop: `Requirements → Architect → validate → (repair ≤3 rounds)`. A graph runtime, a checkpointer, and a state-channel abstraction buy nothing against that shape; every layer added is latency and indirection between you and the thing that actually matters — the deterministic validator. The orchestrator is a plain async function you can read top to bottom in one sitting.

What the problem *did* need wasn't orchestration machinery, it was **observability** — so that's what got built. Agents emit typed `RunEvent`s as work happens, the API route serialises them as Server-Sent Events, and the Studio renders every agent call, validator result, and verifier decision the moment it happens. Nothing waits for the whole pipeline to finish before you see it.

Repair rounds sample candidates **concurrently** and keep the first the deterministic Verifier accepts — one round trip for a choice, instead of one round trip per sequential guess.

## Equipment data

Real hardware, not invented placeholders: Dell PowerEdge, HPE ProLiant, Supermicro, Arista, Cisco, Juniper, APC, Eaton, Synology, and more. `npm run build-catalog` regenerates `src/data/catalog.ts` from the [NetBox device-type library](https://github.com/netbox-community/devicetype-library) — CC0-1.0, public domain, ~12,400 device types, actively maintained. No attribution required; it's given because it's earned.

Verbatim from that source: manufacturer, model, rack units, full-depth flag, weight, PSU count, and port counts (27/39 devices carry a real published `maximum_draw`, 34/39 a real weight). What the library doesn't carry, we estimate — and every item records exactly which fields those are in an `estimated` array, shown in the UI with an `est` marker:

| Field | Why it's estimated |
|---|---|
| `priceUsd` | No open dataset of list prices exists anywhere. |
| `depthMm` | The library only records a full-depth boolean, not millimetres. |
| `powerW` | Only ~44% of rack devices publish real draw — notably 0% of several major vendors' 2U+ servers, and no GPU-class server at all. |
| `powerCapacityW` | Derived from the inlet plug standard (amps × volts × 0.8 derate) where unpublished. |

## Performance

Model choice here is a measured, re-verified decision, not an assumption that it still holds. The full diagnosis — including a case where the *same* model went from "throttled to ~105s/call, unusable" to "~18s/call, 3-for-3 reliable" purely because the account's billing tier changed, caught by actually re-running `npm run pick-model` rather than trusting a stale number — is in [MUBIT_NOTES.md](./MUBIT_NOTES.md).

## Honesty

This is the discipline the whole project runs on, not a disclaimer: **nothing is claimed as a verified Mubit result unless the Mubit console actually shows it.**

- Local metrics (the `/lab` benchmark, call logs, lessons learned) are reported as exactly that — local metrics — never dressed up as adapter performance.
- The Mubit task/adapter status shown in the dashboard comes from a dated, explicitly-labeled console snapshot (`data/mubit-console-snapshot.json`), not a live claim — and a deliberate model re-pin since that snapshot was taken forked all four production tasks again, so even its numbers are known to already be out of date. That's stated here rather than quietly left stale.
- Production traffic is pinned to one model and one request shape specifically so that calls for completely different racks build the *same four* Mubit tasks — verified by checking real local task-key fingerprints, not assumed.
- Diagnostic tooling (`pick-model`) opts out of Mubit recording entirely, so comparing candidate models never pollutes the training data of the pinned one.
- `feasibility.ts`'s lower bound is used only to prove impossibility — a result *under* a limit is never treated as proof a design exists, and the code says so at the exact point someone might be tempted to assume otherwise.

See [MUBIT_NOTES.md](./MUBIT_NOTES.md) for the full task audit, including real fingerprints, call counts, and the free-tier-quota incidents that shaped several of the decisions above.

## Verification

`npm test` runs 163 tests across individual validator rules, property-based tests, full-rack scenarios, equipment editing, browser-storage migration, orchestration (including the feasibility short-circuit, mocked so it needs no live call), and Mubit task-identity fingerprints. A reference-build test proves hundreds of training and held-out seeds admit a zero-hard-violation rack using real catalog devices. `npm run replay` goes further — it replays a real multi-turn conversation against the *live* model, and is how every bug fix in this project's actual history was confirmed, not just unit-tested. See [TESTING.md](./TESTING.md) for the full live-evaluation procedure.

## Project layout

```
src/
  app/              Next.js routes: landing page, dashboard, Studio, lab, API routes
  components/       Studio UI, dashboard cards, landing-page artwork
  lib/
    agents/         The four agents + the Mubit task-identity registry
    training/       Scenario corpus + the deficit-aware adapter trainer
    llm.ts          The one module allowed to call an LLM
    validate.ts     The deterministic validator
    feasibility.ts  The deterministic infeasibility prover
    verify.ts       The deterministic patch verifier
    orchestrate.ts  Wires it all together
  data/
    catalog.ts      Generated real-hardware catalog
scripts/
  build-catalog.ts       Regenerates the catalog from NetBox
  pick-model.ts          Evidence-based model comparison through Mubit
  train-adapters.ts      Deficit-aware Mubit training-traffic generator
  replay-conversation.ts Live multi-turn conversation harness
  smoke-mubit.ts         Connection check
```

## Further reading

- **[MUBIT_NOTES.md](./MUBIT_NOTES.md)** — the real Mubit integration diary: task-identity audits, the free-tier quota incidents, model-choice re-measurements with actual numbers, and the feasibility-detection bug fix with a full before/after. This is where "how we actually used Mubit" lives in detail, not just in summary.
- **[TESTING.md](./TESTING.md)** — the live evaluation procedure and exactly what its metrics do and don't mean.
