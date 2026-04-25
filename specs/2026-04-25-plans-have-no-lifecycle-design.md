# Plans Have No Lifecycle — Design

**Date:** 2026-04-25
**Status:** Approved
**Source illumination:** `meditations/illuminations/2026-04-14T0800-plans-have-no-lifecycle.md`

## Overview

The illumination state machine for `meditations/illuminations/` exposes `open → dispatched → implemented → archived`, queryable via `list_illuminations(status=...)` at `src/cli/mcp/illumination-server.ts:520-531`. The 48-file `docs/superpowers/plans/` directory has no equivalent: 47 of 48 files carry no `status` frontmatter at all (only `2026-04-17-pipeline-script-files.md:1-5` does), there is no `list_plans` MCP tool, and there is no `mark_plan_implemented` mutation parallel to `markDispatched` / `markArchived` (`illumination-server.ts:113-174`, `176-245`). At least one plan — `docs/superpowers/plans/2026-04-12-meditate-backpressure-guard.md:1` — has been sitting unbuilt with no in-tree signal that it remains pending; the asymmetry grows with every session that lands a new plan.

This spec closes the gap with the smallest mirror of the existing illumination machinery:

1. Backfill `status: pending` or `status: implemented` frontmatter on every existing plan — zero unstamped files, zero stale `open` files.
2. Add a `list_plans` MCP tool parallel to `list_illuminations`.
3. Add a `mark_plan_implemented` MCP tool parallel to `markDispatched`, auto-commit on call.
4. Update the `plan_writer` prompt at `pipelines/illumination-to-plan.dot:30` so future pipeline-produced plans ship with the frontmatter.

The lifecycle is deliberately binary (`pending` / `implemented`) — narrower than the illumination's four-state machine. The vocabulary aligns with the illumination side's terminal label `implemented`; no parallel `complete` term is introduced.

## What This Fixes

### Primary: orphan plans have no in-tree signal

`docs/superpowers/plans/2026-04-12-meditate-backpressure-guard.md` has a complete spec at `specs/` and a complete TDD plan, but `src/cli/commands/meditate.ts` has no backpressure guard. Nothing in the repository distinguishes this plan from the 30+ other plans in the same directory whose features have shipped. A developer (or an autonomous agent) resuming after any gap must read each file and cross-check it against the codebase to learn what remains. After this change, `list_plans(status="pending")` returns exactly that subset.

### Secondary: pipeline-produced plans are indistinguishable from manual ones

The `plan_writer` node at `pipelines/illumination-to-plan.dot:30` produces plans that, today, have no creation metadata — no `status`, no `illumination_source`. When the pipeline runs end-to-end, its output is shape-identical to the existing 47 hand-authored plans. Adding one sentence to the prompt makes every pipeline-produced plan queryable from day one and traceable back to its originating illumination by filename.

### Tertiary: pending → implemented transition is not autonomous

The illumination side already has `markDispatched` (`illumination-server.ts:113-174`) and `markArchived` (line 176-245), both of which auto-commit the frontmatter mutation in a `try/catch` (lines 158-166, 227-236). Recent commits 5875b69 (`feat(mcp): auto-commit on markDispatched`) and 8af5f69 (`fix(mcp): list_illuminations(status=archived) reads archive/ subdir`) confirm this is the established pattern. A symmetric `mark_plan_implemented` lets the implementing agent flip `pending → implemented` itself — no human hand-edit, no separate verifier gate, no coordination point that re-introduces the orphan failure mode.

## What This Does NOT Do

