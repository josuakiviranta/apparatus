# TextInput Cursor-Jump Fix Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Stop the mid-edit cursor jump in `TextInput` / `MultilineTextInput` by gating the value-sync `useEffect` against `internalRef.current` so the component ignores echoes of its own `onChange`.

**Architecture:** Two-line surgery, mirrored across two sibling components. The fix lives entirely inside one existing `useEffect`; no new state, no new refs, no prop changes, no driver edits. A regression test is added per component that drives the parent-echo cycle through the existing `Harness` and asserts cursor preservation.

**Tech Stack:** TypeScript, React 18, [Ink](https://github.com/vadimdemedes/ink) for terminal rendering, `ink-testing-library` for component tests, `vitest` as test runner.

**Originating illumination:** `.apparat/meditations/illuminations/2026-05-14T1525-textinput-terminal-wrap-causes-duplication.md`
**Design doc:** `docs/superpowers/specs/2026-05-16-textinput-terminal-wrap-causes-duplication-design.md`

---

## Chunk 1: Gate `TextInput` value-sync effect

**Goal:** Add a `value !== internalRef.current` guard to the `useEffect` at `src/cli/components/TextInput.tsx:33-36` so parent-echoed `value` props no longer slam the cursor to EOL. New regression test fails first, then passes.

**Files:**
- Modify: `src/cli/components/TextInput.tsx:33-36`
- Test: `src/cli/tests/TextInput.test.tsx` (append one new case)

### Pre-flight: confirm anchors

- [x] **Step 0: Verify the effect and `internalRef` are exactly where the design says**

Run:

```bash
sed -n '33,42p' src/cli/components/TextInput.tsx
```

Expected output:

```ts
  useEffect(() => {
    setInternal(value);
    setCursor(value.length);
  }, [value]);

  // Refs so the useInput closure always sees the latest values
  const internalRef = useRef(internal);
  internalRef.current = internal;
  const cursorRef = useRef(cursor);
  cursorRef.current = cursor;
```

If the lines differ, stop — re-read the design doc and re-derive anchors before continuing. The fix depends on `internalRef` already existing and being assigned to `internal` on every render.

### Step 1: Write the failing regression test

- [x] **Step 1.1: Add the new test case**

Edit `src/cli/tests/TextInput.test.tsx`. Append the case below as the last `it(...)` inside the `describe("TextInput", ...)` block (i.e. immediately before the closing `});` on the final line of the `describe` body — currently line 141).

```tsx
  it("cursor preserved when parent echoes value prop", async () => {
    const { stdin, lastFrame } = render(<Harness initial="change" />);
    // Cursor starts at EOL (after the 'e'). Move it back twice so it sits
    // between 'g' and 'e'.
    stdin.write("\u001b[D"); // left arrow
    stdin.write("\u001b[D"); // left arrow
    await delay();
    // Type 'b' at the cursor. If the value-sync effect re-fires on the
    // parent's echo of value, the cursor snaps to EOL and the next render
    // shows "changb"; with the gate in place the insertion lands at the
    // cursor and the frame contains "changbe".
    stdin.write("b");
    await delay();
    expect(lastFrame()).toContain("changbe");
  });
```

The `Harness` at `src/cli/tests/TextInput.test.tsx:9-30` already drives `value` via `useState`, mirroring the production parent-controlled cycle in `PipelineRunView` — so writing the test against `Harness` reproduces the exact self-echo path described in the design (§3.1).

- [x] **Step 1.2: Run the new test and confirm it fails**

Run:

```bash
npx vitest run src/cli/tests/TextInput.test.tsx -t "cursor preserved when parent echoes value prop"
```

Expected: **FAIL.** The assertion message should look like:

```
AssertionError: expected '...changb ...' to contain 'changbe'
```

(The frame may also contain extra whitespace / inverse-cursor glyphs; the key signal is that the substring `changbe` is absent and `changb` is present near a trailing cursor.)

If the test passes, stop — the bug may have been fixed by an earlier change. Re-read the design doc and verify the anchors before continuing.

### Step 2: Apply the gate

- [x] **Step 2.1: Edit the effect**

In `src/cli/components/TextInput.tsx`, replace the value-sync effect (lines 33-36) with the gated version. Exact before / after:

Before:

```ts
  // Sync external value changes (e.g. parent clearing the input after submit)
  useEffect(() => {
    setInternal(value);
    setCursor(value.length);
  }, [value]);
```

After:

```ts
  // Sync external value changes (e.g. parent clearing the input after submit).
  // Gated on `internalRef.current` so parent echoes of this component's own
  // `onChange` calls are ignored — only genuine external diffs reset cursor.
  useEffect(() => {
    if (value !== internalRef.current) {
      setInternal(value);
      setCursor(value.length);
    }
  }, [value]);
```

`internalRef` is already declared at `src/cli/components/TextInput.tsx:39-40` (`const internalRef = useRef(internal); internalRef.current = internal;`) and is reassigned on every render to track the latest `internal`. No new declarations needed.

- [x] **Step 2.2: Run the new test and confirm it passes**

Run:

```bash
npx vitest run src/cli/tests/TextInput.test.tsx -t "cursor preserved when parent echoes value prop"
```

Expected: **PASS.**

### Step 3: Confirm no regressions in `TextInput`

- [x] **Step 3.1: Run the full `TextInput` suite**

Run:

```bash
npx vitest run src/cli/tests/TextInput.test.tsx
```

Expected: **all 8 cases pass** (the 7 existing cases plus the new one).

The clear-after-submit path is exercised indirectly by `Enter calls onSubmit with current value` and the long-buffer cases at lines 84-140; they continue to pass because `setInputBuffer("")` (or any other genuine external reset) produces a value that differs from `internalRef.current`, so the gate compares unequal and the effect still runs.

- [x] **Step 3.2: Type-check the change**

Run:

```bash
npx tsc --noEmit
```

Expected: **exit 0, no output.** The change is a single `if` inside an existing effect; no signatures move.

### Step 4: Commit

- [x] **Step 4.1: Stage and commit**

Run:

```bash
git add src/cli/components/TextInput.tsx src/cli/tests/TextInput.test.tsx
git commit -m "fix(TextInput): gate value-sync useEffect against internalRef so mid-edit cursor stays put"
```

Expected commit summary line:

```
 2 files changed, <small N> insertions(+), <small N> deletions(-)
```

### Plan-scheduler annotations

- `plan_writer.under_declared_shape_consumer_suspected: c1 -> none` — no exported symbol added, removed, renamed, or re-typed; props interface at `src/cli/components/TextInput.tsx:4-15` unchanged; sole importers (`src/cli/lib/interactions/drivers/agent.tsx`, `src/cli/tests/TextInput.test.tsx`) need no edit. No `Modify:` propagation owed.

## Verification targets

- Smokes: None — the `pipelines/smoke/` directory has only `parallel-illumination-to-implementation.dot`, which is the meta-pipeline that orchestrates this plan; it does not exercise in-row cursor positioning.
- Manual exercises: `apparat meditate <folder>` (or any pipeline that mounts `agentDriver`-based interactive chat), open the chat, type `change`, cursor back between `g` and `e`, type `b`. Expected line: `changbe`, cursor between `b` and `e`. Then submit. Expected: input clears, cursor at column 0.
- Lint: `npx vitest run src/cli/tests/TextInput.test.tsx` and `npx tsc --noEmit`.
- Surfaces touched: CLI components (`src/cli/components/TextInput.tsx`), CLI component tests (`src/cli/tests/TextInput.test.tsx`). No `pipelines/surfaces.json` exists in this repo — labels are derived from touched paths.

---

## Chunk 2: Mirror the gate to `MultilineTextInput`

**Goal:** Apply the identical guard to the active footer surface (`MultilineTextInput`) so the chat input — the one the user actually drives via `agentDriver` since commit `c05374a` — stops jumping the cursor. New regression test fails first, then passes.

**Files:**
- Modify: `src/cli/components/MultilineTextInput.tsx:26-29`
- Test: `src/cli/tests/MultilineTextInput.test.tsx` (append one new case)

### Pre-flight: confirm anchors

- [x] **Step 0: Verify the effect and `internalRef` are exactly where the design says**

Run:

```bash
sed -n '26,34p' src/cli/components/MultilineTextInput.tsx
```

Expected output:

```ts
  useEffect(() => {
    setInternal(value);
    setCursor(value.length);
  }, [value]);

  const internalRef = useRef(internal);
  internalRef.current = internal;
  const cursorRef = useRef(cursor);
  cursorRef.current = cursor;
```

If the lines differ, stop and re-derive anchors. As with Chunk 1, the fix depends on `internalRef` already existing and tracking `internal`.

### Step 1: Write the failing regression test

- [x] **Step 1.1: Add the new test case**

Edit `src/cli/tests/MultilineTextInput.test.tsx`. Append the case below as the last `it(...)` inside the `describe("MultilineTextInput", ...)` block (immediately before the closing `});` on the final line of the `describe` body — currently line 124).

```tsx
  it("cursor preserved when parent echoes value prop", async () => {
    const { stdin, lastFrame } = render(<Harness initial="change" />);
    stdin.write("\u001b[D"); // left arrow
    stdin.write("\u001b[D"); // left arrow
    await delay();
    stdin.write("b");
    await delay();
    expect(lastFrame()).toContain("changbe");
  });
```

The component's `Harness` at `src/cli/tests/MultilineTextInput.test.tsx:8-29` is parent-controlled in the same shape as `TextInput`'s, so the case is structurally identical.

- [x] **Step 1.2: Run the new test and confirm it fails**

Run:

```bash
npx vitest run src/cli/tests/MultilineTextInput.test.tsx -t "cursor preserved when parent echoes value prop"
```

Expected: **FAIL.** Assertion message:

```
AssertionError: expected '...changb...' to contain 'changbe'
```

If the test passes, stop and re-verify the anchors.

### Step 2: Apply the gate

- [x] **Step 2.1: Edit the effect**

In `src/cli/components/MultilineTextInput.tsx`, replace the value-sync effect (lines 26-29) with the gated version.

Before:

```ts
  useEffect(() => {
    setInternal(value);
    setCursor(value.length);
  }, [value]);
```

After:

```ts
  // Gated on `internalRef.current` so parent echoes of this component's own
  // `onChange` calls are ignored — only genuine external diffs reset cursor.
  useEffect(() => {
    if (value !== internalRef.current) {
      setInternal(value);
      setCursor(value.length);
    }
  }, [value]);
```

`internalRef` is already declared at `src/cli/components/MultilineTextInput.tsx:31-32`. No new declarations.

- [x] **Step 2.2: Run the new test and confirm it passes**

Run:

```bash
npx vitest run src/cli/tests/MultilineTextInput.test.tsx -t "cursor preserved when parent echoes value prop"
```

Expected: **PASS.**

### Step 3: Confirm no regressions in `MultilineTextInput`

- [x] **Step 3.1: Run the full `MultilineTextInput` suite**

Run:

```bash
npx vitest run src/cli/tests/MultilineTextInput.test.tsx
```

Expected: **all 9 cases pass** (the 8 existing cases plus the new one). The `mid-text edit does not shift non-cursor row content` case at lines 101-123 also exercises arrow-key navigation through `Harness`; it must keep passing.

- [x] **Step 3.2: Type-check the change**

Run:

```bash
npx tsc --noEmit
```

Expected: **exit 0, no output.**

### Step 4: Run the full component test surface to catch indirect ripples

- [x] **Step 4.1: Run the wider CLI component test directory**

Run:

```bash
npx vitest run src/cli/tests
```

Expected: **all suites pass.** This catches any indirect consumer that drives `MultilineTextInput` via `agentDriver` (the agent footer surface). `src/cli/lib/interactions/drivers/agent.tsx` is the sole non-test importer of `MultilineTextInput` and its tests (if any under `src/cli/tests/`) exercise the agentDriver footer.

### Step 5: Commit

- [x] **Step 5.1: Stage and commit**

Run:

```bash
git add src/cli/components/MultilineTextInput.tsx src/cli/tests/MultilineTextInput.test.tsx
git commit -m "fix(MultilineTextInput): mirror TextInput value-sync gate so chat footer stops jumping the cursor"
```

Expected commit summary line:

```
 2 files changed, <small N> insertions(+), <small N> deletions(-)
```

### Plan-scheduler annotations

- `plan_writer.under_declared_shape_consumer_suspected: c2 -> none` — props interface at `src/cli/components/MultilineTextInput.tsx:4-12` unchanged; sole non-test importer (`src/cli/lib/interactions/drivers/agent.tsx`) needs no edit. No `Modify:` propagation owed.
- This chunk has **no source-file overlap** with Chunk 1 (`TextInput.tsx` vs `MultilineTextInput.tsx`), so `plan_scheduler` should not infer a `depends_on` edge from `files_touched`. The two chunks may be executed in parallel by the scheduler; they are logically independent and either can ship without the other. They are ordered in this plan only because Chunk 1 is the smaller, primary surface and Chunk 2 mirrors its pattern.

## Verification targets

- Smokes: None — same reason as Chunk 1.
- Manual exercises: With both chunks merged, mount the chat footer via any pipeline that uses `agentDriver` (e.g. `apparat meditate <folder>`), type `change`, cursor back, type `b`. Expected: `changbe`. Submit. Expected: input clears, cursor at column 0. This is the live demo the operator ran on 2026-05-16.
- Lint: `npx vitest run src/cli/tests/MultilineTextInput.test.tsx` and `npx tsc --noEmit`. After both chunks land, also run `npx vitest run src/cli/tests` as a final ripple check.
- Surfaces touched: CLI components (`src/cli/components/MultilineTextInput.tsx`), CLI component tests (`src/cli/tests/MultilineTextInput.test.tsx`), indirect consumer surface `src/cli/lib/interactions/drivers/agent.tsx` (read-only verification — no edit). No `pipelines/surfaces.json` exists in this repo.

---

## Open questions / disagreements with the reviewer

None at time of writing. If the plan reviewer surfaces a genuine ambiguity that should not be silently absorbed, it will be recorded here.
