---
date: 2026-04-06
description: "Twenty-seven illuminations have diagnosed the run-scenarios plan."
---

# The Observation Loop Has Closed — Integration Is the Only Remaining Step

## Core Idea

Twenty-seven illuminations have diagnosed the run-scenarios plan. The three written today (T0800, T0930, T1100) are no longer observations — they are meta-observations about the gap between the observation system and the execution system. The system has entered a convergence state: each new illumination about the plan produces less new signal and more urgency about the same unfixed gap. The loop exit is not another illumination. It is one human action: open `docs/superpowers/plans/2026-04-05-run-scenarios.md`, apply the amendments, mark it Ready, and stop writing about it.

## Why It Matters

The executing agent reads the plan file. It reads nothing else by default. `meditations/illuminations/2026-04-06T0800-six-amendments-before-the-plan-executes.md` distills all prior diagnosis into six specific, line-level amendments — it is the synthesis point for 20+ prior sessions. But it lives in `meditations/illuminations/`, not in the plan. The executing agent will never encounter it unless something in the plan's header directs it there.

The plan's header currently says: "Use superpowers:subagent-driven-development or superpowers:executing-plans." Neither skill reads illuminations. The executing agent will follow the skill, read the plan, and begin Task 1. At Task 7, it will write `runScenarioSession` from scratch, referencing `meditate-create.ts` as its exemplar (as the plan's architecture header instructs), and produce code with: `--dangerously-skip-permissions` instead of `--permission-mode dontAsk`, no `RALPH_TEST_CMD` override, no SIGINT cleanup handler, no artifact existence check, and zero subprocess tests. All six bugs are pre-diagnosed. All six will occur. Nothing in the execution path prevents them, because the diagnosis lives in a directory the executing agent has no reason to open.

Further illuminations about this plan are diminishing returns. The observation work is done. Every additional illumination written about this gap is evidence that the loop needs to exit, not more evidence that the gap exists.

## Revised Implementation Steps

1. **Read T0800 first and only.** Open `meditations/illuminations/2026-04-06T0800-six-amendments-before-the-plan-executes.md`. It is the distillation of 20 prior illuminations. Do not re-read the prior 20 — T0800 synthesizes them. This step takes 3 minutes.

2. **Apply the six amendments from T0800 to the plan.** Each maps to a specific location in `docs/superpowers/plans/2026-04-05-run-scenarios.md`: (1) architecture header — change exemplar reference from `meditate-create.ts` to a forward reference pointing at the post-Task-2 `meditate.ts`; (2) Task 6 — add `.sort()` to `discoverScenarios` plus a multi-file ordering test; (3) Task 7 — replace `--dangerously-skip-permissions` with `--permission-mode dontAsk` and add `--allowedTools bash`; (4) Task 7 — add `RALPH_TEST_CMD ?? "claude"` to `runScenarioSession` plus three subprocess tests; (5) Task 7 — add SIGINT cleanup with loop cancellation; (6) Task 7 — replace unconditional Done print with `existsSync(outPath)` check and stderr warning.

3. **Apply two additional amendments from T0930 and T1100.** From T0930: add "Step 0: Reread `src/cli/commands/meditate.ts` as it exists after Tasks 1–2. `runScenarioSession` must reproduce RALPH_TEST_CMD, SIGINT cleanup, and exit-code check — derive it from the post-amendment file, not from `meditate-create.ts`." as the first instruction in Task 7. From T1100: add `export` to `runScenarioSession` and a fourth subprocess test (SIGINT terminates child and outer Promise resolves rather than hanging).

4. **Add `Status: Ready` to the plan header.** Insert one line below the goal paragraph: `**Status:** Ready — illumination-integrated, safe to execute.` Without this marker, any future executing agent (or human) has no way to distinguish a patched plan from an unpatched one. The marker is also a commitment: it means the human has read the relevant illuminations and confirms the amendments are applied.

5. **Stop writing illuminations about this plan and execute it.** Once the plan is marked Ready, open `superpowers:executing-plans` and begin Task 1. The pre-work from 27 sessions is now embedded in the document the executing agent will read. The observation system has done everything it can. The rest is execution.
