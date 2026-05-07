# Design: shared two-layer classifier (`classifyLine` + `classifyBlock`) for `stream-formatter.ts`

**Date:** 2026-05-07
**Status:** draft (pending review)
**Originating illumination:** `.apparat/meditations/illuminations/2026-05-06T2210-classify-line-block-shared-parser.md`
**Predecessor ADRs:** ADR-0006 (event-based stream-formatter), ADR-0009 (parser/validator split as single-purpose precedent), ADR-0012 (bundled context for clustered helpers)

## 1. Motivation

`src/cli/lib/stream-formatter.ts` carries two independently-evolved consumers of Claude CLI's NDJSON stream that duplicate the same two layers of parsing. The file even admits the seam — line 318 ships an in-file separator comment `// Raw stream-json event iterator for interactive chat (Path 1.5)`. Above that comment is the TUI formatter (`StreamEvent`, `FormatterState`, `processLine`, `streamEvents`, `serializeEvent`); below it is the raw NDJSON parser (`StreamJsonEvent`, `coerceSessionUsage`, `parseStreamJsonEvents`).

### 1.1 Layer 1 — JSON-line + event-type dispatch is duplicated

`processLine` at `src/cli/lib/stream-formatter.ts:124-132`:

```ts
let event: Record<string, unknown>;
try {
  event = JSON.parse(line) as Record<string, unknown>;
} catch {
  return { events: [], nextState: state };
}

if (event.type === "user") { ... }
```

`parseStreamJsonEvents` at `src/cli/lib/stream-formatter.ts:359-368`:

```ts
let event: Record<string, unknown>;
try {
  event = JSON.parse(line) as Record<string, unknown>;
} catch (err) {
  yield { type: "parse_error", rawLine: line, error: (err as Error).message };
  continue;
}

const t = event.type;
if (t === "system") { ... }
```

Identical `JSON.parse` + try/catch. Identical type-string dispatch on `"system" | "assistant" | "user" | "result"`. The two consumers diverge only on what they do with the parse failure (TUI swallows; raw iterator yields a `parse_error` event) and which event types they care about (TUI handles `user`/`assistant`; raw iterator handles all four).

### 1.2 Layer 2 — `message.content[]` per-block walk is duplicated three times

Inside `processLine`:

- `src/cli/lib/stream-formatter.ts:141-155` — user-side `tool_result` walk (subagent close).
- `src/cli/lib/stream-formatter.ts:192-203` — subagent assistant block walk (`text` / `tool_use`, indented).
- `src/cli/lib/stream-formatter.ts:251-272` — main-agent assistant block walk (`text` / `tool_use`, including the `Agent` tool that opens a subagent).

Inside `parseStreamJsonEvents`:

- `src/cli/lib/stream-formatter.ts:378-393` — assistant block walk (`text` → `assistant_delta`; `tool_use` → typed `ToolCall`).
- `src/cli/lib/stream-formatter.ts:397-405` — user block walk (`tool_result` → typed event).

Every walk inspects `block.type`, narrows on the same three string literals (`"text" | "tool_use" | "tool_result"`), and reads the same fields (`b.text`, `b.name`, `b.input`, `b.id`, `b.tool_use_id`, `b.content`, `b.is_error`). Five separate walks, one decision tree.

### 1.3 Why it matters

Two protocol decoders for one protocol. When Claude CLI introduces a new event type or block kind, both branches must be edited by hand — the type system gives no signal that the two halves drifted. Test files for the two halves are already split (`src/cli/tests/stream-formatter.test.ts` vs `src/cli/tests/stream-json-events.test.ts`) but the source has not yet caught up.

The earlier framing — "`processLine` mutates state, `parseStreamJsonEvents` doesn't, so they cannot share parsing" — was false. `processLine` already returns a new `FormatterState` immutably (`src/cli/lib/stream-formatter.ts:158-167`, `:286-295`); `serializeEvent` (`:298-315`) is pure. The seam is upstream of state, on the line and block decoders. A naive file-split (move `parseStreamJsonEvents` into a sibling module) would preserve the duplication across module boundaries instead of deleting it. The deepening is the shared classifier, not the file boundary — exactly the ordering ADR-0012 prescribed for the validator: define the shape first, cluster after.

## 2. Decision summary

1. **Extract a `classifyLine(line: string) → ClassifiedEvent`** discriminated union over `system | assistant | user | result | parse_error`. Wraps `JSON.parse` + type-string dispatch. Pure function. No state.