- **No new state.** The plan lifecycle stays binary: `pending` and `implemented`. No `dispatched`, no `archived`, no `re-opened`. The illumination's four-state machine is not mirrored. Round 1 of the chat surfaced the option ("does this illumination now discuss all the stages for plans or just for pending stages?"); round 2 closed it ("we could use marks (pending / implemented) for plans"). Adding more states is out of scope here; if a real need surfaces later, that is its own illumination.
- **No `complete` label.** The terminal label is `implemented` to match the illumination state machine's `implemented` terminal value (`illumination-server.ts:78,88,109`). Two parallel terminal vocabularies are not introduced.
- **No verifier gate before `pending → implemented`.** The flip is an MCP tool call from the implementing agent. A verifier-gated flow would re-create the manual checkpoint the autonomy property is designed to remove.
- **No retroactive plan mutation beyond backfill.** The one-time backfill stamps every existing file. After that, the only legitimate pending → implemented transition is the agent calling `mark_plan_implemented`. Hand edits are still possible (the file is just text) but not part of any pipeline contract.
- **No archive subdirectory for plans.** `markArchived` for illuminations writes to `meditations/illuminations/archive/` (`illumination-server.ts:218-225`). Plans have no archive flow because they have no archive state.
- **No `list_plans` "all statuses combined" mode beyond the default.** When `status` is omitted, `list_plans` returns every plan regardless of status, mirroring `listIlluminations`'s un-filtered behavior (`illumination-server.ts:312-336`). When `status` is supplied, results are filtered by frontmatter — same shape as the illumination tool.
- **No backpressure guard implementation.** The originating illumination listed implementing the backpressure guard from `2026-04-12-meditate-backpressure-guard.md` as step 1. That plan has its own design and its own implementation arc; it is referenced here only as the concrete example of an orphan plan. Backfilling its frontmatter to `status: pending` is in scope; building the feature is not.
- **No engine change.** `src/attractor/handlers/agent-handler.ts`, the validator, and gate-routing logic are untouched.
- **No git fail-loud.** Auto-commit blocks swallow errors silently, exactly mirroring `writeIllumination:33-42`. Same rationale: the frontmatter write is the load-bearing operation; the commit is best-effort durability.

## Architecture

### 1. Frontmatter shape on plans

Every plan file gains a frontmatter block before its first heading. Same delimiter style already used on `2026-04-17-pipeline-script-files.md:1-5`:

```
---
status: pending
illumination_source: 2026-04-14T0800-plans-have-no-lifecycle.md
---
# <existing plan title>
```

- `status`: one of `pending` or `implemented`. No other values are valid for plans.
- `illumination_source`: basename (no path) of the originating illumination file. Optional for backfilled plans where the link is unknown or was never an illumination (many existing plans predate the `illumination-to-plan.dot` pipeline). Required on plans produced by the pipeline going forward.

For plans whose features have shipped, the backfill emits `status: implemented` directly. No `implemented_at` timestamp is added (the git history records when the frontmatter was added; the actual ship date is recoverable from feature-landing commits — adding a stamp on backfill would be misleading because the value would be "today", not the historical ship date). Future `mark_plan_implemented` calls similarly do not add a timestamp; vocabulary parity with `markDispatched` (which writes `dispatched_at`, `illumination-server.ts:151`) is broken here deliberately, because backfilled `implemented` plans have no truthful timestamp and inventing one would lie. If a real need for `implemented_at` surfaces later, it can be added uniformly. (See open question.)

### 2. Backfill — `docs/superpowers/plans/*.md`

A one-time pass over all 48 files. For each file, decide `pending` or `implemented` by checking whether the feature exists in the codebase:

- **`implemented`** if the plan's described feature can be located in `src/`, `pipelines/`, or test suites. Examples (non-exhaustive — the plan that lands this design enumerates the full list):
  - `2026-04-12-illumination-state-machine.md` — `markImplemented` / `markDispatched` / `markArchived` exist at `illumination-server.ts:46-245`.
  - `2026-04-12-mark-implemented-lifecycle.md` — same.
  - `2026-04-12-top-level-directory-inventory.md` — `meditations/inventory.md` and related lens files exist.
  - `2026-04-16-implement-as-pipeline.md` — `pipelines/implement.dot` and `src/cli/commands/implement.ts` show the pipeline-shim shape.
  - `2026-04-16-pipeline-portability.md` — `pipelines/illumination-to-implementation.dot` and the validator portability checks have landed.
  - `2026-04-17-pipeline-script-files.md` — already frontmatter-stamped; backfill is a no-op for this file.
  - `2026-04-19-mark-archived-spec-drift.md` — fields and rubric exist (`pipelines/schemas/verifier.json`, `src/cli/agents/verifier.md`).
  - `2026-04-20-source-location-diagnostics.md` — `validate` command emits `file:line:col` (recent commits, project memory entry `2026-04-20-source-location-diagnostics-shipped.md`).
  - `2026-04-22-agent-rubric-prepend.md` — universal-rubric prepend shipped (project memory entry `2026-04-22-rubric-prepend-shipped.md`).
