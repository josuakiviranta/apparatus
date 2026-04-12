# Ink-Native Gate Prompt Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [x]`) syntax for tracking.

**Goal:** Replace the `ConsoleInterviewer` readline prompt with an Ink-native numbered-list selector so `wait-human` gate nodes render entirely inside the Ink TUI frame.

**Architecture:** A new `InkInterviewer` class emits a `gate-ready` NodeEvent carrying the options and a resolve callback. The reducer stores this on `live.gate`. A new `GateSelector` component inside `LiveFooter` handles arrow-key navigation and calls the callback on confirm. No engine code changes.

**Tech Stack:** TypeScript, Ink (React for terminals), Vitest, ink-testing-library, tmux harness (`docs/harness/tmux-drive.md`)

**Spec:** `docs/superpowers/specs/2026-04-14-ink-native-gate-prompt-design.md`

---

## Chunk 1: Types — `pipelineEvents.ts`

**Files:**
- Modify: `src/cli/lib/pipelineEvents.ts`
- Modify: `src/cli/tests/pipelineReducer.test.ts` (TypeScript compile check only — no new tests here)

### Task 1.1: Add `gate-ready` to `NodeEvent` and `gate?` to `LiveBlock`

- [x] **Step 1: Read the current file**

  Read `src/cli/lib/pipelineEvents.ts` in full before editing.

- [x] **Step 2: Add `gate-ready` variant to `NodeEvent`**

  Append this line to the `NodeEvent` union (after `interactive-ready`, before the closing semicolon):

  ```ts
  | { kind: "gate-ready"; options: string[]; onChoose: (choice: string) => void }
  ```

- [x] **Step 3: Add `gate?` field to `LiveBlock`**

  Inside `LiveBlock`, add this optional field after `onDone?`:

  ```ts
  gate?: {
    options: string[];
    onChoose: (choice: string) => void;
  };
  ```

- [x] **Step 4: Verify TypeScript compiles**

  Run: `npm run build 2>&1 | tail -5`

  Expected: `Build success` (the new union variant and new field are additive; no existing code breaks).

- [x] **Step 5: Commit**

  ```bash
  git add src/cli/lib/pipelineEvents.ts
  git commit -m "feat(pipeline): add gate-ready NodeEvent and gate field to LiveBlock"
  ```

---

## Chunk 2: Reducer — `pipelineReducer.ts`

**Files:**
- Modify: `src/cli/lib/pipelineReducer.ts`
- Modify: `src/cli/tests/pipelineReducer.test.ts`

### Task 2.1: Write failing test for `gate-ready`

- [x] **Step 1: Read the current test file**

  Read `src/cli/tests/pipelineReducer.test.ts` in full.

- [x] **Step 2: Append a new describe block**

  Add this block at the end of the test file:

  ```ts
  describe("pipelineReducer — gate-ready", () => {
    it("stores options and onChoose on live.gate", () => {
      let s = pipelineReducer(initialPipelineState, {
        kind: "start", nodeId: "g", label: "Gate?", blockKind: "wait-human",
      });
      const onChoose = vi.fn();
      s = pipelineReducer(s, { kind: "gate-ready", options: ["Yes", "No"], onChoose });
      expect(s.live?.gate?.options).toEqual(["Yes", "No"]);
      expect(s.live?.gate?.onChoose).toBe(onChoose);
    });

    it("is a no-op when live is null", () => {
      const onChoose = vi.fn();
      const s = pipelineReducer(initialPipelineState, {
        kind: "gate-ready", options: ["Yes"], onChoose,
      });
      expect(s).toEqual(initialPipelineState);
    });

    it("does not call onChoose (reducer never invokes callbacks)", () => {
      let s = pipelineReducer(initialPipelineState, {
        kind: "start", nodeId: "g", label: "Gate?", blockKind: "wait-human",
      });
      const onChoose = vi.fn();
      s = pipelineReducer(s, { kind: "gate-ready", options: ["Yes"], onChoose });
      expect(onChoose).not.toHaveBeenCalled();
    });

    it("gate-ready does not affect frozen array", () => {
      let s = pipelineReducer(initialPipelineState, {
        kind: "start", nodeId: "g", label: "Gate?", blockKind: "wait-human",
      });
      s = pipelineReducer(s, {
        kind: "gate-ready", options: ["Yes"], onChoose: vi.fn(),
      });
      expect(s.frozen).toHaveLength(0);
    });
  });
  ```

