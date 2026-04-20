# Source-Location Diagnostics — Smoke Verification

**Date:** 2026-04-20  
**Feature:** Source-location diagnostics (v0.1.31) — `file:line:col` + code-frame carets on `ralph pipeline validate`  
**Commits verified:** `ea2d266`, `9a25aa1`, `e75d58f`, `fabf379`, `3193b76`  
**Build:** `npm run build` → `dist/cli/index.js` 173.53 KB (tsup ESM, ⚡ Build success in 56ms)

---

## Task 6.1 — Validate-clean matrix (14 smoke dots)

All 14 dots produced `Pipeline valid` → exit 0 → `OK`.  
Two dots emitted pre-existing warnings (not regressions):
- `agent-json-vars.dot` — `[variable_coverage]` on `consumer` node (known, pre-existing)
- `tmux-tester.dot` — `[portability_heuristic]` on `tmux_meditate_observer` node (known, pre-existing)

Matrix output saved to: `~/.ralph/harness/validate-matrix-20260420T170952.txt`

| Dot file | Result | Notes |
|---|---|---|
| agent-implement.dot | OK | ✔ Pipeline valid (3 nodes, 2 edges) |
| agent-json-vars.dot | OK | ✔ Pipeline valid (4 nodes, 3 edges); 2 pre-existing `variable_coverage` warnings |
| chat-end-to-end.dot | OK | ✔ Pipeline valid (5 nodes, 5 edges) |
| chat-only.dot | OK | ✔ Pipeline valid (3 nodes, 2 edges) |
| conditional.dot | OK | ✔ Pipeline valid (6 nodes, 6 edges) |
| gate.dot | OK | ✔ Pipeline valid (5 nodes, 5 edges) |
| json-schema-stream.dot | OK | ✔ Pipeline valid (3 nodes, 2 edges) |
| meditate-steer.dot | OK | ✔ Pipeline valid (3 nodes, 2 edges) |
| missing-caller-var.dot | OK | ✔ Pipeline valid (3 nodes, 2 edges) |
| static-multi-node.dot | OK | ✔ Pipeline valid (5 nodes, 4 edges) |
| store.dot | OK | ✔ Pipeline valid (5 nodes, 4 edges) |
| tmux-tester.dot | OK | ✔ Pipeline valid (4 nodes, 3 edges); 1 pre-existing `portability_heuristic` warning |
| tool-runtime-vars.dot | OK | ✔ Pipeline valid (4 nodes, 3 edges) |
| tool.dot | OK | ✔ Pipeline valid (3 nodes, 2 edges) |

### Back-compat check (`sourceLine` field)

```
OK sourceLine=4 matches sourceLocation.line
```

The `@deprecated` `sourceLine` field on `Node` is preserved and equals `sourceLocation.line`. Guard passes.

---

## Task 6.2 — Validate-schema-error fixture (multi-line-attr regression guard)

**Result: PASS**

Fixture: copy of `pipelines/smoke/tool.dot` with two lines injected after `tool_command=`:
```dot
    label="first\nsecond\nthird",
    bad_key="oops"
```
`bad_key` at source line 13. Multi-line `label=` value must not shift subsequent line numbers.

**Captured output:**
```
✖ ../../../../../tmp/ralph-smoke-bad.wVJhe7.dot:13:5 [schema_error] [run_echo]:
 unrecognized key 'bad_key'
  Allowed keys for kind=tool:
    id                    Node identifier (unique within the graph). (required)
    shape                 Graphviz shape; drives node-kind classification.
    label                 Human-readable node label shown in the TUI.
    ...
    11 |     tool_command="echo 'tool-node: ok'",
    12 |     label="first\nsecond\nthird",
  › 13 |     bad_key="oops"
       |     ^^^^^^^^^^^^^^
    14 |   ]
```

**Assertions checked:**
- `$FIXTURE:13:5` — PASS (correct source line, multi-line collapse did not shift position)
- `[schema_error]` — PASS
- `unrecognized key 'bad_key'` — PASS (snake_case vocabulary)
- `Allowed keys for kind=tool:` — PASS
- `^` caret under `bad_key` token — PASS (`^^^^^^^^^^^^^^`)

---

## Task 6.3 — Validate-syntax-error fixture

**Result: PASS**

Fixture: copy of `tool.dot` with closing `]` of `run_echo` node attr block deleted (line 12 removed).

**Captured output:**
```
✖ ../../../../../tmp/ralph-smoke-syntax.dot:13:8 [syntax] Expected "=" but "[" found.
    11 |     tool_command="echo 'tool-node: ok'"
    12 |
  › 13 |   done [shape=Msquare]
       |        ^
    14 |
    15 |   start -> run_echo -> done
```

**Assertions checked:**
- Exit code = 1 — PASS
- `[syntax]` rule — PASS
- `$FIXTURE:13:8` file:line:col — PASS
- No `node_modules/@ts-graphviz` stack trace leak — PASS (output is clean)
- `^` caret — PASS

---

## Task 6.4 — Runtime smoke via tmux-drive harness

Three agent-free dots run via tmux harness (`start_run` / `wait_stable 60000` / `capture` / `assert_smoke_success` / `cleanup_run`). Harness helpers sourced from `docs/harness/tmux-drive.md`.

Note: Pipelines complete in <200ms; the Ink TUI renders and exits before `tmux capture-pane` captures it. The `assert_smoke_success` assertion uses the pipeline JSONL tracer record as authoritative evidence — `pipeline-end` event with `outcome: success`.

| Dot | Result | Run JSONL | pipeline-end outcome |
|---|---|---|---|
| tool.dot | PASS | `~/.ralph/runs/d79f58f6/pipeline.jsonl` | success |
| tool-runtime-vars.dot | PASS | `~/.ralph/runs/7524c0a7/pipeline.jsonl` | success |
| store.dot | PASS | `~/.ralph/runs/d22ea984/pipeline.jsonl` | success |

**tool-runtime-vars.dot** ran 2 tool nodes (`seed` → `delete_file`), exercising `$tool.output` propagation through attribute-heavy nodes post-parser-change. Both nodes: `✓ success`.

**store.dot** ran 3 nodes (`generate` → `save` → `verify`), exercising the `store` handler kind. All nodes: `✓ success`.

---

## Summary

- **14/14 smoke dots validate clean** — zero regressions from source-location diagnostics changes
- **Schema-error fixture** — multi-line attr collapse does not corrupt subsequent line numbers (spec §10 risk resolved)
- **Syntax-error fixture** — clean `[syntax]` diagnostic with file:line:col + caret, no stack leak
- **3/3 runtime smokes pass** — parser field additions (`sourceLine`, `sourceLocation`, `attrLocations`) do not break graph execution
- **Back-compat `sourceLine` field** — `@deprecated` alias preserved, equals `sourceLocation.line`