- **`pending`** if the feature is absent. Confirmed examples:
  - `2026-04-12-meditate-backpressure-guard.md` — no `countIlluminations` and no `--force` in `src/cli/commands/meditate.ts` or `src/cli/program.ts`.
  - `2026-04-12-headless-governance-gates.md` — no headless gate routing in the engine.
  - `2026-04-25-state-machine-exists-verifier-ignores-it.md` — its design just landed (`specs/2026-04-25-state-machine-exists-verifier-ignores-it-design.md`); plan is in flight.

The plan that implements this spec is responsible for the full file-by-file enumeration. The constraint here is the acceptance bar: **zero unstamped files, zero stale `open` files**. A spot check against a few well-known landed features and a few well-known gaps is the validation; an unstamped file or a stale `open` file is treated the same as today's no-frontmatter state — invisible.

The backfill commit message follows the `meditate:` prefix pattern already used by the MCP server's auto-commits (`illumination-server.ts:36,98,161,231`). Suggested: `meditate: backfill plan lifecycle frontmatter`. The plan can split into chunked commits if convenient; that is a plan-time choice, not a spec constraint.

### 3. New MCP tools — `src/cli/mcp/illumination-server.ts`

Two new exported pure helpers and two new `server.tool()` registrations. The shape mirrors `listIlluminations` and `markDispatched` exactly.

#### `listPlans(projectRoot, status?)`

```ts
const NO_PLANS_MESSAGE = "No plans found.";

function parsePlanDescription(filePath: string): string {
  // Plans use a top-level "# <title>" line, not a frontmatter "description" field.
  // Return the first H1 line from the body as the description.
  // Mirrors parseIlluminationDescription's early-return shape (illumination-server.ts:298-310).
  try {
    const content = readFileSync(filePath, "utf8");
    let body = content;
    if (content.startsWith("---\n")) {
      const end = content.indexOf("\n---\n", 4);
      if (end === -1) return "(no description)";
      body = content.slice(end + 5);
    }
    const match = body.match(/^#\s+(.+)$/m);
    return match ? match[1].trim() : "(no description)";
  } catch {
    return "(no description)";
  }
}

export function listPlans(projectRoot: string, status?: string): string {
  const dir = join(projectRoot, "docs", "superpowers", "plans");
  try {
    let files = readdirSync(dir)
      .filter((f) => f.endsWith(".md"))
      .sort();
    if (status) {
      files = files.filter((f) => {
        const content = readFileSync(join(dir, f), "utf-8");
        const fmMatch = content.match(/^---\n([\s\S]*?)\n---\n/);
        if (!fmMatch) return false; // no frontmatter = excluded from any status filter
        const statusMatch = fmMatch[1].match(/^status:\s*(.+)$/m);
        const fileStatus = statusMatch ? statusMatch[1].trim() : null;
        return fileStatus === status;
      });
    }
    if (files.length === 0) return NO_PLANS_MESSAGE;
    return files
      .map((f) => `${f} — ${parsePlanDescription(join(dir, f))}`)
      .join("\n");
  } catch {
    return NO_PLANS_MESSAGE;
  }
}
```

Two deliberate divergences from `listIlluminations`:

- **No-frontmatter handling.** `listIlluminations` defaults missing-frontmatter files to `status: open` (`illumination-server.ts:323`). For plans, an unstamped file is excluded from any status filter. After backfill there should be zero such files; if one appears (e.g., a hand-edit forgot the frontmatter), it surfaces as missing from both `pending` and `implemented` filters — the absence is the bug signal.
- **Description source.** Illuminations carry a `description:` field in frontmatter (`writeIllumination:28`). Plans do not (and the spec is not adding one — too much churn for too little value). The H1 line stands in.

#### `markPlanImplemented(projectRoot, planFilename)`

Mirrors `markDispatched` exactly (`illumination-server.ts:113-174`):