2. **Extract a `classifyBlock(block: unknown) → ClassifiedBlock`** discriminated union over `text | tool_use | tool_result | unknown`. Wraps the per-block walk decisions currently duplicated five times.

3. **Both classifiers live in a new sibling module `src/cli/lib/classify-stream.ts`** — a single-purpose module per ADR-0001 / ADR-0009. The classifiers carry no formatter state and no rendering policy, so they do not belong inside `stream-formatter.ts` after the split.

4. **Rewire `processLine` to use `classifyLine` + `classifyBlock`.** The state-machine policy (subagent buffering, main-agent header gating, ctx-token growth) stays in `processLine`. Only the protocol-decoding decisions move to the classifier.

5. **Rewire `parseStreamJsonEvents` to use `classifyLine` + `classifyBlock`.** Each yielded `StreamJsonEvent` continues to carry the same shape and the same `coerceSessionUsage` post-processing (`:341-350`). Only the JSON-line and per-block walks are replaced.

6. **Public API frozen.** `StreamEvent`, `FormatterState`, `initialState`, `flushState`, `processLine`, `streamEvents`, `serializeEvent`, `StreamJsonEvent`, `parseStreamJsonEvents` keep their exported signatures from `src/cli/lib/stream-formatter.ts`. The two production consumers — `src/cli/lib/agent.ts:8` (imports `parseStreamJsonEvents`) and `src/cli/commands/pipeline/run.ts:23` (imports both `parseStreamJsonEvents` and `streamEvents`) — keep their imports verbatim.

7. **Atomic landing.** One PR — both classifiers, both rewires, two new focused tests, and the existing test files updated to the new shape. Layer 1 alone leaves the larger duplication (block iteration) untouched; landing them together is the design ordering the illumination prescribed (`2026-05-06T2210:18-19`).

8. **No ADR.** The change is internal to `src/cli/lib/`, extends the single-purpose-modules convention already documented by ADR-0001 / ADR-0009, and crosses no public surface. ADR-0006 ("stream-formatter is event-based") continues to govern. Promoting this to ADR-status would over-document a mechanical extraction.

## 3. Architecture

### 3.1 Before / after

```
Before                                                  After
──────                                                  ─────
src/cli/lib/stream-formatter.ts (445 LOC)               src/cli/lib/stream-formatter.ts (~340 LOC)
  ├─ TUI half (lines 1–316)                                ├─ TUI half (~210 LOC)
  │    ├─ StreamEvent, FormatterState, initialState        │    └─ processLine() — calls classifyLine
  │    ├─ formatToolUse, flushState, streamEvents          │       and classifyBlock; keeps state machine
  │    ├─ processLine                                      │
  │    │    ├─ JSON.parse + try/catch    (124–129)         ├─ Raw iterator half (~130 LOC)
  │    │    ├─ user tool_result walk     (141–155)         │    └─ parseStreamJsonEvents — calls
  │    │    ├─ subagent block walk       (192–203)         │       classifyLine and classifyBlock
  │    │    └─ main-agent block walk     (251–272)         │
  │    └─ serializeEvent                                   └─ serializeEvent unchanged
  │
  ├─ separator comment              (line 318)            src/cli/lib/classify-stream.ts (~120 LOC, new)
  │                                                          ├─ ClassifiedEvent type
  └─ Raw iterator half (lines 320–419)                       ├─ ClassifiedBlock type
       ├─ StreamJsonEvent, coerceSessionUsage                ├─ classifyLine(line)
       └─ parseStreamJsonEvents                              └─ classifyBlock(block)
            ├─ JSON.parse + try/catch (359–365)
            ├─ system/assistant/user/result dispatch
            ├─ assistant block walk    (378–393)
            └─ user block walk         (397–405)
```

### 3.2 `classifyLine` contract

```ts
// src/cli/lib/classify-stream.ts

export type ClassifiedEvent =
  | { kind: "system";    sessionId?: string; raw: Record<string, unknown> }
  | { kind: "assistant"; messageId?: string; parentToolUseId?: string;
                         content: unknown[]; usage?: Record<string, unknown> }
  | { kind: "user";      content: unknown[] }
  | { kind: "result";    stopReason: string; text: string;
                         usage: Record<string, unknown>; raw: Record<string, unknown> }
  | { kind: "parse_error"; rawLine: string; error: string }
  | { kind: "unknown";   raw: Record<string, unknown> };

export function classifyLine(line: string): ClassifiedEvent;
```

