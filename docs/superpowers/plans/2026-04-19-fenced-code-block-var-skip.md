---
status: implemented
---

# Fenced Code-Block Variable-Skip Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** `ralph pipeline validate` catches `$HOME` and similar undeclared references that live inside agent `.md` prompt bodies today (runtime-only failures), while runtime stops eagerly expanding shell-like `$var` tokens inside triple-backtick fences.

**Architecture:** Add a `splitFences` helper to `src/attractor/transforms/variable-expansion.ts`. `expandVariables` walks only non-fenced segments. `scanUndeclaredCallerVars` additionally loads each `agent="X"` node's `.md` body (via `getBundledAgentsDir()` + optional `.ralph/agents/` override), strips frontmatter with `parseFrontmatter`, strips fences, and scans the remainder — emitting a new `unresolved_var_in_agent_prompt` diagnostic carrying file + 1-based line. Migrate `src/cli/agents/tmux-tester.md:37` to discover `$WIN` via `tmux list-windows | grep '^test-' | head -1` so no pipeline var lives inside a fence.

**Tech Stack:** TypeScript, vitest, existing `variable-expansion.ts` module surface, existing `src/cli/lib/{assets,frontmatter,agent-registry}.ts` helpers.

**Spec:** `specs/2026-04-19-fenced-code-block-var-skip-design.md`

---

## Chunk 1: `splitFences` + runtime expansion

**Files:**
- Modify: `src/attractor/transforms/variable-expansion.ts:15-32` (expandVariables) — wrap in splitFences walk
- Modify: `src/attractor/transforms/variable-expansion.ts` (add splitFences helper + export)
- Test: `src/attractor/tests/variable-expansion.test.ts` (add test block)

### Task 1.1: Write failing test for `splitFences` helper

- [ ] **Step 1: Write the failing test**

Append to `src/attractor/tests/variable-expansion.test.ts`:

```ts
import { splitFences } from "../transforms/variable-expansion.js";

describe("splitFences", () => {
  it("returns a single non-fenced segment when no fences", () => {
    const out = splitFences("plain $foo text");
    expect(out).toEqual([{ fenced: false, text: "plain $foo text" }]);
  });

  it("splits a single fenced bash block", () => {
    const src = "before\n```bash\nRUN=$HOME\n```\nafter";
    const out = splitFences(src);
    expect(out).toHaveLength(3);
    expect(out[0]).toEqual({ fenced: false, text: "before\n" });
    expect(out[1].fenced).toBe(true);
    expect(out[1].text).toContain("RUN=$HOME");
    expect(out[2]).toEqual({ fenced: false, text: "\nafter" });
  });

  it("treats an unclosed opening fence as fenced to EOF", () => {
    const src = "prose\n```bash\nRUN=$HOME\nmore shell\n";
    const out = splitFences(src);
    expect(out).toHaveLength(2);
    expect(out[0]).toEqual({ fenced: false, text: "prose\n" });
    expect(out[1].fenced).toBe(true);
    expect(out[1].text).toContain("RUN=$HOME");
  });

  it("does NOT treat inline single-backtick spans as fenced", () => {
    const out = splitFences("see `$foo` here");
    expect(out).toEqual([{ fenced: false, text: "see `$foo` here" }]);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/attractor/tests/variable-expansion.test.ts 2>&1 | tail -20`
Expected: FAIL with `splitFences is not exported` / `is not a function`.

- [ ] **Step 3: Implement `splitFences` minimally**

Add to `src/attractor/transforms/variable-expansion.ts` (above `expandVariables`):

```ts
export function splitFences(s: string): Array<{ fenced: boolean; text: string }> {
  const out: Array<{ fenced: boolean; text: string }> = [];
  const lines = s.split(/(\n)/); // keep newlines as separate tokens so joins preserve them
  let buf = "";
  let inFence = false;
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (line === "\n") { buf += line; continue; }
    const opensOrCloses = /^```/.test(line);
    if (!inFence && opensOrCloses) {
      if (buf.length) out.push({ fenced: false, text: buf });
      buf = line;
      inFence = true;
      continue;
    }
    if (inFence && /^```\s*$/.test(line)) {
      buf += line;
      out.push({ fenced: true, text: buf });
      buf = "";
      inFence = false;
      continue;
    }
    buf += line;
  }
  if (buf.length) out.push({ fenced: inFence, text: buf });
  return out;
}
```

- [ ] **Step 4: Run test to verify all 4 pass**

Run: `npx vitest run src/attractor/tests/variable-expansion.test.ts 2>&1 | tail -20`
Expected: all 4 `splitFences` cases PASS.

- [ ] **Step 5: Commit**

```bash
git add src/attractor/transforms/variable-expansion.ts src/attractor/tests/variable-expansion.test.ts
git commit -m "feat(var-expansion): add splitFences helper for fenced markdown"
```

### Task 1.2: Route `expandVariables` through `splitFences`

- [ ] **Step 1: Write failing tests for fenced expansion**

Append to `variable-expansion.test.ts`:

```ts
describe("expandVariables fence behavior", () => {
  it("leaves $HOME literal when inside a triple-backtick fence", () => {
    const src = "prose\n```bash\nRUN=$HOME\n```\n";
    const out = expandVariables(src, {});
    expect(out).toBe(src); // no throw; fenced content passed through
  });

  it("still expands prose $foo outside fences", () => {
    const out = expandVariables("hello $name", { name: "world" });
    expect(out).toBe("hello world");
  });

  it("still expands $foo inside inline single-backtick spans", () => {
    const out = expandVariables("see `$name`", { name: "w" });
    expect(out).toBe("see `w`");
  });

  it("throws UndefinedVariableError for unknown $foo outside fence", () => {
    expect(() => expandVariables("hi $typo", {})).toThrow(UndefinedVariableError);
  });

  it("does NOT throw for unknown $foo inside fence", () => {
    expect(() => expandVariables("```\n$typo\n```", {})).not.toThrow();
  });
});
```

- [ ] **Step 2: Run tests to verify failures**

Run: `npx vitest run src/attractor/tests/variable-expansion.test.ts -t "fence behavior" 2>&1 | tail -20`
Expected: 3 of 5 FAIL (unknown `$HOME` throws; fenced `$typo` throws; current behavior expands everything).

- [ ] **Step 3: Rewrite `expandVariables` to walk fences**

In `src/attractor/transforms/variable-expansion.ts` replace lines 15-32 (the current `expandVariables` body) with:

```ts
export function expandVariables(
  s: string,
  ctx: Record<string, unknown>,
  defaults?: Record<string, string>,
): string {
  return splitFences(s)
    .map((seg) => (seg.fenced ? seg.text : expandSegment(seg.text, ctx, defaults)))
    .join("");
}

function expandSegment(
  s: string,
  ctx: Record<string, unknown>,
  defaults?: Record<string, string>,
): string {
  return s.replace(/\$([a-zA-Z_]\w*(?:\.\w+)*)/g, (match, key) => {
    if (key === "goal" || key === "project") return match;
    const v = ctx[key];
    if (v === undefined) {
      const fallback = defaults?.[key];
      if (fallback !== undefined) return fallback;
      throw new UndefinedVariableError(key);
    }
    if (typeof v === "string") return v;
    if (typeof v === "number" || typeof v === "boolean" || v === null) return String(v);
    return JSON.stringify(v);
  });
}
```

- [ ] **Step 4: Run fence-behavior tests**

Run: `npx vitest run src/attractor/tests/variable-expansion.test.ts -t "fence behavior" 2>&1 | tail -20`
Expected: all 5 PASS.

- [ ] **Step 5: Run full test file to catch regressions**

Run: `npx vitest run src/attractor/tests/variable-expansion.test.ts 2>&1 | tail -20`
Expected: all PASS (prior `expandVariables` tests still green).

- [ ] **Step 6: Run project-wide tests to catch ripple effects**

Run: `npm test 2>&1 | tail -30`
Expected: all PASS (no other file assumed fenced `$var` expands).

- [ ] **Step 7: Commit**

```bash
git add src/attractor/transforms/variable-expansion.ts src/attractor/tests/variable-expansion.test.ts
git commit -m "feat(var-expansion): skip fenced markdown in expandVariables"
```

---

## Chunk 2: Migrate `tmux-tester.md`

**Files:**
- Modify: `src/cli/agents/tmux-tester.md:37` (replace `WIN="test-$run_id"` with tmux-discovery)

### Task 2.1: Rewrite the harness-setup fence

- [ ] **Step 1: Open the file and locate line 37**

Read `src/cli/agents/tmux-tester.md` lines 33-42 for context.

- [ ] **Step 2: Replace the hard-coded `$run_id` line with dynamic discovery**

In `src/cli/agents/tmux-tester.md`, change the fence body at lines 36-41 (the opening ` ```bash ` is line 35, the closing ` ``` ` is line 42 — both stay untouched) from:

```bash
SESSION=$(tmux display-message -p '#S')
WIN="test-$run_id"
RUN_ID="tmux-tester-$(date +%s)-$$"
RUN_DIR="$HOME/.ralph/harness/$RUN_ID"
CAPTURE_INDEX=0
mkdir -p "$RUN_DIR"
```

to:

```bash
SESSION=$(tmux display-message -p '#S')
WIN=$(tmux list-windows -t "$SESSION" -F '#W' | grep '^test-' | head -1)
RUN_ID="tmux-tester-$(date +%s)-$$"
RUN_DIR="$HOME/.ralph/harness/$RUN_ID"
CAPTURE_INDEX=0
mkdir -p "$RUN_DIR"
```

- [ ] **Step 3: Verify the file still reads coherently**

Read `src/cli/agents/tmux-tester.md` lines 24-45. Confirm line 27's prose `- Tmux window name: \`test-$run_id\`` is unchanged (inline backtick still expands — this is the orientation cue for the agent).

