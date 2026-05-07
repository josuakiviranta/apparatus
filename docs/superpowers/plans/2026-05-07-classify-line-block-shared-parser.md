# `classifyLine` + `classifyBlock` Shared Parser Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Extract a two-layer classifier (`classifyLine` + `classifyBlock`) into a new sibling module `src/cli/lib/classify-stream.ts`, then rewire all three NDJSON-line decoders in `src/cli/lib/stream-formatter.ts` (`streamEvents` session-id sniff at `:96-105`, `processLine` for the TUI state machine, `parseStreamJsonEvents` for the raw iterator) to call it. Public exports keep their signatures; behaviour is byte-identical against a frozen NDJSON fixture.

**Architecture:** New module owns protocol decoding only — discriminated unions over `system | assistant | user | result | parse_error | unknown` (line classifier) and `text | tool_use | tool_result | unknown` (block classifier). State machine policy (subagent buffering, ctx-token growth, header gating) and wire-format projection (`StreamJsonEvent` shape, `coerceSessionUsage`) stay in `stream-formatter.ts` with their respective consumers. No ADR — extends the single-purpose-module convention from ADR-0001 / ADR-0009 / ADR-0012; the public event-based contract from ADR-0006 is unchanged.

**Tech Stack:** TypeScript, Vitest, Node.js. Tests run with `npx vitest run`. Type check with `npx tsc --noEmit`.

**Source spec:** `docs/superpowers/specs/2026-05-07-classify-line-block-shared-parser-design.md`
**Originating illumination:** `.apparat/meditations/illuminations/2026-05-06T2210-classify-line-block-shared-parser.md`

---

## File Structure

| File | Action | Responsibility |
|---|---|---|
| `src/cli/lib/classify-stream.ts` | Create | Defines `ClassifiedEvent`, `ClassifiedBlock`, `classifyLine`, `classifyBlock`. Pure decoder, no formatter state, no rendering. |
| `src/cli/tests/classify-line.test.ts` | Create | Focused unit tests for `classifyLine` (parse_error, system/assistant/user/result, parent_tool_use_id round-trip, unknown event types). |
| `src/cli/tests/classify-block.test.ts` | Create | Focused unit tests for `classifyBlock` (text/tool_use/tool_result, missing-id fallthrough, isError defaulting, non-string content preservation). |
| `src/cli/tests/fixtures/classify-stream-replay.ndjson` | Create | Frozen NDJSON corpus: system → assistant text → assistant tool_use Agent → user tool_result → assistant text → result. |
| `src/cli/tests/fixtures/classify-stream-replay.expected.json` | Create | Frozen `{ streamEvents: StreamEvent[]; streamJsonEvents: StreamJsonEvent[] }` captured from the pre-rewire branch. |
| `src/cli/tests/classify-stream-replay.test.ts` | Create | Asserts post-rewire `streamEvents(fixture)` and `parseStreamJsonEvents(fixture)` match the frozen expected outputs byte-identically. |
| `src/cli/lib/stream-formatter.ts` | Modify | Replace three inline `JSON.parse(line)` + try/catch sites (`:99` session sniff, `:124-129` TUI, `:359-365` raw iterator) and the five per-block walks (`:141-155`, `:192-203`, `:251-272`, `:378-393`, `:397-405`) with `classifyLine` / `classifyBlock` calls. Public surface unchanged. |

No other source files are touched. Production consumers (`src/cli/lib/agent.ts`, `src/cli/commands/pipeline/run.ts`) keep their imports verbatim because `streamEvents`, `parseStreamJsonEvents`, and `StreamJsonEvent` keep their signatures. Existing tests at `src/cli/tests/stream-formatter.test.ts`, `src/cli/tests/stream-json-events.test.ts`, `src/cli/tests/stream-json-input.test.ts`, `src/cli/tests/parseClaudeEvent.test.ts`, `src/cli/tests/pipeline.test.ts`, `src/cli/tests/pipeline-headless.test.ts` continue to pass unchanged because they pin on public event shape (per ADR-0006), not on internal helpers — the rewire is event-shape-preserving.

---

## Chunk 1: New `classify-stream.ts` module + unit tests

This chunk lands the decoder module and its two focused unit tests. After this chunk the module is exported and tested but not yet wired — `stream-formatter.ts` continues to use its inline parse/walk code, and the full suite stays green because nothing imports the new file yet.

### Task 1.1: Add the failing unit test for `classifyLine`

**Files:**
- Create: `src/cli/tests/classify-line.test.ts`

- [x] **Step 1: Write the failing test**

Create `src/cli/tests/classify-line.test.ts` with the following exact content:

