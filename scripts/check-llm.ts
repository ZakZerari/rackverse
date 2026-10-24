// Enforces the hackathon's hardest rule: exactly one module calls an LLM,
// and it goes through Mubit. Run with: npm run check:llm
import { readdirSync, readFileSync, statSync } from "node:fs";
import { extname, join, relative } from "node:path";

const ROOT = process.cwd();
const ALLOWED_FILE = join("src", "lib", "llm.ts");
const SCAN_DIRS = ["src", "scripts"];
const IGNORED_SUFFIXES = [".test.ts", ".test.tsx"];

const LLM_IMPORT_PATTERNS = [
  /from\s+["']openai["']/,
  /require\(\s*["']openai["']\s*\)/,
  /new\s+OpenAI\s*\(/,
  /from\s+["']@anthropic-ai\/sdk["']/,
  /from\s+["']@google\/generative-ai["']/,
];

const WRONG_BASE_URL_PATTERNS = [/api\.openai\.com/, /generativelanguage\.googleapis\.com/];

function walk(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    if (entry === "node_modules" || entry === ".next") continue;
    const full = join(dir, entry);
    const stat = statSync(full);
    if (stat.isDirectory()) {
      walk(full, out);
    } else if ([".ts", ".tsx"].includes(extname(full))) {
      out.push(full);
    }
  }
  return out;
}

function main() {
  const violations: { file: string; reason: string }[] = [];

  for (const dir of SCAN_DIRS) {
    let files: string[];
    try {
      files = walk(join(ROOT, dir));
    } catch {
      continue;
    }

    for (const file of files) {
      const rel = relative(ROOT, file);
      if (IGNORED_SUFFIXES.some((suffix) => rel.endsWith(suffix))) continue;

      const content = readFileSync(file, "utf-8");

      if (rel !== ALLOWED_FILE) {
        for (const pattern of LLM_IMPORT_PATTERNS) {
          if (pattern.test(content)) {
            violations.push({
              file: rel,
              reason: `calls an LLM provider SDK directly (matched ${pattern}) — all LLM calls must go through ${ALLOWED_FILE}`,
            });
          }
        }
      }

      for (const pattern of WRONG_BASE_URL_PATTERNS) {
        if (pattern.test(content)) {
          violations.push({
            file: rel,
            reason: `references a non-Mubit LLM endpoint (matched ${pattern})`,
          });
        }
      }
    }
  }

  if (violations.length > 0) {
    console.error("check:llm FAILED — LLM calls must be routed through Mubit via src/lib/llm.ts only:\n");
    for (const v of violations) console.error(`  ${v.file}: ${v.reason}`);
    process.exit(1);
  }

  console.log(`check:llm OK — only ${ALLOWED_FILE} calls an LLM, and it routes through Mubit.`);
}

main();
