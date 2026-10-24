/**
 * The training corpus: predefined, deterministic rack briefs and edit requests.
 *
 * Why it is shaped like this, from Mubit's docs:
 *
 * - A task is "calls [that] share all of these: their instructions; their
 *   tools; their tool choice; their output format; their model". Scenario text
 *   travels in the USER message and touches none of those, so every scenario
 *   here lands in the same four tasks — one per agent, not one per rack. That
 *   is the whole point of the corpus: volume without fragmentation.
 *
 * - "A call with none of these gets a session from the start of its
 *   conversation: its instructions and its first user message", and on Gemini
 *   there is no session field to send ("Gemini | None: Mubit uses the start of
 *   the conversation"). Sessions therefore come from the opening message, and
 *   Mubit "sets a task's test cases aside by session". So the briefs must
 *   differ in WORDS, not only in numbers — Mubit's grouping already treats
 *   "numbers, dates, times and IDs" as not splitting things apart. Two briefs
 *   that differ only in a server count are not two scenarios.
 *
 * - Recovery from every failure state in the docs reads "Send more calls with
 *   new messages." Repeating one prompt does not help; variety does.
 */

export interface DesignScenario {
  /** Stable id, so a resumed run can skip what it already sent. */
  id: string;
  /** The natural-language brief, as a user would type it. */
  prompt: string;
}

export interface EditScenario {
  id: string;
  prompt: string;
}

/**
 * What the rack is for. Each carries its own vocabulary so the briefs built
 * from it don't read as one sentence with the nouns swapped.
 */
const WORKLOADS: { name: string; phrasing: string }[] = [
  { name: "ai-inference", phrasing: "serve AI model inference for our product team" },
  { name: "ai-training", phrasing: "train machine-learning models overnight" },
  { name: "llm-serving", phrasing: "host a couple of large language models for internal tools" },
  { name: "ci-farm", phrasing: "run our CI build farm" },
  { name: "db-primary", phrasing: "carry the primary production database" },
  { name: "backup-target", phrasing: "act as the on-site backup target" },
  { name: "video-transcode", phrasing: "transcode video for a streaming service" },
  { name: "vdi", phrasing: "run virtual desktops for about sixty staff" },
  { name: "branch-office", phrasing: "serve a small branch office" },
  { name: "retail-edge", phrasing: "sit in the back room of a retail store" },
  { name: "telco-edge", phrasing: "handle telco edge traffic at a cell site" },
  { name: "research-cluster", phrasing: "support a university research cluster" },
  { name: "game-servers", phrasing: "host multiplayer game servers" },
  { name: "analytics", phrasing: "crunch nightly analytics jobs" },
  { name: "file-storage", phrasing: "store engineering design files" },
  { name: "monitoring", phrasing: "run our monitoring and logging stack" },
  { name: "dev-staging", phrasing: "give the dev team a staging environment" },
  { name: "broadcast", phrasing: "handle live broadcast playout" },
  { name: "pos-backend", phrasing: "run the point-of-sale backend for a chain" },
  { name: "sensor-ingest", phrasing: "ingest sensor data from a factory floor" },
  { name: "render-farm", phrasing: "render animation frames" },
  { name: "mail-web", phrasing: "run mail and web servers for a small ISP" },
  { name: "lab-bench", phrasing: "sit on a lab bench for hardware testing" },
  { name: "dr-site", phrasing: "stand by as a disaster-recovery site" },
];

/** Where it lives — changes what the brief worries about. */
const SITES: string[] = [
  "in our main colo cage",
  "in a shared rack at a regional datacentre",
  "in a comms room with no raised floor",
  "at a remote site we visit twice a year",
  "in the basement of our own office",
  "in a hot aisle containment pod",
  "in a half-height cabinet under a desk",
  "in a leased suite where power is metered",
];