```typescript
import { describe, it, expect } from "vitest";
import { classifyLine } from "../lib/classify-stream.js";

describe("classifyLine", () => {
  it("returns parse_error on malformed JSON", () => {
    const ev = classifyLine("not json");
    expect(ev.kind).toBe("parse_error");
    if (ev.kind === "parse_error") {
      expect(ev.rawLine).toBe("not json");
      expect(typeof ev.error).toBe("string");
      expect(ev.error.length).toBeGreaterThan(0);
    }
  });

  it("classifies system event with sessionId", () => {
    const line = JSON.stringify({ type: "system", session_id: "abc-123", subtype: "init" });
    const ev = classifyLine(line);
    expect(ev.kind).toBe("system");
    if (ev.kind === "system") {
      expect(ev.sessionId).toBe("abc-123");
      expect(ev.raw.subtype).toBe("init");
    }
  });

  it("classifies system event with missing session_id as undefined", () => {
    const ev = classifyLine(JSON.stringify({ type: "system" }));
    expect(ev.kind).toBe("system");
    if (ev.kind === "system") {
      expect(ev.sessionId).toBeUndefined();
    }
  });

  it("classifies assistant event with content array and messageId", () => {
    const line = JSON.stringify({
      type: "assistant",
      message: { id: "msg-1", content: [{ type: "text", text: "hi" }], usage: { input_tokens: 5 } },
    });
    const ev = classifyLine(line);
    expect(ev.kind).toBe("assistant");
    if (ev.kind === "assistant") {
      expect(ev.messageId).toBe("msg-1");
      expect(ev.content).toEqual([{ type: "text", text: "hi" }]);
      expect(ev.usage).toEqual({ input_tokens: 5 });
      expect(ev.parentToolUseId).toBeUndefined();
    }
  });

  it("round-trips parent_tool_use_id on assistant", () => {
    const line = JSON.stringify({
      type: "assistant",
      parent_tool_use_id: "tool_abc",
      message: { content: [] },
    });
    const ev = classifyLine(line);
    expect(ev.kind).toBe("assistant");
    if (ev.kind === "assistant") {
      expect(ev.parentToolUseId).toBe("tool_abc");
    }
  });

  it("classifies assistant with missing message as empty content", () => {
    const ev = classifyLine(JSON.stringify({ type: "assistant" }));
    expect(ev.kind).toBe("assistant");
    if (ev.kind === "assistant") {
      expect(ev.content).toEqual([]);
      expect(ev.messageId).toBeUndefined();
      expect(ev.usage).toBeUndefined();
    }
  });

  it("classifies user event with content array", () => {
    const line = JSON.stringify({
      type: "user",
      message: { content: [{ type: "tool_result", tool_use_id: "t1", content: "ok" }] },
    });
    const ev = classifyLine(line);
    expect(ev.kind).toBe("user");
    if (ev.kind === "user") {
      expect(ev.content).toEqual([{ type: "tool_result", tool_use_id: "t1", content: "ok" }]);
    }
  });

  it("classifies user with missing message as empty content", () => {
    const ev = classifyLine(JSON.stringify({ type: "user" }));
    expect(ev.kind).toBe("user");
    if (ev.kind === "user") {
      expect(ev.content).toEqual([]);
    }
  });

  it("classifies result event with stopReason, text, usage, raw", () => {
    const line = JSON.stringify({
      type: "result",
      stop_reason: "end_turn",
      result: "done",
      usage: { input_tokens: 1, output_tokens: 2 },
    });
    const ev = classifyLine(line);
    expect(ev.kind).toBe("result");
    if (ev.kind === "result") {
      expect(ev.stopReason).toBe("end_turn");
      expect(ev.text).toBe("done");
      expect(ev.usage).toEqual({ input_tokens: 1, output_tokens: 2 });
      expect(ev.raw.type).toBe("result");
    }
  });

  it("defaults result.stopReason and text when missing", () => {
    const ev = classifyLine(JSON.stringify({ type: "result" }));
    expect(ev.kind).toBe("result");
    if (ev.kind === "result") {
      expect(ev.stopReason).toBe("");
      expect(ev.text).toBe("");
      expect(ev.usage).toEqual({});
    }
  });

  it("returns kind 'unknown' for unrecognised event.type", () => {
    const ev = classifyLine(JSON.stringify({ type: "foo", payload: 1 }));
    expect(ev.kind).toBe("unknown");
    if (ev.kind === "unknown") {
      expect(ev.raw.type).toBe("foo");
    }
  });
});
```

