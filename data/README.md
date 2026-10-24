# data/

Plain JSON/JSONL persistence — no database, per the hackathon's fixed stack.

- `calls.jsonl` — one line per LLM call (agent, latency, tokens, ok/error). Generated at runtime, gitignored.
- `lessons.json` — verified Repair patches, kept locally for the RepairAgent's lessons loop. Generated at runtime, gitignored.
- `versions.json` — committed design version history for the Studio's undo/version history. Generated at runtime, gitignored.
- `bench-results.json` — output of `npm run bench` (config A vs. B on the held-out scenario set). Generated at runtime, gitignored.
- `fixtures/` — cached agent outputs used by `DEMO_SEED` so the demo has a reliable fallback if the network/Mubit is unavailable. Committed on purpose.
