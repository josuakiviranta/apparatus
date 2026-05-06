# Meditate pipeline: self-sufficient under `pipeline run` — Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the bundled `meditate` pipeline runnable end-to-end through `apparat pipeline run meditate --project <folder>` (today it crashes preflight) by mirroring janitor's `read_vision` tool-node pattern, then collapse the wrapper command and bespoke `heartbeat meditate` subcommand that exist only because the pipeline cannot run unattended.

**Architecture:** Three structural moves. (1) The pipeline acquires `vision` itself: a new `read_vision` tool node executes a sibling `read-vision.mjs` (byte-for-byte copy of `src/cli/pipelines/janitor/read-vision.mjs`) under `cwd="$project"`, and the agent rubric switches its `<vision>` placeholder to the qualified input `read_vision.vision` with `default_vision=""` on the agent node. (2) The `meditateCommand` reduces to a thin `pipelineRunCommand` shim — `readVisionIfPresent` is deleted; PID-locking and `appendMeditateGitignore` survive. (3) The bespoke `apparat heartbeat meditate <folder>` block in `heartbeat.ts` is deleted; users move to `apparat heartbeat pipeline meditate --project <folder>`. A new `.apparat/scenarios/bundled-pipelines-self-sufficient/` smoke test contracts the class-of-bug.

**Tech Stack:** TypeScript, Node.js, Vitest, Commander, the apparatus pipeline engine (DOT graphs + `attractor` core), Ink (irrelevant here — no UI changes).

**Source-of-truth design doc:** `docs/superpowers/specs/2026-05-06-meditate-pipeline-not-pipeline-run-callable-design.md`

**Repo invariants enforced by this plan (verify after each chunk):**
- `npx tsc --noEmit` passes.
- `npx vitest run` passes.
- Repo grep `readVisionIfPresent` returns zero hits in `src/`.
- Repo grep `hb.command("meditate <folder>")` returns zero hits in `src/`.
- `src/cli/pipelines/meditate/pipeline.dot` contains `read_vision`.
- `src/cli/pipelines/meditate/meditate.md` contains `read_vision.vision`.
- `src/cli/pipelines/meditate/pipeline.dot` contains `default_vision=""`.

**Open question carried from design § 9:** keep the `apparat meditate <folder>` shorthand or remove it now? Default per design: keep. The shorthand stays; this plan does not touch `program.ts` beyond the indirect effect of `meditateCommand`'s shrink. If the executing session decides to remove the shorthand, that is a follow-up plan, not part of this one.

---

## Chunk 1: Pipeline self-sufficiency (sibling script + .dot + agent rubric)

This chunk makes `apparat pipeline run meditate --project <folder>` succeed end-to-end without any wrapper variable-stuffing. Wrapper code in `meditate.ts` and `heartbeat.ts` is untouched here — still calls `readVisionIfPresent`, still passes `vision: <contents>`. That double-supply is a deliberate transient: with the new `read_vision` tool node also producing `vision`, the engine sees the caller-supplied value first (caller wins per `inputs-resolver.ts` precedence), then chunk 2 removes the caller-side stuffing.

**Files:**
- Create: `src/cli/pipelines/meditate/read-vision.mjs`
- Modify: `src/cli/pipelines/meditate/pipeline.dot`
- Modify: `src/cli/pipelines/meditate/meditate.md`
- Modify: `src/cli/tests/pipeline-smoke-meditate-steer-folder.test.ts`
- Test (new): `src/cli/tests/pipelines-meditate-graph.test.ts`

### Task 1.1: Add the sibling `read-vision.mjs`

**Files:**
- Create: `src/cli/pipelines/meditate/read-vision.mjs`

- [x] **Step 1: Write the failing test asserting the file exists and matches janitor's contract**