```ts
export function markPlanImplemented(
  projectRoot: string,
  planFilename: string,
): { success: true; plan_filename: string; previous_status: string; new_status: string }
  | { success: false; error: string } {
  const fnErr = validateFilename(planFilename);
  if (fnErr) return { success: false, error: fnErr };

  const planDir = join(projectRoot, "docs", "superpowers", "plans");
  const filePath = join(planDir, planFilename);

  if (!existsSync(filePath)) {
    return { success: false, error: `Plan file not found: ${planFilename}` };
  }

  const raw = readFileSync(filePath, "utf-8");
  const fmMatch = raw.match(/^---\n([\s\S]*?)\n---\n/);
  if (!fmMatch) {
    return { success: false, error: "No frontmatter found in plan file" };
  }

  const fmBlock = fmMatch[1];
  const body = raw.slice(fmMatch[0].length);

  const statusMatch = fmBlock.match(/^status:\s*(.+)$/m);
  const currentStatus = statusMatch ? statusMatch[1].trim() : null;

  if (currentStatus !== "pending") {
    return {
      success: false,
      error: `Cannot mark as implemented: current status is ${currentStatus ?? "(missing)"}`,
    };
  }

  const updatedFm = fmBlock.replace(/^status:\s*.+$/m, "status: implemented");
  const updatedContent = `---\n${updatedFm}\n---\n${body}`;
  writeFileSync(filePath, updatedContent);

  try {
    execSync(`git -C "${projectRoot}" add "${filePath}"`, { stdio: "ignore" });
    execSync(
      `git -C "${projectRoot}" commit -m "meditate: mark plan ${planFilename} implemented"`,
      { stdio: "ignore" },
    );
  } catch {
    // git not available, not a git repo, or nothing to commit (idempotent re-run).
  }

  return {
    success: true,
    plan_filename: planFilename,
    previous_status: currentStatus,
    new_status: "implemented",
  };
}
```

Three deliberate constraints:

- **`pending` is the only valid prior state.** Calling on an already-implemented plan returns an error with the current status interpolated. Calling on a missing-frontmatter file returns an explicit `"No frontmatter found"` error rather than silently writing one — the absence is a backfill bug, not a normal state.
- **No new fields beyond `status`.** No `implemented_at`, no commit-hash record. (See open question.)
- **Auto-commit identical shape to `markDispatched`.** Same `try/catch`, same `stdio: "ignore"`, same swallow-on-failure rationale.

#### MCP tool registrations

Two new `server.tool()` calls, inserted near the existing `list_illuminations` / `mark_dispatched` registrations (`illumination-server.ts:519-560`):

```ts
server.tool(
  "list_plans",
  "List implementation plans in docs/superpowers/plans/, with their H1 titles. " +
    "Optionally filter by lifecycle status (pending or implemented). " +
    "Call this to see what plans remain unimplemented.",
  {
    status: z.enum(["pending", "implemented"]).optional(),
  },
  async ({ status }: { status?: string }) => {
    const result = listPlans(projectRoot, status);
    return { content: [{ type: "text" as const, text: result }] };
  },
);

server.tool(
  "mark_plan_implemented",
  "Mark a plan as implemented. Valid only from status pending. " +
    "Auto-commits the frontmatter change. Call this when the plan's feature has shipped.",
  {
    plan_filename: z.string(),
  },
  async ({ plan_filename }: { plan_filename: string }) => {
    const result = markPlanImplemented(projectRoot, plan_filename);
    return {
      content: [{ type: "text" as const, text: JSON.stringify(result, null, 2) }],
    };
  },
);
```

`validateFilename`'s existing regex (`illumination-server.ts:9`) is reused — plan filenames already match `[\w-]+\.md` (e.g., `2026-04-12-meditate-backpressure-guard.md`).

### 4. Frontmatter emission — agent rubric + one prompt edit

Two edits, one per pipeline shape:

**A. `src/cli/agents/plan-writer.md` — agent rubric.** The newer pipeline `pipelines/illumination-to-implementation.dot:34` delegates to the agent rubric ("Follow your agent-level procedure: derive the plan filename from the illumination slug, invoke superpowers:writing-plans, write to $plans_dir/, then loop per chunk..."). Adding the frontmatter instruction to the rubric is the canonical change — every pipeline that calls `plan-writer` inherits it without re-editing prompt strings. Insert a numbered step in the existing Procedure block (after step 3, before "Structure the plan as chunks"):