`classifyLine` performs the protocol-level decoding only. It does not own subagent state, ctx-token tracking, or buffer policy — those stay in `processLine`. It does not render text — that stays in `serializeEvent`.

Decisions encoded in the type:

- A non-JSON line yields `parse_error` (the raw iterator already yields exactly this; the TUI today swallows the error by returning empty events — `processLine` will keep that behaviour by destructuring the result and dropping `parse_error`).
- Every event type recognised today gets its own `kind`. New event types arrive as `kind: "unknown"` rather than silently disappearing — this is the forward-compat seam called out by `:417` (`unknown event types are silently ignored — forward-compat with CLI updates`).
- `assistant` carries `parentToolUseId` so `processLine` can route subagent vs. main-agent without re-reaching into the raw event.

### 3.3 `classifyBlock` contract

```ts
// src/cli/lib/classify-stream.ts

export type ClassifiedBlock =
  | { kind: "text";        text: string }
  | { kind: "tool_use";    id: string; name: string; input: unknown }
  | { kind: "tool_result"; toolUseId: string; content: unknown; isError: boolean }
  | { kind: "unknown";     raw: Record<string, unknown> };

export function classifyBlock(block: unknown): ClassifiedBlock;
```

`classifyBlock` narrows a `message.content[]` element. It produces a typed payload, but does not decide what to do with it — the TUI side wraps tool_use blocks via `formatToolUse` (`stream-formatter.ts:49-71`); the raw side wraps the same blocks via the `ToolCall` shape. Those rendering / wrapping decisions stay with the consumer.

### 3.4 Rewired `processLine` (sketch)

```ts
export function processLine(line: string, state: FormatterState):
  { events: StreamEvent[]; nextState: FormatterState } {
  const ev = classifyLine(line);

  switch (ev.kind) {
    case "parse_error":
    case "system":
    case "result":
    case "unknown":
      return { events: [], nextState: state };

    case "user":
      return processUserEvent(ev, state);    // lifted from current :131-168

    case "assistant":
      return processAssistantEvent(ev, state); // lifted from current :170-295
  }
}
```

`processUserEvent` and `processAssistantEvent` are private helpers in `stream-formatter.ts`. They consume `ClassifiedBlock`s via `classifyBlock`. The state-machine policy (subagent buffering at `:180-209`, main-agent header gating at `:246-249`, ctx-token growth at `:274-284`) stays inline — none of it is duplicated with the raw iterator, none of it belongs in the classifier.

Inside the assistant branch, the per-block walk becomes:

```ts
for (const raw of content) {
  const block = classifyBlock(raw);
  switch (block.kind) {
    case "text":
      events.push({ type: "text", content: unwrapStructuredText(block.text) });
      break;
    case "tool_use":
      if (block.name === "Agent") { /* subagent header deferral */ }
      else events.push(formatToolUse(block.name, block.input as Record<string, unknown>));
      break;
    case "tool_result": case "unknown":
      break; // not emitted by main-agent walks today
  }
}
```

Today's per-block decision sites at lines 141–155, 192–203, and 251–272 collapse onto the same `classifyBlock` switch — the variation is in what each consumer pushes for each block kind, not in how blocks are classified.

### 3.5 Rewired `parseStreamJsonEvents` (sketch)

```ts
export async function* parseStreamJsonEvents(readable: NodeJS.ReadableStream):
  AsyncGenerator<StreamJsonEvent> {
  const rl = readline.createInterface({ input: readable, crlfDelay: Infinity });
  for await (const line of rl) {
    if (!line.trim()) continue;
    const ev = classifyLine(line);
    switch (ev.kind) {
      case "parse_error":
        yield { type: "parse_error", rawLine: ev.rawLine, error: ev.error };
        continue;
      case "system":
        yield { type: "system", sessionId: ev.sessionId, raw: ev.raw };
        continue;
      case "assistant":
        for (const raw of ev.content) {
          const block = classifyBlock(raw);
          if (block.kind === "text")
            yield { type: "assistant_delta", textDelta: block.text, messageId: ev.messageId };
          else if (block.kind === "tool_use")
            yield { type: "tool_use",
                    toolCall: { id: block.id, name: block.name, input: block.input },
                    messageId: ev.messageId };
        }
        continue;
      case "user":
        for (const raw of ev.content) {
          const block = classifyBlock(raw);
          if (block.kind === "tool_result")
            yield { type: "tool_result", toolCallId: block.toolUseId,
                    content: typeof block.content === "string"
                      ? block.content
                      : JSON.stringify(block.content ?? ""),
                    isError: block.isError };
        }
        continue;
      case "result":
        yield { type: "result",
                stopReason: ev.stopReason || "end_turn",
                text: ev.text,
                usage: coerceSessionUsage(ev.usage),
                raw: ev.raw };
        continue;
      case "unknown":
        continue; // forward-compat with CLI updates (matches :417)
    }
  }
}
```

