# Design: Consume-Only Plan Lifecycle (`mark_plan_implemented` → `consume_plan`)

**Date:** 2026-05-04
**Status:** draft (pending review)
**Originating illumination:** `meditations/illuminations/2026-05-01T1537-mark-plan-implemented-not-idempotent.md`

## 1. Motivation

The illumination as filed asked for one fix: make `mark_plan_implemented` idempotent so that re-running a finished pipeline does not emit `success: false` with `"Cannot mark as implemented: current status is done"`. During the chat refinement round the user inspected `docs/superpowers/plans/` and found that the plan-`status` field — the field that error message gates on — has already drifted out of any usable shape. Patching idempotency leaves that drift in place; deleting the field eliminates the entire failure class.

The drift is structural and is verifiable in the current tree.

`src/cli/mcp/illumination-server.ts:500` declares the `list_plans({ status })` schema as:

```ts
status: z.enum(["pending", "implemented"]).optional(),
```

Five of eleven plan files in `docs/superpowers/plans/` currently carry a `status:` frontmatter line (verified via repo grep on `^status:` against frontmatter at line 2):

| Plan file | Frontmatter `status:` value |
|---|---|
| `2026-05-01-source-as-truth-no-behavioral-specs.md` | `pending` |
| `2026-05-01-janitor-dead-two-phase-fn.md` | `done` |
| `2026-05-01-janitor-dead-parse-structured-output.md` | `complete` |
| `2026-05-01-meditate-bypasses-resolver-chain.md` | `complete` |
| `2026-05-03-janitor-dead-scripts.md` | `complete` |

Only `pending` matches the enum the schema expects. Four of five files carry values (`done`, `complete`) the schema does not accept — meaning `list_plans({ status: "implemented" })` returns zero of these despite four of them being implemented in fact. Six of eleven plan files carry no `status:` line at all and are therefore invisible to *any* status filter, regardless of value. The schema and the on-disk corpus disagree, and the disagreement is irreversible without an enforcement mechanism nobody is going to maintain.

Meanwhile, the upstream sibling cleanup for illuminations already shipped under ADR-0002 (`docs/adr/0002-consume-only-illumination-lifecycle.md`). That ADR collapsed three lifecycle tools (`mark_dispatched`, `mark_implemented`, `mark_archived`) into one `consume(filename, reason)` call that does `git rm <path>` + `git commit -m "meditate: consume <filename> (<reason>)"` and nothing else: "No frontmatter rewrite, no validation, no `note` parameter, no return path." The illumination side now has zero drift surface.

This change is the parallel cleanup applied to plans. It is not a new pattern: it is the one already proven on the illumination side, transplanted to the only other in-tree lifecycle that still rewrites frontmatter. The illumination's revised implementation steps (idempotency patch, `alreadyDone: true` flag, branched return shapes) are rejected in favor of the structurally simpler "delete the file when it's done" model the user explicitly requested in chat round 1.

ADR-0004 ("source and context as truth, no behavioral specs") frames the broader principle: drift-prone metadata that no agent depends on for correctness should be excised, not maintained. The plan `status:` field has demonstrably become exactly that.

## 2. Decision summary

1. **Delete `markPlanImplemented`.** The exported function (`src/cli/mcp/illumination-server.ts:222-277`) and its server-tool registration (`:508-521`) go away in full. The error path that produced the failure-class spike (`:250-254`) goes with them. There is no replacement on the same shape.

2. **Add `consumePlan(projectRoot, filename, reason)`.** New exported function and server-tool registration, structurally identical to the shipped illumination `consume` (`src/cli/mcp/illumination-server.ts:68-98` for the function, `:476-492` for the registration). It performs `rmSync` + `git rm <path>` + `git commit -m "meditate: consume <filename> (<reason>)"` against `docs/superpowers/plans/`. No frontmatter rewrite, no transition validation, no return path beyond `{ success, filename, reason }` / `{ success: false, error }`. Reason values mirror the illumination side: `"implemented" | "declined"`.

