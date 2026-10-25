# RackOS verification and Mubit evaluation

## Local engineering gate

Run `npm test`, `npx tsc --noEmit`, `npm run lint`, and `npm run check:llm` before collecting Mubit examples. The tests use real catalog IDs and a complete 42U virtualization rack with six dual-PSU servers, storage, switching, and independent A/B PDUs. They check unit occupancy, electrical draw, weight, depth, outlet count, port count, budget, feed capacity, per-feed outlets, and server PSU redundancy. They also inject faults and check that the verifier accepts a clean repair and rejects a repair with a new collision.

The suite exercises rack resizing, custom equipment specs and prices, catalog reset, browser workspace round trips, and the agent orchestration path with mocked proposals. No API key or Mubit quota is needed for these checks. `src/lib/agents/fingerprint.test.ts` pins each agent's instructions and the exact output format sent to Mubit; update those pins only when deliberately creating a new Mubit task. `src/lib/llm.retry.test.ts` verifies a provider 503 retries with identical task fields and no raw error in the activity stream.

## Scenario design

`generateRequirements(seed)` produces stable edge, virtualization, dense compute, and GPU-training briefs. Rack sizes range from 24U to 48U and power budgets from 3kW to 12kW. Budgets include supporting PDU and switch equipment. GPU briefs ask for GPU-capable servers and have enough money and power for the real GPU catalog item. A local test builds a valid reference rack for 200 training seeds and 50 held-out seeds. This is a feasibility check, not a claim that the AI will choose that rack.

Seeds 1 onward are for training and lesson collection. Seeds 1000 onward are held out. Keep those ranges separate when comparing prompts or models. The benchmark isolates its lesson store in memory, so held-out repairs cannot add examples to the training store.

## Live Mubit run

1. Set `MUBIT_API_KEY` and `MUBIT_MODEL` in `.env.local`.
2. Run `npm run smoke-mubit` to confirm the endpoint and structured output mode. It opts out of Mubit recording, so it does not create another task.
3. Run `npm run bench -- --train-n 8 --held-out-n 8` as a small end-to-end check. The full comparison is `npm run bench -- --train-n 99 --held-out-n 50`; it makes many real model calls and is paced by the configured request cap.
4. Open `/lab` to inspect local Config A (no lessons) against Config B (lessons from train seeds). Each held-out seed uses one architect layout and one injected physical fault shared by both repair arms. Review `data/bench-results.json` and `data/calls.jsonl` for first-round repair pass rate, fully repaired racks, rejected proposals, rounds, end-to-end latency and token use. This is a paired local pipeline comparison, not an adapter comparison.
5. Evaluate any Mubit adapter separately in Mubit's console with the same held-out briefs. Config C remains a placeholder until that comparison is recorded.

The October 24 console snapshot has no live task or passed adapter. RepairAgent v1 scored 60% on 15 cases against an 85% target; store a new dated snapshot when that changes. The corrected paired benchmark stopped after three confirmed held-out pairs because Gemini reported its free-tier 500-request daily limit and a roughly nine-hour retry window. The older result file is explicitly marked unpaired; do not cite its A/B difference as a lesson effect. Rerun the paired benchmark when provider quota is available.

For rack-level evidence, create a rack on `/dashboard`, open it, and submit a copilot prompt or Auto-repair. Returning to `/dashboard` shows that rack's Mubit call attempts, schema-valid replies, average successful-call latency, and runs whose resulting design or repair proposal had zero hard violations. The dashboard also shows the server-wide call log, including older calls that predate rack IDs. Rack-scoped metrics are tested against mixed call logs so similar rack IDs and benchmark runs cannot be attributed to the wrong rack. The design and repair API tests verify that the same run ID reaches the agent pipeline and its recorded engineering outcome.

In the Studio, start from a rack with real servers and A/B power equipment, then select each **Break it** preset. The power cut should show `POWER_BUDGET_EXCEEDED` when load exceeds 70% of the former allocation; the B-side PDU failure should show `REDUNDANCY_SINGLE_FEED`; and the CapEx cut should show `BUDGET_EXCEEDED` when the installed bill exceeds the new limit. Click **Auto-repair** and inspect every verifier decision before accepting its proposal. The Studio bar refreshes from server-recorded repair outcomes. A rack with spare capacity may absorb a preset without a hard violation, which is a valid engineering result rather than a forced failure.

`/lab` keeps a local Good/Bad suggestion and verifier reason for each RepairAgent candidate, correlated with the `x-middleware-request-id` header when present. Review those calls in Mubit Requests. The gateway documentation describes manual ratings but does not document a feedback endpoint or state that ratings filter adapter examples; the local suggestions are not submitted ratings.

These are local Mubit gateway and deterministic-verifier measurements. They do not expose Mubit adapter-training keep rates or prove physical rack performance. A repair run can describe a verified proposal even if the user later declines to apply it; the separate engineering status on the rack card always evaluates the currently saved design.

The dollar figure uses recorded input/output tokens and Google's published paid-tier list rates for `gemini-3.5-flash-lite` ($0.30/$2.50 per million). It is a provider price estimate, not a bill: Mubit fees, credits, discounts, and any missing token usage are outside the calculation. The value is omitted when a validated run cannot be priced completely.

For a fair comparison, keep the model, task fingerprints, catalog, scenario generator, validator, and seed ranges fixed throughout a run. A changed task fingerprint can start a new Mubit task rather than continuing the prior adapter's examples. The production model is pinned in code. `npm run pick-model` is diagnostic and opts out of Mubit recording, so it cannot create comparison tasks.

The RackArchitect, RackEditor and RepairAgent instructions were deliberately updated for the A/B PSU and outlet checks. Their current fingerprints are pinned in the tests. Treat earlier Mubit task runs as a different prompt version when comparing results.

## Model limits

The engineering gate checks catalog estimates, aggregate rack power, capacity and fit. It does not model exact cabling, phase balance, thermal airflow, rail compatibility or switch uplink topology. User-edited specs are treated as supplied data. Passing this gate supports a design review, not installation approval.