- [ ] **Step 3b: Run existing validator on the file before committing**

Run: `node dist/cli/index.js pipeline validate pipelines/smoke/tmux-tester.dot 2>&1 | tail -5`
Expected: `✔ Pipeline valid` (this catches accidental fence-marker breakage from Step 2; validator agent-body scan is not yet in place, so the fenced-$var rule is not yet enforced — the check is structural only).

- [ ] **Step 4: Commit**

```bash
git add src/cli/agents/tmux-tester.md
git commit -m "refactor(tmux-tester): discover window via tmux list-windows, drop fenced \$run_id"
```

---

## Chunk 3: Validator reads agent `.md` bodies

**Files:**
- Modify: `src/attractor/transforms/variable-expansion.ts:128-153` (`scanUndeclaredCallerVars`)
- Modify: `src/attractor/transforms/variable-expansion.ts` (change `MissingRef` shape; adjust callers' type imports)
- Modify: `src/cli/commands/pipeline.ts:161-179` — Task 3.1 Step 5 updates the three existing formatter call sites (`formatMissingInputsError`, `formatLegacyMissingWarning`, `formatUndeclaredWarning`) to `.map(r => r.name)` at their boundaries (signatures unchanged). Task 3.2 Step 3 adds a **separate, new** render hunk below these three calls for `source`-bearing entries — no overlap with Step 5's narrow call-site edit
- Test: `src/attractor/tests/variable-expansion.test.ts` (validator-level)
- Test: `src/cli/tests/commands/pipeline-validate.test.ts` (new file — no pre-existing validate test exists; see Task 3.2 Step 1 note on helpers)

### Task 3.1: Extend `MissingRef` shape

- [ ] **Step 1: Read current types**

Read `src/attractor/transforms/variable-expansion.ts:128-153` and any type imports.

- [ ] **Step 2: Write failing unit test for new shape**

In `variable-expansion.test.ts` add:

```ts
describe("scanUndeclaredCallerVars with agent body", () => {
  it("flags unfenced $typo inside an agent .md body", async () => {
    const projectDir = makeTempProjectWithAgent("fake-agent", `---
name: fake-agent
---
# body
Value: $typo_var
`);
    const graph = parseInlineDot(`
      digraph test {
        inputs="project"
        start -> n1 [label="go"]
        n1 [agent="fake-agent"]
        n1 -> exit
      }
    `);
    const res = scanUndeclaredCallerVars(graph, { project: projectDir });
    expect(res.missing.some((m) =>
      typeof m === "object" && m.name === "typo_var" && m.source?.file.endsWith("fake-agent.md")
    )).toBe(true);
  });

  it("does NOT flag $HOME inside a triple-backtick fence in agent body", async () => {
    const projectDir = makeTempProjectWithAgent("fake-agent", `---
name: fake-agent
---
Pre-fence prose.
\\\`\\\`\\\`bash
RUN=$HOME
\\\`\\\`\\\`
`);
    const graph = parseInlineDot(/* same shape referring to fake-agent */);
    const res = scanUndeclaredCallerVars(graph, { project: projectDir });
    expect(res.missing.some((m) => typeof m === "object" && m.name === "HOME")).toBe(false);
  });

  it("skips agent body when node.prompt is set (override)", async () => {
    const projectDir = makeTempProjectWithAgent("fake-agent", "$typo_var\n");
    const graph = parseInlineDot(`
      digraph test {
        inputs="project"
        start -> n1 [label="go"]
        n1 [agent="fake-agent", prompt="no var here"]
        n1 -> exit
      }
    `);
    const res = scanUndeclaredCallerVars(graph, { project: projectDir });
    expect(res.missing.some((m) => typeof m === "object" && m.name === "typo_var")).toBe(false);
  });
});
```

`makeTempProjectWithAgent` and `parseInlineDot` are **new local helpers** — they do NOT exist yet in `src/cli/tests/helpers/`. Define them near the top of `variable-expansion.test.ts`. Minimal concrete implementations:

```ts
import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { parseDot } from "../dot-parser.js"; // confirm actual path via grep