- [x] **Step 3: Run the tests to verify they fail**

  Run: `npx vitest run src/cli/tests/pipelineReducer.test.ts 2>&1 | tail -20`

  Expected: tests fail with `is not a function` or `undefined` on `live?.gate`.

### Task 2.2: Implement `gate-ready` case in reducer

- [x] **Step 1: Read the current reducer**

  Read `src/cli/lib/pipelineReducer.ts` in full.

- [x] **Step 2: Add the `gate-ready` case**

  Inside the `switch (event.kind)` block, add this case after the `interactive-ready` case:

  ```ts
  case "gate-ready": {
    if (!state.live) return state;
    return {
      ...state,
      live: { ...state.live, gate: { options: event.options, onChoose: event.onChoose } },
    };
  }
  ```

- [x] **Step 3: Run tests to verify they pass**

  Run: `npx vitest run src/cli/tests/pipelineReducer.test.ts 2>&1 | tail -10`

  Expected: all tests pass.

- [x] **Step 4: Run full test suite to check for regressions**

  Run: `npx vitest run 2>&1 | tail -10`

  Expected: all tests pass.

- [x] **Step 5: Commit**

  ```bash
  git add src/cli/lib/pipelineReducer.ts src/cli/tests/pipelineReducer.test.ts
  git commit -m "feat(pipeline): handle gate-ready in pipelineReducer"
  ```

---

## Chunk 3: `InkInterviewer`

**Files:**
- Create: `src/attractor/interviewer/ink.ts`
- Create: `src/attractor/tests/ink-interviewer.test.ts`

### Task 3.1: Write failing test for `InkInterviewer`

- [x] **Step 1: Read the interviewer interface**

  Read `src/attractor/interviewer/index.ts`. Key types: `Question`, `Answer`, `Interviewer`.

- [x] **Step 2: Create the test file**

  Create `src/attractor/tests/ink-interviewer.test.ts`:

  ```ts
  import { describe, it, expect, vi } from "vitest";
  import { InkInterviewer } from "../interviewer/ink.js";
  import type { NodeEvent } from "../../cli/lib/pipelineEvents.js";

  function makeInterviewer() {
    const emitted: NodeEvent[] = [];
    const emit = (e: NodeEvent) => emitted.push(e);
    const interviewer = new InkInterviewer(emit);
    return { interviewer, emitted };
  }

  describe("InkInterviewer", () => {
    it("emits gate-ready with the provided options", async () => {
      const { interviewer, emitted } = makeInterviewer();
      // don't await — the promise is pending until onChoose is called
      const promise = interviewer.ask({
        type: "MULTIPLE_CHOICE",
        prompt: "Proceed?",
        options: ["Approve", "Decline"],
      });

      expect(emitted).toHaveLength(1);
      expect(emitted[0].kind).toBe("gate-ready");
      if (emitted[0].kind === "gate-ready") {
        expect(emitted[0].options).toEqual(["Approve", "Decline"]);
      }

      // resolve so vitest doesn't hang
      if (emitted[0].kind === "gate-ready") emitted[0].onChoose("Approve");
      await promise;
    });

    it("falls back to ['continue'] when options is undefined", async () => {
      const { interviewer, emitted } = makeInterviewer();
      const promise = interviewer.ask({ type: "FREEFORM", prompt: "Go?" });
      expect(emitted[0].kind).toBe("gate-ready");
      if (emitted[0].kind === "gate-ready") {
        expect(emitted[0].options).toEqual(["continue"]);
        emitted[0].onChoose("continue");
      }
      await promise;
    });

    it("emits text event with chosen value when onChoose is called", async () => {
      const { interviewer, emitted } = makeInterviewer();
      const promise = interviewer.ask({
        type: "MULTIPLE_CHOICE",
        prompt: "Proceed?",
        options: ["Approve", "Decline"],
      });
      if (emitted[0].kind === "gate-ready") emitted[0].onChoose("Approve");
      await promise;

      expect(emitted).toHaveLength(2);
      expect(emitted[1]).toEqual({ kind: "text", role: "you", text: "Approve" });
    });

    it("resolves the promise with the chosen value", async () => {
      const { interviewer, emitted } = makeInterviewer();
      const promise = interviewer.ask({
        type: "MULTIPLE_CHOICE",
        prompt: "Proceed?",
        options: ["Approve", "Decline"],
      });
      if (emitted[0].kind === "gate-ready") emitted[0].onChoose("Decline");
      const answer = await promise;
      expect(answer).toEqual({ value: "Decline" });
    });
  });
  ```