Create new test file `src/cli/tests/pipelines-meditate-graph.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { existsSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { parseDot } from "../../attractor/core/graph.js";
import { validateGraph } from "../../attractor/core/graph-validator.js";

const REPO_ROOT = resolve(__dirname, "../../..");
const MEDITATE_DIR = join(REPO_ROOT, "src", "cli", "pipelines", "meditate");
const JANITOR_DIR = join(REPO_ROOT, "src", "cli", "pipelines", "janitor");

describe("meditate pipeline — sibling read-vision.mjs", () => {
  it("exists at src/cli/pipelines/meditate/read-vision.mjs", () => {
    expect(existsSync(join(MEDITATE_DIR, "read-vision.mjs"))).toBe(true);
  });

  it("is byte-identical to janitor's read-vision.mjs (file-copy reuse per ADR-0001)", () => {
    const meditateScript = readFileSync(join(MEDITATE_DIR, "read-vision.mjs"), "utf-8");
    const janitorScript = readFileSync(join(JANITOR_DIR, "read-vision.mjs"), "utf-8");
    expect(meditateScript).toBe(janitorScript);
  });
});

describe("meditate pipeline — pipeline.dot graph shape", () => {
  it("declares only `steer` as caller-supplied input", () => {
    const dotPath = join(MEDITATE_DIR, "pipeline.dot");
    const graph = parseDot(readFileSync(dotPath, "utf-8"));
    expect(graph.inputs).toEqual(["steer"]);
  });

  it("contains a read_vision tool node with cwd=$project + script_file=read-vision.mjs + produces_from_stdout", () => {
    const dotPath = join(MEDITATE_DIR, "pipeline.dot");
    const graph = parseDot(readFileSync(dotPath, "utf-8"));
    // Graph.nodes is a Map<string, Node>; attributes are flat keys on Node (not nested under .attributes)
    const rv = graph.nodes.get("read_vision");
    expect(rv).toBeDefined();
    expect(rv!.type).toBe("tool");
    expect((rv as Record<string, unknown>).cwd).toBe("$project");
    expect((rv as Record<string, unknown>).script_file).toBe("read-vision.mjs");
    // produces_from_stdout: parser may return string "true" or boolean true depending on quoting
    expect(String((rv as Record<string, unknown>).produces_from_stdout)).toBe("true");
  });

  it("has default_vision=\"\" on the meditate agent node so a missing VISION.md still resolves", () => {
    const dotPath = join(MEDITATE_DIR, "pipeline.dot");
    const graph = parseDot(readFileSync(dotPath, "utf-8"));
    const meditate = graph.nodes.get("meditate");
    expect(meditate).toBeDefined();
    expect((meditate as Record<string, unknown>).default_vision).toBe("");
  });

  it("wires start -> read_vision -> meditate -> end", () => {
    const dotPath = join(MEDITATE_DIR, "pipeline.dot");
    const graph = parseDot(readFileSync(dotPath, "utf-8"));
    const edgeKeys = graph.edges.map((e) => `${e.from}->${e.to}`);
    expect(edgeKeys).toContain("start->read_vision");
    expect(edgeKeys).toContain("read_vision->meditate");
    expect(edgeKeys).toContain("meditate->end");
  });

  it("validateGraph emits zero error-level diagnostics", () => {
    const dotPath = join(MEDITATE_DIR, "pipeline.dot");
    const graph = parseDot(readFileSync(dotPath, "utf-8"));
    const diags = validateGraph(graph, dirname(dotPath));
    const errors = diags.filter((d) => d.severity === "error");
    expect(errors).toEqual([]);
  });
});

describe("meditate pipeline — meditate.md rubric", () => {
  it("frontmatter inputs: declares [steer, read_vision.vision]", () => {
    const md = readFileSync(join(MEDITATE_DIR, "meditate.md"), "utf-8");
    const fm = md.match(/^---\n([\s\S]+?)\n---\n/);
    expect(fm).not.toBeNull();
    const inputsMatch = fm![1].match(/inputs:\n((?:\s+-\s+.+\n?)+)/);
    expect(inputsMatch).not.toBeNull();
    const inputs = inputsMatch![1]
      .split("\n")
      .map((l) => l.replace(/^\s+-\s+/, "").trim())
      .filter(Boolean);
    expect(inputs).toEqual(["steer", "read_vision.vision"]);
  });

  it("body uses <read_vision_vision> placeholder, not the bare <vision> tag", () => {
    const md = readFileSync(join(MEDITATE_DIR, "meditate.md"), "utf-8");
    const fm = md.match(/^---\n[\s\S]+?\n---\n/);
    const body = md.slice(fm![0].length);
    expect(body).toContain("<read_vision_vision>");
    expect(body).not.toMatch(/<vision>/);
  });
});
```

- [x] **Step 2: Run the new test file — expected: every case fails**

Run:

```bash
npx vitest run src/cli/tests/pipelines-meditate-graph.test.ts
```

Expected: red. The `read-vision.mjs` existence assertion fails (file missing); the graph-shape assertions fail (`graph.inputs` is `["steer", "vision"]`, no `read_vision` node, no `default_vision`); the rubric assertions fail (frontmatter still lists `vision`, body still has `<vision>`).

- [x] **Step 3: Create the sibling script as a byte-for-byte copy of janitor's**

Create `src/cli/pipelines/meditate/read-vision.mjs` with this exact content (matches `src/cli/pipelines/janitor/read-vision.mjs`):

```js
import fs from "node:fs";

let vision = "";
try {
  vision = fs.readFileSync("VISION.md", "utf8");
} catch {
  // VISION.md absent — empty string is the contract.
}
console.log(JSON.stringify({ vision }));
```

- [x] **Step 4: Re-run only the byte-equality test — expected: pass**

Run:

```bash
npx vitest run src/cli/tests/pipelines-meditate-graph.test.ts -t "byte-identical"
```

Expected: pass. The other test cases in that file still fail; they are addressed in Tasks 1.2 and 1.3 of this chunk.

### Task 1.2: Rewire `pipeline.dot`

**Files:**
- Modify: `src/cli/pipelines/meditate/pipeline.dot`

- [x] **Step 1: Replace the entire file content** with the after-state from design § 4.1

Overwrite `src/cli/pipelines/meditate/pipeline.dot` with:

```
digraph meditate {
  inputs="steer"

  start [shape=Mdiamond];
  end   [shape=Msquare];

  read_vision [type="tool",
               cwd="$project",
               script_file="read-vision.mjs",
               produces_from_stdout=true]

  meditate [shape=box, agent="meditate", default_vision=""];

  start -> read_vision -> meditate -> end;
}
```

Notes for the editor: keep the trailing newline. The `inputs="steer"` attribute is the new caller-input declaration. `default_vision=""` on the `meditate` agent node is what `inputs-resolver.ts:42` matches as the fallback when `read_vision.vision` is absent (e.g. if someone disables the tool node — defensive, not strictly required, but mirrors janitor exactly).

- [x] **Step 2: Re-run the graph-shape assertions — expected: pass**

Run:

```bash
npx vitest run src/cli/tests/pipelines-meditate-graph.test.ts -t "pipeline.dot graph shape"
```

Expected: all five graph-shape cases pass. The rubric and read-vision.mjs cases unchanged.

### Task 1.3: Switch `meditate.md` to the qualified input

**Files:**
- Modify: `src/cli/pipelines/meditate/meditate.md`

- [x] **Step 1: Edit the frontmatter `inputs:` block (currently lines 6–8)**

Find:

```yaml
inputs:
  - vision
  - steer
```

Replace with:

```yaml
inputs:
  - steer
  - read_vision.vision
```

Order matches the design doc: `steer` first (caller input), `read_vision.vision` second (graph-internal, qualified). This mirrors how janitor declares `inputs:` order in `src/cli/pipelines/janitor/janitor.md`.

- [x] **Step 2: Edit the body placeholder**

