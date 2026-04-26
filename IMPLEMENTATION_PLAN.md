# Mark Plan Implemented — Wire memory_writer As Canonical Caller (v2)

**Goal:** Make `memory_writer` the single canonical caller for closing both a plan
(status → implemented) and its illumination (status → implemented) at the end of every
`illumination-to-implementation` pipeline run.

Design doc: `specs/2026-04-25-plans-have-no-lifecycle-design.md`
Agent file: `src/cli/agents/memory-writer.md`

---

## Shipped 2026-04-26 (v0.1.38) — commit `8eca826`

- **Chunk A** — deleted shadow 6-step procedure from `memory_writer` node prompt in `pipelines/illumination-to-implementation.dot`
- **Chunk B** — added `mcp__illumination__mark_implemented` to `memory-writer.md` tools whitelist
- **Chunk C** — split rubric step 7 into 7a (plan close) + 7b (illumination close), both best-effort
- **Chunk D** — generalized Hard rules best-effort bullet to cover both closes
- **Chunk E** — amended `specs/2026-04-25-plans-have-no-lifecycle-design.md` line-276 paragraph naming `memory_writer` as canonical caller for both closes
- **Chunk F.1** — `npm run build`, `tsc --noEmit`, `pipeline validate`, `vitest illumination-server.test.ts` — all PASS

---

## Remaining work

### Chunk F.2 — Happy-path end-to-end tmux run

1. Read `docs/harness/tmux-drive.md` in full before issuing any tmux commands; source the bash block it contains (`start_run`, `capture`, `wait_stable`, `send_input`, `cleanup_run`).
2. Prepare a test repo with:
   - A plan file under `docs/superpowers/plans/` with valid YAML frontmatter (`status: pending` or `open`).
   - An illumination file under `meditations/illuminations/` with valid YAML frontmatter (`status: dispatched` or `open`).
3. Run `pipelines/illumination-to-implementation.dot` against that test repo via `start_run`.
4. `wait_stable` + `capture` to poll until the pipeline reaches the `memory_writer` node and completes.
5. **Assert — plan frontmatter:** `status` field in the test repo's plan file equals `implemented`.
6. **Assert — illumination frontmatter:** `status` field in the test repo's illumination file equals `implemented`.
7. **Assert — git log:** auto-commit(s) from `memory_writer` appear in the test repo's `git log` reflecting the frontmatter rewrites.
8. Call `cleanup_run` after assertions pass.

### Chunk F.3 — Negative-path tmux runs (two cases, run sequentially)

Read `docs/harness/tmux-drive.md` before starting; source the bash block.

**Case 1 — Orphan plan (plan file has no frontmatter):**

1. Prepare a test repo where the plan file has no YAML frontmatter block; illumination file has valid frontmatter (`status: dispatched`).
2. Run `pipelines/illumination-to-implementation.dot` via `start_run`.
3. `wait_stable` + `capture` until pipeline completes.
4. **Assert — plan close failed gracefully:** the memory file written by `memory_writer` contains a bullet under `Learnings from the run` that quotes the `error` field from the MCP response verbatim.
5. **Assert — illumination close still succeeded:** illumination frontmatter `status` equals `implemented`.
6. **Assert — node exit 0:** pipeline run exits with code 0 (best-effort, no hard failure).
7. `cleanup_run`.

**Case 2 — Orphan illumination (illumination file has no frontmatter):**

1. Prepare a test repo where the illumination file has no YAML frontmatter; plan file has valid frontmatter (`status: pending`).
2. Run the pipeline via `start_run`; `wait_stable` + `capture` until complete.
3. **Assert — illumination close failed gracefully:** memory file `Learnings from the run` section contains a bullet quoting the `error` field from the MCP response verbatim.
4. **Assert — plan close still succeeded:** plan frontmatter `status` equals `implemented`.
5. **Assert — node exit 0:** pipeline exits 0.
6. `cleanup_run`.