Notes for the implementer:
- The defaulting on `result` (`stop_reason || "end_turn"` and `result || ""`) lives in the consumer-side projection inside `parseStreamJsonEvents` (`stream-formatter.ts:411-412`). The classifier itself returns the raw values it observed; tests above pin that contract — empty strings on missing, `{}` on missing usage. `parseStreamJsonEvents` continues to apply `stopReason || "end_turn"` when projecting to `StreamJsonEvent`.
- The `raw` field on `system`, `result`, and `unknown` carries the entire parsed object so consumers that need fall-through fields (currently only the raw iterator's `system.raw` and `result.raw`) keep working without re-parsing.

- [x] **Step 2: Run the test to verify it fails**

Run:
```bash
npx vitest run src/cli/tests/classify-line.test.ts
```
Expected: FAIL with `Cannot find module '../lib/classify-stream.js'` (the source file does not yet exist).

### Task 1.2: Add the failing unit test for `classifyBlock`

**Files:**
- Create: `src/cli/tests/classify-block.test.ts`

- [x] **Step 1: Write the failing test**

Create `src/cli/tests/classify-block.test.ts` with the following exact content:

```typescript
import { describe, it, expect } from "vitest";
import { classifyBlock } from "../lib/classify-stream.js";

describe("classifyBlock", () => {
  it("classifies text block", () => {
    const b = classifyBlock({ type: "text", text: "hello" });
    expect(b.kind).toBe("text");
    if (b.kind === "text") expect(b.text).toBe("hello");
  });

  it("text block with non-string text falls through to unknown", () => {
    const b = classifyBlock({ type: "text", text: 42 });
    expect(b.kind).toBe("unknown");
  });

  it("classifies tool_use block", () => {
    const b = classifyBlock({ type: "tool_use", id: "t1", name: "Read", input: { file_path: "/a" } });
    expect(b.kind).toBe("tool_use");
    if (b.kind === "tool_use") {
      expect(b.id).toBe("t1");
      expect(b.name).toBe("Read");
      expect(b.input).toEqual({ file_path: "/a" });
    }
  });

  it("tool_use coerces missing id and name to empty strings", () => {
    const b = classifyBlock({ type: "tool_use" });
    expect(b.kind).toBe("tool_use");
    if (b.kind === "tool_use") {
      expect(b.id).toBe("");
      expect(b.name).toBe("");
      expect(b.input).toBeUndefined();
    }
  });

  it("classifies tool_result block with explicit isError true", () => {
    const b = classifyBlock({ type: "tool_result", tool_use_id: "t1", content: "boom", is_error: true });
    expect(b.kind).toBe("tool_result");
    if (b.kind === "tool_result") {
      expect(b.toolUseId).toBe("t1");
      expect(b.content).toBe("boom");
      expect(b.isError).toBe(true);
    }
  });

  it("tool_result defaults isError to false when omitted", () => {
    const b = classifyBlock({ type: "tool_result", tool_use_id: "t1", content: "ok" });
    expect(b.kind).toBe("tool_result");
    if (b.kind === "tool_result") expect(b.isError).toBe(false);
  });

  it("tool_result preserves non-string content untouched", () => {
    const obj = { foo: 1, bar: [2, 3] };
    const b = classifyBlock({ type: "tool_result", tool_use_id: "t1", content: obj });
    expect(b.kind).toBe("tool_result");
    if (b.kind === "tool_result") {
      // consumer-side stringification stays in parseStreamJsonEvents
      expect(b.content).toBe(obj);
    }
  });

  it("returns kind 'unknown' for unrecognised block.type", () => {
    const b = classifyBlock({ type: "foo", payload: 1 });
    expect(b.kind).toBe("unknown");
    if (b.kind === "unknown") expect(b.raw.type).toBe("foo");
  });

  it("returns kind 'unknown' for non-object input", () => {
    const b = classifyBlock(null);
    expect(b.kind).toBe("unknown");
  });
});
```

Notes for the implementer:
- The "non-string text falls through to unknown" assertion mirrors the existing guard at `stream-formatter.ts:380` (`if (b.type === "text" && typeof b.text === "string")`). The classifier preserves that guard rather than emitting a malformed `text` block.
- `tool_result.content` is left at its observed type. The string-coerce (`typeof b.content === "string" ? b.content : JSON.stringify(b.content ?? "")` from `:403`) stays in `parseStreamJsonEvents` because the `StreamJsonEvent` shape mandates `content: string` — that is a consumer-side projection, not a decoder concern.

- [x] **Step 2: Run the test to verify it fails**

Run:
```bash
npx vitest run src/cli/tests/classify-block.test.ts
```
Expected: FAIL with `Cannot find module '../lib/classify-stream.js'`.

### Task 1.3: Implement `classify-stream.ts` — minimal code to pass both tests

**Files:**
- Create: `src/cli/lib/classify-stream.ts`

- [x] **Step 1: Write the implementation**

Create `src/cli/lib/classify-stream.ts` with the following exact content:

```typescript
// Two-layer classifier for Claude CLI's stream-json NDJSON output.
//
// Layer 1: classifyLine — turns one NDJSON line into a typed event union.
// Layer 2: classifyBlock — narrows a `message.content[]` element to a typed
// payload. Both consumers (TUI formatter `processLine`, raw iterator
// `parseStreamJsonEvents`) call these instead of inlining JSON.parse and
// per-block walks. State machine policy and wire-format projection stay
// with their respective owners in stream-formatter.ts.

export type ClassifiedEvent =
  | { kind: "system"; sessionId?: string; raw: Record<string, unknown> }
  | {
      kind: "assistant";
      messageId?: string;
      parentToolUseId?: string;
      content: unknown[];
      usage?: Record<string, unknown>;
    }
  | { kind: "user"; content: unknown[] }
  | {
      kind: "result";
      stopReason: string;
      text: string;
      usage: Record<string, unknown>;
      raw: Record<string, unknown>;
    }
  | { kind: "parse_error"; rawLine: string; error: string }
  | { kind: "unknown"; raw: Record<string, unknown> };

export type ClassifiedBlock =
  | { kind: "text"; text: string }
  | { kind: "tool_use"; id: string; name: string; input: unknown }
  | { kind: "tool_result"; toolUseId: string; content: unknown; isError: boolean }
  | { kind: "unknown"; raw: Record<string, unknown> };

export function classifyLine(line: string): ClassifiedEvent {
  let event: Record<string, unknown>;
  try {
    event = JSON.parse(line) as Record<string, unknown>;
  } catch (err) {
    return { kind: "parse_error", rawLine: line, error: (err as Error).message };
  }

  const t = event.type;

  if (t === "system") {
    return {
      kind: "system",
      sessionId: typeof event.session_id === "string" ? event.session_id : undefined,
      raw: event,
    };
  }

  if (t === "assistant") {
    const msg = (event.message ?? {}) as Record<string, unknown>;
    return {
      kind: "assistant",
      messageId: typeof msg.id === "string" ? msg.id : undefined,
      parentToolUseId:
        typeof event.parent_tool_use_id === "string" ? event.parent_tool_use_id : undefined,
      content: Array.isArray(msg.content) ? (msg.content as unknown[]) : [],
      usage: (msg.usage ?? undefined) as Record<string, unknown> | undefined,
    };
  }

  if (t === "user") {
    const msg = (event.message ?? {}) as Record<string, unknown>;
    return {
      kind: "user",
      content: Array.isArray(msg.content) ? (msg.content as unknown[]) : [],
    };
  }

  if (t === "result") {
    return {
      kind: "result",
      stopReason: typeof event.stop_reason === "string" ? event.stop_reason : "",
      text: typeof event.result === "string" ? event.result : "",
      usage: (event.usage ?? {}) as Record<string, unknown>,
      raw: event,
    };
  }

  return { kind: "unknown", raw: event };
}

export function classifyBlock(block: unknown): ClassifiedBlock {
  if (!block || typeof block !== "object") {
    return { kind: "unknown", raw: {} };
  }
  const b = block as Record<string, unknown>;

  if (b.type === "text") {
    if (typeof b.text === "string") return { kind: "text", text: b.text };
    return { kind: "unknown", raw: b };
  }

  if (b.type === "tool_use") {
    return {
      kind: "tool_use",
      id: typeof b.id === "string" ? b.id : "",
      name: typeof b.name === "string" ? b.name : "",
      input: b.input,
    };
  }

  if (b.type === "tool_result") {
    return {
      kind: "tool_result",
      toolUseId: typeof b.tool_use_id === "string" ? b.tool_use_id : "",
      content: b.content,
      isError: b.is_error === true,
    };
  }

  return { kind: "unknown", raw: b };
}
```

- [x] **Step 2: Run both new test files**

Run:
```bash
npx vitest run src/cli/tests/classify-line.test.ts src/cli/tests/classify-block.test.ts
```
Expected: PASS — all `classify-line.test.ts` and `classify-block.test.ts` cases green.

- [x] **Step 3: Type-check the new module**

Run:
```bash
npx tsc --noEmit
```
Expected: clean (no errors). The new file has no consumers yet, so no downstream compile fanout.

- [x] **Step 4: Run the full suite to confirm no collateral damage**

Run:
```bash
npx vitest run
```
Expected: all green. The new module is unused; existing tests are untouched.

- [x] **Step 5: Commit**

```bash
git add src/cli/lib/classify-stream.ts src/cli/tests/classify-line.test.ts src/cli/tests/classify-block.test.ts
git commit -m "feat(cli/lib): add classifyLine + classifyBlock decoder module

New src/cli/lib/classify-stream.ts owns Claude CLI stream-json
protocol decoding via two pure functions returning discriminated
unions. No consumers wired yet — stream-formatter.ts continues to
use its inline parse/walk code. Lands the decoder seam ahead of
the rewire so tests can pin classifier semantics independently
of formatter state machine policy.

Per docs/superpowers/specs/2026-05-07-classify-line-block-shared-parser-design.md.
"
```

## Verification targets

- Smokes: None (no `pipelines/smoke/*.dot` files exist in this repo).
- Manual exercises: None — the module is unused after this chunk.
- Lint: `npx tsc --noEmit`; `npx vitest run src/cli/tests/classify-line.test.ts src/cli/tests/classify-block.test.ts`; `npx vitest run`.
- Surfaces touched: `src/cli/lib` (new module), `src/cli/tests` (two new unit tests). No `pipelines/surfaces.json` exists in this repo — this row names the two `src/` directories the change crosses.

---

## Chunk 2: Capture frozen fixture, rewire both consumers, replay-test byte-identical

This chunk is atomic per design §2.7 / §7.5: both `processLine` and `parseStreamJsonEvents` are rewired to call the classifiers in the same merge, and a replay test pins the byte-identical invariant against a frozen fixture captured from the pre-rewire branch. Layer 1 alone leaves Layer 2 duplication untouched — the design explicitly forbids staging.

### Task 2.1: Add the canned NDJSON fixture

**Files:**
- Create: `src/cli/tests/fixtures/classify-stream-replay.ndjson`

- [x] **Step 1: Write the fixture**

Create `src/cli/tests/fixtures/classify-stream-replay.ndjson` with the following exact content (each line is one JSON event; preserve trailing newline). The fixture covers system → main-agent assistant text → main-agent tool_use Agent (subagent open + buffered) → user tool_result (subagent close) → main-agent assistant text + ctx growth → result; this exercises every branch the rewired code touches.

```
{"type":"system","session_id":"sess-1","subtype":"init"}
{"type":"assistant","message":{"id":"msg-1","content":[{"type":"text","text":"hello"}],"usage":{"input_tokens":10,"cache_read_input_tokens":0,"cache_creation_input_tokens":0}}}
{"type":"assistant","message":{"id":"msg-2","content":[{"type":"tool_use","id":"tool_abc","name":"Agent","input":{"description":"sub-task","prompt":"do thing"}}],"usage":{"input_tokens":11,"cache_read_input_tokens":0,"cache_creation_input_tokens":0}}}
{"type":"assistant","parent_tool_use_id":"tool_abc","message":{"id":"msg-3","content":[{"type":"text","text":"sub-text"},{"type":"tool_use","id":"tool_xyz","name":"Read","input":{"file_path":"/tmp/a"}}]}}
{"type":"user","message":{"content":[{"type":"tool_result","tool_use_id":"tool_abc","content":"ok"}]}}
{"type":"assistant","message":{"id":"msg-4","content":[{"type":"text","text":"after sub"}],"usage":{"input_tokens":15,"cache_read_input_tokens":0,"cache_creation_input_tokens":0}}}
{"type":"result","stop_reason":"end_turn","result":"done","usage":{"input_tokens":15,"output_tokens":4}}
not-json-malformed-line
{"type":"foo","payload":1}
```

The trailing two lines exercise the `parse_error` and `unknown` event-type paths so the rewire's behaviour on those edges is also frozen.

### Task 2.2: Capture the expected outputs from the pre-rewire code

This task is a snapshot capture against the **current** `stream-formatter.ts` (before any rewire). The captured JSON is the frozen contract the post-rewire code must satisfy byte-identically.

**Files:**
- Create: `src/cli/tests/fixtures/classify-stream-replay.expected.json`

- [x] **Step 1: Write a one-shot capture script**

Create the file `scripts/capture-classify-stream-replay.ts` (this script is a build-time tool, deleted in Step 4 — do **not** check it in). The `.ts` extension lets `tsx` resolve the imported `.ts` source directly. Exact content:

```typescript
#!/usr/bin/env node
import { Readable } from "node:stream";
import { readFileSync, writeFileSync } from "node:fs";
import { streamEvents, parseStreamJsonEvents } from "../src/cli/lib/stream-formatter.ts";

const fixture = readFileSync("src/cli/tests/fixtures/classify-stream-replay.ndjson", "utf8");

async function collect<T>(gen: AsyncGenerator<T>): Promise<T[]> {
  const out: T[] = [];
  for await (const ev of gen) out.push(ev);
  return out;
}

const a = await collect(streamEvents(Readable.from([fixture])));
const b = await collect(parseStreamJsonEvents(Readable.from([fixture])));

writeFileSync(
  "src/cli/tests/fixtures/classify-stream-replay.expected.json",
  JSON.stringify({ streamEvents: a, streamJsonEvents: b }, null, 2) + "\n",
);
console.log(`captured: ${a.length} StreamEvents, ${b.length} StreamJsonEvents`);
```

- [x] **Step 2: Execute the capture against the current (pre-rewire) source**

Run:
```bash
npx tsx scripts/capture-classify-stream-replay.ts
```
Expected: `captured: <n> StreamEvents, <m> StreamJsonEvents` printed; the file `src/cli/tests/fixtures/classify-stream-replay.expected.json` exists with a `{ "streamEvents": [...], "streamJsonEvents": [...] }` JSON object.

The capture must run against the **unmodified** `stream-formatter.ts` — do not start Task 2.4 until this file exists. If `tsx` is not on the local PATH, install it once with `npm install --no-save tsx` then re-run; do not switch to a `.mjs` runner because importing a `.ts` source from `.mjs` is environment-dependent.

- [x] **Step 3: Sanity-check the captured shape**

Open `src/cli/tests/fixtures/classify-stream-replay.expected.json`. Verify:

- `streamEvents` array contains, in order: `main_agent_open`, `text` ("hello"), `ctx`, `subagent_open` (description "sub-task"), an indented `text` ("sub-text"), an indented `tool` (read /tmp/a), `subagent_close`, `text` ("after sub"), `ctx`, `main_agent_close` — this exercises the buffered subagent close at user-event time.
- `streamJsonEvents` array contains, in order: `system`, `assistant_delta` ("hello"), `tool_use` (Agent / tool_abc), `assistant_delta` ("sub-text"), `tool_use` (Read / tool_xyz), `tool_result` (tool_abc / "ok"), `assistant_delta` ("after sub"), `result`, `parse_error` (rawLine "not-json-malformed-line").

If the captured output does not match the above ordering, stop — the fixture or the capture script is wrong, not the source.

- [x] **Step 4: Delete the capture script and stage only the fixture pair**

Run:
```bash
rm scripts/capture-classify-stream-replay.ts
```

The script is a one-shot build artefact. The frozen JSON it produced is the durable contract.

### Task 2.3: Add the failing replay test

**Files:**
- Create: `src/cli/tests/classify-stream-replay.test.ts`

- [x] **Step 1: Write the failing test**

Create `src/cli/tests/classify-stream-replay.test.ts` with the following exact content:

```typescript
import { describe, it, expect } from "vitest";
import { Readable } from "node:stream";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { streamEvents, parseStreamJsonEvents } from "../lib/stream-formatter.js";

const here = dirname(fileURLToPath(import.meta.url));
const fixturePath = join(here, "fixtures", "classify-stream-replay.ndjson");
const expectedPath = join(here, "fixtures", "classify-stream-replay.expected.json");

const fixture = readFileSync(fixturePath, "utf8");
const expected = JSON.parse(readFileSync(expectedPath, "utf8")) as {
  streamEvents: unknown[];
  streamJsonEvents: unknown[];
};

async function collect<T>(gen: AsyncGenerator<T>): Promise<T[]> {
  const out: T[] = [];
  for await (const ev of gen) out.push(ev);
  return out;
}

describe("classify-stream replay (byte-identical invariant)", () => {
  it("streamEvents replay matches the frozen pre-rewire baseline", async () => {
    const got = await collect(streamEvents(Readable.from([fixture])));
    expect(got).toEqual(expected.streamEvents);
  });

  it("parseStreamJsonEvents replay matches the frozen pre-rewire baseline", async () => {
    const got = await collect(parseStreamJsonEvents(Readable.from([fixture])));
    expect(got).toEqual(expected.streamJsonEvents);
  });
});
```

- [x] **Step 2: Run the replay test against pre-rewire source — expect it to PASS**

Run:
```bash
npx vitest run src/cli/tests/classify-stream-replay.test.ts
```
Expected: PASS. The test was written to lock the **current** behaviour; against the unmodified `stream-formatter.ts` it must already pass. If it fails, the fixture or the captured JSON is wrong — fix Task 2.1 or 2.2 before continuing. Do **not** edit `stream-formatter.ts` to "make the replay pass" at this point.

### Task 2.4: Rewire `streamEvents` session sniff and `processLine` to consume the classifiers

**Files:**
- Modify: `src/cli/lib/stream-formatter.ts:88-112` (`streamEvents` session-id sniff)
- Modify: `src/cli/lib/stream-formatter.ts:120-296` (`processLine` body)

`streamEvents` at `:96-105` carries a third inline `JSON.parse(line)` decoder for sniffing `session_id` from the first `system` event before delegating to `processLine`. The design's §10.1 grep invariant (`JSON.parse(line)` returns 0 matches in `stream-formatter.ts` post-rewire) requires this third decoder to also route through `classifyLine`. The fix is mechanical: classify once per line at the top of the for-await loop, sniff `kind === "system"` for the optional `onSessionId` callback, then pass the *same* line to `processLine` (which classifies again — duplication is at the `classifyLine(line)` call, not the JSON.parse, and is acceptable because `classifyLine` is pure and cheap).

Independent rationale: `unwrapStructuredText` at `:35-47` legitimately calls `JSON.parse(trimmed)` on a single tool-result string blob, not on a stream line. That is **not** a stream-line decoder and stays. The grep in Task 2.6 Step 1 pins on the literal `JSON.parse(line)` substring — `unwrapStructuredText`'s call (`JSON.parse(trimmed)`) is unaffected.

- [x] **Step 1: Add the classifier import**

At the top of `src/cli/lib/stream-formatter.ts` (immediately after `import * as readline from "readline";` at `:1`), add:

```typescript
import { classifyLine, classifyBlock } from "./classify-stream.js";
```

- [x] **Step 2: Rewire the `streamEvents` session-id sniff**

Replace the `streamEvents` body (currently `src/cli/lib/stream-formatter.ts:88-112`) with the version below. The function signature, async-generator yield order, and `flushState` tail are unchanged; only the inline `JSON.parse(line)` sniff at `:99` is replaced.

```typescript
export async function* streamEvents(
  readable: NodeJS.ReadableStream,
  opts?: { onSessionId?: (id: string) => void }
): AsyncGenerator<StreamEvent> {
  const rl = readline.createInterface({ input: readable, crlfDelay: Infinity });
  let state = initialState();
  let sessionIdEmitted = false;

  for await (const line of rl) {
    if (!sessionIdEmitted && opts?.onSessionId) {
      const sniff = classifyLine(line);
      if (sniff.kind === "system" && typeof sniff.sessionId === "string") {
        opts.onSessionId(sniff.sessionId);
        sessionIdEmitted = true;
      }
    }
    const { events, nextState } = processLine(line, state);
    state = nextState;
    for (const e of events) yield e;
  }

  for (const e of flushState(state)) yield e;
}
```

Note: the prior code swallowed JSON-parse failures silently. The rewired version receives `kind: "parse_error"` from `classifyLine` and ignores it implicitly (the `if (sniff.kind === "system" ...)` guard fails for parse_error). Behaviour preserved.

- [x] **Step 3: Replace the body of `processLine`**

Replace the entire `processLine` function body (currently `src/cli/lib/stream-formatter.ts:120-296`) with the rewired version below. The function signature, return shape, and emitted `StreamEvent[]` ordering are unchanged. The state-machine policy (subagent buffering, header gating, ctx-token growth) stays inline; only the JSON.parse and per-block walks move out.

```typescript
export function processLine(
  line: string,
  state: FormatterState
): { events: StreamEvent[]; nextState: FormatterState } {
  const ev = classifyLine(line);

  // Non-actionable line kinds: parse_error, system, result, unknown.
  // Today's TUI swallows JSON parse failures (returns empty events) and
  // does not render system/result/unknown — preserve that.
  if (
    ev.kind === "parse_error" ||
    ev.kind === "system" ||
    ev.kind === "result" ||
    ev.kind === "unknown"
  ) {
    return { events: [], nextState: state };
  }

  // user-wrapped tool_result events (subagent close)
  if (ev.kind === "user") {
    const events: StreamEvent[] = [];
    const nextPending = new Set(state.pendingSubagentIds);
    const nextBuffers = new Map(state.subagentBuffers);
    const nextDescriptions = new Map(state.subagentDescriptions);
    const nextMainAgentOpen = state.mainAgentOpen;

    for (const item of ev.content) {
      const block = classifyBlock(item);
      if (block.kind === "tool_result") {
        const id = block.toolUseId;
        if (nextPending.has(id)) {
          const desc = nextDescriptions.get(id) ?? "";
          const buf = nextBuffers.get(id) ?? [];
          events.push({ type: "subagent_open", description: desc });
          events.push(...buf);
          events.push({ type: "subagent_close" });
          nextPending.delete(id);
          nextBuffers.delete(id);
          nextDescriptions.delete(id);
        }
      }
    }

    return {
      events,
      nextState: {
        ...state,
        pendingSubagentIds: nextPending,
        subagentBuffers: nextBuffers,
        subagentDescriptions: nextDescriptions,
        mainAgentOpen: nextMainAgentOpen,
      },
    };
  }

  // assistant
  const content = ev.content;
  const usage = ev.usage as Usage | undefined;
  const parentToolUseId = ev.parentToolUseId;

  // Subagent assistant events: buffer instead of emitting
  if (parentToolUseId) {
    const hasContent = content.some((b) => {
      const block = classifyBlock(b);
      return (
        block.kind === "tool_use" ||
        (block.kind === "text" && block.text.trim().length > 0)
      );
    });
    if (!hasContent) return { events: [], nextState: state };

    const nextBuffers = new Map(state.subagentBuffers);
    let buf = nextBuffers.get(parentToolUseId) ?? [];
    buf = [...buf]; // clone
    for (const raw of content) {
      const block = classifyBlock(raw);
      if (block.kind === "text") {
        buf.push({ type: "text", content: unwrapStructuredText(block.text), indented: true });
      } else if (block.kind === "tool_use") {
        const input = (block.input ?? {}) as Record<string, unknown>;
        const toolEvent = formatToolUse(block.name, input);
        buf.push({ ...toolEvent, indented: true });
      }
    }
    nextBuffers.set(parentToolUseId, buf);
    return {
      events: [],
      nextState: { ...state, subagentBuffers: nextBuffers },
    };
  }

  // Main agent assistant events
  const events: StreamEvent[] = [];
  const nextPending = new Set(state.pendingSubagentIds);
  const nextBuffers = new Map(state.subagentBuffers);
  const nextDescriptions = new Map(state.subagentDescriptions);
  let nextMainAgentOpen = state.mainAgentOpen;
  let nextLastMainCtxTotal = state.lastMainCtxTotal;

  // Skip events with no substantive content (no visible text or tool calls)
  const hasContent = content.some((b) => {
    const block = classifyBlock(b);
    return (
      block.kind === "tool_use" ||
      (block.kind === "text" && block.text.trim().length > 0)
    );
  });

  if (!hasContent) {
    return {
      events,
      nextState: {
        pendingSubagentIds: nextPending,
        subagentBuffers: nextBuffers,
        subagentDescriptions: nextDescriptions,
        mainAgentOpen: nextMainAgentOpen,
        lastMainCtxTotal: nextLastMainCtxTotal,
      },
    };
  }

  // Open main agent block when any content is non-Agent
  const hasNonAgentContent = content.some((b) => {
    const block = classifyBlock(b);
    return block.kind !== "tool_use" || block.name !== "Agent";
  });
  if (hasNonAgentContent && !nextMainAgentOpen) {
    events.push({ type: "main_agent_open" });
    nextMainAgentOpen = true;
  }

  for (const raw of content) {
    const block = classifyBlock(raw);
    if (block.kind === "text") {
      events.push({ type: "text", content: unwrapStructuredText(block.text) });
    } else if (block.kind === "tool_use") {
      const input = (block.input ?? {}) as Record<string, unknown>;
      if (block.name === "Agent") {
        const desc = String(input.description ?? input.prompt ?? "");
        if (nextMainAgentOpen) {
          events.push({ type: "main_agent_close" });
          nextMainAgentOpen = false;
        }
        // Subagent header is deferred to close time
        nextPending.add(block.id);
        nextDescriptions.set(block.id, desc);
        nextBuffers.set(block.id, []);
      } else {
        events.push(formatToolUse(block.name, input));
      }
    }
  }

  // Gate ctx line on growth — only emit when total increases and main agent is open
  if (nextMainAgentOpen && typeof usage?.input_tokens === "number") {
    const total =
      (usage.input_tokens ?? 0) +
      (usage.cache_read_input_tokens ?? 0) +
      (usage.cache_creation_input_tokens ?? 0);
    if (total > state.lastMainCtxTotal) {
      events.push({ type: "ctx", tokens: total });
      nextLastMainCtxTotal = total;
    }
  }

  return {
    events,
    nextState: {
      pendingSubagentIds: nextPending,
      subagentBuffers: nextBuffers,
      subagentDescriptions: nextDescriptions,
      mainAgentOpen: nextMainAgentOpen,
      lastMainCtxTotal: nextLastMainCtxTotal,
    },
  };
}
```

Notes for the implementer:
- The `Usage` type alias at `:114-118` stays where it is — it is the TUI-side projection of the wire `usage` object.
- `formatToolUse`, `unwrapStructuredText`, and `flushState` are unchanged; the rewire only replaces the inline parse + walk decisions.
- The `Agent` branch still gates `block.id` (now `string`, no longer needs `String(...)` coercion) — `classifyBlock` already enforces `id: string`.
- The "no substantive content" early-return path enumerates all five `nextState` keys explicitly rather than spreading `...state`. This is byte-equivalent to the pre-rewire `{ ...state, ... }` because all five keys are listed; it is preserved verbatim from the pre-rewire code (`stream-formatter.ts:228-238`).

- [x] **Step 4: Run the existing TUI test file**

Run:
```bash
npx vitest run src/cli/tests/stream-formatter.test.ts
```
Expected: PASS. The test pins on emitted `StreamEvent[]` shape (per ADR-0006); the rewire is event-shape-preserving.

- [x] **Step 5: Run the replay test — assert TUI half stays byte-identical**

Run:
```bash
npx vitest run src/cli/tests/classify-stream-replay.test.ts
```
Expected: the `streamEvents` case PASSES (TUI half rewired). The `parseStreamJsonEvents` case is still pre-rewire and must also PASS — it has not been touched yet.

### Task 2.5: Rewire `parseStreamJsonEvents` to consume `classifyLine` + `classifyBlock`

**Files:**
- Modify: `src/cli/lib/stream-formatter.ts:352-419`

- [x] **Step 1: Replace the body of `parseStreamJsonEvents`**

Replace the entire `parseStreamJsonEvents` function (currently `src/cli/lib/stream-formatter.ts:352-419`) with the rewired version below. The function signature, yielded `StreamJsonEvent` shape, and ordering are unchanged. `coerceSessionUsage` (`:341-350`) stays where it is — it owns the consumer-side `SessionUsage` projection.

```typescript
export async function* parseStreamJsonEvents(
  readable: NodeJS.ReadableStream,
): AsyncGenerator<StreamJsonEvent> {
  const rl = readline.createInterface({ input: readable, crlfDelay: Infinity });
  for await (const line of rl) {
    if (!line.trim()) continue;

    const ev = classifyLine(line);

    if (ev.kind === "parse_error") {
      yield { type: "parse_error", rawLine: ev.rawLine, error: ev.error };
      continue;
    }

    if (ev.kind === "system") {
      yield { type: "system", sessionId: ev.sessionId, raw: ev.raw };
      continue;
    }

    if (ev.kind === "assistant") {
      for (const raw of ev.content) {
        const block = classifyBlock(raw);
        if (block.kind === "text") {
          yield { type: "assistant_delta", textDelta: block.text, messageId: ev.messageId };
        } else if (block.kind === "tool_use") {
          yield {
            type: "tool_use",
            toolCall: { id: block.id, name: block.name, input: block.input },
            messageId: ev.messageId,
          };
        }
      }
      continue;
    }

    if (ev.kind === "user") {
      for (const raw of ev.content) {
        const block = classifyBlock(raw);
        if (block.kind === "tool_result") {
          yield {
            type: "tool_result",
            toolCallId: block.toolUseId,
            content:
              typeof block.content === "string"
                ? block.content
                : JSON.stringify(block.content ?? ""),
            isError: block.isError,
          };
        }
      }
      continue;
    }

    if (ev.kind === "result") {
      yield {
        type: "result",
        stopReason: ev.stopReason || "end_turn",
        text: ev.text,
        usage: coerceSessionUsage(ev.usage),
        raw: ev.raw,
      };
      continue;
    }

    // ev.kind === "unknown" — forward-compat with CLI updates (matches the
    // pre-rewire silent fall-through at the old :417).
  }
}
```

Notes for the implementer:
- The `stopReason || "end_turn"` defaulting stays at the consumer site because the published `StreamJsonEvent.result` contract uses `"end_turn"` as the default. The classifier deliberately preserves the empty string so the consumer can decide.
- The string-coerce on `tool_result.content` stays at the consumer site because `StreamJsonEvent.tool_result.content` is typed `string`; the classifier preserves the raw shape (`unknown`).
- The `unknown` kind is the explicit replacement for the prior implicit `// unknown event types are silently ignored — forward-compat with CLI updates` comment at `:417`. Behaviour is unchanged.

- [x] **Step 2: Run the existing raw-iterator test file**

Run:
```bash
npx vitest run src/cli/tests/stream-json-events.test.ts
```
Expected: PASS. Test pins on yielded `StreamJsonEvent` shape; the rewire is yield-preserving.

- [x] **Step 3: Run the replay test — assert both halves byte-identical**

Run:
```bash
npx vitest run src/cli/tests/classify-stream-replay.test.ts
```
Expected: both cases PASS — `streamEvents` already green from Task 2.4, `parseStreamJsonEvents` now also green after the rewire.

### Task 2.6: Verify the deletion via grep — old parse/walk code is gone

These greps are part of the design's §10.1 static checks. Each must produce zero matches inside `stream-formatter.ts`; matches elsewhere (e.g. inside `classify-stream.ts` or test fixtures) are fine.

- [x] **Step 1: Grep `JSON.parse(line)` in stream-formatter.ts — expect 0 matches**

Run:
```bash
grep -n 'JSON\.parse(line)' src/cli/lib/stream-formatter.ts || echo "OK: no matches"
```
Expected: `OK: no matches`.

Two notes for the implementer:
- `unwrapStructuredText` at `:35-47` calls `JSON.parse(trimmed)` — that is **not** a stream-line parse and stays. The grep above pins on the literal substring `JSON.parse(line)`, so `JSON.parse(trimmed)` is naturally exempt.
- The `streamEvents` session-id sniff that previously called `JSON.parse(line)` at the pre-rewire `:99` was rewired in Task 2.4 Step 2 to use `classifyLine` instead. After the full Chunk 2 rewire, all three former call sites (`streamEvents`, `processLine`, `parseStreamJsonEvents`) route through `classifyLine`, leaving zero `JSON.parse(line)` substrings in the file.

- [x] **Step 2: Grep event-type string dispatch in stream-formatter.ts — expect 0 matches**

Run (the patterns use `grep -E` so `|` is alternation, not literal):
```bash
grep -nE 'event\.type === |t === "system"|t === "assistant"|t === "user"|t === "result"' src/cli/lib/stream-formatter.ts || echo "OK: no matches"
```
Expected: `OK: no matches`.

Bidirectional sanity (optional, advisory): before applying the rewire, the same command should print matches at the pre-rewire lines (`:132`, `:170`, `:368`, `:374`, `:394`, `:408`). If the pre-rewire grep prints zero matches, the regex is wrong; if the post-rewire grep prints any matches, the rewire missed a site.

- [x] **Step 3: Grep block-type string dispatch in stream-formatter.ts — expect 0 matches**

Run (`-E` again — the alternation is literal otherwise):
```bash
grep -nE 'block\.type === |b\.type === "text"|b\.type === "tool_use"|b\.type === "tool_result"' src/cli/lib/stream-formatter.ts || echo "OK: no matches"
```
Expected: `OK: no matches`. After the rewire, all per-block decisions go through `classifyBlock` and the consumers switch on `block.kind`. Bidirectional sanity (optional): pre-rewire should match the per-block walks at `:143`, `:184`, `:195`, `:197`, `:222`, `:243`, `:253`, `:255`, `:380`, `:382`, `:399`.

- [x] **Step 4: Confirm the public surface is unchanged**

Run:
```bash
grep -n '^export ' src/cli/lib/stream-formatter.ts
```
Expected: the exported names are exactly — `StreamEvent`, `FormatterState`, `initialState`, `flushState`, `streamEvents`, `processLine`, `serializeEvent`, `StreamJsonEvent`, `parseStreamJsonEvents`. No additions, no removals.

### Task 2.7: Run the full suite + type check + smoke the production consumers compile

- [x] **Step 1: Type-check the whole repo**

Run:
```bash
npx tsc --noEmit
```
Expected: clean. The discriminated unions force exhaustive handling at every consumer site; missing a `kind` would surface here.

- [x] **Step 2: Run the full vitest suite**

Run:
```bash
npx vitest run
```
Expected: all green. In particular: `src/cli/tests/stream-formatter.test.ts`, `src/cli/tests/stream-json-events.test.ts`, `src/cli/tests/stream-json-input.test.ts`, `src/cli/tests/parseClaudeEvent.test.ts`, `src/cli/tests/pipeline.test.ts`, `src/cli/tests/pipeline-headless.test.ts` — none of these are touched by this chunk; their continued green is the consumer-side regression check.

- [x] **Step 3: Spot-check the two production consumers still compile against the unchanged exports**

Run:
```bash
grep -n 'parseStreamJsonEvents\|streamEvents' src/cli/lib/agent.ts src/cli/commands/pipeline/run.ts
```
Expected: imports/uses identical to the pre-chunk state — `src/cli/lib/agent.ts` imports `parseStreamJsonEvents`; `src/cli/commands/pipeline/run.ts` imports both `parseStreamJsonEvents` and `streamEvents`. No edits required, as design §4.4 predicted.

### Task 2.8: Commit the rewire

- [x] **Step 1: Stage and commit**

```bash
git add src/cli/lib/stream-formatter.ts src/cli/tests/fixtures/classify-stream-replay.ndjson src/cli/tests/fixtures/classify-stream-replay.expected.json src/cli/tests/classify-stream-replay.test.ts
git commit -m "refactor(cli/lib): rewire stream-formatter to use classify-stream

processLine and parseStreamJsonEvents now share JSON-line decoding
and per-block walks via classifyLine + classifyBlock. Five duplicated
walks (lines 141-155, 192-203, 251-272, 378-393, 397-405) and two
duplicated JSON.parse + try/catch blocks (lines 124-129, 359-365)
collapse onto the single decoder seam. Public exports keep their
signatures; production consumers (src/cli/lib/agent.ts,
src/cli/commands/pipeline/run.ts) need no changes.

The new classify-stream-replay fixture freezes the byte-identical
behaviour of streamEvents and parseStreamJsonEvents against a
canned NDJSON corpus; the replay test pins both halves.

Per docs/superpowers/specs/2026-05-07-classify-line-block-shared-parser-design.md.
"
```

- [x] **Step 2: Final sanity — replay green, full suite green, tsc clean**

Run, in this order:
```bash
npx vitest run src/cli/tests/classify-stream-replay.test.ts
npx tsc --noEmit
npx vitest run
```
Expected: all three pass. If any fail post-commit, revert with `git revert HEAD` rather than amending — the chunk is small enough that a forward-fix commit is safe and cleaner.

## Verification targets

- Smokes: None (no `pipelines/smoke/*.dot` files exist in this repo).
- Manual exercises: Optional — run `apparat pipeline run <any pipeline that streams a TUI>` and visually confirm the formatted output matches the pre-rewire baseline. Behaviour is byte-identical per the replay test, so this is for sanity only.
- Lint: `npx tsc --noEmit` (Task 2.7 Step 1); `npx vitest run src/cli/tests/classify-stream-replay.test.ts` (Task 2.5 Step 3, Task 2.8 Step 2); `npx vitest run` (Task 2.7 Step 2, Task 2.8 Step 2).
- Surfaces touched: `src/cli/lib` (rewired `stream-formatter.ts`), `src/cli/tests` (new replay test + fixture pair). No `pipelines/surfaces.json` exists in this repo — this row names the two `src/` directories the change crosses. No CLI flag, agent schema, pipeline node attribute, or MCP tool surface is touched.
