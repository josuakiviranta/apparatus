---
date: 2026-04-20
status: open
description: `ToolNodeSchema` at `src/attractor/core/schemas.ts:35-49` is `.strict()` with zero `default_*` fields whitelisted — first tool node needing a safety-net default (`mark_archived.default_archive_reason_short`) fails validation; a narrow zod-native passthrough accepting `default_<snake_name>="string"` on tool nodes (via `.catchall` + `.superRefine` keying on `startsWith("default_")`) preserves typo-catching strictness everywhere else while unblocking merging-path pipelines.
---

## Core Idea

Running `ralph pipeline validate pipelines/illumination-to-implementation.dot` rejected `default_archive_reason_short="Declined at approval gate"` at line 17 with `schema_error: unrecognized key 'default_archive_reason_short'`. The `mark_archived` tool node has two asymmetric incoming paths: `remove_gate --Archive-->` produces `$archive_reason_short` via the verifier's output, while `approval_gate --Decline-->` does not. The `default_archive_reason_short` attribute was the author's patch for the decline path — a human-authored sentinel that expresses why the node ran. Today it's rejected because `ToolNodeSchema` got no defaults whitelist at all.

A fast-path pipeline-only fix shipped first: `pipelines/schemas/verifier.json` now marks `archive_reason_short` as `required`, `src/cli/agents/verifier.md` mandates the agent emit it on every verdict (placeholder `"Declined at approval gate"` on `preferred_label: "true"`, empty string on `"empty"`), and the `default_archive_reason_short=` attribute was deleted from the `.dot`. Validator goes green today. But the underlying schema asymmetry remains: the next tool node needing a safety-net default will hit the same wall. This illumination is the deeper fix.

Compare the per-kind schema state in `src/attractor/core/schemas.ts`:

- `AgentNodeSchema:29-32` — four hand-listed defaults (`defaultRefinements`, `defaultChatNotesPath`, `defaultTestResult`, `defaultTestSummary`).
- `GateNodeSchema:54` — one hand-listed default (`defaultRefinements`).
- `ToolNodeSchema:35-49` — zero.

The proposal: extend `ToolNodeSchema` with a regex-keyed passthrough accepting `default_<snake_name>="string"` while rejecting every other unknown key. Typo-catching strictness is preserved everywhere outside the `default_` prefix.

## Why It Matters

Merging-path pipelines are a first-class pattern. Any node downstream of a branching gate where only some branches produce a variable will want a default. Tool nodes are especially common merge points because they're where side effects happen (commits, archive moves, file writes). The current schema silently assumes tool nodes are only ever reached on paths that produce every variable they consume — that assumption breaks the moment a decline/skip branch exists.

Workarounds available today are all worse than a schema fix:

1. Always-produce-from-verifier: mutate the upstream verifier to emit a sentinel like `"Passed verification"` on every path. Launders human intent through a machine voice and loses the author's chosen wording.
2. Agent-node laundering: insert a trivial agent between the gate and the tool just to set the var. Adds a node for no semantic reason.
3. Engine PR per variable: add `defaultArchiveReasonShort` to `ToolNodeSchema`, rebuild, ship. Exactly the whitelist pattern the parent illumination argues against.

The illumination `2026-04-19T1200-default-vars-whitelist.md` (status: open) already argued for replacing all three whitelists with a generic `default_<varname>` passthrough. This illumination is a narrower, ships-sooner version: do the generic passthrough at least for tool nodes now, because a real pipeline is blocked on it, and align with T1200's broader direction when capacity allows.

## Revised Implementation Steps