function makeTempProjectWithAgent(name: string, body: string): string {
  const root = mkdtempSync(join(tmpdir(), "ralph-test-"));
  const agentsDir = join(root, ".ralph/agents");
  mkdirSync(agentsDir, { recursive: true });
  writeFileSync(join(agentsDir, `${name}.md`), body);
  return root;
}

function parseInlineDot(src: string): Graph {
  return parseDot(src); // or the actual parser function exported from the engine
}
```

Before writing, run `grep -n "parseDot\\|parseGraph" src/attractor/` (via Grep tool) to locate the actual parser symbol and adjust the import.

- [ ] **Step 3: Run test to verify failures**

Run: `npx vitest run src/attractor/tests/variable-expansion.test.ts -t "with agent body" 2>&1 | tail -30`
Expected: all 3 FAIL (scanner doesn't read `.md` files yet).

- [ ] **Step 4: Extend `MissingRef` type and scanner**

In `src/attractor/transforms/variable-expansion.ts` update exports and scanner:

```ts
export type MissingRef = {
  name: string;
  source?: { file: string; line: number; agentName: string; nodeId: string };
};

// (re-use existing RESERVED, STRING_ATTRS, VAR_RE)

import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { parseFrontmatter } from "../../cli/lib/frontmatter.js";
import { getBundledAgentsDir } from "../../cli/lib/assets.js";

function resolveAgentMdPath(projectDir: string | undefined, agentName: string): string | null {
  if (projectDir) {
    const local = join(projectDir, ".ralph/agents", `${agentName}.md`);
    if (existsSync(local)) return local;
  }
  const bundled = join(getBundledAgentsDir(), `${agentName}.md`);
  if (existsSync(bundled)) return bundled;
  return null;
}

type AgentSource = { file: string; line: number; agentName: string; nodeId: string };

function collectAgentBodyRefs(
  node: Node,
  projectDir: string | undefined,
  refs: Map<string, AgentSource[]>,
): void {
  const agentName = (node as Record<string, unknown>).agent;
  if (typeof agentName !== "string") return;
  // Skip body when an explicit prompt/label is provided — it overrides config.prompt at runtime.
  if ((node as Record<string, unknown>).prompt) return;
  if ((node as Record<string, unknown>).label) return;
  const path = resolveAgentMdPath(projectDir, agentName);
  if (!path) return;
  let raw: string;
  try {
    raw = readFileSync(path, "utf8");
  } catch {
    return; // diagnostic is best-effort; runtime will error separately on missing/unreadable files
  }
  // parseFrontmatter returns { attributes, body } per src/cli/lib/frontmatter.ts.
  const { body } = parseFrontmatter(raw);
  // Line offset: if body === raw, no frontmatter; else count newlines in the stripped prefix.
  const frontmatterLineOffset = raw.length === body.length
    ? 0
    : raw.slice(0, raw.length - body.length).split("\n").length - 1;
  // Walk segments with a running cursor so line numbers are accurate even when identical segments repeat.
  let segStart = 0;
  for (const seg of splitFences(body)) {
    if (!seg.fenced) {
      const re = new RegExp(VAR_RE.source, VAR_RE.flags);
      let m: RegExpExecArray | null;
      while ((m = re.exec(seg.text)) !== null) {
        const name = m[1].replace(/\.+$/, "");
        if (RESERVED.has(name)) continue;
        const line = body.slice(0, segStart + m.index).split("\n").length + frontmatterLineOffset;
        const entry: AgentSource = { file: path, line, agentName, nodeId: node.id };
        const existing = refs.get(name);
        if (existing) existing.push(entry); else refs.set(name, [entry]);
      }
    }
    segStart += seg.text.length;
  }
}

