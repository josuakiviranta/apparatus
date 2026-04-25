---
status: implemented
---

# Markdown Rendering for Node Outputs Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Render markdown syntax in node output text using `marked` + `marked-terminal` so Claude agent outputs display styled terminal text instead of raw markdown.

**Architecture:** Add a `renderMarkdown(text)` utility in `src/cli/lib/render-markdown.ts` that converts markdown to ANSI strings via `marked-terminal`. Call it at render time in `BodyLineView` (pipeline history) and `StreamLine` (live streaming). Raw markdown is preserved in data types — only transformed at display.

**Tech Stack:** TypeScript/ESM, `marked@18`, `marked-terminal@7.3`, `vitest` for tests.

---

## Chunk 1: Install deps + renderMarkdown utility (TDD)

**Files:**
- Modify: `package.json` (add `marked`, `marked-terminal` to dependencies)
- Create: `src/cli/lib/render-markdown.ts`
- Create: `src/cli/tests/render-markdown.test.ts`

### Task 1: Install dependencies

- [ ] **Step 1: Install marked and marked-terminal**

```bash
npm install marked marked-terminal
```

Expected: both packages added to `package.json` dependencies, `package-lock.json` updated.

- [ ] **Step 2: Verify install**

```bash
node -e "import('marked').then(m => console.log('marked ok', Object.keys(m)))"
```

Expected: prints `marked ok` with exported keys including `marked`.

- [ ] **Step 3: Commit**

```bash
git add package.json package-lock.json
git commit -m "chore: install marked + marked-terminal for markdown rendering"
```

---

### Task 2: Write failing tests for renderMarkdown

- [ ] **Step 1: Create test file**

Create `src/cli/tests/render-markdown.test.ts`:

```typescript
import { describe, it, expect } from "vitest";
import { renderMarkdown } from "../lib/render-markdown.js";

describe("renderMarkdown", () => {
  it("converts bold syntax to ANSI bold", () => {
    const result = renderMarkdown("**bold text**");
    expect(result).not.toContain("**");
    expect(result.length).toBeGreaterThan(0);
  });

  it("converts heading syntax — no literal # in output", () => {
    const result = renderMarkdown("# My Heading");
    expect(result).not.toMatch(/^#\s/m);
  });

  it("passes plain text through unchanged (no markdown)", () => {
    const result = renderMarkdown("hello world");
    expect(result.trim()).toContain("hello world");
  });

  it("handles numbered lists without literal markdown", () => {
    const result = renderMarkdown("1. First\n2. Second");
    expect(result.length).toBeGreaterThan(0);
    // Should contain the text content
    expect(result).toContain("First");
    expect(result).toContain("Second");
  });

  it("does not add trailing newlines", () => {
    const result = renderMarkdown("some text");
    expect(result).toBe(result.trimEnd());
  });

  it("handles empty string without throwing", () => {
    expect(() => renderMarkdown("")).not.toThrow();
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
npm test -- render-markdown
```

Expected: FAIL — `Cannot find module '../lib/render-markdown.js'`

---

### Task 3: Implement renderMarkdown

- [ ] **Step 1: Create src/cli/lib/render-markdown.ts**

```typescript
import { marked } from "marked";
import TerminalRenderer from "marked-terminal";

marked.use({ renderer: new TerminalRenderer() });

export function renderMarkdown(text: string): string {
  return (marked(text) as string).trimEnd();
}
```

- [ ] **Step 2: Run tests to verify they pass**

```bash
npm test -- render-markdown
```

Expected: all 6 tests PASS.

- [ ] **Step 3: Commit**

```bash
git add src/cli/lib/render-markdown.ts src/cli/tests/render-markdown.test.ts
git commit -m "feat: add renderMarkdown utility using marked-terminal"
```

---

## Chunk 2: Wire renderMarkdown into display components

**Files:**
- Modify: `src/cli/components/BlockView.tsx`
- Modify: `src/cli/components/ui.tsx`

### Task 4: Update BodyLineView in BlockView.tsx

`BodyLineView` renders stored pipeline body lines (role: claude/you/system). The `claude:` role text contains markdown.

- [ ] **Step 1: Read the current file**

Read `src/cli/components/BlockView.tsx` to find the exact line rendering `line.text`.

- [ ] **Step 2: Add import and update render**

At the top of `src/cli/components/BlockView.tsx`, add:
```typescript
import { renderMarkdown } from "../lib/render-markdown.js";
```

In the `BodyLineView` component, change:
```tsx
// Find this line (approx line 21):
<Text><Text bold color={roleColor(line.role)}>{line.role}:</Text> {line.text}</Text>
// Change to:
<Text><Text bold color={roleColor(line.role)}>{line.role}:</Text> {renderMarkdown(line.text)}</Text>
```

- [ ] **Step 3: Run full test suite**

```bash
npm test
```

Expected: all tests PASS (no regressions).

- [ ] **Step 4: Commit**

```bash
git add src/cli/components/BlockView.tsx
git commit -m "feat: render markdown in BodyLineView node outputs"
```

---

### Task 5: Update StreamLine in ui.tsx

`StreamLine` renders live streaming text events while a node is running.

- [ ] **Step 1: Read the current file**

Read `src/cli/components/ui.tsx` to find the exact text case in the `StreamLine` switch.

- [ ] **Step 2: Add import and update render**

At the top of `src/cli/components/ui.tsx`, add:
```typescript
import { renderMarkdown } from "../lib/render-markdown.js";
```

In the `StreamLine` component, find the `case "text":` branch and change:
```tsx
// Find this (approx line 53):
return <Text>{event.indented ? "  " : ""}{event.content}</Text>;
// Change to:
return <Text>{event.indented ? "  " : ""}{renderMarkdown(event.content)}</Text>;
```

- [ ] **Step 3: Run full test suite**

```bash
npm test
```

Expected: all tests PASS.

- [ ] **Step 4: Build to verify TypeScript compiles**

```bash
npm run build
```

Expected: no TypeScript errors, `dist/` updated.

- [ ] **Step 5: Commit**

```bash
git add src/cli/components/ui.tsx
git commit -m "feat: render markdown in StreamLine live output"
```

---

## Done

All markdown in node outputs (both stored body lines and live streaming) now renders with ANSI terminal styling. No data types changed. No pipeline stages changed.