Find this passage (around line 33–34, in the "Strategic compass" block):

```
- `<vision>` — the project's `VISION.md` (north star; may be empty if absent)
- `<steer>` — initial steering message from the caller (may be empty)
```

Replace `<vision>` with `<read_vision_vision>`. Result:

```
- `<read_vision_vision>` — the project's `VISION.md` (north star; may be empty if absent)
- `<steer>` — initial steering message from the caller (may be empty)
```

Then find the line referencing `<vision>` further down (the one starting with "Treat `<vision>` as the strategic filter…", around line 36):

```
Treat `<vision>` as the strategic filter for step 6: every illumination must move the project toward — or surface drift away from — that vision. If `<vision>` is empty, no project vision exists yet; flag this in your reflection.
```

Replace each occurrence of `<vision>` in this paragraph with `<read_vision_vision>`. Result:

```
Treat `<read_vision_vision>` as the strategic filter for step 6: every illumination must move the project toward — or surface drift away from — that vision. If `<read_vision_vision>` is empty, no project vision exists yet; flag this in your reflection.
```

- [x] **Step 3: Confirm no remaining bare `<vision>` placeholders survive in the body**

Run:

```bash
grep -n -F "<vision>" src/cli/pipelines/meditate/meditate.md || echo "OK: no bare <vision> tag"
```

Expected output: `OK: no bare <vision> tag`. If anything else prints, the editor missed a placeholder; fix and re-run.

- [x] **Step 4: Re-run the rubric tests — expected: pass**

Run:

```bash
npx vitest run src/cli/tests/pipelines-meditate-graph.test.ts -t "meditate.md rubric"
```

Expected: both rubric cases pass.

### Task 1.4: Adjust the existing meditate-steer scenario smoke test

**Files:**
- Modify: `src/cli/tests/pipeline-smoke-meditate-steer-folder.test.ts`

The existing test exercises `.apparat/scenarios/meditate-steer/pipeline.dot` (a project-local scenario, not the bundled `src/cli/pipelines/meditate/pipeline.dot`). It uses `validateGraph` only — it does not exercise the bundled pipeline. We add one assertion: `validateGraph` is also clean for the bundled meditate pipeline. The new bundled-pipelines-self-sufficient scenario in chunk 3 will be the broader contract; this is the targeted parity check.

- [x] **Step 1: Add a new `describe` block for the bundled pipeline**

Append to `src/cli/tests/pipeline-smoke-meditate-steer-folder.test.ts` (above the closing of file):

```ts
describe("src/cli/pipelines/meditate/ — bundled pipeline self-sufficiency", () => {
  it("declares only steer as caller-supplied input (vision is now graph-internal)", () => {
    const dotPath = join(REPO_ROOT, "src", "cli", "pipelines", "meditate", "pipeline.dot");
    const graph = parseDot(readFileSync(dotPath, "utf-8"));
    expect(graph.inputs).toEqual(["steer"]);
  });

  it("validateGraph emits zero error-level diagnostics", () => {
    const dotPath = join(REPO_ROOT, "src", "cli", "pipelines", "meditate", "pipeline.dot");
    const graph = parseDot(readFileSync(dotPath, "utf-8"));
    const diags = validateGraph(graph, dirname(dotPath));
    const errors = diags.filter((d) => d.severity === "error");
    expect(errors).toEqual([]);
  });
});
```

- [x] **Step 2: Run the smoke test — expected: pass**

Run:

```bash
npx vitest run src/cli/tests/pipeline-smoke-meditate-steer-folder.test.ts
```

Expected: pass. Both the original meditate-steer scenario assertions and the new bundled-pipeline assertions hold.

### Task 1.5: Full chunk verification + commit

- [x] **Step 1: Run the entire vitest suite — expected: pass**

Run:

```bash
npx vitest run
```

Expected: full suite green. The wrapper still calls `readVisionIfPresent` and stuffs `vision` (untouched in this chunk), so existing meditate.test.ts cases that assert `variables.vision === <contents>` still pass — caller-supplied `vision` wins over graph-internal `read_vision.vision` per `inputs-resolver.ts` precedence. If a vitest run fails on a test that uses `<vision>` literally, fix the test by switching its expectation to `<read_vision_vision>`; the body of the rubric is the source of truth.

- [x] **Step 2: Run typecheck — expected: clean**

Run:

```bash
npx tsc --noEmit
```

Expected: zero errors.

- [x] **Step 3: Commit**

```bash
git add src/cli/pipelines/meditate/read-vision.mjs \
        src/cli/pipelines/meditate/pipeline.dot \
        src/cli/pipelines/meditate/meditate.md \
        src/cli/tests/pipelines-meditate-graph.test.ts \
        src/cli/tests/pipeline-smoke-meditate-steer-folder.test.ts
git commit -m "$(cat <<'EOF'
feat(meditate-pipeline): self-sufficient vision via read_vision tool node

Adds src/cli/pipelines/meditate/read-vision.mjs (byte-for-byte copy of
janitor's), wires a read_vision tool node into pipeline.dot, drops vision
from the caller-supplied inputs= list, and switches the agent rubric to
the qualified input read_vision.vision with default_vision="".

The wrapper command (meditate.ts) still stuffs vision via --var; that
caller-side path is removed in the next commit. With both supplying
vision, caller wins per inputs-resolver precedence — full vitest suite
remains green through the transient.

Closes design step 1-4 from
docs/superpowers/specs/2026-05-06-meditate-pipeline-not-pipeline-run-callable-design.md
EOF
)"
```

## Verification targets