export function scanUndeclaredCallerVars(
  graph: Graph,
  initialContext: Record<string, unknown>,
): { missing: MissingRef[]; declared: MissingRef[]; undeclared: MissingRef[] } {
  const attrRefs = new Set<string>();
  const producers = new Set<string>();
  const agentRefs = new Map<string, AgentSource[]>();
  const projectDir = typeof initialContext.project === "string" ? initialContext.project : undefined;

  for (const node of graph.nodes.values()) {
    collectVarRefs(node, attrRefs);
    collectProducers(node, producers);
    collectAgentBodyRefs(node, projectDir, agentRefs);
  }

  const ctxKeys = new Set(Object.keys(initialContext));
  const missing: MissingRef[] = [];

  for (const name of attrRefs) {
    if (ctxKeys.has(name) || producers.has(name)) continue;
    missing.push({ name });
  }
  for (const [name, sources] of agentRefs) {
    if (ctxKeys.has(name) || producers.has(name)) continue;
    for (const source of sources) missing.push({ name, source });
  }
  missing.sort((a, b) => a.name.localeCompare(b.name));

  const declaredSet = new Set(graph.inputs ?? []);
  const declared = missing.filter((r) => declaredSet.has(r.name));
  const undeclared = missing.filter((r) => !declaredSet.has(r.name));
  return { missing, declared, undeclared };
}
```

- [ ] **Step 5: Update existing callers' signatures**

Locate and update these three existing formatters in `src/cli/commands/pipeline.ts:161-179` that today consume `preflight.missing` / `preflight.declared` / `preflight.undeclared` as `string[]`:
- `formatMissingInputsError(missing, ...)` → call with `preflight.missing.map(r => r.name)`
- `formatLegacyMissingWarning(declared, ...)` → call with `preflight.declared.map(r => r.name)`
- `formatUndeclaredWarning(undeclared, ...)` → call with `preflight.undeclared.map(r => r.name)`

Do NOT rewrite the formatters themselves — only their call sites. This keeps their signatures `string[]` → unchanged → existing tests green. Task 3.2 Step 3 will add a **separate, new** render block below these three calls to emit `unresolved_var_in_agent_prompt` for entries that carry a `source`. No overlap: Task 3.1 modifies three `.map()` call sites; Task 3.2 adds a new render hunk. Run `grep -rn "scanUndeclaredCallerVars" src/` (Grep tool) to confirm pipeline.ts is the only consumer.

- [ ] **Step 6: Run focused tests**

Run: `npx vitest run src/attractor/tests/variable-expansion.test.ts 2>&1 | tail -20`
Expected: all PASS including the 3 new `with agent body` cases.

- [ ] **Step 7: Run full suite**

Run: `npm test 2>&1 | tail -40`
Expected: all PASS.

- [ ] **Step 8: Commit**

```bash
git add src/attractor/transforms/variable-expansion.ts src/attractor/tests/variable-expansion.test.ts src/cli/commands/pipeline.ts
git commit -m "feat(validate): scan agent .md bodies for unresolved vars"
```

### Task 3.2: CLI integration — render source + exit non-zero

- [ ] **Step 1: Write failing CLI test**

In `src/cli/tests/commands/pipeline-validate.test.ts` (or create if absent, modeled on adjacent validate tests) add:

```ts
it("exits non-zero and reports unresolved_var_in_agent_prompt when agent body has an undeclared $var", async () => {
  const project = await setupTempProjectWith({
    ".ralph/agents/faker.md": `---
name: faker
---
Ref: $meditations_dir_typo
`,
    "pipelines/test.dot": `
      digraph t {
        inputs="project"
        start -> n1 [label="go"]
        n1 [agent="faker"]
        n1 -> exit
      }
    `,
  });
  const { exitCode, stderr } = await runCli(["pipeline", "validate", "pipelines/test.dot"], { cwd: project });
  expect(exitCode).not.toBe(0);
  expect(stderr).toContain("unresolved_var_in_agent_prompt");
  expect(stderr).toContain("faker.md");
  expect(stderr).toContain("meditations_dir_typo");
});
```

Helpers `setupTempProjectWith` and `runCli` **do not exist** — `src/cli/tests/helpers/` contains only `fake-child-handle.ts` and `plain-frame.ts`. Add minimal implementations inline in this test file. Concrete approach: prefer spawning the built CLI binary (requires a prior `npm run build` — add as a `beforeAll` or test prerequisite note) via `child_process.spawnSync("node", ["dist/cli/index.js", ...args], { cwd, encoding: "utf8" })` and read `status` / `stdout` / `stderr` off the result. `setupTempProjectWith` mirrors `makeTempProjectWithAgent` from Task 3.1: mkdtemp, mkdir parents, write each file.

Also assert explicitly that no `$HOME` diagnostic appears (negative check):
```ts
expect(stderr).not.toContain("$HOME");
```
This guards against the rendering layer accidentally flagging fenced refs.

- [ ] **Step 2: Run test to confirm failure**

Run: `npx vitest run src/cli/tests/commands/pipeline-validate.test.ts 2>&1 | tail -20`
Expected: FAIL — currently validator doesn't print file:line or the new diagnostic key.

- [ ] **Step 3: Wire `unresolved_var_in_agent_prompt` diagnostic in pipeline.ts**

In `src/cli/commands/pipeline.ts` around line 157 (the existing `scanUndeclaredCallerVars` call site): for every entry in `missing` where `source` is present, print:

```
  - unresolved_var_in_agent_prompt: $<name>
    <relative path>:<line>
    (referenced in agent="<agentName>" used by node <nodeId>)