> `4. **Begin the plan file with a frontmatter block.** Two fields, in this order: \`status: pending\` and \`illumination_source: <basename of $illumination_path>\` (filename only, no path). Place the block before the plan's first heading, delimited by \`---\` lines. The downstream \`list_plans\` MCP tool reads this frontmatter; omitting it makes the produced plan invisible to lifecycle queries.`

Subsequent step numbers shift by one.

**B. `pipelines/illumination-to-plan.dot:30` — older pipeline prompt.** The `plan_writer` node here has a fully self-contained prompt that does NOT delegate to the agent rubric. It must be edited inline. Current prompt body ends with:

> `Follow the conventions of existing plans in $plans_dir/. Include: chunks, tasks with TDD steps, exact file paths, commit messages.\n\nDo NOT modify any other project files.`

After:

> `Follow the conventions of existing plans in $plans_dir/. Include: chunks, tasks with TDD steps, exact file paths, commit messages.\n\nBegin the plan file with a frontmatter block containing exactly two fields: \`status: pending\` and \`illumination_source: <basename of $illumination_path>\`. Place the frontmatter before the plan's first heading.\n\nDo NOT modify any other project files.`

Both edits are required — the rubric edit covers `illumination-to-implementation.dot:34` and any future agent-rubric-delegating pipeline; the inline edit covers the legacy self-contained prompt. The instruction is explicit (per the `feedback-pipeline-prompt-control` memory rule: never swap steps for "invoke skill X" deferrals). The agent does not need to derive the frontmatter shape — it is spelled out in both places.

A Glob over `pipelines/*.dot` at implementation time confirms no third pipeline owns a plan-writing prompt; if one is found, the same inline-edit rule applies.

### 5. Tool whitelist updates — `src/cli/agents/*.md`

Agents that implement features and need to flip pending → implemented gain `mcp__illumination__mark_plan_implemented` in their `tools:` list. The agent that calls the tool is the implementing agent itself, whichever pipeline or loop is actively shipping the plan's feature; caller identity is not pinned to one specific agent file (per round-2 rationale: "user said 'agent' generically, scoped by autonomy goal; pinning to one specific agent would re-introduce a coordination point").

Concretely: any agent that runs implementation work AND has the `illumination` MCP server attached in its agent-file `mcp:` block (the same block that wires `mark_dispatched` / `mark_archived` today, e.g., `meditate.md:17-23`) gets `mark_plan_implemented` whitelisted. The implementation must verify per agent that the MCP server is actually attached before adding the whitelist line — agents that lack the `mcp:` block cannot reach the tool regardless of whitelist entry. Agents with a strictly read-only or design-only posture (`verifier.md`, `change-explainer.md`, `design-writer.md`, `plan-writer.md`) do not get the flip whitelisted; see open question 2 for the `plan-writer.md` decision rationale.

`list_plans` is whitelisted more broadly — any agent that benefits from "what's still pending?" awareness, including `meditate.md` (so meditation sessions can spot orphan plans) and `implement.md`, again subject to the same MCP-attachment verification. The plan enumerates the exact agent-file edits after Globbing `src/cli/agents/*.md` and inspecting each `mcp:` block.

## Components

### `docs/superpowers/plans/*.md` (48 files)

Backfill pass. Each file gains a frontmatter block. Outcome: every file has `status: pending` or `status: implemented`. Extra frontmatter fields beyond `status` and `illumination_source` are tolerated — `listPlans` and `markPlanImplemented` only read `status`, and stripping unrelated fields would force unrelated churn (e.g., `2026-04-17-pipeline-script-files.md:1-5` carries `date`, `design_doc`, `execution_style`; those are kept). The minimum acceptance bar is presence of a valid `status:` line; supersets are fine. The exact-shape constraint is reserved for **plan_writer-produced** plans (where the prompt specifies the two-field shape), not the backfill.

### `src/cli/mcp/illumination-server.ts`

Two new exported helpers (`listPlans`, `markPlanImplemented`) and one new helper (`parsePlanDescription`). Two new `server.tool()` registrations inside the existing `Promise.all([...]).then(...)` block. No new imports — `readFileSync`, `readdirSync`, `writeFileSync`, `existsSync`, `execSync`, `join`, `validateFilename`, `z` are all already imported (lines 1-5, 9).

### `src/cli/agents/plan-writer.md`