3. **Drop the plan `z.enum` and the `list_plans` status filter.** The `z.enum(["pending", "implemented"]).optional()` schema field at `:500` is removed. The runtime status-filter loop in `listPlans` (`:197-220`, specifically the `if (status) { files = files.filter(...) }` block at `:203-212`) is removed; `listPlans` becomes "every file in the folder, sorted, with H1 description." This mirrors `listIlluminations`'s post-ADR-0002 shape.

4. **Strip `status:` frontmatter from the five existing plan files** that carry one. Each file's leading frontmatter block loses its `status:` line; everything else (`---` delimiters, body) is preserved byte-for-byte. After the strip, `grep -rn '^status:' docs/superpowers/plans/ | head` returns zero hits at line 2.

5. **Update the tail-node prompt.** `pipelines/illumination-to-implementation/memory-writer.md:12` swaps `mcp__illumination__mark_plan_implemented` for `mcp__illumination__consume_plan` in the tools list. Step 7a at `:130` swaps the `mark_plan_implemented` call for `consume_plan(filename = basename of $plan_writer.plan_path, reason = "implemented")`. The "best-effort, never-abort" softening at `:134-145` is retained — the failure mode it guards against (file already gone, file path empty) still applies to `consume_plan`, which returns `{ success: false, error: "Plan file not found" }` when called twice. The note in the docstring "Mark a plan as implemented. Valid only from status pending." (`:510`) does not exist in the new shape; the new docstring mirrors the illumination `consume` docstring.

6. **Update the plan-writer prompt.** `pipelines/illumination-to-implementation/plan-writer.md:44-45` currently directs the agent to begin every plan with frontmatter `status: pending`. That step is removed. Plans no longer carry a `status:` field at write time, matching the post-cleanup state of existing files.

7. **Tests.** `src/cli/tests/illumination-server.test.ts` deletes the `markPlanImplemented` describe block and the `listPlans({ status })` filter cases (~5–8 cases). It adds a `consumePlan` describe block templated on the existing `consume` tests (~3 cases: success path with git commit, file-not-found, missing-git tolerance). The agent tool whitelists at `src/cli/tests/meditate.test.ts:183,201` and `src/cli/tests/janitor-agent.test.ts:42` — which currently include `mcp__illumination__mark_plan_implemented` — swap that string for `mcp__illumination__consume_plan`. The negative-match assertion at `src/cli/tests/janitor-agent.test.ts:84` (a `not.toMatch(/mark_plan_implemented/)` regex check) becomes `not.toMatch(/consume_plan/)` against the new tool name.

Out of scope (locked):

- ADR-0003 ("consume-only plan lifecycle"). Refinement bullet 6 explicitly defers this to plan-writer judgment; ADR-0002 itself shipped without a sibling ADR for plans, and ADR-0004 already covers the underlying principle. If the implementation plan's reviewer wants a discrete ADR, it is a one-paragraph addition; this design does not require one.
- Any rewrite of `listPlans` beyond the filter removal (no new sort key, no new output shape, no new H2 parser).
- Any rename of `consume` itself or of the existing illumination tool surface.
- Any change to `meditate.dot` or `illumination-to-implementation/pipeline.dot` graphs.

## 3. Architecture

### 3.1 Current shape

```
illumination MCP server
├── consume(filename, reason)              ← ADR-0002, post-2026-04-30
├── list_illuminations()                   ← no status filter, post-ADR-0002
├── list_plans({ status: "pending"|"implemented"|undef })
└── mark_plan_implemented(plan_filename)
       ├── reads plan frontmatter
       ├── rejects unless status === "pending"
       ├── rewrites status: pending → status: implemented
       └── commits "meditate: mark plan <filename> implemented"
```

The plan-side surface is a parallel-but-divergent copy of the pre-2026-04-30 illumination surface. The illumination side has since been cleaned up; the plan side still carries the original drift-prone shape. The illumination's chat round 1 confirmed the operator does not value the structural data the rewrite tries to preserve — only that the file stops being a live work item.

