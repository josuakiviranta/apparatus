---
date: 2026-05-01
description: Both files in scripts/ are dead one-shot dev tools — backfill-plan-frontmatter.sh references 50 deleted plan files and audit-tool-nodes.mjs has no callers — delete both.
---

## Findings

1. **What:** `scripts/backfill-plan-frontmatter.sh` is a dead one-shot migration script whose targets no longer exist.
   **Evidence:** The script's STATUS associative array hardcodes 50 filename keys (`scripts/backfill-plan-frontmatter.sh:18-69`), all dating 2026-04-03 through 2026-04-25. Current `docs/superpowers/plans/` contains only 6 files (`2026-04-30-bundle-janitor-pipeline.md` … `2026-05-01-agent-kill-deletion.md`) — none overlap. Running the script today would exit 1 on line 71: `MISS: … not found — table out of sync with filesystem`. No binding in `package.json#scripts`.
   **Why it matters (KISS lens):** A future reader sees a `scripts/` folder and wonders whether these scripts are part of the operational workflow or safe to ignore. The dead STATUS table creates false signal — it looks authoritative but models a state of the world that was deleted months ago.
   **Suggested action:** `git rm scripts/backfill-plan-frontmatter.sh`

2. **What:** `scripts/audit-tool-nodes.mjs` is a dev audit helper with no callers and no npm binding.
   **Evidence:** Sole occurrence in the codebase is the file itself (`scripts/audit-tool-nodes.mjs:2` — self-referential comment `// scripts/audit-tool-nodes.mjs`). No `package.json#scripts` entry. No `import` or `require` anywhere. The script's stated purpose — "Suggests cwd value based on prefix patterns" — is a one-off audit; ADR and memory confirm the `cwd` migration was completed (`memory/2026-04-19-pipeline-validator-trust-upgrade.md`).
   **Why it matters (KISS lens):** Every file in `scripts/` that isn't part of a documented workflow is a maintenance question mark. With two such files the folder reads as a junk drawer — the reader can't distinguish "occasionally useful" from "already done, forgot to delete".
   **Suggested action:** `git rm scripts/audit-tool-nodes.mjs`; if the folder becomes empty afterwards, remove it too.

## Reading thread

- `2026-05-01T0212-janitor-dead-two-phase-fn.md` — covers dead exports in `session.ts` (`runTwoPhaseClaudeSession`). Same dead-code category, different domain (lib vs scripts). Not duplicated here.
- `2026-05-01T0211-pipeline-lifecycle-cli-surface-gap.md` — covers missing `pipeline create` command. Unrelated.
- `2026-05-01T0120-janitor-graph-validator-bloat.md` — covers graph.ts bloat. Unrelated.