```

Ensure the overall `validateExit` path (existing) returns non-zero when any such diagnostic exists. Verify by reading the surrounding render/exit logic; extend, don't rewrite.

- [ ] **Step 4: Run CLI test**

Run: `npx vitest run src/cli/tests/commands/pipeline-validate.test.ts 2>&1 | tail -20`
Expected: PASS.

- [ ] **Step 5: Run full suite**

Run: `npm test 2>&1 | tail -40`
Expected: all PASS.

- [ ] **Step 6: Smoke the real fixture**

Run: `npm run build && node dist/cli/index.js pipeline validate pipelines/illumination-to-implementation.dot 2>&1 | tail -20`
Expected: exit 0, "Pipeline valid" — because after Chunk 2 migration the only remaining agent-body `$var` references (e.g. `$project`, `$run_id` in prose, `$goal` etc.) are all legit and produced/declared.

- [ ] **Step 7: Commit**

```bash
git add src/cli/commands/pipeline.ts src/cli/tests/commands/pipeline-validate.test.ts
git commit -m "feat(validate): surface unresolved_var_in_agent_prompt with file:line"
```

---

## Chunk 4: Demonstrate the validator catches a deliberate typo in the real pipeline

**Why this chunk exists:** the user explicitly wants to see `ralph pipeline validate pipelines/illumination-to-implementation.dot` **fail** post-implementation — i.e. observe the new `unresolved_var_in_agent_prompt` diagnostic fire against the actual production pipeline, not just against a test fixture. By design, after Chunks 1-3 land, the real pipeline validates cleanly (the `$HOME` runtime bug was fixed by fence-skipping; the `$run_id` inside the fence was removed by the migration). To surface the diagnostic, this chunk temporarily introduces a typo outside the fence, watches validation fail, then reverts.

**Not redundant with Chunk 3 Task 3.2's CLI test:** that automated test uses a synthetic `.dot` + fake `.md`; this chunk proves the diagnostic works against the real production artifact (`pipelines/illumination-to-implementation.dot` + `src/cli/agents/tmux-tester.md`). The synthetic test guards against regression; this demo is the user's eyes-on evidence.

**Files (temporary edits only — reverted at end):**
- Temporarily modify: `src/cli/agents/tmux-tester.md` (insert one unfenced `$meditations_dir_xyz` reference in prose)

### Task 4.1: Deliberate typo injection + demo + revert

- [ ] **Step 1: Insert a deliberate unfenced typo in `tmux-tester.md`**

Edit `src/cli/agents/tmux-tester.md` — immediately after the existing line `- Project folder: $project` (around line 26), insert a new prose line:

```
- Meditations folder (intentional-demo-typo): $meditations_dir_xyz
```

This ref is outside any fence, so the new validator scanner will pick it up. It is not in the graph's `inputs=` and not produced by any node.

- [ ] **Step 2: Run validate on the real pipeline**

Run: `node dist/cli/index.js pipeline validate pipelines/illumination-to-implementation.dot 2>&1 | tail -15`

Expected output (exact wording may vary, but these tokens must appear):
```
✗ Pipeline invalid
  - unresolved_var_in_agent_prompt: $meditations_dir_xyz
    src/cli/agents/tmux-tester.md:<line>
    (referenced in agent="tmux-tester" used by node tmux_tester)