### 3.2 Target shape

```
illumination MCP server
├── consume(filename, reason)              ← unchanged
├── consume_plan(filename, reason)         ← NEW; mirror of consume
├── list_illuminations()                   ← unchanged
└── list_plans()                           ← no status param
```

`mark_plan_implemented` is gone. The plan side now matches the illumination side in shape: alive (file present in `docs/superpowers/plans/`) or consumed (file deleted). No frontmatter rewrite, no enum, no transition gate. Re-running a pipeline whose plan file was already consumed gets `{ success: false, error: "Plan file not found" }` from the second call — which the tail-node prompt's existing best-effort softening already handles as a non-fatal log line. The original failure class (`success: false` from `done → done`) cannot exist because there is no `done` state to be in.

### 3.3 Symmetry with the illumination side

The new `consumePlan` is intentionally a near-copy of the existing `consume`:

```ts
// existing — src/cli/mcp/illumination-server.ts:68-98
export function consume(
  projectRoot: string,
  filename: string,
  reason: ConsumeReason,
): { success: true; filename: string; reason: ConsumeReason }
  | { success: false; error: string } {
  const fnErr = validateFilename(filename);
  if (fnErr) throw new Error(fnErr);
  // …reason validation…
  const filePath = join(projectRoot, "meditations", "illuminations", filename);
  if (!existsSync(filePath)) {
    return { success: false, error: "Illumination file not found" };
  }
  rmSync(filePath);
  try {
    execSync(`git -C "${projectRoot}" rm "${filePath}"`, { stdio: "ignore" });
    execSync(
      `git -C "${projectRoot}" commit -m "meditate: consume ${filename} (${reason})"`,
      { stdio: "ignore" },
    );
  } catch { /* git unavailable / no repo / nothing to commit */ }
  return { success: true, filename, reason };
}
```

`consumePlan` differs in exactly two points: the `join` target is `docs/superpowers/plans` (not `meditations/illuminations`), and the not-found error string says "Plan file not found" (not "Illumination file not found"). The commit-message format `meditate: consume <filename> (<reason>)` is identical, by design — a single `git log --grep "meditate: consume"` continues to surface every consumed artifact, plan or illumination. This deliberate naming choice is the simplest answer to the audit-trail concern ADR-0002 explicitly accepted: declines/implementations are durable in `git log`, not on disk.

### 3.4 Why not "delete the body, keep the function name"

Considered: keep `markPlanImplemented` as the public name, rewrite its internals to do `rmSync` + `git rm`. Rejected — the name lies about the verb (it does not mark anything; it deletes), the parameter order (`plan_filename` only, no `reason`) does not match the consume contract, and the symmetry with the illumination `consume` would be obscured. Same reason ADR-0002 paragraph "(a) Delete-only, keep three tools" rejected the analogous shortcut on the illumination side: "the names lie about what they do, the API surface is artificially wide."

## 4. Components & file edits

