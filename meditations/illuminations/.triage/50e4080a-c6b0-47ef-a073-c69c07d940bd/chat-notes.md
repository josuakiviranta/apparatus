# Chat round notes — 2026-05-03T00:00Z

## What the user raised

- Skepticism about the premise: "Does plans even have statuses? I checked docs/superpowers/plans and could not confirm these would have any frontmatter substatus."
- Counter-proposal on the lifecycle model: "plans should be consumed ones implemented that should be the status of those plans" (interpreted: plans should follow the consume-only model — `git rm` on implementation, no `status:` field).
- Framing prompt: "We have opportunity to fix this drift" — explicit invitation to broaden scope beyond the verifier's idempotency patch.
- Final decision: "yep let's pivot" — pivot the illumination away from the idempotency fix and toward consume-only plan lifecycle.

## Conclusions reached

- **The illumination's original scope (idempotent `markPlanImplemented`) is rejected as the framing.** The pipeline should produce a design doc and plan for **consume-only plan lifecycle** instead.
  - Came from: user's "let's pivot" + "We have opportunity to fix this drift".
  - Rationale: user observed the drift firsthand by inspecting `docs/superpowers/plans/` and finding the status field is mostly absent; patching idempotency leaves the underlying drift in place. Mirroring the consume-only model (already shipped for illuminations via ADR-0002 / `2026-04-30-consume-only-illumination-lifecycle.md`) eliminates the entire failure class instead of patching one branch.

- **New tool: `consume_plan(filename, reason)`** — mirror of the existing `consume` MCP tool used for illuminations. Performs `git rm <plan-file>` + commit, no frontmatter manipulation.
  - Came from: user's "plans should be consumed ones implemented".
  - Rationale: reuse a proven, shipped pattern rather than invent a parallel mechanism. Idempotency becomes a non-issue by definition (already-removed file = no-op `git rm` failure or empty diff, handled the same as the illumination case).

- **Delete the status enum and frontmatter handling for plans.** Remove `markPlanImplemented`, the `z.enum(["pending", "implemented"])` schema at `src/cli/mcp/illumination-server.ts:500`, and the `list_plans` status filter parameter. Strip any `status:` frontmatter from the existing 4 plan files that carry one.
  - Came from: user's pivot acceptance + drift observation (only 4 of 11 on-disk plans carry frontmatter, with values `pending` / `complete` / `done` — none of which the schema enum accepts uniformly).
  - Rationale: the drift evidence shows the field is unmaintainable in practice. Keeping a partially-honored enum is worse than removing it.

- **Update the tail-node prompt** at `pipelines/illumination-to-implementation/memory-writer.md` to call `consume_plan` instead of `mark_plan_implemented`. Update the plan-writer agent (wherever it emits plan frontmatter) to stop emitting `status: pending`.
  - Came from: scope discussion of "which files change".
  - Rationale: keep the pipeline coherent with the new lifecycle. Tail-node prompt currently treats lifecycle calls as best-effort/never-abort; that softening can be removed once the call is intrinsically idempotent.

- **Blast radius is M, not S.** ~6 files: MCP server (delete + add), tail-node prompt, plan-writer prompt, 4 plan files (frontmatter strip), test suite (replace mark-implemented suite with consume-plan suite). Still single-session size.
  - Came from: scope discussion.
  - Rationale: honest sizing — bigger than the verifier's S call, but the broader fix is what the user asked for.

## Open questions

- Whether to write a fresh ADR (e.g. `0003-consume-only-plan-lifecycle.md`) mirroring ADR-0002, or skip the ADR and let the implementation plan stand alone — deferred because the user did not specify, and the consume-only-illumination plan itself did not require a sibling ADR beyond 0002.