```
Exit code: non-zero.

Capture the stderr/stdout snippet — this is the evidence the user asked for. Paste it into the memory note written in Step 7 (no commit occurs in this chunk, so the commit-message option does not apply).

- [ ] **Step 3: Revert the demo typo with `git checkout`**

Run: `git checkout src/cli/agents/tmux-tester.md`
Then assert the revert is byte-exact: `git diff --exit-code src/cli/agents/tmux-tester.md` — exit code 0 means clean. If non-zero, STOP and investigate; do not proceed.

Rationale: manual undo + inspection is fragile (editor whitespace, partial undos). `git checkout` restores to the post-Chunk-2 HEAD deterministically.

- [ ] **Step 4: Re-run validate to confirm it now passes**

Run: `node dist/cli/index.js pipeline validate pipelines/illumination-to-implementation.dot 2>&1 | tail -5`
Expected: `✔ Pipeline valid (22 nodes, 30 edges)`, exit 0.

- [ ] **Step 5: Validate every pipeline in-tree**

Run: `for f in pipelines/*.dot pipelines/smoke/*.dot; do echo "== $f =="; node dist/cli/index.js pipeline validate "$f" 2>&1 | tail -5; done`
Expected: every file prints `✔ Pipeline valid`.

- [ ] **Step 6: Re-run the original `$HOME` failure reproducer (OPTIONAL — user-driven; automated implementers SKIP)**

User runs (in a tmux context): `ralph pipeline run pipelines/illumination-to-implementation.dot --project . --var meditations_dir=meditations --var specs_dir=specs --var plans_dir=docs/superpowers/plans` through the `tmux_tester` node.
Expected: no `Undefined variable $HOME`. The `tmux_tester` agent either succeeds or fails for unrelated reasons (test failures it reports) — but NOT on variable expansion.

- [ ] **Step 7: Write the memory note and update the index**

Write `/Users/josu/.claude/projects/-Users-josu-Documents-projects-ralph-cli/memory/2026-04-19-fenced-var-skip-shipped.md` with:
- one-paragraph summary of what was added (fence-skip in `expandVariables`, agent-body scan in `scanUndeclaredCallerVars`, `unresolved_var_in_agent_prompt` diagnostic, tmux-tester migration)
- the Step 2 captured output (demo invariant: validator catches unfenced typos)
- the Step 4/5 clean-validate output (assurance: real pipelines validate post-fix)

Append one line to `/Users/josu/.claude/projects/-Users-josu-Documents-projects-ralph-cli/memory/MEMORY.md`:
```
| 2026-04-19 | Fenced Code-Block Variable-Skip (runtime + validator) | [→ File](2026-04-19-fenced-var-skip-shipped.md) |
```

- [ ] **Step 8: No code commit in this chunk**

Chunk 4 leaves the tree in the same state as end-of-Chunk-3. The demo-typo edit from Step 1 is reverted in Step 3 via `git checkout`. `git status` inside the ralph-cli repo must be **fully clean** — the memory files written in Step 7 live outside this repo (under `~/.claude/projects/.../memory/`) and do not show up in `git status`.

```bash
git status
```
