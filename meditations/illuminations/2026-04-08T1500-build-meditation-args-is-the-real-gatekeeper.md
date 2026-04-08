---
date: 2026-04-08
description: The 1300 illumination correctly detected that list_illuminations is auto-denied in meditation sessions but misidentified the cause — the real gatekeeper is the hardcoded --allowedTools list in buildMeditationArgs(), not settings.local.json.
---

## Core Idea

The 1300 illumination correctly observed the symptom: `list_illuminations` is auto-denied in meditation sessions. But it diagnosed the wrong cause. It pointed to `.claude/settings.local.json` and recommended finding the global Claude Code settings file. That is a dead end. The actual gatekeeper is `buildMeditationArgs()` in `src/cli/commands/meditate.ts`, which passes an explicit `--allowedTools` list to the spawned `claude` process. That list has 6 entries — the 6 tools that existed before 0.0.26. `mcp__illumination__list_illuminations` was never added when it shipped.

## Why It Matters

The 1300 illumination's fix steps would send a developer down the wrong path: hunting global settings files, editing `.claude/settings.local.json`, and wondering why the fix has no effect. The actual fix is a single line in `buildMeditationArgs`:

```
"--allowedTools", "mcp__illumination__list_illuminations",
```

This matters beyond the immediate fix. `buildMeditationArgs` contains a hardcoded, silent contract between the MCP server's registered tools and the session's permission model. Every time a new tool is registered in `illumination-server.ts`, it must also be added to `buildMeditationArgs`. There is no compile-time check, no test, and no runtime warning when they diverge. The tool silently becomes unreachable in production while passing all unit tests.

The CRUD-as-checklist lens applies here: creating an MCP tool has two parts — register it in the server (`illumination-server.ts`) and wire it into the spawned session (`buildMeditationArgs`). 0.0.26 did the first and skipped the second. The tool exists but cannot be called.

## Revised Implementation Steps

1. **Add `list_illuminations` to `buildMeditationArgs` in `src/cli/commands/meditate.ts`.** After the `read_meta_meditation` entry, add:
   ```ts
   "--allowedTools", "mcp__illumination__list_illuminations",
   ```
   This is the complete fix. No settings file changes needed.

2. **Update the unit test for `buildMeditationArgs` in `src/cli/tests/meditate.test.ts`.** The test that asserts the `--allowedTools` list should include `mcp__illumination__list_illuminations`. If no such test exists, add one that explicitly checks every allowed tool by name. This test would have caught the 0.0.26 gap.

3. **Build and run a real meditation session to verify.** `npm run build`, then `ralph meditate <project>`. Confirm `list_illuminations` returns the illumination list instead of a denial error. This is the end-to-end verification the 1300 illumination suggested — it remains the right way to confirm.

4. **Add a comment above the `--allowedTools` list in `buildMeditationArgs`.** Something like: `// Must stay in sync with tools registered in illumination-server.ts`. This makes the invariant visible at the call site.

5. **Update or supersede the 1300 illumination.** The 1300 illumination is untracked (not yet committed). If it ships as-is, it will send future readers toward the wrong fix. Either amend its "Revised Implementation Steps" to point at `buildMeditationArgs`, or note its diagnosis as incorrect in a comment in `specs/mcp-illumination.md`. The correct deployment checklist item is: "add to `buildMeditationArgs` in `meditate.ts`" — not "add to settings.local.json".