- [x] **Step 3: Run tests to verify they fail**

  Run: `npx vitest run src/attractor/tests/ink-interviewer.test.ts 2>&1 | tail -10`

  Expected: fail with module-not-found for `../interviewer/ink.js`.

### Task 3.2: Implement `InkInterviewer`

- [x] **Step 1: Create `src/attractor/interviewer/ink.ts`**

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

- [x] **Step 2: Run tests to verify they pass**

  Run: `npx vitest run src/attractor/tests/ink-interviewer.test.ts 2>&1 | tail -10`

  Expected: 4 tests pass.

- [x] **Step 3: Run full test suite**

  Run: `npx vitest run 2>&1 | tail -10`

  Expected: all tests pass.

- [x] **Step 4: Commit**

  ```bash
  git add src/attractor/interviewer/ink.ts src/attractor/tests/ink-interviewer.test.ts
  git commit -m "feat(interviewer): add InkInterviewer for Ink-native gate prompts"
  ```

---

## Chunk 4: `GateSelector` component

**Files:**
- Create: `src/cli/components/GateSelector.tsx`
- Create: `src/cli/tests/GateSelector.test.tsx`

### Task 4.1: Write failing tests for `GateSelector`

- [x] **Step 1: Create the test file**

  Create `src/cli/tests/GateSelector.test.tsx`:

  ```tsx
  import React from "react";
  import { describe, it, expect, vi } from "vitest";
  import { render } from "ink-testing-library";
  import { GateSelector } from "../components/GateSelector.js";

  describe("GateSelector", () => {
    it("renders all options with ▶ on the first by default", () => {
      const { lastFrame } = render(
        <GateSelector options={["Approve", "Decline"]} onChoose={vi.fn()} />
      );
      const frame = lastFrame() ?? "";
      expect(frame).toContain("▶ 1. Approve");
      expect(frame).toContain("  2. Decline");
    });

    it("renders the hint line", () => {
      const { lastFrame } = render(
        <GateSelector options={["Yes", "No"]} onChoose={vi.fn()} />
      );
      const frame = lastFrame() ?? "";
      expect(frame).toContain("↑↓ navigate");
      expect(frame).toContain("1-2 to choose");
    });

    it("moves ▶ down on down-arrow keypress", () => {
      const { lastFrame, stdin } = render(
        <GateSelector options={["Approve", "Decline"]} onChoose={vi.fn()} />
      );
      stdin.write("\u001B[B"); // down arrow ANSI
      const frame = lastFrame() ?? "";
      expect(frame).toContain("  1. Approve");
      expect(frame).toContain("▶ 2. Decline");
    });

    it("clamps at the last option on repeated down-arrow", () => {
      const { lastFrame, stdin } = render(
        <GateSelector options={["A", "B"]} onChoose={vi.fn()} />
      );
      stdin.write("\u001B[B");
      stdin.write("\u001B[B"); // past end
      const frame = lastFrame() ?? "";
      expect(frame).toContain("▶ 2. B");
    });

    it("moves ▶ back up on up-arrow keypress", () => {
      const { lastFrame, stdin } = render(
        <GateSelector options={["Approve", "Decline"]} onChoose={vi.fn()} />
      );
      stdin.write("\u001B[B"); // down
      stdin.write("\u001B[A"); // up
      const frame = lastFrame() ?? "";
      expect(frame).toContain("▶ 1. Approve");
    });

    it("calls onChoose with the selected option on Enter", () => {
      const onChoose = vi.fn();
      const { stdin } = render(
        <GateSelector options={["Approve", "Decline"]} onChoose={onChoose} />
      );
      stdin.write("\r"); // Enter
      expect(onChoose).toHaveBeenCalledWith("Approve");
    });

    it("calls onChoose immediately on digit keypress", () => {
      const onChoose = vi.fn();
      const { stdin } = render(
        <GateSelector options={["Approve", "Decline"]} onChoose={onChoose} />
      );
      stdin.write("2");
      expect(onChoose).toHaveBeenCalledWith("Decline");
    });

    it("ignores out-of-range digit", () => {
      const onChoose = vi.fn();
      const { stdin } = render(
        <GateSelector options={["Approve", "Decline"]} onChoose={onChoose} />
      );
      stdin.write("9");
      expect(onChoose).not.toHaveBeenCalled();
    });
  });
  ```