- Smokes: `src/cli/tests/pipeline-smoke-meditate-steer-folder.test.ts`, `src/cli/tests/pipelines-meditate-graph.test.ts`
- Manual exercises: in a temp project with a `VISION.md`, run `apparat pipeline run meditate --project <tmp>` — expected: pipeline runs end-to-end, illumination written under `<tmp>/.apparat/meditations/illuminations/`. Repeat with `VISION.md` removed — expected: same pipeline shape, `<read_vision_vision>` renders empty.
- Lint: `npx vitest run src/cli/tests/pipelines-meditate-graph.test.ts src/cli/tests/pipeline-smoke-meditate-steer-folder.test.ts` and `npx tsc --noEmit`.
- Surfaces touched: pipeline definition, agent rubric, pipeline tests. (No `pipelines/surfaces.json` exists in this repo; pipeline-definition + agent-rubric are the canonical labels.)

---

## Chunk 2: Wrapper command shrink + heartbeat-meditate removal

The pipeline now self-acquires `vision`. Remove the wrapper's variable-stuffing (`readVisionIfPresent` + `vision: …` in `meditateCommand`) and the bespoke `apparat heartbeat meditate <folder>` subcommand that exists only because `pipeline run meditate` could not run unattended.

**Files:**
- Modify: `src/cli/commands/meditate.ts`
- Modify: `src/cli/commands/heartbeat.ts`
- Modify: `src/cli/tests/meditate.test.ts`
- Modify: `src/cli/tests/heartbeat.test.ts`

### Task 2.1: Delete `readVisionIfPresent` and shrink `meditateCommand`

**Files:**
- Modify: `src/cli/commands/meditate.ts`

- [x] **Step 1: Update meditate.test.ts — flip the vision assertions to the new contract**

The current `meditate.test.ts:258-278` asserts the wrapper passes `variables.vision`. Replace those two cases with their inverse (the wrapper no longer touches `vision`):

In `src/cli/tests/meditate.test.ts`, find:

```ts
  it("reads <project>/VISION.md and passes it as the vision variable", async () => {
    const visionContent = "# Project Vision\n\nNorth-star content for the meditate agent.";
    writeFileSync(join(tmpDir, "VISION.md"), visionContent);
    const calls: Array<{ dotFile: string; opts: any }> = [];
    vi.spyOn(pipelineMod, "pipelineRunCommand").mockImplementation(async (dotFile, opts) => {
      calls.push({ dotFile, opts });
    });
    await meditateCommand(tmpDir);
    expect(calls).toHaveLength(1);
    expect(calls[0].opts.variables.vision).toBe(visionContent);
  });

  it("passes empty vision string when VISION.md is absent", async () => {
    const calls: Array<{ dotFile: string; opts: any }> = [];
    vi.spyOn(pipelineMod, "pipelineRunCommand").mockImplementation(async (dotFile, opts) => {
      calls.push({ dotFile, opts });
    });
    await meditateCommand(tmpDir);
    expect(calls).toHaveLength(1);
    expect(calls[0].opts.variables.vision).toBe("");
  });
```

Replace with:

```ts
  it("does NOT pass `vision` as a caller variable — the pipeline's read_vision tool node owns it", async () => {
    const visionContent = "# Project Vision\n\nNorth-star content for the meditate agent.";
    writeFileSync(join(tmpDir, "VISION.md"), visionContent);
    const calls: Array<{ dotFile: string; opts: any }> = [];
    vi.spyOn(pipelineMod, "pipelineRunCommand").mockImplementation(async (dotFile, opts) => {
      calls.push({ dotFile, opts });
    });
    await meditateCommand(tmpDir);
    expect(calls).toHaveLength(1);
    expect(calls[0].opts.variables).not.toHaveProperty("vision");
  });

  it("passes only `steer` (the single declared caller input) when --var is empty", async () => {
    const calls: Array<{ dotFile: string; opts: any }> = [];
    vi.spyOn(pipelineMod, "pipelineRunCommand").mockImplementation(async (dotFile, opts) => {
      calls.push({ dotFile, opts });
    });
    await meditateCommand(tmpDir);
    expect(calls).toHaveLength(1);
    expect(Object.keys(calls[0].opts.variables)).toEqual(["steer"]);
    expect(calls[0].opts.variables.steer).toBe("");
  });
```

- [x] **Step 2: Run the meditate.test.ts file — expected: the two replaced cases fail**

Run:

```bash
npx vitest run src/cli/tests/meditate.test.ts -t "does NOT pass"
npx vitest run src/cli/tests/meditate.test.ts -t "passes only"
```

Expected: red. `meditateCommand` still passes `vision: readVisionIfPresent(absPath)`, so `variables.vision` is still set and the new cases fail.

- [x] **Step 3: Delete `readVisionIfPresent` and the `vision` line in `meditateCommand`**

In `src/cli/commands/meditate.ts`:

Find and delete the entire block (lines 39–42):

```ts
export function readVisionIfPresent(projectFolder: string): string {
  const p = join(projectFolder, "VISION.md");
  return existsSync(p) ? readFileSync(p, "utf8") : "";
}
```

Then in `meditateCommand`, find:

```ts
    return await self.pipelineRunCommand("meditate", {
      project: absPath,
      variables: {
        steer: opts.variables?.steer ?? "",
        vision: readVisionIfPresent(absPath),
      },
    });
```

Replace with:

```ts
    return await self.pipelineRunCommand("meditate", {
      project: absPath,
      variables: { steer: opts.variables?.steer ?? "" },
    });
```

The `import { readFileSync, ... }` line at the top is still needed for the PID-lock helpers (`readPid` reads the PID file). Leave imports alone — `tsc` would catch a stray unused import; verify in step 6.

- [x] **Step 4: Re-run the meditate.test.ts file — expected: pass**

Run:

```bash
npx vitest run src/cli/tests/meditate.test.ts
```

Expected: all cases pass, including the two replacements.

- [x] **Step 5: Repo-wide grep — `readVisionIfPresent` should have zero hits in `src/`**

Run:

```bash
grep -rn "readVisionIfPresent" src/ || echo "OK: zero hits in src/"
```

