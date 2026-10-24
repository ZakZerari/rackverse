# data/

Plain JSON/JSONL persistence — no database, per the hackathon's fixed stack.

- `calls.jsonl` — one line per LLM call (agent, latency, tokens, ok/error). Generated at runtime, gitignored.
- `rack-runs.jsonl` — rack-scoped design and repair outcomes after deterministic validation. Generated at runtime, gitignored.
- `lessons.json` — verified Repair patches, kept locally for the RepairAgent's lessons loop. Generated at runtime, gitignored.
- Rack collection, designs, conversations and version histories are stored in browser localStorage (`rackverse.fleet.v2`). The previous single-rack `rackverse.workspace.v1` is migrated on first load.
- `bench-results.json` — output of `npm run bench` (config A vs. B on the held-out scenario set). Generated at runtime, gitignored.