`coerceSessionUsage` (`stream-formatter.ts:341-350`) stays in `stream-formatter.ts` because it owns a `SessionUsage` projection that is internal to the raw iterator's wire format. The string-coerce on `tool_result.content` (`:403`) stays at the consumer site because the `StreamJsonEvent` shape mandates `content: string`. These are deliberate consumer-side projections, not duplicated decoding.

### 3.6 Forward-compat — `unknown` kinds

Today, unknown event types silently fall through (`stream-formatter.ts:417`). Today, unknown block types silently fall through (no `else` branch in any of the five walks). The classifiers preserve that behaviour by routing both to `kind: "unknown"`. Consumers explicitly handle `unknown` (TUI: drop; raw iterator: continue) — making the silent fall-through a visible decision rather than an absent branch. Adding a new event type or block kind in the future is a one-place edit (extend the union in `classify-stream.ts`, then pick which consumers should react).

### 3.7 What `processLine`'s state machine still owns

The classifier extraction is deliberately narrow. After the split, `processLine` still owns:

- Subagent buffer maps: `state.subagentBuffers`, `state.subagentDescriptions`, `state.pendingSubagentIds` (`:12-18`).
- Subagent header deferral via the `Agent` tool branch (`:258-267`).
- Main-agent open/close gating on the presence of non-`Agent` content (`:241-249`).
- Ctx-token growth comparison and emission (`:274-284`).
- The "skip events with no substantive content" guard (`:220-239`).
- `unwrapStructuredText` invocation on `text` blocks (`:35-47`, `:196`, `:254`).

None of this is duplicated with the raw iterator. None of it belongs in the classifier. The split keeps each module single-purpose: `classify-stream.ts` decodes the wire format; `stream-formatter.ts`'s TUI half runs the formatter state machine; `stream-formatter.ts`'s raw half projects to `StreamJsonEvent`.

## 4. Components and file edits

### 4.1 `src/cli/lib/classify-stream.ts` (new, ~120 LOC)

Defines `ClassifiedEvent`, `ClassifiedBlock`, `classifyLine(line)`, `classifyBlock(block)`. No imports beyond `node`'s built-ins. No formatter state. No rendering. The module is purely declarative + decoder logic.

### 4.2 `src/cli/lib/stream-formatter.ts` (rewritten, ~340 LOC)

- Top half (`processLine`, `streamEvents`, `serializeEvent`, `flushState`, `formatToolUse`, `unwrapStructuredText`, `initialState`, types): **kept** with `processLine` rewired to call `classifyLine` + `classifyBlock`. Inline JSON.parse / try/catch and the three per-block walks at `:141-155`, `:192-203`, `:251-272` are deleted.
- Bottom half (`parseStreamJsonEvents`, `StreamJsonEvent`, `coerceSessionUsage`): **kept** with `parseStreamJsonEvents` rewired to call `classifyLine` + `classifyBlock`. Inline JSON.parse / try/catch at `:359-365`, the type-string switch at `:367-416`, and the two per-block walks at `:378-393` and `:397-405` are deleted.
- Separator comment at `:317-323` is **kept** — the TUI/raw split inside the file is still a meaningful in-file boundary even after the classifier extraction.

### 4.3 Test files