One numbered step inserted in the Procedure block (between current steps 3 and 4). No frontmatter changes, no tool list changes, no model changes. Subsequent step numbers shift by one.

### `pipelines/illumination-to-plan.dot`

One prompt-string edit on the `plan_writer` node (line 30). No node additions, no edge changes, no `produces=` change (the `plan_writer` has no `produces=` attribute and does not need one — its output is a written file, not a context variable).

### `pipelines/illumination-to-implementation.dot`

No edit. The `plan_writer` node at line 34 already delegates to the agent rubric ("Follow your agent-level procedure: derive the plan filename from the illumination slug, invoke superpowers:writing-plans, write to $plans_dir/, ..."), so the rubric edit covers it transitively. Verified by reading the prompt string at implementation time.

### `src/cli/agents/*.md`

Tool whitelist additions on implementing-and-meditating agent files. Exact list: plan's responsibility.

### `src/cli/tests/illumination-server.test.ts`

New test cases. The illumination-side of this file already exercises the equivalent illumination machinery (see `specs/2026-04-25-state-machine-exists-verifier-ignores-it-design.md:150-170` for the test-shape pattern). Required cases:

- **`listPlans` empty.** Empty `docs/superpowers/plans/` → returns `NO_PLANS_MESSAGE`.
- **`listPlans` filter — pending.** Three fixture plans (one `pending`, one `implemented`, one no-frontmatter) → `listPlans(projectRoot, "pending")` returns one line for the pending file only.
- **`listPlans` filter — implemented.** Same fixture → `listPlans(projectRoot, "implemented")` returns one line for the implemented file only.
- **`listPlans` filter — no-frontmatter excluded.** Same fixture → no-frontmatter file does not appear under any status filter.
- **`listPlans` no filter.** Same fixture → all three files appear.
- **`markPlanImplemented` happy path.** Pending plan → frontmatter is rewritten to `status: implemented` and `git status --porcelain` is empty after the call.
- **`markPlanImplemented` already-implemented.** Implemented plan → returns `success: false` with the current-status error message; frontmatter is unchanged.
- **`markPlanImplemented` missing frontmatter.** No-frontmatter plan → returns `success: false` with the "No frontmatter found" error; file is unchanged.
- **`markPlanImplemented` missing file.** Non-existent filename → returns `success: false` with the "Plan file not found" error.
- **Auto-commit observability.** After `markPlanImplemented` the working tree is clean and `git log --oneline -1` shows the `meditate: mark plan ... implemented` message.

The test file already initializes a temp `git init -b main` repo for `writeIllumination` and `markDispatched` tests (per `specs/2026-04-25-state-machine-exists-verifier-ignores-it-design.md:170`); the same setup is reused.

## Data Flow

### Backfill pass (one-time)

```
docs/superpowers/plans/                  for each file:
  └─ <plan>.md  (no frontmatter)         determine status from src/ + pipelines/
                                            ↓
                                         prepend:
                                           ---
                                           status: pending | implemented
                                           ---
                                            ↓
                                         git add docs/superpowers/plans/<plan>.md
                                            ↓
                                         git commit -m "meditate: backfill plan lifecycle frontmatter"
```

After: 48/48 files frontmatter-stamped. Zero unstamped, zero stale `open` (no plan ever had `open`; the rule is preventative).

### `list_plans` query

```
agent calls list_plans(status="pending")
  └─ readdirSync(docs/superpowers/plans)
        └─ filter on .md
        └─ for each file: parse frontmatter status field
        └─ keep only files with status === "pending"
        └─ map to "<filename> — <H1 title>"
        └─ return joined
```

If `archive/` or any subdirectory is added under `docs/superpowers/plans/` later, `readdirSync` does not recurse — non-`.md` entries are filtered, subdirectories are silently skipped because they fail the `.endsWith(".md")` check. (The same bug class as `listIlluminations` pre-fix on `archive/`; for plans there is no archive flow, so the issue does not arise.)

### `mark_plan_implemented` flip

```
implementing agent finishes feature
  └─ calls mark_plan_implemented(plan_filename="2026-04-12-meditate-backpressure-guard.md")
        └─ validateFilename
        └─ readFileSync
        └─ parse frontmatter
        └─ assert status === "pending"
        └─ rewrite frontmatter: status: pending → status: implemented
        └─ writeFileSync
        └─ git add <path>
        └─ git commit -m "meditate: mark plan ... implemented"
        └─ return { success: true, previous_status: "pending", new_status: "implemented" }
```