Expected output: `OK: zero hits in src/`. Hits in `MEMORY.md`, `docs/`, frozen prose are acceptable (design § 6 marks those as untouched historical record).

- [x] **Step 6: Typecheck**

Run:

```bash
npx tsc --noEmit
```

Expected: zero errors. If `readFileSync` becomes unused, TypeScript flags it — remove it from the import line and re-run.

### Task 2.2: Delete the `hb.command("meditate <folder>")` block

**Files:**
- Modify: `src/cli/commands/heartbeat.ts`
- Modify: `src/cli/tests/heartbeat.test.ts`

- [x] **Step 1: Update heartbeat.test.ts — flip cases to assert the subcommand is gone**

The `heartbeat.test.ts:62-131` block currently asserts `apparat heartbeat meditate FIXTURE_DIR --every 5` registers a task. After removal, Commander rejects the unknown subcommand. Replace the entire `describe("apparat heartbeat meditate", () => { ... })` block (lines 62–131) AND the `describe("apparat heartbeat meditate --var", () => { ... })` block (lines 133–159) with a single `describe` asserting the subcommand is gone:

In `src/cli/tests/heartbeat.test.ts`, find and delete:

```ts
describe("apparat heartbeat meditate", () => {
  // ... lines 63-130 ...
});

describe("apparat heartbeat meditate --var", () => {
  // ... lines 134-158 ...
});
```

Insert in their place:

```ts
describe("apparat heartbeat meditate (removed subcommand)", () => {
  it("Commander rejects `heartbeat meditate <folder>` — replacement is `heartbeat pipeline meditate`", async () => {
    const errSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    const writeSpy = vi.spyOn(process.stderr, "write").mockImplementation(() => true);
    await expect(
      makeProgram().parseAsync([
        "node", "apparat", "heartbeat", "meditate", FIXTURE_DIR, "--every", "5",
      ])
    ).rejects.toThrow();
    expect(request).not.toHaveBeenCalled();
    errSpy.mockRestore();
    writeSpy.mockRestore();
  });
});
```

The expectation is a Commander-thrown error (the subcommand does not exist). `program.exitOverride()` in `makeProgram` converts Commander's exit into a thrown error, which `toThrow()` catches without asserting on the exact message — Commander's error text changes between versions and is not a stable contract.

- [x] **Step 2: Run the heartbeat.test.ts file — expected: the new case fails because the subcommand still exists**

Run:

```bash
npx vitest run src/cli/tests/heartbeat.test.ts -t "removed subcommand"
```

Expected: red. The subcommand is still wired in `heartbeat.ts:102-132`; Commander accepts it; `request` is called; `expect(request).not.toHaveBeenCalled()` fails.

- [x] **Step 3: Delete the `hb.command("meditate <folder>")` block in heartbeat.ts**

In `src/cli/commands/heartbeat.ts`, find and delete the entire block (lines 102–132):

```ts
  hb
    .command("meditate <folder>")
    .description("Schedule meditate to run on a project folder at a fixed interval")
    .addHelpText("after", "\nExamples:\n  apparat heartbeat meditate my-app --every 30\n")
    .requiredOption("--every <n>", "interval in minutes", (v) => {
      const n = parseInt(v, 10);
      if (isNaN(n) || n < 1) throw new Error("--every must be a positive integer");
      return n;
    })
    .option("--var <key=value>", "pass caller variable (repeatable, e.g. --var steer=...)", collectKV, {} as Record<string, string>)
    .action(async (folder: string, opts: Record<string, unknown>) => {
      const every = opts.every as number;
      const variables = (opts["var"] as Record<string, string> | undefined) ?? {};
      const absPath = resolve(folder);
      validatePathArg(folder, absPath, "directory", "Project folder");
      try {
        const taskArgs: string[] = [absPath];
        for (const [k, v] of Object.entries(variables)) {
          taskArgs.push("--var", `${k}=${v}`);
        }
        const res = await request("register_task", {
          command: "meditate",
          args: taskArgs,
          interval: every,
        });
        await output.success(`Registered: ${res.taskId} (every ${every} min)`);
      } catch (err: any) {
        await output.error(`Error: ${err.message}`);
        process.exit(1);
      }
    });
```

Leave one blank line between the description block (`.addHelpText`) and the next `hb.command("implement <folder>")` block. After deletion, the file should flow `addHelpText("after", …)` → blank → `hb.command("implement <folder>")`.

- [x] **Step 4: If `collectKV` is now imported but unused, remove the import**

Run:

```bash
grep -n "collectKV" src/cli/commands/heartbeat.ts
```

Expected output now: only the import line at the top (no in-file usages remain). Open `src/cli/commands/heartbeat.ts` and delete the line:

```ts
import { collectKV } from "../lib/collect-kv.js";
```

- [x] **Step 5: Re-run heartbeat.test.ts — expected: pass**

Run:

```bash
npx vitest run src/cli/tests/heartbeat.test.ts
```

Expected: all cases pass, including the new "removed subcommand" assertion.

- [x] **Step 6: Typecheck**

Run:

```bash
npx tsc --noEmit
```

Expected: zero errors. If `collectKV` was the only thing importing from `../lib/collect-kv.js`, that import deletion is what makes typecheck happy. If TypeScript complains about an unused `Record<string, string>` import, recheck the deletion.

- [x] **Step 7: Repo grep — `hb.command("meditate <folder>")` should have zero hits in `src/`**

Run:

```bash
grep -rn 'command("meditate <folder>")' src/ || echo "OK: zero hits in src/"
```

Expected output: `OK: zero hits in src/`.

### Task 2.3: Full chunk verification + commit

- [x] **Step 1: Run the entire vitest suite — expected: pass**

Run:

```bash
npx vitest run
```