- **New** `src/cli/tests/classify-line.test.ts` (~80 LOC) — focused unit tests for `classifyLine`. Cover: malformed JSON → `parse_error`; each of `system`/`assistant`/`user`/`result` produces the right `kind` with the right fields; `parent_tool_use_id` round-trips on `assistant`; missing optional fields are absent rather than `undefined`-as-string; truly unknown `event.type` (e.g. `"foo"`) → `kind: "unknown"`.
- **New** `src/cli/tests/classify-block.test.ts` (~60 LOC) — focused unit tests for `classifyBlock`. Cover: each of `text`/`tool_use`/`tool_result` produces the right `kind` with the right fields; missing-id `tool_use` falls through to `kind: "unknown"` rather than `tool_use` with empty id; `tool_result` carries `isError` correctly when omitted vs. explicit `false` vs. `true`; non-string `tool_result.content` is preserved as `unknown` (consumer-side `JSON.stringify` continues to live in `parseStreamJsonEvents`).
- **New** `src/cli/tests/classify-stream-replay.test.ts` (~40 LOC) + `src/cli/tests/fixtures/classify-stream-replay.ndjson` + `src/cli/tests/fixtures/classify-stream-replay.expected.json` — byte-identical replay invariant. Asserts both `streamEvents(fixture)` and `parseStreamJsonEvents(fixture)` produce the frozen pre-split outputs.
- **Updated** `src/cli/tests/stream-formatter.test.ts` — current test file already pins `processLine` outputs by event shape (per ADR-0006). Most tests need no edits because the rewired `processLine` produces byte-identical `StreamEvent[]` for the same inputs. Any test that asserts on internal helper names or mocks `JSON.parse` (verified absent today) would need touching; with the current asserts on event shape only, the file expects 0 edits unless coverage of the new `unknown` event-type fall-through is added (recommended; ~10 LOC).
- **Updated** `src/cli/tests/stream-json-events.test.ts` — pins `parseStreamJsonEvents` outputs by yielded `StreamJsonEvent` shape. Same story: the rewire preserves the public yield sequence; expected delta is at most a few lines covering the explicit `unknown` fallthrough.
- **Updated** `src/cli/tests/stream-json-input.test.ts` — covers `formatUserTurn` (separate concern, `src/cli/lib/stream-json-input.ts`). Kept on the list because the illumination flagged it as co-evolving; no edits expected unless the file imports through the rewired path (verified: imports `formatUserTurn` only).
- **Updated** `src/cli/tests/parseClaudeEvent.test.ts` — covers `src/cli/lib/parseClaudeEvent.ts`, a sibling module that also reads the stream-json shape. Kept on the list out of caution; no rewire is planned for `parseClaudeEvent` in this design (it has its own concerns; sub-cluster decision deferred). Expected edits: 0.
- **Updated (mocks)** `src/cli/tests/pipeline.test.ts`, `src/cli/tests/pipeline-headless.test.ts` — both mock the stream-formatter module. The mock seams stay at the public exports (`parseStreamJsonEvents`, `streamEvents`); no edits anticipated.

### 4.4 Production consumers

| File | Today's import | Edit |
|---|---|---|
| `src/cli/lib/agent.ts:8` | `parseStreamJsonEvents`, `StreamJsonEvent` | none — surface unchanged |
| `src/cli/commands/pipeline/run.ts:23` | `parseStreamJsonEvents`, `streamEvents` | none — surface unchanged |
| `src/cli/lib/parseClaudeEvent.ts` | (sibling parser, no import from `stream-formatter`) | none — out of scope |
| `src/cli/tests/helpers/fake-child-handle.ts` | uses the public stream surface | none — surface unchanged |

### 4.5 No ADR

The bundle is a private implementation detail of `src/cli/lib/`. ADR-0006 already governs the public event-based contract. ADR-0001 / ADR-0009 govern the single-purpose-module convention. A new ADR would over-document a mechanical extraction whose only signal is the source itself (per ADR-0004).

### 4.6 LOC sanity check

| File | Approx LOC after split |
|---|---|
| `src/cli/lib/stream-formatter.ts` (rewritten) | ~340 (down from 445) |
| `src/cli/lib/classify-stream.ts` (new) | ~120 |
| `src/cli/tests/classify-line.test.ts` (new) | ~80 |
| `src/cli/tests/classify-block.test.ts` (new) | ~60 |
| **Net source LOC change** | +15 (≈ +3%) |

The split adds ~15 LOC of imports / module structure and saves ~100 LOC of duplicated parse + walk code. Net near-zero on raw LOC; substantial positive on locality.

## 5. Data flow

### 5.1 Before — two parallel decoder paths

```
NDJSON line ──► processLine             ──► JSON.parse + try/catch ──► event-type switch ──► per-block walk × 3 ──► StreamEvent[]
NDJSON line ──► parseStreamJsonEvents   ──► JSON.parse + try/catch ──► event-type switch ──► per-block walk × 2 ──► StreamJsonEvent
```

Two parsers. Five walks. Identical decisions on every parse-and-classify step.

### 5.2 After — one decoder path, two consumers

```
                                                         ┌─► state machine ──► StreamEvent[]
NDJSON line ──► classifyLine ──► classifyBlock per block ┤
                                                         └─► event projection ──► StreamJsonEvent
```

