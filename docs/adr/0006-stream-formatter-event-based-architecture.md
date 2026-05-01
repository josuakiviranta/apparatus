# 0006: Stream formatter is event-based, not string-based

**Date:** 2026-05-01
**Status:** Accepted (salvaged from docs/specs/stream-formatter.md before deletion)

## Context

The Claude Code CLI emits a streaming JSON-line transcript. ralph-cli's `stream-formatter` (`src/cli/lib/stream-formatter.ts`) consumes that stream and produces output that the CLI's UI layer renders.

An earlier design returned formatted strings directly from `processLine()`, with subagent buffers stored as accumulated indented text. The current design returns a structured `StreamEvent` union and stores per-subagent buffers as `Map<string, StreamEvent[]>`. Rendering is delegated to `serializeEvent()` and to React/Ink components (`PipelineApp.tsx`, `ui.tsx`).

From the spec being salvaged (`docs/specs/stream-formatter.md`):

> ```typescript
> export type StreamEvent =
>   | { type: "main_agent_open" }
>   | { type: "main_agent_close" }
>   | { type: "subagent_open"; description: string }
>   | { type: "subagent_close" }
>   | { type: "text"; content: string; indented?: boolean }
>   | { type: "tool"; name: string; label: string; indented?: boolean }
>   | { type: "ctx"; tokens: number };
> ```

## Decision

`stream-formatter` produces typed events, not strings. The public API is `streamEvents()` (an async generator wrapping readline), with `processLine()` retained as a lower-level primitive. Rendering is the consumer's responsibility — `serializeEvent()` exists for plain-text output, while Ink components consume events directly to drive React-style re-renders.

## Consequences

**Positive:**
- Multiple UI backends (Ink TUI, plain-text terminal, JSON export, future tooling) can consume the same event stream without duplicating parsing logic.
- Subagent header deferral (only printing on close, when the description is final) is expressible as a buffer-then-emit transformation rather than a string-substitution hack.
- Tests assert on event shape, not on whitespace-sensitive rendered output.

**Negative:**
- Two-step pipeline (parse → render) is more code than direct string emission. Each new event type requires updating both producer and consumer.
- Consumers that want raw rendered text must call `serializeEvent()` themselves; a one-line caller now needs two imports.

## Related

- Salvaged from `docs/specs/stream-formatter.md` on 2026-05-01 during the source-as-truth excision
- See ADR-0004 for the broader excision rationale
- Spec: `docs/superpowers/specs/2026-05-01-source-as-truth-no-behavioral-specs-design.md`