- [x] **Step 2: Run tests to verify they fail**

  Run: `npx vitest run src/cli/tests/GateSelector.test.tsx 2>&1 | tail -10`

  Expected: fail with module-not-found for `GateSelector.js`.

### Task 4.2: Implement `GateSelector`

- [x] **Step 1: Create `src/cli/components/GateSelector.tsx`**

  ```tsx
  import React, { useState } from "react";
  import { Box, Text, useInput } from "ink";

  export function GateSelector({
    options,
    onChoose,
  }: {
    options: string[];
    onChoose: (choice: string) => void;
  }) {
    const [selected, setSelected] = useState(0);

    useInput((input, key) => {
      if (key.upArrow) setSelected((i) => Math.max(0, i - 1));
      if (key.downArrow) setSelected((i) => Math.min(options.length - 1, i + 1));
      if (key.return) onChoose(options[selected]);
      const digit = parseInt(input);
      if (!isNaN(digit) && digit >= 1 && digit <= options.length) {
        onChoose(options[digit - 1]);
      }
    });

    return (
      <Box flexDirection="column" marginLeft={2}>
        {options.map((opt, i) => (
          <Text key={i} color={i === selected ? "green" : undefined}>
            {i === selected ? "▶ " : "  "}
            {i + 1}. {opt}
          </Text>
        ))}
        <Text dimColor>{"  "}↑↓ navigate · Enter or 1-{options.length} to choose</Text>
      </Box>
    );
  }
  ```

- [x] **Step 2: Run tests to verify they pass**

  Run: `npx vitest run src/cli/tests/GateSelector.test.tsx 2>&1 | tail -10`

  Expected: 8 tests pass.

- [x] **Step 3: Run full test suite**

  Run: `npx vitest run 2>&1 | tail -10`

  Expected: all tests pass.

- [x] **Step 4: Commit**

  ```bash
  git add src/cli/components/GateSelector.tsx src/cli/tests/GateSelector.test.tsx
  git commit -m "feat(tui): add GateSelector component for Ink-native gate prompts"
  ```

---

## Chunk 5: Wire `GateSelector` into `LiveFooter`

**Files:**
- Modify: `src/cli/components/LiveFooter.tsx`
- Modify: `src/cli/tests/LiveFooter.test.tsx`

### Task 5.1: Write failing tests

- [x] **Step 1: Read the current test file**

  Read `src/cli/tests/LiveFooter.test.tsx` in full.

- [x] **Step 2: Append new tests at the end of the file**

  ```tsx
  describe("LiveFooter — wait-human gate", () => {
    function makeGateLiveBlock(overrides: Partial<LiveBlockWithInput> = {}): LiveBlockWithInput {
      return {
        id: "gate-0",
        nodeId: "approval_gate",
        label: "Do you approve?",
        kind: "wait-human",
        startedAt: Date.now() - 1000,
        body: [],
        stats: { turns: 0, tokensIn: 0, tokensOut: 0 },
        gate: {
          options: ["Approve", "Decline"],
          onChoose: vi.fn(),
        },
        ...overrides,
      };
    }

    it("renders GateSelector options when block.gate is set", () => {
      const { lastFrame } = render(<LiveFooter block={makeGateLiveBlock()} index={1} />);
      const frame = lastFrame() ?? "";
      expect(frame).toContain("▶ 1. Approve");
      expect(frame).toContain("  2. Decline");
    });

    it("shows 'awaiting choice' status instead of streaming spinner", () => {
      const { lastFrame } = render(<LiveFooter block={makeGateLiveBlock()} index={1} />);
      const frame = lastFrame() ?? "";
      expect(frame).toContain("awaiting choice");
      expect(frame).not.toContain("streaming");
    });

    it("does not render GateSelector when block.gate is absent", () => {
      const block = makeGateLiveBlock();
      delete (block as Partial<typeof block>).gate;
      const { lastFrame } = render(<LiveFooter block={block} index={1} />);
      const frame = lastFrame() ?? "";
      expect(frame).not.toContain("▶");
      expect(frame).not.toContain("↑↓ navigate");
    });
  });
  ```

