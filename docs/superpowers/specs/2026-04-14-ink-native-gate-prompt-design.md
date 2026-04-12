# Ink-Native Gate Prompt — Design Spec

## Overview

When a `hexagon` (wait.human) node fires in the pipeline, the current `ConsoleInterviewer`
writes the prompt and numbered choices to raw stdout via Node.js `readline`. Because Ink also
owns stdout for its render loop, the two conflict: Ink re-renders over the readline output,
erasing all options after the first, producing a double block header, and leaving raw text
above the Ink frame.

This spec replaces `ConsoleInterviewer` in the TUI path with an `InkInterviewer` that routes
the gate prompt entirely through the existing NodeEvent/reducer pipeline. No engine code
changes. All three rendering bugs are eliminated.

## Root Cause (confirmed via tmux debugging)

Three bugs observed in `pipelines/gate-test.dot`:

1. **Options after #1 overwritten** — Ink re-renders the block header over the readline
   output, erasing `2. Decline`, `3. Chat`, and `Choice:`.
2. **Double block header** — The gate node's header line appears twice (once live, once
   frozen) because readline's own prompt text duplicates the Ink-rendered line.
3. **Raw text above Ink frame** — The question text and numbered list from readline land
   above the Ink frame with no visual integration.

## Architecture

### Data Flow

```
WaitHumanHandler.execute()
  → interviewer.ask({ prompt, options: ["Approve","Decline","Chat"] })

InkInterviewer.ask()                              [new]
  → emits { kind: "gate-ready", options, onChoose }
  → returns Promise<Answer>  (pending until onChoose is called)

pipelineReducer  handles "gate-ready"
  → stores { options, onChoose } on live.gate

LiveFooter renders GateSelector                   [new]
  → numbered list, ▶ cursor on selected item
  → useInput: ↑↓ navigate, Enter or digit to confirm

User presses Enter on "Approve"
  → GateSelector calls live.gate.onChoose("Approve")
  → InkInterviewer also emits { kind: "text", role: "you", text: "Approve" }
  → Promise resolves with { value: "Approve" }
  → WaitHumanHandler returns { status: "success", preferredLabel: "Approve" }
  → engine routes to "Approve" edge, emits "end"
  → block freezes:
      ━━ [1] approval_gate · Do you approve?
        you: Approve
        ✓ success · 0 turns · 0/0 tok · 1.2s
```

### Invariants Preserved

- Reducer stores `onChoose` but never calls it — same pattern as `child`/`onDone` on
  `interactive-ready`.
- `patchConsole: false` — no readline or console writes during the gate prompt.
- `ConsoleInterviewer` remains unchanged and still used by non-TUI callers.

## Types

### `pipelineEvents.ts` — new NodeEvent variant

```ts
| { kind: "gate-ready"; options: string[]; onChoose: (choice: string) => void }
```

### `pipelineEvents.ts` — LiveBlock extension

```ts
export type LiveBlock = {
  // ...existing fields unchanged...
  gate?: {
    options: string[];
    onChoose: (choice: string) => void;
  };
};
```

### `pipelineReducer.ts` — new case

```ts
case "gate-ready": {
  if (!state.live) return state;
  return {
    ...state,
    live: { ...state.live, gate: { options: event.options, onChoose: event.onChoose } },
  };
}
```

## Components

### `src/cli/components/GateSelector.tsx` (new)

```tsx
export function GateSelector({ options, onChoose }: {
  options: string[];
  onChoose: (choice: string) => void;
}) {
  const [selected, setSelected] = useState(0);

  useInput((input, key) => {
    if (key.upArrow)   setSelected(i => Math.max(0, i - 1));
    if (key.downArrow) setSelected(i => Math.min(options.length - 1, i + 1));
    if (key.return)    onChoose(options[selected]);
    const digit = parseInt(input);
    if (!isNaN(digit) && digit >= 1 && digit <= options.length)
      onChoose(options[digit - 1]);
  });

  return (
    <Box flexDirection="column" marginLeft={2}>
      {options.map((opt, i) => (
        <Text key={i} color={i === selected ? "green" : undefined}>
          {i === selected ? "▶ " : "  "}{i + 1}. {opt}
        </Text>
      ))}
      <Text dimColor>{"  "}↑↓ navigate · Enter or 1-{options.length} to choose</Text>
    </Box>
  );
}
```

