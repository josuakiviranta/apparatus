---
date: 2026-04-13
status: open
description: PROMPT_pipeline_create.md teaches DOT grammar but ships no named workflow patterns — consumer projects face a blank "what do you want?" before they know what ralph can do, so authoring sessions produce generic codergen chains instead of meditating/implementing/scenario loops.
---

## Core Idea

`PROMPT_pipeline_create.md` is a syntax manual. It documents every node shape, every attribute, every edge condition with precision. What it does not contain is a **pattern vocabulary**: named, reusable workflow shapes with stated intent, so the authoring agent can say "this sounds like an Observe-then-Fix loop — shall we start there?" instead of asking the blank "what do you want the pipeline to accomplish?" A consumer project developer — someone who just ran `npm install -g ralph-cli` — does not know that `ralph.meditate` exists, that `ralph.run-scenarios` is a node type, or that `goal_gate` enforces mandatory completion. They answer "run my tests and fix failures" and the agent writes a single `box` node because that's all it can confidently map to their answer.

## Why It Matters

The gene transfusion lens makes the failure legible. The first transfusion is expensive: you need an exemplar. Ralph ships no exemplars for consumer projects — T2300 and T0000 address the missing bundled `.dot` files and the missing `hello.dot` scaffold. But even with exemplars available, the authoring agent does not *choose among patterns*. It teaches grammar, asks intent, and produces the simplest valid graph. The richer node types — `ralph.implement`, `ralph.meditate`, `ralph.run-scenarios`, `wait.human`, named agents — only appear in outputs if the user already knows to ask for them by name.

Look at the current create flow in `src/cli/commands/pipeline.ts`: the trigger injected into the session is `${promptContent}\n\nCreate a new pipeline named "${name}". Write it to: ${dotPath}`. Zero pattern orientation. The authoring agent enters with grammar knowledge and exits the non-interactive phase having received only a name and a path. The interactive phase inherits no structured starting point.

Compare to `new.ts`: `BRAINSTORM_TRIGGER` tells the kickoff agent to "invoke the Skill tool with skill name 'superpowers:brainstorming'" — a structured entry into design space. Pipeline create has no equivalent. It's `ralph new` without the brainstorming step.

The semport lens adds a second angle. The internal ralph-cli pipelines — `illumination-to-plan.dot`, `gate-test.dot`, the smoke suite — encode accumulated design judgment: how to chain meditate and implement, how to gate on scenario outcomes, how to use JSON variable passing between agents. That judgment is locked inside files consumer projects will never see unless T2300's bundled distribution is implemented. But even then, seeing a file is not the same as the authoring agent *presenting it as a named option*.

## Revised Implementation Steps

1. **Add a Pattern Gallery section to `src/cli/prompts/PROMPT_pipeline_create.md`**. Define 4–5 named patterns with one-sentence intent descriptions and the core node sequence each uses. Candidates:
   - *Observe-then-Fix*: `ralph.run-scenarios → ralph.meditate → conditional → box(fix) → loop_restart` — use when you want automated insight before each fix cycle.
   - *Test Gate*: `ralph.run-scenarios → goal_gate box → exit` — use when implementation is already done and you just need a passing-tests assertion.
   - *Agent Chain*: sequence of `agent="name"` nodes with JSON handoffs via `$variables` — use when different specialized agents own different stages.
   - *Human Approval*: `box → wait.human → box/exit` — use when a human must review output before proceeding.
   - *Implement Loop*: `ralph.implement → ralph.run-scenarios → conditional → loop_restart` — use for unattended TDD cycles.

2. **Change the authoring agent's opening move.** Update the trigger in `pipelineCreateCommand` to append: `"Before designing, present the user with the Pattern Gallery from your prompt. Ask which pattern fits their need, or whether they want something custom. Use their answer as the design starting point."` This makes the session begin with orientation, not a blank canvas.

3. **Scaffold `pipelines/` and a `hello.dot` in `scaffoldProject()`** (`src/cli/commands/new.ts`). The starter pipeline should demonstrate the *Test Gate* pattern — it's the simplest one that uses a non-trivial ralph-specific node. This gives the authoring agent a local exemplar to transfuse from on the first `pipeline create` in any new project.

4. **Add a `## When to use each node type` section to `PROMPT_pipeline_create.md`** describing real-world triggers: "use `ralph.meditate` when you want Claude to observe and reflect before acting; use `ralph.run-scenarios` when the project has a `scenario-tests/` directory; use `agent=` when the project has entries in `~/.ralph/agents/`." This gives the authoring agent decision criteria, not just syntax.

5. **Surface bundled pipelines in `pipelineListCommand`** once T2300's `getBundledPipelinesDir()` is implemented. When listing, show bundled pipelines as a separate section labelled `ralph built-ins` with their goals. This gives `pipeline list` a discovery function — users can see what patterns ship with ralph before writing their own.
