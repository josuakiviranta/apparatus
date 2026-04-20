---
date: 2026-04-20
status: shipped
shipped_in: v0.1.31
shipped_sha: fabf379
supersedes: null
superseded_by: null
---

# Source-Location-Aware Validator Diagnostics — Design

## 1. Problem

`ralph pipeline validate` tells authors *which node* is wrong but not *where in the file*. Error output today:

```
✖ [schema_error] [mark_archived]: unrecognized key 'default_archive_reason_short'
  Allowed keys for kind=tool: type, cwd, tool_command, script_file, ...
```

The author knows the node id. They do not know:

1. Which `.dot` file the diagnostic came from (multiple pipelines may be validated in a batch).
2. Which line of that file to open.
3. Which attribute within the node triggered the error when the node has many attributes.
4. The column / extent of the offending token.

Malformed DOT is worse: `parseAST` from `@ts-graphviz/ast` throws a raw `SyntaxError` that the CLI does not catch or style, leaking internal stack frames.

## 2. Why now

v0.1.28 replaced the regex parser with `parseDotV2` (`src/attractor/core/graph-ast.ts`) backed by `@ts-graphviz/ast`. Every AST node — including `Attribute` and `Edge` — already carries a precise `location: { start: {line, column, offset}, end: {...} }`. We currently read only `node.location.start.line` → store as `Node.sourceLine`. The rest of the positional information is dropped on the floor.

The entire motivation for the v0.1.28 migration (IMPLEMENTATION_PLAN.md:15) was to unlock file:line diagnostics. Cashing in that work is the next logical step.

Adjacent pain: Bug 2 from the 2026-04-20 triage session (`default_archive_reason_short` rejected on a tool node) is a case where file:line would have immediately shown the author the fix location.

## 3. Goals

**In scope:**

- Every `Diagnostic` produced by `validateGraph`, `validateNode`, and the new DOT-syntax wrap path carries an optional `SourceLocation`.
- The `pipeline validate` CLI renders `<relpath>:<line>:<col>` before each diagnostic message and shows a code-frame with a caret under the offending token where possible.
- Syntax errors from `@ts-graphviz/ast` are caught and re-emitted as a `rule: "syntax"` diagnostic instead of leaking a stack trace.
- Per-attribute errors (e.g. unrecognized keys) point at the **specific attribute line**, not the node line.
- Edge-rule diagnostics (edge target missing, invalid condition) point at the **edge line**.

**Out of scope:**

- Reshaping runtime errors. `UndefinedVariableError` at execution time retains its current shape.
- Validating Graphviz's own attribute vocabulary (`shape=banana`). Ralph uses DOT as a carrier, not a rendering spec.
- Round-trip AST editing (`pipeline refine` doing surgical rewrites). Separate, larger project.
- Changing validator rule names, severity, or message bodies. This change is additive: new `location` field + CLI prefix.
- Changing how runtime handlers emit errors (no `sourceLocation` plumbing into tracer events).

## 4. Data model

Three new shapes live in `src/attractor/types.ts`:

```ts
export interface SourceLocation {
  /** 1-based line. */
  line: number;
  /** 1-based column. */
  column: number;
  /** Optional end for caret underline width. Both fields set together. */
  endLine?: number;
  endColumn?: number;
}

export interface Node {
  // …existing fields…
  /** @deprecated Use sourceLocation.line. Kept for back-compat with 0.1.28 consumers. */
  sourceLine?: number;
  sourceLocation?: SourceLocation;
  /** Per-attribute locations, keyed by camelCase attribute name. */
  attrLocations?: Record<string, SourceLocation>;
}

export interface Edge {
  // …existing fields…
  sourceLocation?: SourceLocation;
  attrLocations?: Record<string, SourceLocation>;
}

export interface Diagnostic {
  rule: string;
  severity: "error" | "warning";
  message: string;
  hint?: string;
  /** File:line pointer; absent when the rule is not tied to a specific location. */
  location?: SourceLocation;
}
```

**Key design choice:** `attrLocations` keys are **camelCase** (same as the attribute fields after `toCamel()`), not snake_case. Rationale: Node fields in memory are camelCase; error-rendering code already round-trips to snake_case via `camelToSnake` when printing. Keeping camelCase as the canonical key avoids a parallel vocabulary.

**Back-compat:** `sourceLine` is kept but marked `@deprecated` in the interface. It is still populated by `parseDotV2` for any external consumer, but internal validator code switches to `sourceLocation`. Remove in a later version.

**Schema strip:** `src/attractor/core/schemas.ts:137` already strips `sourceLine` before zod strict-parse so the parser-injected field doesn't violate `.strict()`. Extend the strip list to `sourceLocation` and `attrLocations`.

## 5. Parser changes

### 5.1 Per-attribute locations

`readAttrs` (`graph-ast.ts:16-25`) currently returns `AttrMap` only. Change the return type to:

```ts
interface ReadAttrsResult {
  attrs: AttrMap;
  locations: Record<string, SourceLocation>;
}
```

For every `Attribute` child, record:
- `line = child.location.start.line`
- `column = child.location.start.column`
- `endLine = child.location.end.line`
- `endColumn = child.location.end.column`