### `src/cli/components/LiveFooter.tsx` — two changes

1. Render `GateSelector` between body lines and status line when `block.gate` is set:
   ```tsx
   {block.gate && (
     <GateSelector options={block.gate.options} onChoose={block.gate.onChoose} />
   )}
   ```

2. Special-case status line for `wait-human` kind (no spinner, no token counts):
   ```ts
   if (block.kind === "wait-human") {
     return `  awaiting choice · ${formatElapsed(block.startedAt)}`;
   }
   ```

### `src/attractor/interviewer/ink.ts` (new)

```ts
import type { Interviewer, Question, Answer } from "./index.js";
import type { NodeEvent } from "../../cli/lib/pipelineEvents.js";

export class InkInterviewer implements Interviewer {
  constructor(private emit: (e: NodeEvent) => void) {}

  async ask(q: Question): Promise<Answer> {
    return new Promise((resolve) => {
      this.emit({
        kind: "gate-ready",
        options: q.options ?? ["continue"],
        onChoose: (choice) => {
          this.emit({ kind: "text", role: "you", text: choice });
          resolve({ value: choice });
        },
      });
    });
  }
}
```

### `src/cli/commands/pipeline.ts` — one-line swap

```ts
// Before:
interviewer: process.stdin.isTTY ? new ConsoleInterviewer() : new AutoApproveInterviewer(),

// After:
interviewer: process.stdin.isTTY
  ? new InkInterviewer(callbacks.emit)
  : new AutoApproveInterviewer(),
```

## Files Changed

| File | Change |
|------|--------|
| `src/cli/lib/pipelineEvents.ts` | Add `gate-ready` to `NodeEvent`; add `gate?` to `LiveBlock` |
| `src/cli/lib/pipelineReducer.ts` | Handle `gate-ready` case |
| `src/cli/components/GateSelector.tsx` | New component |
| `src/cli/components/LiveFooter.tsx` | Render `GateSelector`; special-case status for `wait-human` |
| `src/attractor/interviewer/ink.ts` | New `InkInterviewer` class |
| `src/cli/commands/pipeline.ts` | Swap to `InkInterviewer` for TTY path |

## Tests

### Unit tests

- `GateSelector.test.tsx` — renders all options, ▶ on selected, arrow nav, Enter confirm,
  digit confirm
- `pipelineReducer.test.ts` — `gate-ready` stores gate on live; existing cases unaffected
- `InkInterviewer.test.ts` — emits `gate-ready` event, emits `text` event on resolve,
  promise resolves with correct value

### Tmux integration test

After implementation, run `pipelines/gate-test.dot` inside the tmux harness to verify the
three bugs are fixed:

1. Source helpers from `docs/harness/tmux-drive.md`.
2. `start_run "ralph pipeline run pipelines/gate-test.dot"`
3. `wait_for_string "▶ 1. Approve" 30000` — confirms GateSelector is rendering inside Ink
   (not via readline). If this times out, the fix did not land.
4. `capture` — verify:
   - `▶ 1. Approve` appears **inside** the `━━ [1] approval_gate` block, not above it
   - `2. Decline` is visible (was previously overwritten)
   - The block header appears **exactly once** (not duplicated)
   - No raw readline text above the Ink frame
5. `tmux send-keys -t "$SESSION:$WIN" Down` — move cursor to Decline
6. `wait_stable 1000`
7. `capture` — verify `▶ 2. Decline` is now highlighted
8. `tmux send-keys -t "$SESSION:$WIN" Up` — move back to Approve
9. `wait_stable 1000`
10. `tmux send-keys -t "$SESSION:$WIN" Enter` — confirm choice
11. `wait_for_string "you: Approve" 30000` — confirms body line emitted
12. `wait_for_string "✓ success" 60000` — confirms gate block frozen correctly
13. `capture` — final snapshot for manual review
14. `cleanup_run`

Capture files land in `~/.ralph/harness/<run-id>/`. Diff consecutive captures to verify
exactly what changed between arrow-key steps.
