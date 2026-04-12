# Handler Context, Registry Cleanup, and Deduplication Implementation Plan

## Status: Implemented (v0.1.11)

Chunks 1–3 and verification (Tasks 1–8, Steps 1–42) completed 2026-04-12.
Remaining: Task 9 (smoke pipeline regression tests via tmux).

---

## Remaining Work

### Task 9: Smoke pipeline regression tests via tmux

> **MANDATORY:** Read `docs/harness/tmux-drive.md` before this task. Use only the patterns documented there. Do not invent custom tmux commands.

**Pipelines to run:**
- `pipelines/smoke/chat-only.dot`
- `pipelines/smoke/agent-implement.dot`
- `pipelines/smoke/gate.dot`
- `pipelines/smoke/tool.dot`
- `pipelines/smoke/chat-end-to-end.dot`
- `pipelines/smoke/conditional.dot`
- `pipelines/smoke/meditate-steer.dot`

- [ ] **Step 43: Read tmux-drive.md**
- [ ] **Step 44: Run each smoke pipeline**
- [ ] **Step 45: Final commit (if any fixes were needed)**

---

## Constraints Recap

- **YAGNI / KISS** — only the changes described above
- **Existing tests must pass** at every commit point (`npm test`)
- **Smoke tests are non-negotiable** — the refactoring touches handler execution code that all pipelines depend on
