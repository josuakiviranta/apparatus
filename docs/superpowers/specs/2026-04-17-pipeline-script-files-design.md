---
date: 2026-04-17
status: proposed
owner: josu
driven_by:
  - "Silent success of `mark_dispatched` during illumination-to-implementation run 880388e1"
  - "Failure of refine-agent's inline `node -e '…'` tool_command (triple-quote collision broke DOT tokenization)"
---

# Pipeline Script Files — Design

## Problem

Tool nodes in `.dot` pipelines (`type="tool"`) today carry their shell logic inline inside a single `tool_command=` attribute value. The value is a shell string passed to `sh -c` (`src/attractor/handlers/tool.ts:12`). For simple invocations (`rm $file`, `git push`) this is fine. For anything non-trivial it fails in three ways:

1. **Quoting collapses.** DOT attribute delimiters are `"…"`. Shell single-quotes delimit `node -e '…'`. JS/Python string literals need quotes. Authors escape inner `"` as `\"` and inner `\n` as `\\n`; the hand-written regex parser in `src/attractor/core/graph.ts:39-51` doesn't always survive the escape soup. Today's `illumination-to-implementation.dot` ships `mark_dispatched` with an inline Node one-liner that the validator rejects as `edge_target_exists: Edge target "mark_dispatched" not declared` — the node *is* declared, but the parser gives up mid-attribute.
2. **No reviewability or tests.** A 500-char single-line quoted blob cannot be unit-tested or diff-reviewed sensibly. The logic lives in a file type whose tooling (editors, linters, formatters) offers nothing for it.
3. **Structured output is not a first-class option.** Agent nodes have `produces=` + `json_schema_file=` (`src/attractor/handlers/agent-handler.ts:208-235`) so their output populates context automatically. Tool nodes only emit `tool.output: <stdout>` (`src/attractor/handlers/tool.ts:18,21`). When a tool node needs to feed a typed value downstream, the pipeline author has no clean path.

Separately, `mark_dispatched` demonstrated a fourth problem: the node was written as `agent="implement"` calling an MCP server that isn't registered in the spawned Claude session. The agent returned `{"error":"tool_unavailable",…}` but `agent.success=true`, so the pipeline treated the illumination as dispatched when it hadn't been. That failure is the single sharpest motivator — a proper tool-node escape hatch with real exit codes removes the class of bug entirely.

## Goals

- Give pipeline authors a typed, reviewable, testable way to express tool-node side effects longer than a single shell command.
- Keep the `.dot` file legible: attribute values stay under ~120 chars.
- Make failure detection unambiguous: non-zero exit → node fail, no silent success.
- Give tool nodes feature parity with agent nodes for structured output capture.
- Steer every future `pipeline create` / `pipeline refine` session toward the new pattern automatically.
- Zero breaking change to existing `tool_command=` nodes.

## Non-goals