One JSON.parse decision. One block decision tree. Two consumer-side projections — TUI state machine vs. wire-format projection — each owning only the policy that distinguishes it from the other.

## 6. Blast radius / impact surface

- **Size:** **S** (~5–8 files).
- **Files touched:**
  - **Rewritten:** `src/cli/lib/stream-formatter.ts` (~340 LOC after split, down from 445).
  - **New:** `src/cli/lib/classify-stream.ts` (~120 LOC).
  - **New:** `src/cli/tests/classify-line.test.ts`, `src/cli/tests/classify-block.test.ts`.
  - **Updated (likely small / zero edits):** `src/cli/tests/stream-formatter.test.ts`, `src/cli/tests/stream-json-events.test.ts`, `src/cli/tests/stream-json-input.test.ts`, `src/cli/tests/parseClaudeEvent.test.ts`, `src/cli/tests/pipeline.test.ts`, `src/cli/tests/pipeline-headless.test.ts`.
- **Surfaces crossed:** `src/cli/lib` only.
  - **CLI flags:** none.
  - **Pipeline / agent schema:** none.
  - **Pipeline node attribute:** none.
  - **MCP tool shape:** none.
  - **Public CLI surface (stdout / stderr / exit codes):** none.
  - **`StreamEvent` / `StreamJsonEvent` exports:** none.
- **Breaking changes:** **no.**
  - `processLine`, `streamEvents`, `serializeEvent`, `flushState`, `initialState`, `FormatterState`, `StreamEvent` keep their signatures.
  - `parseStreamJsonEvents`, `StreamJsonEvent` keep their signatures.
  - `src/cli/lib/agent.ts` and `src/cli/commands/pipeline/run.ts` need no changes.
  - The two new exports (`classifyLine`, `classifyBlock`) are additive.