Expected: full suite green. If a test fails because it asserts `variables.vision` is the old value (other than the two we already updated), update the assertion to `not.toHaveProperty("vision")` — the wrapper no longer supplies it.

- [x] **Step 2: Repo grep invariants per design § 8**

Run:

```bash
grep -rn "readVisionIfPresent" src/ || echo "OK: readVisionIfPresent gone"
grep -rn 'command("meditate <folder>")' src/ || echo "OK: heartbeat-meditate subcommand gone"
grep -n "read_vision" src/cli/pipelines/meditate/pipeline.dot || echo "FAIL: read_vision missing from pipeline.dot"
grep -n "read_vision.vision" src/cli/pipelines/meditate/meditate.md || echo "FAIL: read_vision.vision missing from rubric"
grep -n 'default_vision=""' src/cli/pipelines/meditate/pipeline.dot || echo "FAIL: default_vision missing from pipeline.dot"
```

Expected: first two print `OK:`, last three print a hit (no `FAIL:`).

- [x] **Step 3: Commit**

```bash
git add src/cli/commands/meditate.ts \
        src/cli/commands/heartbeat.ts \
        src/cli/tests/meditate.test.ts \
        src/cli/tests/heartbeat.test.ts
git commit -m "$(cat <<'EOF'
refactor(meditate): drop wrapper variable-stuffing + bespoke heartbeat subcommand

The meditate pipeline now self-acquires vision via the read_vision tool
node landed in the previous commit, so the wrapper command no longer
needs to read VISION.md. meditateCommand becomes a thin pipelineRunCommand
shim (PID-lock + gitignore-append behaviour preserved).

The bespoke `apparat heartbeat meditate <folder>` subcommand existed only
because pipeline-run could not run meditate unattended. With the pipeline
self-sufficient, the generic `apparat heartbeat pipeline meditate` path
covers it. Removing the subcommand advances the
command-surface-collapse-to-pipeline-alias direction.

Breaking changes (per design § 6, no compat shim — single-cohort repo):
- `apparat heartbeat meditate <folder> --every N` removed
  → use `apparat heartbeat pipeline meditate --project <folder> --every N`
- `--var vision=...` on the heartbeat-meditate path removed
  → place VISION.md at <project>/ root; the pipeline reads it directly
- `readVisionIfPresent` export from src/cli/commands/meditate.ts removed
  (internal-only; no external consumer)

Closes design steps 5-6 from
docs/superpowers/specs/2026-05-06-meditate-pipeline-not-pipeline-run-callable-design.md
EOF
)"
```

## Verification targets

- Smokes: `src/cli/tests/meditate.test.ts`, `src/cli/tests/heartbeat.test.ts`, `src/cli/tests/pipelines-meditate-graph.test.ts`
- Manual exercises: `apparat meditate <tmp>` produces an illumination identical in shape to `apparat pipeline run meditate --project <tmp>`. `apparat heartbeat meditate <tmp> --every 5` exits with a Commander unknown-command error. `apparat heartbeat pipeline meditate --project <tmp> --every 5` registers a task.
- Lint: `npx vitest run src/cli/tests/meditate.test.ts src/cli/tests/heartbeat.test.ts` and `npx tsc --noEmit`.
- Surfaces touched: CLI command (`meditate.ts`), heartbeat subcommand (`heartbeat.ts`).

---

## Chunk 3: bundled-pipelines-self-sufficient scenario + doc updates

This chunk is the contract test that catches the *next* time a bundled pipeline secretly relies on a wrapper command's variable-stuffing. It iterates every bundled pipeline (`src/cli/pipelines/*/pipeline.dot`) and asserts the pipeline parses, validates, and would not preflight-fail when invoked through the engine with only its declared `inputs=` (each defaulted to empty string). Doc edits for `AGENTS.md`, `README.md`, and `CONTEXT.md` close the spec ripple from design § 6.

**Files:**
- Test (new): `src/cli/tests/bundled-pipelines-self-sufficient.test.ts`
- Modify: `AGENTS.md`
- Modify: `README.md`
- Modify: `CONTEXT.md`

Per design § 9 open-question 3, default the scenario format to **parameterized** (one test file iterating over each bundled pipeline) — fewer fixture trees to maintain.

### Task 3.1: New scenario — every bundled pipeline runnable through `pipeline run`

**Files:**
- Test (new): `src/cli/tests/bundled-pipelines-self-sufficient.test.ts`

- [x] **Step 1: Write the new test file**