1. **Schema change — zod-native.** In `src/attractor/core/schemas.ts:35-49`, replace `.strict()` on `ToolNodeSchema` with `.catchall(z.string())` followed by `.superRefine` that rejects every extra key not matching `startsWith("default_")`. This uses zod primitives end-to-end — no regex literal — and keeps the accept-check readable.

   A minor parser tweak is required first: `src/attractor/core/graph.ts:48` currently runs `toCamel()` on every attribute key before zod sees the object, so `default_archive_reason_short` arrives as `defaultArchiveReasonShort` at validation time. For `.startsWith("default_")` to work, skip camelCase conversion for keys already matching `/^default_[a-z]/` — let them reach the schema as-is. This also makes the runtime seeding of step 2 trivial (the key suffix is the context-var name, no snake→camel→snake round-trip).

   Sketch:
   ```ts
   export const ToolNodeAttrRules = BaseNodeSchema.extend({
     type: z.literal("tool"),
     cwd: z.string().min(1),
     toolCommand: z.string().optional(),
     scriptFile: z.string().optional(),
     scriptArgs: z.string().optional(),
     producesFromStdout: z.union([z.boolean(), z.literal("true")]).optional(),
     produces: z.string().optional(),
   })
     .catchall(z.string())
     .superRefine((data, ctx) => {
       const known = new Set([
         "id","shape","label","condition","class",
         "type","cwd","toolCommand","scriptFile","scriptArgs",
         "producesFromStdout","produces",
       ]);
       for (const k of Object.keys(data)) {
         if (known.has(k)) continue;
         if (!k.startsWith("default_")) {
           ctx.addIssue({
             code: "unrecognized_keys",
             keys: [k],
             path: [],
             message: `unrecognized key '${k}'`,
           });
         }
       }
     })
     .refine(n => !(n.toolCommand && n.scriptFile), { message: "script_command_conflict" })
     .refine(n => n.toolCommand || n.scriptFile, { message: "tool_node_needs_command_or_script" });
   ```

   Fallback if the parser tweak is deferred: use `z.string().regex(/^default[A-Z]/)` inside the refine. Functionally identical; slightly less idiomatic.

2. **Runtime seeding.** In whichever engine module currently reads `node.defaultRefinements` and seeds `$refinements`, add (for tool nodes) an iteration over every attribute whose key `startsWith("default_")`. For each, if the current context has no value for the suffix (`key.slice("default_".length)`), seed it to the attribute's string value. With the parser tweak in step 1, suffix is already snake_case — no further conversion needed.

3. **Unit tests.** Two cases in the schema test file:
   - `default_archive_reason_short="hello"` on a tool node validates clean.
   - `foo_bar="x"` on a tool node still rejects with `unrecognized key`.
   Plus a runtime test asserting the seeded context var name matches the attribute suffix verbatim (no camelCase conversion — stay snake).

4. **Integration test.** After steps 1–3, `ralph pipeline validate pipelines/illumination-to-implementation.dot` succeeds. A smoke run of the decline path asserts `$archive_reason_short` equals `"Declined at approval gate"` when `mark_archived` executes. This is the trigger case — it must pass before the illumination closes.

5. **Follow-up marker.** Add a one-line TODO in `schemas.ts` pointing at `2026-04-19T1200-default-vars-whitelist.md` so the next person extending defaults knows agent and gate schemas want the same treatment.

## Trade-Off

The pipeline-only fix (already shipped as a band-aid) makes the verifier always produce `archive_reason_short`, deletes the `default_` attribute, and re-rubrics the agent. It preserves strict schemas but replaces the author's human wording (`"Declined at approval gate"`) with a verifier-emitted placeholder — the `.md` rubric now hardcodes that exact placeholder on the `true` verdict, so the wording is preserved in this one case. The structural problem remains: every future tool node needing a safety-net default forces another band-aid upstream (mutating an unrelated agent's rubric + contract) rather than a one-line attribute on the consuming node. This illumination's schema-side fix is the general answer; the band-aid is the specific answer for a single concrete pipeline.

## Cross-References

- `2026-04-19T1200-default-vars-whitelist.md` — parent direction. Argues for replacing all three hand-lists with a generic `default_<varname>` passthrough across agent, gate, and tool schemas. This illumination is the narrower, ships-sooner scope: tool nodes only, because a concrete pipeline is blocked today.
- `2026-04-20T1800-validator-and-runtime-disagree-on-defaults.md` — sibling bug memory that named the concrete failure mode where validator and runtime part ways on default handling. This illumination proposes one of the two candidate fix directions discussed there.
- `2026-04-20T1900-path-sensitive-var-flow-validator.md` — semantic integration. A path-sensitive validator must treat `default_<var>` on node N as "N produces `<var>`" when computing var-availability sets per incoming path; otherwise the validator will still flag merge-point tool nodes as consuming unset vars.
- `2026-04-20T2200-explicit-consumes-declarations.md` — once nodes declare `consumes=`, authors see at a glance which `default_*` keys are load-bearing versus ornamental. The two features compose: `consumes` lists the surface, `default_*` supplies merge-path fallbacks.
