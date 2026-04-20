# Fenced Code-Block Variable-Skip Design

**Date:** 2026-04-19
**Status:** Approved
**Source:** conversation session 2026-04-19 following `tmux_tester` runtime failure `Undefined variable $HOME` on `ralph pipeline run pipelines/illumination-to-implementation.dot` (validator reported `✔ Pipeline valid`).

## Overview

`ralph pipeline validate` reports `Pipeline valid (22 nodes, 30 edges)` for a graph that fails at runtime with `Undefined variable $HOME` inside the `tmux_tester` agent node. The failure originates not in the `.dot` file but in `src/cli/agents/tmux-tester.md:39`, inside a fenced bash example:

````markdown
```bash
RUN_DIR="$HOME/.ralph/harness/$RUN_ID"
```
````

That markdown body is loaded at runtime by `src/attractor/handlers/agent-handler.ts:62` and piped through `expandVariables` (`src/attractor/transforms/variable-expansion.ts:20`), which treats every `$identifier` as a pipeline variable. `$HOME`/`$RUN_ID` are intended for the *shell* the LLM later runs — not for pipeline substitution. The validator, which stops at `.dot` node attributes, never scans agent `.md` bodies and therefore never warns.

The fix has two halves:

1. **Runtime:** `expandVariables` skips content between triple-backtick fences. Text inside ` ``` ` blocks is passed through verbatim so `$HOME`, `$RUN_DIR`, `$SESSION`, `$WIN`, and other shell constructs reach the LLM intact. Inline single-backtick spans (e.g. `` `$run_id` ``) continue to expand — they are an authoring convenience in prose, not a shell-code signal.
2. **Validator:** `scanUndeclaredCallerVars` loads agent `.md` bodies for every `agent="X"` node (when the node has neither a `prompt=` nor a `label=` attr, so the body is actually what runtime uses). It resolves the agent path via the same loader agents use at runtime, strips the YAML frontmatter, strips triple-backtick fences, then scans the remainder for `$var` references. Unknown refs surface as a new `[unresolved_var_in_agent_prompt]` diagnostic with `file:line`.

One existing ref breaks under the new rule: `src/cli/agents/tmux-tester.md:37` uses `WIN="test-$run_id"` inside a fenced bash block, where `$run_id` is a real pipeline variable. The migration is self-contained in `tmux-tester.md` — we replace the hard-coded `$run_id` with a `tmux list-windows` discovery command, removing the need for pipeline-time substitution inside the fence. No upstream `launch_tmux` edits, no tmux environment plumbing.

No engine changes outside `variable-expansion.ts`. No schema changes. Net surface: two functions extended, one helper added, one agent prompt migrated, one validator diagnostic added.

## What This Fixes

### Primary: validate-run divergence on agent prompts

Today `ralph pipeline validate` has zero visibility into agent `.md` bodies. Every undefined `$var` inside an agent prompt is a runtime-only failure. This ships the first validator check that reads those bodies. The `tmux_tester $HOME` case is the prompting incident; the class of bug is "any typoed or unpassed variable the author writes into an agent prompt."

### Secondary: stop expanding shell `$` inside bash examples

`expandVariables` currently interprets any `$identifier` it sees. Agent markdown is chock-full of shell snippets that use `$HOME`, `$RUN_DIR`, `$1`, `$(cmd)`, etc. Today the runtime throws on the first shell-var it sees. Skipping fenced content makes shell-in-markdown authoritative and removes a whole class of accidental collisions (e.g. a future pipeline passing a `$PATH` variable would have silently overwritten shell `PATH` references).

## What This Does NOT Do

- **No new CLI flag.** Validator behavior is unconditional. Authors who previously relied on a pipeline var expanding *inside a triple-backtick fence* will see a breaking-change diagnostic; one such case exists today (`tmux-tester.md:37`) and is migrated in this spec.
- **No escape syntax.** We do not introduce `\$foo` or `${{foo}}`. The triple-backtick fence itself is the only escape. Inline single-backtick spans do NOT escape — they expand like the rest of the prose.
- **No runtime lookup of `process.env`.** Considered and rejected. It masks typos and diverges from shell semantics.
- **No change to `.dot` node attributes.** `STRING_ATTRS = ["prompt", "toolCommand", "label", "scriptArgs", "cwd"]` continues to be scanned verbatim. Fences are a markdown concept; they are not part of DOT attribute values in any existing pipeline.
- **No fenced-block awareness in script files.** `pipelines/scripts/*.mjs` are not scanned for `$var`; they are arbitrary code.
- **No retroactive migration of archived agent prompts.** Only files currently referenced by an in-tree pipeline are covered.
- **No edit to `launch_tmux`'s `tool_command`.** An earlier draft routed `run_id` through tmux `set-environment`; discarded because `tmux new-window` env inheritance depends on session-level `update-environment` config and is not guaranteed portable. The migration keeps all changes inside `tmux-tester.md`.

## Architecture

### 1. Runtime: `expandVariables` fence-skipping

`src/attractor/transforms/variable-expansion.ts:15-32` (`expandVariables`) currently does a single `String.prototype.replace` with `/\$([a-zA-Z_]\w*(?:\.\w+)*)/g`. Replace with a two-pass walk: split the string on triple-backtick fenced regions, expand only outside them, re-join.

**Fence-detection rule** (one helper, `splitFences`):

```ts
// Returns segments alternating { fenced: false, text } / { fenced: true, text }.
// Opening fence: /^```[^\n]*\n/ at a line boundary (any language tag allowed).
// Closing fence: /^```\s*$/ at a line boundary.
// Unclosed fence: EOF reached without a closer ⇒ remainder is treated as fenced
// (matches CommonMark "unclosed code block" semantics, keeps $var literal rather
// than throwing a different error).
// Inline single-backtick spans are NOT treated as fences — they continue to expand.
export function splitFences(s: string): Array<{ fenced: boolean; text: string }>;
```

`expandVariables` then:

```ts
export function expandVariables(s, ctx, defaults?) {
  return splitFences(s)
    .map(seg => seg.fenced ? seg.text : expandSegment(seg.text, ctx, defaults))
    .join("");
}
```

`expandSegment` is the current body of `expandVariables` verbatim (the `$goal`/`$project` skip and the throw-on-undefined remain untouched).

The `variableExpansionTransform` graph-level function (`variable-expansion.ts:58`) already calls `expandVariables`; no change needed there — it inherits the new semantics.

### 2. Validator: scan agent `.md` bodies

`scanUndeclaredCallerVars` (`variable-expansion.ts:128-153`) today scans only `STRING_ATTRS` on in-memory nodes. Extend it to also scan agent prompt bodies.

**Resolution order for each `agent="X"` node** (only when **neither `node.prompt` nor `node.label`** is set — if either is, the body is never used at runtime per `agent-handler.ts:62` `const rawPrompt = node.prompt ?? node.label ?? config.prompt;`):

1. Project-local override: `join(projectDir, ".ralph/agents", \`${agentName}.md\`)`.
2. Bundled fallback: `getBundledAgentsDir()` from `src/cli/lib/assets.ts` (the same helper `src/cli/lib/agent-registry.ts:12` uses). Path: `join(getBundledAgentsDir(), \`${agentName}.md\`)`.
3. If neither exists: skip silently. The runtime will emit its own error later; the validator is diagnostic, not load-bearing for missing files.

**Processing:**

1. Read the file.
2. Reuse `parseFrontmatter` from `src/cli/lib/frontmatter.ts` to split `{ data, body }`. Scan `body` only — never the YAML.
3. Apply `splitFences` and scan only the non-fenced segments with the same `VAR_RE` regex that `collectVarRefs` uses.
4. Any ref not in `RESERVED`, not produced by any node in the graph, and not in the caller-supplied initial context becomes a new `missing` entry carrying its source location.

**New diagnostic shape.** `scanUndeclaredCallerVars` today returns `{ missing: string[], declared: string[], undeclared: string[] }`. Extend `missing` entries to a discriminated shape:

```ts
type MissingRef = { name: string; source?: { file: string; line: number; agentName: string; nodeId: string } };
```

DOT-attribute refs stay as `{ name }` with no `source` (no file path exists for in-memory attrs). Agent-body refs carry the source triple. Callers (`src/cli/commands/pipeline.ts:157`) adapt their render.

**Validator CLI output** (example):

```
✗ Pipeline invalid
  - unresolved_var_in_agent_prompt: $HOME
    src/cli/agents/tmux-tester.md:39
    (referenced in agent="tmux-tester" used by node tmux_tester)
```

`pipeline validate` already exits non-zero on validator errors (`src/cli/commands/pipeline.ts` exit path around the existing `validateExit`); this new diagnostic participates in that existing exit-code plumbing.

### 3. Migrate `src/cli/agents/tmux-tester.md`

The problem line is `tmux-tester.md:37` (inside the fence that opens on line 35):

````
```bash
SESSION=$(tmux display-message -p '#S')
WIN="test-$run_id"
RUN_ID="tmux-tester-$(date +%s)-$$"
RUN_DIR="$HOME/.ralph/harness/$RUN_ID"
CAPTURE_INDEX=0
mkdir -p "$RUN_DIR"
```
````

Under the new rule, `$run_id` on line 37 stops expanding. The clean fix replaces the hardcoded pipeline var with runtime discovery of the window:

````
```bash
SESSION=$(tmux display-message -p '#S')
WIN=$(tmux list-windows -t "$SESSION" -F '#W' | grep '^test-' | head -1)
RUN_ID="tmux-tester-$(date +%s)-$$"
RUN_DIR="$HOME/.ralph/harness/$RUN_ID"
CAPTURE_INDEX=0
mkdir -p "$RUN_DIR"
```
````

The upstream `launch_tmux` tool node (`pipelines/illumination-to-implementation.dot:41`) is the only thing creating windows named `test-*` in the current tmux session, so `grep '^test-' | head -1` uniquely identifies the target. If multiple `test-*` windows ever coexist (parallel pipeline runs into the same tmux session), the agent can later be extended with stricter matching; out of scope here.

Line 27's prose reference (`- Tmux window name: \`test-$run_id\``) stays unchanged — it is inline single-backtick, which the new rule continues to expand, so the agent still sees a concrete window name in prose for orientation.

### 4. Test surface

- `src/attractor/transforms/variable-expansion.test.ts`: add cases for
  - `splitFences`: no fence → single non-fenced seg; one `\`\`\`bash ... \`\`\`` block → alternating segs; unclosed opening fence → final seg marked fenced.
  - `expandVariables` fence behavior: fenced `$HOME` stays literal; prose `$foo` expands; inline single-backtick `` `$foo` `` still expands; undeclared `$foo` inside fence does NOT throw.
- `src/attractor/transforms/variable-expansion.test.ts` (same file): `scanUndeclaredCallerVars` extended-mode tests
  - Given a graph with an `agent="X"` node and a fake agent `.md` containing a fenced `$HOME` and an unfenced `$typo_var`, expect `missing` to contain `{name: "typo_var", source: {...}}` and NOT `HOME`.
  - Given a node with `prompt=` attr set, the agent `.md` body is NOT scanned (explicit override).
- Regression unit test: feed `expandVariables` a fixture derived from `tmux-tester.md`'s harness block; verify no throw, `$HOME` literal in output.
- `src/cli/commands/pipeline.test.ts` (or nearest existing suite for `pipeline validate` CLI): a tiny synthetic `.dot` + inline agent `.md` fixture reproducing the `$HOME` case; assert exit code ≠ 0 and stderr contains `unresolved_var_in_agent_prompt`.

## Backward Compatibility

Breaking: any pipeline currently relying on `$var` expansion *inside a triple-backtick fence* in an agent `.md` body. Audit (2026-04-19): one site, `src/cli/agents/tmux-tester.md:37` (`$run_id`), migrated in §3. No `.dot` files contain fences. No script files are affected. The smoke pipeline `pipelines/smoke/tmux-tester.dot` uses the same `tmux-tester` agent and benefits from the migration without further edits.

Post-merge run of `ralph pipeline validate pipelines/**/*.dot` and `ralph pipeline validate pipelines/smoke/*.dot` should show zero `unresolved_var_in_agent_prompt` diagnostics.