Create `src/cli/tests/bundled-pipelines-self-sufficient.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { parseDot } from "../../attractor/core/graph.js";
import { validateGraph } from "../../attractor/core/graph-validator.js";
import { scanUndeclaredCallerVars } from "../../attractor/transforms/variable-expansion.js";

const REPO_ROOT = resolve(__dirname, "../../..");
const BUNDLED_PIPELINES_DIR = join(REPO_ROOT, "src", "cli", "pipelines");

function bundledPipelines(): { name: string; dotPath: string }[] {
  return readdirSync(BUNDLED_PIPELINES_DIR, { withFileTypes: true })
    .filter((d) => d.isDirectory())
    .map((d) => ({
      name: d.name,
      dotPath: join(BUNDLED_PIPELINES_DIR, d.name, "pipeline.dot"),
    }))
    .filter((p) => existsSync(p.dotPath));
}

describe("bundled pipelines — runnable through `apparat pipeline run` with only declared inputs", () => {
  const pipelines = bundledPipelines();

  it("discovered at least one bundled pipeline", () => {
    expect(pipelines.length).toBeGreaterThan(0);
  });

  for (const { name, dotPath } of pipelines) {
    describe(`pipeline: ${name}`, () => {
      it("validateGraph emits zero error-level diagnostics", () => {
        const graph = parseDot(readFileSync(dotPath, "utf-8"));
        const diags = validateGraph(graph, dirname(dotPath));
        const errors = diags.filter((d) => d.severity === "error");
        expect(errors).toEqual([]);
      });

      it("preflight surfaces zero undeclared references when caller supplies only declared inputs", () => {
        const graph = parseDot(readFileSync(dotPath, "utf-8"));
        // Construct the minimal caller supply: one empty string per declared input.
        const variables: Record<string, string> = {};
        for (const decl of graph.inputs ?? []) {
          variables[decl] = "";
        }
        const preflight = scanUndeclaredCallerVars(graph, variables);

        // Contract: every variable referenced in a node's string attributes must be
        // (a) in graph.inputs (caller-declared), (b) produced by an upstream node,
        // or (c) a qualified $node.key whose source node exists.
        // `preflight.undeclared` contains refs that satisfy NONE of those AND are
        // NOT in graph.inputs — the wrapper-stuffing bug this test guards against.
        // (preflight.declared is empty by construction here because we pre-supply every
        //  declared input, so ctxKeys filters them out before the partition.)
        const undeclaredNames = preflight.undeclared.map((r) => r.name);
        expect(
          undeclaredNames,
          `Pipeline "${name}" references variables not declared in inputs= and not produced by any node: ${undeclaredNames.join(", ")}. ` +
          `This is the wrapper-stuffing class of bug — the pipeline cannot run via \`apparat pipeline run\` with only its declared inputs.`,
        ).toEqual([]);
      });
    });
  }
});
```

This test gives every bundled pipeline two assertions: graph-validates clean, and the engine's preflight would not reject it when invoked with only its declared inputs as empty strings. The second is the precise check the meditate bug originally violated. Note the failure-message arg in `expect(...).toEqual([])` — it surfaces *which* variable names are unresolved, so a future regression points at the offending pipeline name, not just "test failed".

- [x] **Step 2: Run the new test — expected: pass**

Run:

```bash
npx vitest run src/cli/tests/bundled-pipelines-self-sufficient.test.ts
```

Expected: pass for every bundled pipeline (`implement`, `janitor`, `meditate`). If `implement` fails, the failure-message arg should name the offending variables — those would be wrapper-stuffed values (e.g. `scenarios_dir` if it has caller-side defaulting). Fix the *pipeline*, not the test, by mirroring the read_vision pattern (a tool node + sibling script + `default_*` attribute) — that is the contract this test enforces. Note: `scenarios_dir` *is* in `implement/pipeline.dot` `inputs=`, so it should pass; `record_base` produces `sha`. If a real failure surfaces a hole this design did not foresee, treat it as discovery and surface to the user before patching the test.

- [x] **Step 3: Confirm the test catches a regression**

Mental sanity check (do not commit this): if you temporarily restore `inputs="steer,vision"` in `src/cli/pipelines/meditate/pipeline.dot` (without restoring the wrapper), the meditate test case fails with a message naming `vision` as missing. Revert the test before continuing.

### Task 3.2: Doc updates — `AGENTS.md`, `README.md`, `CONTEXT.md`

**Files:**
- Modify: `AGENTS.md`
- Modify: `README.md`
- Modify: `CONTEXT.md`

The design doc § 6 doc-ripple checklist:

| File | Edit |
|---|---|
| `AGENTS.md:25` | Reference reads correctly under thinner `meditate.ts` shape (verify with grep). |
| `README.md` | `apparat meditate` shorthand description survives; add a one-line note that `apparat pipeline run meditate --project <folder>` is the canonical engine invocation. |
| `CONTEXT.md` | Glossary deprecation note: "`apparat heartbeat meditate` (removed 2026-05-06): use `apparat heartbeat pipeline meditate`." |

- [x] **Step 1: AGENTS.md — verify the line 25 reference holds and is honest**

Open `AGENTS.md` and read line 25 (`- Commands: src/cli/commands/{implement,meditate,pipeline}.ts`). The line still names `meditate.ts` — true after the shrink (the file remains; it is just thinner). No edit needed.

Run:

```bash
grep -n "readVisionIfPresent\|meditate <folder>" AGENTS.md || echo "OK: AGENTS.md has no stale references"
```

Expected: `OK: AGENTS.md has no stale references`. If a hit appears, edit the offending line to remove or update the reference.

- [x] **Step 2: README.md — add canonical-invocation note** — applied to working tree; deferred from chunk-3 commit because README has unrelated `apparat init` skill-shim WIP that should not be bundled here.

In `README.md`, find the existing meditate block (lines 51–54):

```
```bash
apparat meditate <project-folder> [--var steer=<text>]
```
Runs a meditate session against the project's meditations. `--var steer=...` injects an initial steering message at session start. Backed by the bundled folder pipeline `src/cli/pipelines/meditate/`.
```

Replace with:

```
```bash
apparat meditate <project-folder> [--var steer=<text>]
```
Runs a meditate session against the project's meditations. `--var steer=...` injects an initial steering message at session start. Backed by the bundled folder pipeline `src/cli/pipelines/meditate/`. Equivalent to `apparat pipeline run meditate --project <project-folder>` — the shorthand only adds a PID lock and `.gitignore` entries.
```

The added sentence makes the engine path canonical and discoverable; the shorthand is now explicitly an alias plus a small amount of plumbing.

- [x] **Step 3: README.md — update the heartbeat example if it still shows `heartbeat meditate`**

Run:

```bash
grep -n "heartbeat meditate" README.md
```

Expected: zero hits (the README's heartbeat example uses `heartbeat pipeline janitor`, not heartbeat meditate). If a hit appears, replace it with `apparat heartbeat pipeline meditate --project . --every 30`.

- [x] **Step 4: CONTEXT.md — add the glossary deprecation note**

In `CONTEXT.md`, locate the section that documents heartbeat or scheduled-task vocabulary (around line 75 — the `meditate: consume <filename> (<reason>)` line is in this region). Add a new bullet at the end of the surrounding glossary block:

```
`apparat heartbeat meditate` — **Removed 2026-05-06.** The bespoke heartbeat subcommand existed only because the bundled meditate pipeline could not run unattended. The pipeline now self-acquires `vision` via a `read_vision` tool node. Use `apparat heartbeat pipeline meditate --project <folder> --every <n>` instead.
```

If `CONTEXT.md` does not have a clearly delimited glossary block, append the bullet to the end of the section closest to "scheduled" or "heartbeat" vocabulary. Keep the Markdown syntax consistent with the surrounding bullets — most CONTEXT.md sections use `-` for list items.

Verify the edit landed:

```bash
grep -n "Removed 2026-05-06" CONTEXT.md
```

Expected: one hit naming the deprecation.

- [x] **Step 5: Run the full vitest suite + typecheck once more**

Run:

```bash
npx vitest run
npx tsc --noEmit
```

Expected: green + zero errors.

### Task 3.3: Final chunk verification + commit

- [x] **Step 1: Repo-wide invariants per design § 8 (post-merge)**

Run:

```bash
grep -rn "readVisionIfPresent" src/ || echo "OK: readVisionIfPresent gone from src"
grep -rn 'command("meditate <folder>")' src/ || echo "OK: heartbeat-meditate gone from src"
grep -n "read_vision" src/cli/pipelines/meditate/pipeline.dot
grep -n "read_vision.vision" src/cli/pipelines/meditate/meditate.md
grep -n 'default_vision=""' src/cli/pipelines/meditate/pipeline.dot
grep -n "Removed 2026-05-06" CONTEXT.md
```

Expected: `OK:` for the first two; non-empty hits for the remaining four.

- [x] **Step 2: Manual smoke (executor, run interactively)** — deferred to user; bundled-pipelines-self-sufficient.test.ts is the automated equivalent.

These four checks are the design's § 10.3 smoke list. Run in a temp scratch directory; the executor should treat any deviation as a discovery and surface it before continuing:

```bash
TMP=$(mktemp -d)
cd "$TMP"
git init -q
echo "# Test Vision\n\nFocus on simplicity." > VISION.md
mkdir -p .apparat/meditations/illuminations
apparat pipeline run meditate --project "$TMP"
ls .apparat/meditations/illuminations/
```

Expected: at least one `*.md` illumination file written. Repeat with `rm VISION.md` between runs — expected: same shape, the agent's `<read_vision_vision>` placeholder renders as the empty string, no crash.

```bash
apparat meditate "$TMP"
ls .apparat/meditations/illuminations/
```

Expected: a second illumination file appears; structure matches the engine-path output.

```bash
apparat heartbeat meditate "$TMP" --every 5 2>&1 | head -5
```

Expected: a Commander unknown-command error (text varies by Commander version; the assertion is non-zero exit + no daemon registration). The replacement command is the next check:

```bash
apparat heartbeat pipeline meditate --project "$TMP" --every 5
apparat heartbeat list
```

Expected: a `pipeline:meditate` task in the heartbeat list.

- [x] **Step 3: Commit**

```bash
git add src/cli/tests/bundled-pipelines-self-sufficient.test.ts \
        AGENTS.md README.md CONTEXT.md