Callers merge locations with spread. Subgraph-scoped defaults (`nodeDefaults`, `edgeDefaults`) do **not** get locations — defaults apply to future nodes and the relevant location is the node's own declaration.

### 5.2 Node + edge locations

In the `Node` case (`graph-ast.ts:68-76`), set:

```ts
sourceLocation: {
  line: child.location.start.line,
  column: child.location.start.column,
  endLine: child.location.end.line,
  endColumn: child.location.end.column,
},
attrLocations,
```

Keep the legacy `sourceLine` field populated (same value as `sourceLocation.line`) for back-compat during this transition.

In the `Edge` case (`graph-ast.ts:78-85`), do the same. Edge locations are currently missing entirely — this is the larger uplift on the edge side.

### 5.3 Stylesheet application

`applyStylesheet` (`dot-common.ts`) copies fields onto nodes. It must **preserve** `sourceLocation` and `attrLocations` on the returned node — they are parser metadata, not stylesheet-configurable. Confirm via test that stylesheet-mutated nodes still carry their locations. Likely already works because `applyStylesheet` spreads the input node, but pin it in a test.

## 6. Syntax-error wrapping

New module `src/attractor/core/dot-syntax.ts`:

```ts
export class DotSyntaxError extends Error {
  readonly location: SourceLocation;
  constructor(message: string, location: SourceLocation) {
    super(message);
    this.name = "DotSyntaxError";
    this.location = location;
  }
}
```

In `parseDotV2`, wrap the `parseAST(normalized)` call:

```ts
let ast;
try { ast = parseAST(normalized); }
catch (e: any) {
  // @ts-graphviz/ast raises a PEG SyntaxError with .location = { start, end }
  if (e && e.location && typeof e.location.start?.line === "number") {
    throw new DotSyntaxError(
      e.message ?? "DOT syntax error",
      {
        line: e.location.start.line,
        column: e.location.start.column,
        endLine: e.location.end?.line,
        endColumn: e.location.end?.column,
      },
    );
  }
  throw e; // pass through anything we cannot classify
}
```

In `pipelineValidateCommand` (`src/cli/commands/pipeline.ts`), catch `DotSyntaxError` from `parseDot(src)` and emit a `rule: "syntax"` diagnostic through the same renderer path — then return 1.

## 7. Validator wiring

### 7.1 `validateNode` (schemas.ts)

Fill `diag.location` based on the zod issue kind:

- `issue.code === "unrecognized_keys"`:
  - Today emits **one** diagnostic listing all unknown keys.
  - Change: emit **one diagnostic per key** so each gets its own `location`. Why: each unknown key has its own attr-location; collapsing into one message forces picking a single line which may not match any of them. Keeping error count honest is fine — authors usually have one stray key.
  - `location = node.attrLocations?.[toCamel(snakeKey)] ?? node.sourceLocation`.
  - Preserve the existing hint (Allowed keys table) on each diagnostic — user feedback memory explicitly demands the hint.
- All other codes:
  - If `issue.path.length > 0`, attempt `node.attrLocations?.[issue.path[0]]`.
  - Fallback to `node.sourceLocation`.

### 7.2 `validateGraph` edge rules (graph.ts)

For each diagnostic whose source is an `Edge`, set `location = edge.sourceLocation`. Affected rules:

- `edge_target_exists`, `edge_source_exists` (graph.ts:125-127)
- `condition_syntax` (graph.ts:133)
- Anything else iterated from `edges` — audit during implementation.

### 7.3 `validateGraph` node rules

Node-level rules (`reachability`, `reaches_exit`, `start_no_incoming`, `exit_no_outgoing`, `variable_coverage`, `portability_heuristic`, `script_command_conflict`, `unsupported_script_extension`, `script_file_exists`, `inline_script_smell`, `type_known`, `type_unsupported`) set `location = node.sourceLocation`.

Cardinality rules (`start_node`, `terminal_node`) do not reference a single node — leave `location` absent.

## 8. CLI renderer

### 8.1 Code-frame module

New file `src/cli/lib/code-frame.ts`:

```ts
export function renderCodeFrame(
  source: string,
  loc: SourceLocation,
  opts: { context?: number; color?: boolean } = {},
): string;
```

Behaviour:

- Splits `source` into lines once per call (caller can memoize if needed).
- Prints `context` (default 2) lines before and after the offending line.
- Gutter shows line numbers right-padded. Offending line prefixed with `›` (or `>` if `color=false`).
- Below the offending line, emits a caret underline:
  - `column - 1` spaces, then `^` characters spanning `max(1, endColumn - column)` (clamped if end location missing → single `^`).
- No ANSI colors when `opts.color === false` (tests assert on plain text).
- When `loc` points past end-of-file (malformed trailing content), clamp to last line and emit a trailing `^`.

Pure function — no side effects, no file I/O. Unit-testable in isolation.

### 8.2 `pipelineValidateCommand` wiring