Next session calls `list_plans(status="pending")`; the just-implemented plan is gone from the list. No human hand-edit, no separate verifier gate.

### `plan_writer` produces frontmatter

```
pipeline reaches plan_writer
  └─ prompt instructs: write frontmatter block with status: pending and illumination_source
  └─ plan_writer agent writes file:
       ---
       status: pending
       illumination_source: 2026-04-14T0800-plans-have-no-lifecycle.md
       ---
       # <plan title>
       ...
  └─ list_plans(status="pending") immediately reflects the new plan
```

Pipeline-produced plans are queryable from the moment they land.

## Constraints

- **Backfill must be exhaustive.** Zero unstamped, zero stale `open`. Per round-1 rationale: "partial backfill defeats the queryability goal; an unstamped or stale-`open` plan is just as invisible as today's no-frontmatter state." The acceptance check is a `find docs/superpowers/plans -maxdepth 1 -name '*.md' | xargs grep -L '^status:'` returning empty (no files lacking a `status:` line). The plan codifies the exact verification command.
- **Vocabulary parity.** Terminal label is `implemented`, not `complete` or `done`. Per round-2 override: "match the existing `implemented` term used on the illumination side; avoid introducing `complete` as a parallel-but-different label."
- **Binary lifecycle.** Plans have two states. No `dispatched`, no `archived`. The illumination's four-state machine is not mirrored. If a future need surfaces, that is its own illumination.
- **No human in the happy path.** `pending → implemented` is an MCP tool call from the implementing agent. Per round-2 rationale: "hand-edit reproduces the orphan failure mode the illumination identifies; verifier gate adds latency and a manual checkpoint that breaks autonomy."
- **Caller identity is not pinned.** Any agent with the tool whitelisted can call `mark_plan_implemented`. Per round-2 rationale: "pinning to one specific agent would re-introduce a coordination point and break the autonomy property."
- **Auto-commit pattern is the contract.** Same four-line `try/catch` shape as `writeIllumination:33-42`, `markImplemented:96-103`, `markDispatched:158-166`, `markArchived:227-236`. No new abstraction; duplication is intentional.
- **Description source is H1.** Plans have no `description:` frontmatter field today; this spec does not add one. `parsePlanDescription` reads the first H1 line from the body. If a plan's body has no H1, the description is `(no description)` — same fallback shape as `parseIlluminationDescription:301`.
- **No engine change, no validator change.** Touch surface is MCP server, one prompt string, agent whitelists, the test file, and the plan corpus.

## Open Questions

- **Should `mark_plan_implemented` add an `implemented_at: YYYY-MM-DD` field?** The illumination-side `markDispatched` adds `dispatched_at` (`illumination-server.ts:151`) and `markImplemented` adds `implemented_at` (line 90). Symmetric design would add `implemented_at` to plans on the flip. Argument against: backfilled `implemented` plans cannot honestly carry a date — adding "today" lies, and adding nothing creates a two-shape divergence (some `implemented` plans have a stamp, some don't). The spec leans toward consistency: no timestamp on either path. Open for the plan to revisit if vocabulary parity with the illumination state machine is judged more valuable than truthfulness on backfill. **Provisional decision: omit `implemented_at`. Plan is free to flip if reviewer disagrees.**

- **Does `plan-writer.md` get `mark_plan_implemented` whitelisted?** The `plan-writer` agent today writes a plan and exits; it does not implement features. Whitelisting it would let a future "write-and-immediately-mark" flow exist, but no such flow is in scope. **Provisional decision: do not whitelist `plan-writer.md`.** Plan flips this if a concrete need surfaces during implementation.

- ~~**`pipelines/illumination-to-implementation.dot` plan-writing prompt.**~~ Resolved during review: line 34's prompt delegates to the agent rubric, so the `plan-writer.md` edit covers it. The spec now enumerates both edit sites (`plan-writer.md` rubric step + `illumination-to-plan.dot:30` inline prompt). A Glob over `pipelines/*.dot` at implementation time confirms no third site needs editing.