/** A constraint with teeth — these are what make the validator interesting. */
const CONSTRAINTS: string[] = [
  "leave room to grow later",
  "keep the whole thing as cheap as you can",
  "everything has to be serviceable from the front",
  "we lose power often, so hold the load through an outage",
  "the floor is rated low, so keep the weight sensible",
  "it has to survive losing one power feed",
  "we only have a single circuit to work with",
  "spare parts matter more than peak speed",
  "noise is a problem, so nothing exotic",
  "we want headroom on power, not a rack running at the limit",
  "plan the network ports properly, we ran out last time",
  "keep the device count low so there's less to manage",
];

/** How a person actually opens the request. */
const OPENERS: string[] = [
  "I need a rack to",
  "Put together a rack that will",
  "We're building out a rack to",
  "Design something for us to",
  "Can you spec a rack to",
  "Looking for a build that will",
];

/** Sizes, kept as plain prose — some briefs state them, some don't. */
const SIZING: string[] = [
  "42U cabinet",
  "24U cabinet",
  "48U cabinet",
  "18U wall-mount",
  "45U cabinet",
  "", // deliberately unstated, so the agent has to default
];

const BUDGETS: string[] = [
  "Budget is around $40k.",
  "We can spend up to $120k.",
  "Keep it under $25k if you can.",
  "There's about $75k available.",
  "No hard budget, but don't be silly.",
  "", // unstated
];

/**
 * Mixed-radix indexing: walking `index` through the dimensions at different
 * strides gives a distinct combination each time without repeating a pairing
 * early. Deterministic, so a given index is always the same scenario.
 */
function pick<T>(list: T[], index: number, stride: number): T {
  return list[(Math.floor(index / stride) + index) % list.length];
}

export function designScenario(index: number): DesignScenario {
  const workload = pick(WORKLOADS, index, 1);
  const site = pick(SITES, index, 3);
  const constraint = pick(CONSTRAINTS, index, 5);
  const opener = pick(OPENERS, index, 7);
  const sizing = pick(SIZING, index, 11);
  const budget = pick(BUDGETS, index, 13);

  const size = sizing ? ` It's a ${sizing} ${site}.` : ` It goes ${site}.`;
  const money = budget ? ` ${budget}` : "";

  return {
    id: `design-${workload.name}-${index}`,
    prompt: `${opener} ${workload.phrasing}.${size} Please ${constraint}.${money}`,
  };
}

/**
 * Follow-up requests, for RackEditor. Written as things a person says to a
 * rack that already exists — which is exactly the distribution that task has
 * to serve.
 */
const EDITS: string[] = [
  "we hired more people, add another couple of servers",
  "this came in over budget — find me something cheaper",
  "swap the switch for one with more ports, we're out",
  "add redundant power, the site lost a feed last month",
  "free up some space near the top for a future appliance",
  "the PDU isn't big enough, sort the outlets out",
  "move the heavy gear lower, it's top-heavy as drawn",
  "we don't need that much storage, take some out",
  "add a patch panel so the cabling isn't a mess",
  "that server is overkill, use something smaller",
  "we need a second switch for redundancy",
  "power draw is too close to the limit, bring it down",
  "put a UPS in, we can't take an outage",
  "the rack is half empty, consolidate into a shorter one",
  "add blanking panels to close the gaps",
  "replace the GPU box, we're not doing AI on this one any more",
  "we need another storage array for the archive",
  "this is too expensive, drop to one switch",
  "give me more compute without going over the power budget",
  "the network ports don't add up, fix that",
  "take out anything we don't actually need",
  "add a server and whatever it needs to work",
  "we want everything on two independent feeds",
  "shift the switch to the top so patching is easier",
];

export function editScenario(index: number): EditScenario {
  return {
    id: `edit-${index}`,
    prompt: EDITS[index % EDITS.length],
  };
}

/** Distinct briefs available before the generator starts repeating a pairing. */
export const DESIGN_SCENARIO_SPACE =
  WORKLOADS.length * SITES.length * CONSTRAINTS.length * OPENERS.length * SIZING.length * BUDGETS.length;

export const EDIT_SCENARIO_COUNT = EDITS.length;
