# Markdown Rendering for Node Outputs

**Date:** 2026-04-16
**Status:** Approved

## Problem

Node outputs (Claude agent text) contain markdown syntax (`**bold**`, `# headers`, numbered lists, fenced code blocks). These render as literal characters in the terminal TUI instead of styled text.

## Scope

Both rendering sites:
- `BodyLineView` (`src/cli/components/BlockView.tsx`) — stored body lines in pipeline history
- `StreamLine` (`src/cli/components/ui.tsx`) — live streaming text during node execution

## Approach

Use `marked` + `marked-terminal` to convert markdown strings to ANSI-colored strings at render time. Raw markdown is preserved in data types (`BodyLine.text`, `StreamEvent.content`) and only transformed at the display layer.

```
raw text (markdown string)
     ↓
renderMarkdown(text)          ← new utility
     ↓
ANSI-colored string
     ↓
<Text>{ansiString}</Text>     ← Ink passes ANSI through to stdout
```

## New File: `src/cli/lib/render-markdown.ts`

```ts
import { marked } from "marked";
import TerminalRenderer from "marked-terminal";

marked.use({ renderer: new TerminalRenderer() });

export function renderMarkdown(text: string): string {
  return (marked(text) as string).trimEnd();
}
```

- Single responsibility: markdown → ANSI string
- `.trimEnd()` prevents extra blank lines from `marked-terminal`'s trailing newline behavior
- Importable/mockable in tests

## Component Changes

**BlockView.tsx** — `BodyLineView` component:
```tsx
// before
<Text>{line.text}</Text>
// after
<Text>{renderMarkdown(line.text)}</Text>
```

**ui.tsx** — `StreamLine` text case:
```tsx
// before
return <Text>{event.indented ? "  " : ""}{event.content}</Text>;
// after
return <Text>{event.indented ? "  " : ""}{renderMarkdown(event.content)}</Text>;
```

## Dependencies

Add to `package.json` dependencies:
- `marked` (latest: 18.x, ESM-compatible)
- `marked-terminal` (latest: 7.3.x, brings `chalk@^5` transitively)

No existing dep conflicts. `chalk` is not currently installed.

## No Breaking Changes

- `BodyLine` type unchanged
- `StreamEvent` type unchanged
- Pipeline data flow unchanged
- Only display-layer components change

## Testing

Unit tests for `renderMarkdown()`:
- `**bold**` → output contains ANSI bold codes, no literal `**`
- `# Heading` → output does not contain literal `#`
- Fenced code block → styled output
- Plain text (no markdown) → passes through unchanged

No existing component tests need structural changes (snapshot updates may be needed if any exist).
