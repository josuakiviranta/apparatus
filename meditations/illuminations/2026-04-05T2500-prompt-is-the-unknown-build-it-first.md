---
date: 2026-04-05
description: 'Every component of the `run-scenarios` spec can be unit tested except one: `PROMPT_scenario.md`.'
---

# Prompt Is the Unknown — Build It First

## Core Idea

Every component of the `run-scenarios` spec can be unit tested except one: `PROMPT_scenario.md`. Header parsing, slug generation, file discovery, argument construction — all testable without running claude. The prompt is not. It can only be verified by spawning an actual claude session against a real script and inspecting the output. The spec defers prompt content to a bulleted "responsibilities" list, which is appropriate for design but dangerous for execution order: if you build the command first and the prompt last, the first real user becomes the first real test.

## Why It Matters

This pattern has already played out once in this codebase. `PROMPT_meditation.md` was built alongside `meditate.ts` and has been amended by illuminations twice — once to add the memory-read step (`2026-04-05T2330`), once implicitly through the `list_meta_meditations` and `read_meta_meditation` tools being added to the allowed set. Those amendments happened because the prompt's behavior was only observed through real sessions, not through a deliberate testing phase before the command shipped. The illumination at `2026-04-05T0900` identified that the meditation agent is blind to its own outputs — a symptom of a prompt that was never stress-tested before deployment.

`PROMPT_scenario.md` carries the same risk, amplified. The scenario workflow is more complex than meditate: claude must read a script, execute it, interpret the output (not just transcribe it), diagnose root causes, and write a structured report with correct frontmatter. That's four discrete behaviors, any of which can go subtly wrong. If the exit code in the frontmatter is wrong, or claude describes symptoms instead of causes, or the `<details>` block gets malformed — the report looks complete but fails the handoff to the implement session. The command will appear to work. The reports will be quietly useless.

## Revised Implementation Steps

1. **Write `PROMPT_scenario.md` before writing any command code.** Draft the prompt, place it in a scratch directory alongside a real test script, and invoke `claude` directly with the same flags `run-scenarios` will use (`--print`, `--output-format stream-json`, `--permission-mode dontAsk`). Do this manually, without any ralph machinery around it.

2. **Run the prompt against two cases: a passing script and a failing script.** A passing script with clear output tests whether claude can accurately characterize success. A failing script with a non-zero exit code tests whether claude diagnoses the root cause or just pastes stderr. These are the two behaviors that make or break the feature.

3. **Inspect the output file frontmatter specifically.** The `status: pass/fail` field, the `date` format, and the `script:` path must match the format the spec defines — because downstream tooling (and future prompts in the implement session) will consume this frontmatter. If the date format drifts or the status value is `"failed"` instead of `"fail"`, the handoff breaks silently.

4. **Iterate on the prompt until both cases produce correct output, then freeze it.** The spec's "responsibilities" bullets become acceptance criteria for the prompt, not implementation notes. A prompt that passes both cases can be committed as the reference. The command code then wraps a known-good prompt, not a speculative one.

5. **Fix the three `meditate.ts` bugs before starting the run-scenarios implementation.** They are independent three-line changes, fully specified in the design spec, and affect every meditation session running today. The spec buries them as "modified files" in a feature that doesn't exist yet. Each deserves its own commit: (a) `RALPH_TEST_CMD` escape hatch, (b) exit code surfaced in close handler, (c) tool-use progress indicators in stream parser. Shipping these before `run-scenarios` lands means the bugs stop accumulating damage immediately rather than waiting for the broader feature.
