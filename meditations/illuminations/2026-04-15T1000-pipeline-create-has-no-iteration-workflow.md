---
date: 2026-04-14
status: open
description: pipeline create is a one-shot tool in a project that accumulates pipelines over time — once a .dot file exists, every subsequent improvement happens through blind hand-editing with no authoring context, no design continuity, and no command designed for the job.
---

## Core Idea

`ralph pipeline create` is a creation command. It fires a two-phase Claude session, produces a `.dot` file, and exits. The entire T-series (T2300–T0900) improves that first creation: better context, better patterns, better distribution, better testing. But pipelines in a consumer project are not written once and left unchanged. They are iterated: a branch gets added after a new failure mode is discovered, an agent name changes, a retry condition is tuned, a `wait.human` gate is removed once trust is established. After the first creation session, every one of these changes happens through hand-editing the `.dot` file directly — no authoring session, no pattern guidance, no agent awareness of the existing graph, no design continuity. The command for this workflow does not exist.

## Why It Matters

Read `pipelineCreateCommand` in `src/cli/commands/pipeline.ts:278–285`. The conflict check is already there:

```ts
if (existsSync(dotPath)) {
  await output.error(`Pipeline already exists: ${dotPath}\nDelete or rename it before running create.`);
  process.exit(1);
}
```

The code already recognizes that the pipeline exists. Its only response is to refuse. There is no forward path. A consumer project developer who wants to refine `ci-loop.dot` must delete it, run `pipeline create ci-loop` again, and reconstruct the design from memory — or hand-edit the DOT syntax and hope the routing still works. Both options discard the design context.

The gene transfusion lens makes the cost concrete: the first transfusion is expensive, but it produces an exemplar. The exemplar is only valuable if subsequent sessions can point at it and say "start here." `pipeline create` cannot do that — it ignores the existing file and errors out. The T-series improvements to the creation path (T0000's context injection, T0100's pattern gallery, T0300's manifest awareness) all assume a blank canvas. They fire once, during creation. When the team returns to refine the pipeline three weeks later, none of that orientation fires again. The authoring agent enters blind.

The actual maintenance workflow is: open `ci-loop.dot`, add an edge by hand, change a label string, run `pipeline validate`, observe a syntax error or miss a semantic one (T0400 unimplemented), run the pipeline, watch it route wrong, re-open the file. This cycle has no agent assistance, no pattern awareness, and no protection against the most common iteration mistake — changing an edge label from `"fail"` to `"error"` and silently breaking all downstream routing.

Consumer projects that invest in ralph pipelines — the ones most likely to want `@acme/ralph-pipelines` (T0700) — are the ones with 5–10 pipelines after six months. Those projects are not running `pipeline create` anymore. They are iterating on existing pipelines continuously. The gap the T-series does not address is the dominant activity of a mature consumer project.

## Revised Implementation Steps

1. **Add `ralph pipeline refine <name>` to `src/cli/commands/pipeline.ts`** and register it in `program.ts`. Before launching the session, read the existing `.dot` file and inject its content verbatim into the trigger: `"Here is the current pipeline:\n\n<content>\n\nThe user wants to refine it. Discuss what they want to change, then write the updated version to ${dotPath}."` This is the same pattern as `ralph plan` resuming from an existing `IMPLEMENTATION_PLAN.md`. The existing file is the exemplar; the session is the transfusion.

2. **Update `pipelineCreateCommand`'s conflict-check message** to surface `refine` as the correct next step: `"Pipeline 'ci-loop' already exists. Use 'ralph pipeline refine ci-loop' to modify it, or '--force' to overwrite."` The current message (`"Delete or rename it before running create"`) points toward data loss. After `refine` exists, it becomes the natural response to the conflict. This is the discoverable surface where most iterating developers will first encounter the command.

3. **Inject the existing graph into the `refine` trigger alongside T0300's manifest context** (once manifest loading is built). The authoring agent gets: the current pipeline graph, the project's declared agents and conventions, and the named pattern gallery (T0100). It can then propose targeted edits — "you have a `[label=\"fail\"]` edge here; if you want to catch both fail and error, add a second edge or use a wildcard condition" — rather than redesigning from blank. The conversation is oriented toward delta, not recreation.

4. **After a successful `refine` session, run `pipelineValidateCommand` automatically**, same as `create` does today. The validate step that T0400 will eventually make semantic-aware is the natural checkpoint after any iteration: the file was just written by an agent, and the developer deserves a confirmation that the graph is still structurally and (eventually) semantically sound before they commit it. This closes the hand-edit → silent-error loop.

5. **Document `pipeline refine` in `README.md`** alongside `pipeline create` with an explicit distinction: `create` starts from blank (use for new workflows), `refine` starts from the existing file (use for all subsequent changes). Consumer project documentation should establish this as the standard iteration pattern — not hand-editing — as early as possible. Teams that learn to hand-edit first will hand-edit forever.