- [x] **Step 3: Run tests to verify they fail**

  Run: `npx vitest run src/cli/tests/LiveFooter.test.tsx 2>&1 | tail -15`

  Expected: the three new tests fail (GateSelector not rendered, status line not special-cased).

### Task 5.2: Modify `LiveFooter.tsx`

- [x] **Step 1: Read the current file**

  Read `src/cli/components/LiveFooter.tsx` in full.

- [x] **Step 2: Add `GateSelector` import**

  Add at the top with the other imports:

  ```ts
  import { GateSelector } from "./GateSelector.js";
  ```

- [x] **Step 3: Special-case the status line for `wait-human`**

  Modify `statusLine()` to return early for gate nodes:

  ```ts
  function statusLine(block: LiveBlockWithInput): string {
    if (block.kind === "wait-human") {
      return `  ◆ awaiting choice · ${formatElapsed(block.startedAt)}`;
    }
    const icon = block.input ? "●" : "⠋";
    const verb = block.input ? "awaiting" : "streaming";
    const parts = [
      `  ${icon} ${verb}`,
      `${block.stats.turns} turns`,
      `${block.stats.tokensIn}/${block.stats.tokensOut} tok`,
      formatElapsed(block.startedAt),
    ];
    return parts.join(" · ");
  }
  ```

- [x] **Step 4: Render `GateSelector` between body lines and status**

  Inside the `LiveFooter` JSX, add the `GateSelector` block between the body lines and the `<Text dimColor>{statusLine(block)}</Text>` line:

  ```tsx
  {block.gate && (
    <GateSelector options={block.gate.options} onChoose={block.gate.onChoose} />
  )}
  ```

- [x] **Step 5: Run tests to verify they pass**

  Run: `npx vitest run src/cli/tests/LiveFooter.test.tsx 2>&1 | tail -15`

  Expected: all tests pass including the three new ones.

- [x] **Step 6: Run full test suite**

  Run: `npx vitest run 2>&1 | tail -10`

  Expected: all tests pass.

- [x] **Step 7: Commit**

  ```bash
  git add src/cli/components/LiveFooter.tsx src/cli/tests/LiveFooter.test.tsx
  git commit -m "feat(tui): wire GateSelector into LiveFooter for wait-human blocks"
  ```

---

## Chunk 6: Wire `InkInterviewer` in `pipeline.ts`

**Files:**
- Modify: `src/cli/commands/pipeline.ts`

### Task 6.1: Swap `ConsoleInterviewer` for `InkInterviewer`

- [x] **Step 1: Read `pipeline.ts`**

  Read `src/cli/commands/pipeline.ts` in full, noting where `ConsoleInterviewer` is imported and used.

- [x] **Step 2: Add `InkInterviewer` import**

  Add alongside existing interviewer imports:

  ```ts
  import { InkInterviewer } from "../../attractor/interviewer/ink.js";
  ```

- [x] **Step 3: Replace the interviewer line**

  Find:
  ```ts
  interviewer: process.stdin.isTTY ? new ConsoleInterviewer() : new AutoApproveInterviewer(),
  ```

  Replace with:
  ```ts
  interviewer: process.stdin.isTTY
    ? new InkInterviewer(callbacks.emit)
    : new AutoApproveInterviewer(),
  ```