git commit -m "$(cat <<'EOF'
test(bundled-pipelines): contract test for self-sufficiency under pipeline run

Adds a parameterized vitest that iterates every bundled pipeline under
src/cli/pipelines/*/pipeline.dot and asserts (a) validateGraph is clean
and (b) preflight succeeds when the caller supplies only the pipeline's
declared inputs= as empty strings. This is the contract test for the
class-of-bug the meditate fix exposed: a bundled pipeline must not
secretly require a wrapper command's variable-stuffing to run.

Adds the canonical-invocation hint to README.md (apparat pipeline run
meditate --project <folder> is now a discoverable equivalent to the
shorthand) and the CONTEXT.md glossary deprecation note for the removed
heartbeat-meditate subcommand.

Closes design steps 7-8 + § 6 doc ripple from
docs/superpowers/specs/2026-05-06-meditate-pipeline-not-pipeline-run-callable-design.md
EOF
)"
```

## Verification targets

- Smokes: `src/cli/tests/bundled-pipelines-self-sufficient.test.ts`, `src/cli/tests/pipelines-meditate-graph.test.ts`, `src/cli/tests/pipeline-smoke-meditate-steer-folder.test.ts`
- Manual exercises: `apparat pipeline run meditate --project <tmp>` (with VISION.md present and absent), `apparat meditate <tmp>`, `apparat heartbeat meditate <tmp> --every 5` (must fail), `apparat heartbeat pipeline meditate --project <tmp> --every 5` (must register).
- Lint: `npx vitest run` + `npx tsc --noEmit`.
- Surfaces touched: pipeline-tests, docs (`AGENTS.md`, `README.md`, `CONTEXT.md`).

---

## Notes for the executing session

- The transient between chunks 1 and 2 (caller supplies `vision` AND `read_vision` produces `vision`) is intentional. Do not ship chunks 1 and 2 in a single commit unless you also choose to skip the per-chunk green-test invariant — the plan's TDD shape relies on chunk 1 leaving the suite green before chunk 2 lands.
- If the new `bundled-pipelines-self-sufficient` test in chunk 3 fails on `implement` or any other bundled pipeline, treat it as a discovery and surface to the user before adapting either the test or the offending pipeline. The contract is what we want; failures point at real bugs the design did not anticipate.
- Per the project's MEMORY-as-historical-record convention (design § 6), do not edit `MEMORY.md` topic files that mention `readVisionIfPresent` or the heartbeat-meditate subcommand. Frozen prose is left in place.
- The `apparat meditate <folder>` shorthand decision (design § 9 open-question 1) is left "keep" by default. If the executing session has a strong reason to remove it, that is a separate plan; do not bundle the decision into this implementation.
