# Prompt and Permission Model Are Coupled but Designed Apart

## Core Idea

`PROMPT_scenario.md` (Task 5) and `buildScenarioArgs` (Task 7) are tightly coupled: the prompt dictates which tools Claude will use, and the args must either permit exactly those tools or grant blanket access. The plan writes the prompt first, then the args separately, with no mechanism connecting them. The implementing agent will write both without noticing the dependency — and T3300's finding (use `--permission-mode dontAsk`, not `--dangerously-skip-permissions`) cannot be correctly adopted without revisiting the prompt to enumerate what tools the restricted agent is actually allowed to use.

## Why It Matters

The coupling is direct and non-obvious. `PROMPT_scenario.md`'s Task 5 draft instructs Claude to:

1. Read the script (needs a file-read tool or bash)
2. Run it via bash (needs bash)
3. Write a markdown report to `{{OUTPUT_PATH}}` (needs a file-write tool)

Under `--dangerously-skip-permissions`, all three happen implicitly — Claude uses whatever tool it reaches for. Under `--permission-mode dontAsk` with an explicit `--allowedTools` list, the tools Claude is allowed to reach for must be enumerated. If `--allowedTools` includes `bash` but not the built-in file-write tool, step 3 breaks. If it includes the file-write tool but not bash, step 2 breaks. If it includes both, the security benefit shrinks toward the meditate pattern — but meditate's allowed tools are MCP-scoped to 6 specific read-only operations, while scenario's bash is a general-purpose shell.

The plan's Task 5 note says: "Verify the file is picked up by tsup — no config change needed." The prompt is treated as static content to bundle, not as a behavioral specification that determines what the runtime environment must support. The permission model question is deferred to Task 7, which by that point will look at `meditate-create.ts` (or `meditate.ts` if T3300 is adopted) as its reference — without re-reading the prompt to verify the tools match.

T3300 correctly identified the wrong permission model. But fixing the permission model without simultaneously auditing the prompt's tool usage produces a broken session: restricted args, prompt that instructs tool usage outside the restriction, silently failed writes, then `console.log("Done: scenario-runs/...")` regardless (T2700).

The meditate pattern avoided this problem because the prompt and `buildMeditationArgs` were designed together: `PROMPT_meditation.md` only uses the 6 MCP tools, and `buildMeditationArgs` allows exactly those 6 tools. The constraint is end-to-end consistent. The scenario pattern has no equivalent co-design — prompt and args are designed two tasks apart by a plan written before T3300 existed.

## Revised Implementation Steps

1. **Write `PROMPT_scenario.md` last, not first.** Reverse the order of Tasks 5 and 7. Write `buildScenarioArgs` (and settle the permission model — use `--permission-mode dontAsk` per T3300) before writing the prompt. Once the allowed tool list is fixed, write the prompt to use only those tools. The prompt becomes a derived artifact of the permission model, not an input to it.

2. **Enumerate the exact tool list for `buildScenarioArgs` before writing any prompt text.** The minimum viable set for a scenario session: `bash` (run the script), `write_file` (write the report). Verify these are the correct tool names for the Claude CLI's `--allowedTools` flag — check against the `buildMeditationArgs` pattern in `meditate.ts` for the flag syntax. Only then write the prompt to use these two tools and no others.

3. **Write the prompt's step 1 (read the script) as a bash operation, not a file-read tool.** With `--allowedTools bash,write_file`, Claude should read the script by running `cat {{SCRIPT_PATH}}` in bash rather than using a file-read MCP tool. This keeps the allowed tools minimal and the prompt consistent with what's available. Document this constraint as an inline comment above the `PROMPT_scenario.md` content: `<!-- Allowed tools: bash, write_file — prompt must not reference other tools -->`.

4. **Add a vitest test to `run-scenarios.test.ts` that asserts `buildScenarioArgs` contains `--permission-mode dontAsk` and does NOT contain `--dangerously-skip-permissions`.** Mirror the equivalent assertion that should exist for `buildMeditationArgs`. This test makes the permission choice explicit and prevents the implementing agent from copying the wrong exemplar unchecked.

5. **Cross-reference Tasks 5 and 7 in the plan with a one-line dependency note.** In Task 5's header, add: `Depends on: Task 7 (permission model must be settled before prompt is written)`. In Task 7's header: `Informs: Task 5 (allowed tools list determines prompt tool usage)`. This makes the coupling visible to the executing agent regardless of whether it reads the illuminations.