- [x] **Step 4: Remove the now-unused `ConsoleInterviewer` import**

  Delete the line:
  ```ts
  import { ConsoleInterviewer } from "../../attractor/interviewer/console.js";
  ```

- [x] **Step 5: Build to verify no TypeScript errors**

  Run: `npm run build 2>&1 | tail -5`

  Expected: `Build success`.

- [x] **Step 6: Run full test suite**

  Run: `npx vitest run 2>&1 | tail -10`

  Expected: all tests pass.

- [x] **Step 7: Commit**

  ```bash
  git add src/cli/commands/pipeline.ts
  git commit -m "feat(pipeline): use InkInterviewer for TTY gate prompts, remove ConsoleInterviewer from TUI path"
  ```

---

## Chunk 7: Tmux Integration Test

**Files:**
- Reference: `docs/harness/tmux-drive.md` (read before starting this chunk)
- Reference: `pipelines/gate-test.dot` (the minimal isolation pipeline created for this feature)

This chunk is a manual verification session using the tmux harness. It confirms the three bugs observed before implementation are all fixed.

### Task 7.1: Source the harness and start the run

- [ ] **Step 1: Read `docs/harness/tmux-drive.md`**

  Read the full file. Source the entire fenced bash block into your shell before running any harness commands.

- [ ] **Step 2: Start the run**

  ```bash
  start_run "ralph pipeline run pipelines/gate-test.dot"
  echo "RUN_DIR=$RUN_DIR  WIN=$WIN"
  ```

### Task 7.2: Verify the gate renders inside Ink

- [ ] **Step 1: Wait for `▶ 1. Approve` to appear**

  ```bash
  wait_for_string "▶ 1. Approve" 30000
  ```

  If this times out: the GateSelector is not rendering. Stop and debug — do not proceed.

- [ ] **Step 2: Capture and inspect the TUI state**

  ```bash
  wait_stable 2000 && capture
  cat "$RUN_DIR/current.txt"
  ```

  Verify all of the following in the captured output:
  - `▶ 1. Approve` appears **below** the `━━ [1] approval_gate` header line (not above it)
  - `2. Decline` is visible (was overwritten by Ink before the fix)
  - `↑↓ navigate` hint is present
  - `awaiting choice` appears in the status line (not `streaming`)
  - The `━━ [1] approval_gate` header appears **exactly once** (not duplicated)
  - No raw readline text above the Ink frame

### Task 7.3: Test arrow-key navigation

- [ ] **Step 1: Press down arrow and capture**

  ```bash
  tmux send-keys -t "$SESSION:$WIN" Down
  wait_stable 1000
  capture
  cat "$RUN_DIR/current.txt"
  ```

  Expected: `▶ 2. Decline` is now highlighted; `1. Approve` has no `▶`.

- [ ] **Step 2: Press up arrow and capture**

  ```bash
  tmux send-keys -t "$SESSION:$WIN" Up
  wait_stable 1000
  capture
  cat "$RUN_DIR/current.txt"
  ```

  Expected: `▶ 1. Approve` is highlighted again.

### Task 7.4: Confirm choice and verify frozen block

- [ ] **Step 1: Press Enter to select Approve**

  ```bash
  tmux send-keys -t "$SESSION:$WIN" Enter
  ```

- [ ] **Step 2: Wait for the body line and frozen outcome**

  ```bash
  wait_for_string "you: Approve" 15000
  wait_for_string "success" 60000
  wait_stable 2000
  capture
  cat "$RUN_DIR/current.txt"
  ```

  Expected frozen gate block:
  ```
  ━━ [1] approval_gate · Do you approve?
    you: Approve
    ✓ success · 0 turns · 0/0 tok · <elapsed>
  ```

  The block header appears exactly once. No raw readline artifact above it.

- [ ] **Step 3: Verify the `approved` agent ran to completion**

  The capture should also show `━━ [2] approved · agent` block with `✓ success`.

### Task 7.5: Cleanup

- [ ] **Step 1: Clean up the tmux window**

  ```bash
  cleanup_run
  ```

- [ ] **Step 2: Commit a session note if any unexpected issues were found**

  If everything passed cleanly, no commit is needed. If you had to fix anything during the tmux session, commit those fixes now before declaring done.