- After reading `src` and resolving `absPath`, compute `relPath = relative(process.cwd(), absPath)` for compact output.
- For each diagnostic, new output sequence:
  1. Header line: `<sev-glyph> <relPath>:<line>:<col> [<rule>] <message>`. Omit `:<line>:<col>` when `location` absent.
  2. Hint (indented, unchanged).
  3. Code frame (indented two spaces), only when `location` is present and `isTTY` stdout OR `RALPH_NO_FRAME` env not set (env flag for bots).

- Syntax-error path: `try { parseDot(src); } catch (e) { … }` — wrap once at the top. Render via same path.

### 8.3 Output module

`output.error` / `output.warn` currently take a single string. Option A: concatenate the code-frame into that string before calling. Option B: add a `output.diagnostic(sev, header, frame?)` function. Pick A to minimize surface-area change. The frame is just more text.

## 9. Testing approach

TDD order, one commit per chunk:

- `graph-ast.test.ts`: parse a fixture, assert `node.sourceLocation`, `node.attrLocations.key.line/column`, edge locations.
- `dot-common.test.ts`: `applyStylesheet` preserves `sourceLocation` / `attrLocations`.
- New `src/attractor/tests/dot-syntax.test.ts`: malformed DOT → `DotSyntaxError` with expected `{line, column}`.
- `schemas.test.ts`: `validateNode` with a node carrying `attrLocations` → unrecognized-keys diag has `location`. One diag per unknown key. Hint preserved.
- `graph.test.ts`: edge-rule diag carries `location`. Node-level diag carries `node.sourceLocation`.
- New `src/cli/tests/code-frame.test.ts`: pure renderer unit tests (start of file, end of file, single-line, multi-line span, no color).
- CLI integration test (`pipeline.test.ts` or a new file): full `pipelineValidateCommand` on a fixture pipeline → snapshot-match output including relpath, line:col, caret line. Run with `FORCE_COLOR=0` (per `memory/2026-04-17-ink-test-ansi-and-tmux-labels.md`).

Dual-parser test (`dual-parser.test.ts`): strip `sourceLocation` / `attrLocations` from both sides of the equality check (same pattern as `sourceLine` today) so the test stays meaningful.

## 10. Gotchas

- **Strict-schema strip list.** Missing a strip invites the "own parser metadata fails own validator" bug pattern (origin of `sourceLine` strip).
- **Per-key diagnostics vs grouped.** Today's unrecognized-keys diag is a single message listing all keys. Splitting to one-per-key may surprise tests — update any snapshot/assertion that counts diagnostics.
- **`@ts-graphviz/ast` PEG error shape.** Verify `e.location.start` exists in practice. If the library nests it differently per error type, fall back to throwing the original error (current behavior).
- **Column 1 vs 0.** `@ts-graphviz/ast` emits 1-based lines and columns. Our type says 1-based. Do not double-convert.
- **Multi-line quoted values.** `parseDotV2` pre-collapses newlines inside quoted strings before handing to `parseAST`. Line numbers **after collapse** may not match **original source** for attributes on such lines. Mitigation: keep pre-collapse confined to the attribute-value text only, not to the line structure around it. The current regex replaces `\s*\n\s*` with a single space inside the quoted region — this preserves outer line counts because the replacement lives inside the same logical token. Pin this in a test: multi-line `model_stylesheet` attr should still report correct line for the *next* node.
- **Large files.** Code-frame renderer must not read the file repeatedly for each diagnostic — the CLI already has `src` in scope; pass it to the renderer.
- **ANSI in test env.** Match existing pattern from `memory/2026-04-17-ink-test-ansi-and-tmux-labels.md` — `FORCE_COLOR=0` + explicit `color: false` in renderer calls.
- **Validator vocabulary feedback** (`memory/feedback-validator-vocabulary.md`): the word "key" must not mix with "attribute" in user-facing messages. This change adds a **prefix** (`file:line:col`) — leave the message body as-is.

## 11. Backout plan

All changes are additive. To back out:

1. Remove the location prefix in `pipelineValidateCommand`.
2. Remove the code-frame call.
3. `location`, `sourceLocation`, `attrLocations` stay populated but unread — no behavioral change.

Reverting the parser's location capture is safe because the fields are optional.

## 12. Success criteria

Running `ralph pipeline validate pipelines/illumination-to-implementation.dot` against a DOT that re-introduces `default_archive_reason_short` on `mark_archived` prints:

```
✖ pipelines/illumination-to-implementation.dot:17:16 [schema_error] [mark_archived]: unrecognized key 'default_archive_reason_short'
  Allowed keys for kind=tool:
    type                    Must be the literal "tool" for tool nodes. (required)
    cwd                     Required working directory (literal or $project / $run_id). (required)
    …

  15 │ mark_archived [type="tool",
  16 │                cwd="$project",
› 17 │                default_archive_reason_short="Declined at approval gate",
     │                ^^^^^^^^^^^^^^^^^^^^^^^^^^^^
  18 │                script_file="pipelines/scripts/mark-archived.mjs"]
```

A malformed DOT prints a `[syntax]` diagnostic with a caret at the PEG error location, not a stack trace. All existing validator tests pass once updated to accept the per-key split for unrecognized-keys.