- **Spec / docs ripple:**
  - [ ] No new ADR.
  - [ ] No edits to existing ADRs (ADR-0006 still describes the public event surface; ADR-0009 still describes the module-split convention; ADR-0012 still governs the validator's bundled-context approach — this design extends the same single-purpose / shared-helper pattern but does not change those ADRs).
  - [ ] No edits to `CONTEXT.md`, `README.md`, `AGENTS.md`, `VISION.md`.
  - [ ] No edits to sibling design docs.
- **Test ripple:** medium-light.
  - [ ] **2 new test files** for the classifiers (`classify-line.test.ts`, `classify-block.test.ts`).
  - [ ] **5 existing test files** likely need 0 or near-0 edits because they pin on public event shape (per ADR-0006) — `stream-formatter.test.ts`, `stream-json-events.test.ts`, `stream-json-input.test.ts`, `parseClaudeEvent.test.ts`, plus `pipeline*.test.ts` mocks.

## 7. Trade-offs

### 7.1 One classifier vs. two

A variant: define only `classifyLine`, keep the per-block walks duplicated. Rejected per the illumination (`2026-05-06T2210:18-19`): "Layer 1 alone leaves the bigger duplication (block iteration) untouched — commit both layers together." Layer 2 is where the larger walking-the-content-array decision tree lives; landing only Layer 1 means a half-extracted abstraction.

### 7.2 Single classifier file vs. two files

Could split as `classify-line.ts` + `classify-block.ts`. Rejected: the two classifiers share zero state but are co-evolved (every new event type tends to bring new block kinds), and both are <100 LOC each. Co-locating in one ~120-LOC `classify-stream.ts` is the right grain — same convention used by `src/cli/lib/stream-json-input.ts` (formatter helpers co-located).

### 7.3 Move classifier inside `stream-formatter.ts` vs. extract to sibling

Could keep both classifiers as un-exported helpers at the top of `stream-formatter.ts`. Rejected:

- The whole point of the deepening is that `stream-formatter.ts` carries two unrelated jobs today (TUI state machine + raw wire projection). Adding a third (protocol decoding) inside the same file walks back the single-purpose convention ADR-0009 just established for `graph-validator.ts` / `graph.ts`.
- The classifier is genuinely re-usable — `parseClaudeEvent.ts` may eventually consume it (deferred sub-cluster decision). Keeping it private makes that re-use harder.
- Test files already cluster on classifier vs. consumer; the new `classify-{line,block}.test.ts` can target the classifier without spinning up a fake formatter state.

### 7.4 Classifier returns discriminated union vs. callbacks

Could expose `classifyLine(line, callbacks: {onSystem, onAssistant, ...})`. Rejected:

- Discriminated unions compose with TypeScript's exhaustiveness checking — adding a new event type produces a compile-time error in every consumer's switch. Callback-style hides that signal.
- The TUI consumer wants `kind: "system" | "result" | "unknown" | "parse_error"` to take a fast no-op path; callback-style forces it to allocate empty handler closures.
- Consumer-side switches are already the idiom for `StreamEvent` (`serializeEvent` at `stream-formatter.ts:298-315`).

### 7.5 Atomic vs. staged

Could land Layer 1 first, Layer 2 later. Rejected:

- The illumination explicitly calls this out: "Layer 1 alone leaves the bigger duplication (block iteration) untouched — commit both layers together."
- An interim state where lines are classified but blocks are not is still net-better than today, but reviewers must hold both shapes in mind during the gap. The change is mechanical and small enough to land in one PR.

### 7.6 No ADR

A new ADR could record "stream parsing is shared via classify-stream.ts." Rejected per ADR-0004 (source as truth, no behavioural specs): the classifier is internal to `src/cli/lib/`, the public event-based contract (ADR-0006) is unchanged, and the single-purpose / shared-helper convention is already documented (ADR-0001, ADR-0009, ADR-0012). Promoting this would over-document a mechanical extraction.

## 8. Constraints

After the change:

- `npx tsc --noEmit` passes.
- `npx vitest run src/cli/tests/` passes — including the two new classifier tests and the unchanged consumer tests.
- `npx vitest run` (full suite) passes.
- Running `apparat pipeline run <fixture>` on a representative pipeline produces byte-identical TUI output to the pre-split baseline. A canned NDJSON fixture replayed through `streamEvents` yields the same `StreamEvent[]`; replayed through `parseStreamJsonEvents` yields the same `StreamJsonEvent` sequence.
- `src/cli/lib/classify-stream.ts` exists and exports `classifyLine`, `classifyBlock`, `ClassifiedEvent`, `ClassifiedBlock`.
- Repo-wide grep `from "\.\./lib/stream-formatter\.js"` and `from "\.\.\/\.\.\/lib/stream-formatter\.js"` show *the same* hits as today — no consumer rewrote its import.
- `src/cli/lib/stream-formatter.ts` no longer contains a literal `JSON.parse(line)` (verified via `Grep`).

Behaviour invariants:

- For every NDJSON line in the fixture corpus, `processLine(line, state)` returns a `StreamEvent[]` and `nextState` byte-identical to the pre-split run.
- For every NDJSON line in the fixture corpus, `parseStreamJsonEvents` yields the same sequence of `StreamJsonEvent`s in the same order, with the same field values.
- Unknown event types and unknown block kinds continue to fall through silently for both consumers (preserving the forward-compat behaviour at `stream-formatter.ts:417`).

## 9. Open questions

- **Should `coerceSessionUsage` move to `classify-stream.ts`?** Today `coerceSessionUsage(u)` (`stream-formatter.ts:341-350`) projects the wire `usage` object into the internal `SessionUsage` shape. It is consumed only by the raw iterator's `result` branch. Moving it would force `classify-stream.ts` to import `SessionUsage` from `session.ts`, leaking the consumer-side projection into the decoder. Default: leave `coerceSessionUsage` in `stream-formatter.ts`, alongside `parseStreamJsonEvents`.
- **Should `parseClaudeEvent.ts` migrate to `classify-stream.ts`?** `src/cli/lib/parseClaudeEvent.ts` is a third reader of the same wire format. Out of scope for this design — the present split delivers the standardized handle; the further migration is a separate decision driven by the next time `parseClaudeEvent` and `classify-stream` would otherwise drift. (Tracked here so a future deepening session does not re-derive the duplicate.)
- **Should the in-file separator comment at `stream-formatter.ts:317-323` survive the split?** It currently flags the TUI / raw boundary inside one file. After the classifier extraction, both halves are smaller and the boundary is still meaningful (state machine vs. event projection). Default: keep. Revisit if a future split moves either half out of the file entirely.

## 10. Verification approach

### 10.1 Static checks

- `npx tsc --noEmit` — clean. The discriminated unions in `classify-stream.ts` enforce exhaustive switches in both consumers; missing a `kind` produces a compile error at the call site.
- Grep `JSON\.parse\(line\)` on `src/cli/lib/stream-formatter.ts` — returns 0 matches after the split (verifies the parse decoding moved out).
- Grep `event\.type === ` and `t === "system"` style checks on `src/cli/lib/stream-formatter.ts` — returns 0 matches (verifies the type-string dispatch moved out).
- Grep `block\.type === "tool_use"` style checks on `src/cli/lib/stream-formatter.ts` — returns 0 matches (verifies the per-block decoding moved out; the consumer-side switches use `block.kind` instead).

### 10.2 Tests

- `npx vitest run src/cli/tests/classify-line.test.ts` — passes (new).
- `npx vitest run src/cli/tests/classify-block.test.ts` — passes (new).
- `npx vitest run src/cli/tests/classify-stream-replay.test.ts` — passes (new; byte-identical fixture replay).
- `npx vitest run src/cli/tests/stream-formatter.test.ts` — passes unchanged (event-shape asserts per ADR-0006).
- `npx vitest run src/cli/tests/stream-json-events.test.ts` — passes unchanged.
- `npx vitest run src/cli/tests/stream-json-input.test.ts` — passes unchanged.
- `npx vitest run src/cli/tests/parseClaudeEvent.test.ts` — passes unchanged.
- `npx vitest run src/cli/tests/pipeline.test.ts src/cli/tests/pipeline-headless.test.ts` — pass unchanged.
- `npx vitest run` — full suite green.

### 10.3 Fixture replay

A canned NDJSON fixture is committed to `src/cli/tests/fixtures/classify-stream-replay.ndjson` — representative of a real `apparat pipeline run` transcript: system → assistant text deltas → assistant tool_use Agent → user tool_result → assistant text → result. The pre-split run captures the expected outputs into `src/cli/tests/fixtures/classify-stream-replay.expected.json` (one array of `StreamEvent`s, one array of `StreamJsonEvent`s). The post-split run is asserted equal:

- `streamEvents(fixture)` → `StreamEvent[]` collected via `for await`.
- `parseStreamJsonEvents(fixture)` → `StreamJsonEvent[]` collected via `for await`.

The replay test lives at `src/cli/tests/classify-stream-replay.test.ts` (new) so the byte-identical invariant is mechanically reproducible — not just auditable in prose. The fixture is captured once from the pre-split branch and frozen; any future change to the public event shapes deliberately re-captures it (analogous to `src/attractor/tests/graph-validator-byte-identical.test.ts` for the validator).

### 10.4 Negative cases

- A merge that introduces `classify-stream.ts` but forgets to wire `processLine` to it — `tsc --noEmit` catches the unused-import; the existing test asserts on event shape and would fail because the inline parse path is deleted.
- A merge that adds a new `kind` to `ClassifiedEvent` but forgets to handle it in one consumer — the exhaustive switch in the rewired `processLine` / `parseStreamJsonEvents` produces a compile error.
- A merge that returns `kind: "unknown"` for a block where today's code returned a real value — the existing test fails on the missing emitted event.

## 11. Summary

`src/cli/lib/stream-formatter.ts` carries two consumers of Claude CLI's NDJSON stream — `processLine` (TUI formatter state machine) and `parseStreamJsonEvents` (raw NDJSON iterator) — that duplicate JSON-line decoding (`:124-129` and `:359-365`) and the per-block content walk (`:141-155`, `:192-203`, `:251-272`, `:378-393`, `:397-405`). The file admits the seam at line 318. Two parsers for one protocol create silent drift when Claude CLI adds an event type or block kind. This design extracts a two-layer classifier — `classifyLine(line) → ClassifiedEvent` and `classifyBlock(block) → ClassifiedBlock` — into a new sibling module `src/cli/lib/classify-stream.ts`. Both consumers are rewired to call the classifiers; the TUI state machine (subagent buffering, ctx-token growth, header gating) and the wire-format projection (`StreamJsonEvent` shape, `coerceSessionUsage`) stay with their respective owners. Public exports are unchanged: `StreamEvent`, `FormatterState`, `processLine`, `streamEvents`, `parseStreamJsonEvents`, `serializeEvent`, `StreamJsonEvent` keep their signatures; the two production consumers (`src/cli/lib/agent.ts:8`, `src/cli/commands/pipeline/run.ts:23`) need no changes. New `kind: "unknown"` payloads make today's silent forward-compat fall-through (`:417`) into a visible decision. Blast radius: S (~5–8 files); breaking changes: zero. The deepening extends the single-purpose-module convention (ADR-0001, ADR-0009) and the bundled-helper pattern (ADR-0012) without requiring a new ADR — the contract change is internal to `src/cli/lib/`, the event-based public surface (ADR-0006) is unchanged, and the only signal needed is the source itself (per ADR-0004).