| File | Change |
|---|---|
| `src/cli/mcp/illumination-server.ts` | Delete `markPlanImplemented` (`:222-277`). Delete its server-tool registration (`:508-521`). Drop the `status` parameter from the `list_plans` registration's zod schema (`:500`) and from the handler signature; remove the in-handler status filter (`:203-212`). Add new exported `consumePlan` function (mirror of `consume` at `:68-98`) and its server-tool registration (mirror of `consume` registration at `:476-492`), targeting `docs/superpowers/plans/`. |
| `pipelines/illumination-to-implementation/memory-writer.md` | Swap `mcp__illumination__mark_plan_implemented` → `mcp__illumination__consume_plan` in the `tools:` list at `:12`. Rewrite step 7a at `:130` to call `consume_plan({ filename, reason: "implemented" })` instead of `mark_plan_implemented`. Retain the "best-effort, never-abort" framing at `:134-145` — the file-already-gone case still surfaces as `success: false` from the second call. |
| `pipelines/illumination-to-implementation/plan-writer.md` | Delete the `status: pending` frontmatter directive at `:44-45`. Plan files written by this node will no longer carry a frontmatter block. |
| `docs/superpowers/plans/2026-05-01-source-as-truth-no-behavioral-specs.md` | Strip `status: pending` line from frontmatter (line 2). |
| `docs/superpowers/plans/2026-05-01-janitor-dead-two-phase-fn.md` | Strip `status: done` line from frontmatter (line 2). |
| `docs/superpowers/plans/2026-05-01-janitor-dead-parse-structured-output.md` | Strip `status: complete` line from frontmatter (line 2). |
| `docs/superpowers/plans/2026-05-01-meditate-bypasses-resolver-chain.md` | Strip `status: complete` line from frontmatter (line 2). |
| `docs/superpowers/plans/2026-05-03-janitor-dead-scripts.md` | Strip `status: complete` line from frontmatter (line 2). |
| `src/cli/tests/illumination-server.test.ts` | Delete the `markPlanImplemented` describe block (~5 cases including the `done → done` rejection case). Delete the `listPlans({ status })` filter cases (~3 cases). Add a `consumePlan` describe block (~3 cases: success-with-commit, file-not-found, git-unavailable-no-throw). The describe block templates verbatim on the existing `consume` describe block. |
| `src/cli/tests/meditate.test.ts:183,201` | Replace `mcp__illumination__mark_plan_implemented` with `mcp__illumination__consume_plan` in the agent tool-whitelist assertions. |
| `src/cli/tests/janitor-agent.test.ts:42` | Replace `mcp__illumination__mark_plan_implemented` with `mcp__illumination__consume_plan` in the tool-whitelist assertion. |
| `src/cli/tests/janitor-agent.test.ts:84` | Update the `not.toMatch(/mark_plan_implemented/)` negative regex to `not.toMatch(/consume_plan/)` so the assertion continues to guard against the same intent (no plan-lifecycle tool leaking into this agent's prompt) under the new tool name. |

Approximately six source-code/test edits plus five plan-file frontmatter strips. Single coherent commit per chunk in the implementation plan; all edits land in one branch.

## 5. Data flow

### 5.1 Before

```
implement-loop ships
        │
        ▼
memory-writer node runs
        │
        ▼
mark_plan_implemented(plan_filename)
        │
        ├── reads frontmatter ── status field absent? ─→ {success:false, "No frontmatter found"}
        │
        ├── status === "pending"? ── no ────────────────→ {success:false, "Cannot mark as implemented: current status is <X>"}
        │
        └── yes ──→ rewrite "status: pending" → "status: implemented" ──→ commit ──→ {success:true, ...}
```

The diamond at `status === "pending"?` is the failure-class spike. The illumination's run reproduced it: a re-run of a successful pipeline passed every gate, then crashed the lifecycle node because the prior run had already written `status: done` (a value that is itself outside the schema enum, but that the rewrite path nonetheless wrote at an earlier point in history).

### 5.2 After

```
implement-loop ships
        │
        ▼
memory-writer node runs
        │
        ▼
consume_plan(filename, reason="implemented")
        │
        ├── file exists? ── no ──→ {success:false, "Plan file not found"} ──┐
        │                                                                   │
        └── yes ──→ rmSync + git rm + commit ──→ {success:true, ...} ───────┤
                                                                            │
                                                                            ▼
                                                          tail-node logs the result
                                                          and proceeds (best-effort
                                                          softening at memory-writer.md:134-145)
```

There is no diamond on a state field. The only failure mode is "file not found," which is the correct semantics for a re-run: the previous run already consumed it. The tail-node's existing softening (added pre-pivot for the same idempotency concern) handles this branch as a non-fatal log line.

## 6. Blast radius / impact surface

Sourced from the verifier's blast paragraph (Size: M; ~6 files) and the explainer's `## Blast radius` block.

- **Size:** M.
- **Files touched:** 11 total — 1 source (`src/cli/mcp/illumination-server.ts`), 2 pipeline prompts (`memory-writer.md`, `plan-writer.md`), 5 plan files (frontmatter strip), 3 test files (`illumination-server.test.ts`, `meditate.test.ts`, `janitor-agent.test.ts`).
- **Surfaces crossed:**
  - **CLI:** affected. The MCP server bundled into `dist/cli/mcp/illumination-server.js` is rebuilt; the `mark_plan_implemented` tool name disappears, `consume_plan` appears.
  - **Pipeline engine:** unaffected. No change to `Graph`, resolver, validator, or runtime.
  - **Agents:** affected. The `memory-writer` node's tool list and step 7a call change. The `plan-writer` node stops emitting `status: pending`. No agent rubric outside `pipelines/illumination-to-implementation/` references either tool name.
  - **Docs:** ADR-0002 stays as the canonical lifecycle precedent. ADR-0003 (sibling for plans) is *not* required by this design — see §2 out-of-scope. README does not advertise either tool name (verified via grep).
  - **Tests:** affected. `illumination-server.test.ts` describe-block delete + add. Tool-whitelist string swap in `meditate.test.ts` and `janitor-agent.test.ts` (4 lines total).
  - **Build:** unaffected. `tsup.config.ts` continues to bundle `src/cli/mcp/illumination-server.ts` as-is.
  - **npm package:** unaffected by removed surface — `mark_plan_implemented` was an MCP tool name advertised only via the runtime registration list, not a TypeScript export consumed by external packages.
- **Breaking change list:**
  - **MCP tool name `mark_plan_implemented`:** removed. The only in-repo caller is the `memory-writer.md` prompt; this design swaps that caller. No external consumer is documented anywhere. Verifier's "public-contract subagent confirmed only one in-repo caller of `mark_plan_implemented` (memory-writer.md) and zero callers of `list_plans({status: ...})`."
  - **`list_plans({ status })` parameter:** removed. Zero in-repo callers found.
  - **TypeScript export `markPlanImplemented`:** removed from `src/cli/mcp/illumination-server.ts`. Imported only by `src/cli/tests/illumination-server.test.ts:14`, whose import line is updated alongside the describe-block delete.
- **Spec / docs ripple checklist:**
  - [ ] No README update required — `mark_plan_implemented` is not advertised in `README.md` (verified via grep, only test/prompt/source file hits).
  - [ ] No ADR-0003 required — refinement bullet 6 defers to plan-writer judgment; ADR-0004 covers the underlying principle and ADR-0002 covers the precedent. The implementation plan may surface this question for review.
  - [ ] No CONTEXT.md update required — plan `status` field is not referenced in domain language docs.
- **Test ripple checklist:**
  - [x] `src/cli/tests/illumination-server.test.ts` — delete `markPlanImplemented` describe block (~5 cases) + `listPlans({ status })` cases (~3 cases); add `consumePlan` describe block (~3 cases templated on `consume`).
  - [x] `src/cli/tests/meditate.test.ts:183,201` — string swap in tool-whitelist assertions.
  - [x] `src/cli/tests/janitor-agent.test.ts:42` — string swap in tool-whitelist assertion. `:84` updates the `not.toMatch(/mark_plan_implemented/)` regex to `not.toMatch(/consume_plan/)`.
  - [ ] No new fixture files required — `consumePlan` tests reuse the same temp-dir + mocked `execSync` scaffolding the existing `consume` tests use.

Single session, single repo, no external consumers. Net infrastructure consolidation: ~55 lines of `markPlanImplemented` source go away; ~30 lines of `consumePlan` come in (mirror of existing `consume`); net source delta is negative. Plus the schema simplifications.

## 7. Trade-offs

### 7.1 Risk: a future workflow needs a "still pending" plan list

`list_plans({ status: "pending" })` no longer exists. Callers asking "which plans are unimplemented?" cannot filter at the MCP layer.

**Accepted because:** every file in `docs/superpowers/plans/` is alive. Same logic as `list_illuminations` post-ADR-0002: there is nothing to filter, because consumed plans are deleted. A consumer who wants the literal answer to "which plans remain unimplemented" calls `list_plans()` and gets exactly that list. The previously-correct answer ("filter by status field") was already wrong in practice given the drift evidence — five of eleven files carried a `status:` field, four of those five with values outside the schema enum. Removing the parameter eliminates the mismatch instead of pretending a partially-honored filter is functional.

### 7.2 Risk: durability of "this plan was implemented"

The frontmatter rewrite (`status: pending` → `status: implemented`) was a structurally durable signal. After this change, "this plan was implemented" is recoverable only via `git log --grep "meditate: consume"` — exactly as ADR-0002 made the same trade-off for declined illuminations.

**Accepted because:** the structurally-durable signal was demonstrably not maintained (drift). A signal that drifts is worse than no signal — it lies. ADR-0002 set the precedent: "The decline reason is durable only in `git log`. Searching past declines requires `git log --grep="declined"`. No ls-able directory of past judgments." The plan side adopts the same trade-off. The implement-loop's own commit, the plan-writer's commit, the design-writer's commit, the verifier-flow commits, and the new `meditate: consume <plan> (implemented)` commit are all timestamped and discoverable.

### 7.3 Risk: re-running a successful pipeline emits `success: false`

The second call to `consume_plan(<already-deleted-plan>, "implemented")` returns `{ success: false, error: "Plan file not found" }`. That is structurally identical to the original symptom (a `success: false` line in the trace).

**Accepted because:** the trace meaning has changed. Under `mark_plan_implemented`, `success: false` meant "the rewrite path rejected the input" — which masked real bugs because every `done → done` re-run looked like every other rejection. Under `consume_plan`, `success: false` means exactly one thing: the file is not on disk. That is the correct semantics for a re-run, and the tail-node's existing best-effort softening (`pipelines/illumination-to-implementation/memory-writer.md:134-145`) treats it as a non-fatal log line. The semantic precision is the win even though the surface symbol (`success: false`) looks the same.

### 7.4 Risk: the strip-frontmatter step touches files outside the design's primary scope

Five plan files in `docs/superpowers/plans/` get a frontmatter line removed. That is a content edit to historical artifacts.

**Accepted because:** the alternative (leave the lines in place) leaves the corpus in a state where four of five `status:` values disagree with the schema's removed-but-historical enum. Stripping the lines normalizes the corpus to "no status field on any plan," matching the new write-path. The body of each plan file is untouched. ADR-0002's analogous paragraph explicitly stripped `status: open` from the one surviving illumination during rollout for the same reason.

### 7.5 Risk: ADR-0003 absence weakens the audit trail for this decision

ADR-0002 sits as the canonical lifecycle decision. A future reader looking at the plan side may not immediately find a sibling ADR explaining the parallel cleanup.

**Accepted with mitigation:** this design doc + the resulting implementation plan + the commit history form an audit trail at parity with the illumination side (which itself shipped without a sibling ADR for plans because plans were not yet in scope). ADR-0004's "no behavioral specs" principle covers the rationale at the abstract layer. If the implementation-plan reviewer flags this as insufficient, a one-paragraph ADR-0003 is a small addition to the chunked plan; the design does not require it up front.

## 8. Constraints

- All source-code edits, prompt edits, plan-file frontmatter strips, and test edits land together in a single coherent series of commits (one per chunk in the implementation plan). Splitting strip-frontmatter from the source-code change leaves the corpus and the schema inconsistent for the duration of the gap.
- `npx tsc --noEmit` must pass after the change. The deleted export (`markPlanImplemented`) and removed schema field (`status` on `list_plans`) must have zero remaining importers; type-check confirms.
- `npx vitest run` must pass. The deleted describe block and the new `consumePlan` describe block ship together — the test count moves but stays green.
- `npm run build` must succeed. The MCP server bundles cleanly under `tsup`; no new entry, no removed entry that other entries depend on.
- The new `consume_plan` MCP tool registration mirrors the existing `consume` registration's docstring conventions verbatim. Future readers comparing the two should see two near-identical blocks differing only in target directory and not-found error string.
- `git log --grep "meditate: consume"` after the change continues to surface every consumed artifact (illuminations and plans share the prefix). This is the audit-trail mechanism the design relies on per §7.2.

## 9. Open questions

1. **ADR-0003 sibling.** Refinement bullet 6 deferred this to design-writer / plan-writer judgment. This design's position: not required, see §7.5. The implementation-plan reviewer may overrule; a one-paragraph ADR is a small addition.
2. **Renaming `consume` to `consume_illumination` for parity.** Considered: a future reader sees `consume` (which targets illuminations only) and `consume_plan` (which targets plans) and may not immediately grasp the asymmetry in the unprefixed name. Rejected for this design — `consume` is shipped, has zero in-repo divergence, and renaming it touches every test and pipeline that already calls it. If the asymmetry rankles, a follow-up illumination is the right surface, not this design.
3. **`list_plans` output shape.** Currently returns `<filename> — <H1 title>` per line. Out of scope for this design, but the implementation plan may want to confirm this shape continues to satisfy the only documented caller (the meditation `meditate` agent's plan-listing rubric).

## 10. Verification approach

### 10.1 Static checks

Run after each chunk lands:

- `grep -rn '^status:' docs/superpowers/plans/ | head` — expected: zero hits at line 2 of any plan file. Confirms the strip ran on all five files.
- `grep -rn 'mark_plan_implemented\|markPlanImplemented' src/ pipelines/ docs/` — expected: zero hits in `src/`, `pipelines/`, and `docs/superpowers/specs/`. Hits in `meditations/` and `memory/` are historical (illumination + memory notes); they are not load-bearing. Hits inside `docs/superpowers/plans/2026-04-30-consume-only-illumination-lifecycle.md` and `docs/adr/0002-consume-only-illumination-lifecycle.md` are also historical references (the plan/ADR that documented the prior tool surface) and are acceptable.
- `grep -rn 'consume_plan\|consumePlan' src/ pipelines/` — expected: hits in `src/cli/mcp/illumination-server.ts`, `src/cli/tests/*`, `pipelines/illumination-to-implementation/memory-writer.md`. No other surfaces.
- `npx tsc --noEmit` — clean.

### 10.2 Tests

- `npx vitest run src/cli/tests/illumination-server.test.ts` — `markPlanImplemented` describe block deleted; `consumePlan` describe block green; existing `consume` describe block unchanged.
- `npx vitest run src/cli/tests/meditate.test.ts src/cli/tests/janitor-agent.test.ts` — tool-whitelist assertions pass with the new tool name.
- `npx vitest run` — full suite green; the test count adjusts (markPlanImplemented cases out, consumePlan cases in).

### 10.3 Smoke

- `pipelines/smoke/*.dot` — no smoke pipeline invokes `mark_plan_implemented` or `consume_plan` directly (verified via grep). The MCP tool surface change is invisible to smoke runs.
- `ralph pipeline run pipelines/illumination-to-implementation/pipeline.dot --illumination <fresh>` end-to-end: the tail-node logs a single `consume_plan` call with `success: true` on first run; a hypothetical replay would log `success: false, error: "Plan file not found"` and continue per the existing soften-and-log path.

## 11. Summary

The illumination's stated symptom — `mark_plan_implemented` rejecting `done → done` re-runs — was the visible tip of a structural drift: five of eleven plan files carry a `status:` frontmatter line, four of which hold values (`done`, `complete`) outside the schema's `pending|implemented` enum. Patching idempotency leaves the drift in place; this design deletes the field entirely. `markPlanImplemented` and the `list_plans` status filter come out; `consume_plan` goes in as a near-copy of the shipped illumination `consume` (`git rm` + commit, no frontmatter rewrite). Six of eleven existing plan files already carry no `status:` field; the other five are stripped to match. The tail-node prompt swaps one MCP tool name for the other and keeps its existing best-effort softening unchanged. ADR-0002 set the precedent for illuminations on 2026-04-30; this is the parallel cleanup for plans, eliminating the failure class instead of patching it.