- Replacing `tool_command=` — it stays supported for simple commands.
- Adding execution-timeout handling (separate concern; tool.ts has none today, this spec doesn't introduce one).
- Auto-migrating existing pipelines — the audit is manual, one-time.
- Scripting runtime sandboxing.
- Per-rule severity config — severity stays hardcoded per emission site, matching current convention.

## Architecture

Three additions, all strictly additive:

1. **Directory convention.** `pipelines/scripts/<name>.<ext>` — parallel to existing `pipelines/schemas/<name>.json`. Script names kebab-case, typically matching the node ID that calls them.
2. **Three new DOT attributes** on tool nodes: `script_file=`, `script_args=`, `produces_from_stdout=`. The DOT parser forwards unknown attributes verbatim (`src/attractor/core/graph.ts:48`), so registering them needs no parser change — only handler updates.
3. **Two new validator rules** + an authoring-prompt guidance block so the pattern propagates to every new pipeline.

### Data flow

```
pipeline.dot                         engine                                             script file
──────────────────                   ──────────────────                                 ──────────────
script_file="scripts/x.mjs"    ──▶   resolve relative to dotDir         ─────▶          (reads argv)
script_args="$foo $bar.baz"    ──▶   expandVariables(args, context)     ─────▶          (runs)
                                     spawnSync("sh", ["-c", cmd])                        (writes stdout
produces_from_stdout=true      ◀──   parse last line of stdout as JSON  ◀─────           + exits 0/≠0)
                                     merge into contextUpdates
```

Control flow: engine → tool handler → spawned process → tool handler captures exit/stdout → tool handler reports `Outcome` to engine → engine merges `contextUpdates` into main context (`src/attractor/core/engine.ts:262-264`).

## Components

### Attribute: `script_file=`

**Value:** relative path from the `.dot` file's directory.

**Semantics:** resolves identically to `json_schema_file=` today (see `src/attractor/handlers/agent-handler.ts:105` which uses `resolve(dotDir, jsonSchemaFile)`). `dotDir` is already available to handlers via `meta.dotDir`; the validator must be taught to receive it (see §Validator changes).

**Interpreter dispatch** is decided by file extension:

| Extension | Interpreter invocation |
|-----------|------------------------|
| `.mjs`, `.js`, `.cjs` | `node <path> <args>` |
| `.ts`, `.mts` | `node --import tsx <path> <args>` *(only if `tsx` resolvable — else error)* |
| `.sh`, `.bash` | `bash <path> <args>` |
| `.py` | `python3 <path> <args>` |
| other | error: `unsupported_script_extension` |

The tool handler constructs the final shell string, still passes it to `spawnSync("sh", ["-c", cmd])`. This keeps the shell path unchanged so env, cwd, and spawn semantics are identical to today's `tool_command`.

**Exclusivity.** `script_file=` and `tool_command=` are mutually exclusive. If both are present: validator error `script_command_conflict`. If neither: existing error (today `type_unsupported`).

### Attribute: `script_args=`

**Value:** a single string. Variables expanded via the existing helper at `src/attractor/transforms/variable-expansion.ts:15-32` before being appended to the interpreter invocation.

**Tokenization:** after variable expansion the value is passed to `sh -c` as part of the command string, so shell word-splitting rules apply — the same behavior as today's `tool_command`. Authors who need to preserve literal spaces inside an argument wrap that arg in single quotes within the attribute value. Matches what `tool_command=` already does; nothing new to learn.

**Undeclared variables** surface through the existing `variable_coverage` warning (memory `2026-04-16-preflight-variable-check.md`). No change needed — the check runs on the concatenated text, which includes `script_args`.

### Attribute: `produces_from_stdout=true`

**Semantics:** when present (and only when present), the tool handler attempts to parse the **last non-empty line** of the process's stdout as JSON. If parsing succeeds, the top-level keys are flattened into `contextUpdates` using the node ID as prefix (matching the convention agent-handler uses — `src/attractor/handlers/agent-handler.ts:208-235`). If parsing fails: warning logged, context unchanged, but the node's exit code still governs success/failure.

**Why last line, not all stdout.** Scripts commonly log human-readable progress to stdout. Reserving the last line for JSON output lets them do both without needing a separate stderr channel. This matches informal Unix tradition (`jq --compact-output | tail -1`).

**Compatibility.** `tool.output: <stdout>` is still populated — existing consumers don't break. The new behavior is opt-in per node.

**Produces declaration.** A node using `produces_from_stdout=true` may also declare `produces="foo, bar"` (existing attribute). If declared, the validator checks that every name appears as a key in a sample-run stdout — same mechanism as `json_schema_file` validation for agents, just against a user-supplied JSON example rather than a schema. Optional: if this adds too much scope, drop it for v1 and declare `produces=` as documentation-only until v2.

### Validator changes

File: `src/attractor/core/graph.ts`, inside `validateGraph()` near the existing `portability_heuristic` pass (~line 280).

**Signature change:** `validateGraph(graph)` → `validateGraph(graph, dotDir?)`. The `dotDir` is optional for backward compat with existing callers, required for the new rules. `pipelineValidateCommand` already knows `dirname(absPath)` of the parsed file and can pass it.

**New rules**, both scoped to nodes with `resolveHandlerType(node) === "tool"`:

| Rule ID | Severity | Check |
|---------|----------|-------|
| `inline_script_smell` | warning | `toolCommand` matches any of: `/\bnode\s+-e\b/`, `/\bpython3?\s+-c\b/`, `/\bbash\s+-c\b/`, `/<<\s*['"]?[A-Z]/` (heredoc), or length >120 after variable expansion. Message: `"Inline script in tool_command= is fragile under DOT quoting. Move to pipelines/scripts/<name>.<ext> and use script_file=."` |
| `script_file_exists` | error | `scriptFile` is set AND `dotDir` is known AND `resolve(dotDir, scriptFile)` doesn't exist. Message: `"script_file= references a path that doesn't exist: <resolved>"` |
| `script_command_conflict` | error | Both `scriptFile` and `toolCommand` are set. Message: `"script_file= and tool_command= are mutually exclusive."` |
| `unsupported_script_extension` | error | `scriptFile` has an extension not in the interpreter table. Message: `"Unsupported script extension: <ext>. Supported: .mjs, .js, .cjs, .ts, .mts, .sh, .bash, .py."` |

CLI exit stays non-zero only on errors (existing behavior — `src/cli/commands/pipeline.ts:pipelineValidateCommand`). The smell warning prints but doesn't block, in line with `portability_heuristic`.

### Handler changes

File: `src/attractor/handlers/tool.ts` (currently 23 lines).

Branching:

```typescript
if (node.scriptFile) {
  const cmd = buildInterpreterCommand(node, meta, context);
  const result = spawnSync("sh", ["-c", cmd], { encoding: "utf8" });
  return mapResult(node, result);
} else if (node.toolCommand) {
  // existing path, unchanged
}
```

`buildInterpreterCommand` does: resolve path from `meta.dotDir`, pick interpreter from extension, expand `script_args` via the shared helper, concatenate. Returns a shell string.

`mapResult` extends today's `{status, contextUpdates: {"tool.output": stdout}}` with optional stdout-JSON parse when `producesFromStdout` is set. Existing output still emitted regardless.

### Authoring prompt changes

File: `src/cli/prompts/PROMPT_pipeline_create.md`.

Insert new section between "Portability rule" (line 89) and "Edge attributes" (line 91):

```markdown
## Tool-node side effects

If a tool node needs shell logic beyond a single command with trivial arguments,
externalise it:

1. Write the script to `pipelines/scripts/<node-id>.<ext>` using `.mjs`, `.sh`,
   or `.py`.
2. Reference it from the node:

   ```dot
   my_node [type="tool",
            script_file="scripts/<node-id>.mjs",
            script_args="$foo $bar"]
   ```

3. (Optional) emit a single JSON line as the **last** line of stdout and add
   `produces_from_stdout=true` + `produces="key1, key2"` — the engine will
   flatten those keys into the pipeline context.

Do **not** inline `node -e '…'`, `python -c '…'`, `bash -c "…"`, or heredocs
inside `tool_command=` — DOT's quoting cannot hold them safely, and the
validator will warn (`inline_script_smell`). Scripts receive their arguments
positionally (`process.argv` / `$1 $2`) and signal failure with a non-zero
exit code. Non-zero exit fails the node and halts the pipeline (or triggers
`max_retries` if set).
```

This section is pulled in by `composeCreatePrompt(project)` (`src/cli/lib/pipeline-create-prompt.ts:27`) for both `ralph pipeline create` and `ralph pipeline refine` (confirmed: both call the same helper — `src/cli/commands/pipeline.ts:612,677`). Refine's preservation clause at `src/cli/commands/pipeline.ts:700` applies to node IDs and edge labels, not to attribute values, so the new rule doesn't contradict it.

No snapshot tests to update — the existing prompt test file (`src/cli/tests/pipeline-create-prompt.test.ts`) uses `toContain` assertions on anchor phrases, not full-text snapshots.

### README + harness docs

- `README.md` — one-paragraph addition under the pipeline section noting `pipelines/scripts/` and `script_file=`.
- `specs/architecture.md` / `specs/commands.md` — one-line reference each if those files describe the .dot attribute surface. Not checked in design phase; plan will inspect.

## Constraints & trade-offs

- **Extra file-system lookup.** Every tool node with `script_file=` forces the validator to `stat()` a path. Negligible at pipeline-validate scale (single digits of nodes per pipeline).
- **Interpreter lock-in.** Supporting only the interpreter table above means exotic runtimes (deno, bun, ruby) aren't first-class. Can be extended later without breaking change; for v1 the table covers every script the current repo needs.
- **No Windows consideration.** `spawnSync("sh", ["-c", cmd])` already assumes POSIX; this design inherits that assumption. Matches existing project posture.
- **`tool.output` duplication.** When `produces_from_stdout=true`, the raw stdout is still emitted as `tool.output`. Slight redundancy but avoids breaking existing consumers that read `tool.output`.
- **Migration cost.** Only one pipeline (`illumination-to-implementation.dot`) currently contains inline-script smell after the failed refine run. Low.

## Alternatives considered

1. **Just add a new ralph CLI subcommand per side effect** (`ralph illumination mark-dispatched`). Cleaner architecturally but costs a new command surface per node type, new tests, new README entries. Rejected: scope creep.
2. **Keep `tool_command=` but add a heredoc-safe encoding.** Any scheme we invent is yet another quoting convention authors and agents must learn. Rejected: moves the complexity rather than removing it.
3. **Allow inline scripts via a dedicated `inline_script=` attribute + base64 encoding.** Solves the quoting problem but keeps the unreviewability problem. Rejected.

## Rollout plan

Staged to minimise risk:

1. Land the engine attribute parsing + handler dispatch. Existing pipelines unaffected because they don't set `script_file=`.
2. Land the validator rules as warnings (including `script_file_exists` as warning initially). Observe any surprises in CI.
3. Migrate `illumination-to-implementation.dot`'s `mark_dispatched` as the first real consumer. Land + scenario-smoke.
4. Promote `script_file_exists` / `script_command_conflict` / `unsupported_script_extension` to errors in a follow-up commit once no false positives have surfaced.
5. Update `README.md` + authoring prompt.

## Open questions

- **Do we gate the `.ts` path behind `tsx` availability at validate time?** Leaning yes — error out during validate if `.ts` is used but `tsx` isn't in the project's deps. Prevents runtime surprise.
- **Should the stdout JSON capture also read stderr?** Today: no; scripts that emit their JSON to stdout only. Reviewable post-v1.
- **Do we pass `dotDir` or full `meta` to validators?** Implementation detail; plan will resolve by inspecting other handler signatures.

## Verification evidence

All design decisions grounded in read-only verification performed 2026-04-17 against commit `be53a97`:

- Unknown attributes stored silently by parser: `src/attractor/core/graph.ts:39-51`, `toCamel()` at line 4.
- Tool handler: `src/attractor/handlers/tool.ts:1-23` — `spawnSync("sh", ["-c", command])`, exit-code mapping at lines 14-21, stdout capture at line 13.
- Variable expansion helper reusable: `src/attractor/transforms/variable-expansion.ts:15-32`.
- Validator returns `Diagnostic[]`, severity hardcoded per emission: `src/attractor/types.ts:80-84`, `src/attractor/core/graph.ts:200+`.
- `json_schema_file` path resolution precedent: `src/attractor/handlers/agent-handler.ts:105` — `resolve(dotDir, jsonSchemaFile)`.
- Shared authoring prompt: `src/cli/lib/pipeline-create-prompt.ts:27`, consumed by both create (`src/cli/commands/pipeline.ts:612`) and refine (`src/cli/commands/pipeline.ts:677`).
- Refine preservation clause: `src/cli/commands/pipeline.ts:700`.
- No snapshot tests on prompt: `src/cli/tests/pipeline-create-prompt.test.ts`.

---

Review checkpoint: read this doc, flag any decision you want reconsidered, or approve to move to Phase 2 (implementation plan).
