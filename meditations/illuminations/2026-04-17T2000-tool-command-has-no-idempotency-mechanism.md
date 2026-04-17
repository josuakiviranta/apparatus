---
date: 2026-04-17
status: open
description: tool_command= nodes carry the same --resume idempotency requirement as script_file= nodes but have no structured mechanism to express or test it — the delete_file node in illumination-to-implementation.dot is the concrete violation (rm without -f fails on resume).
---

## Core Idea

`script_file=` and `tool_command=` are both `type="tool"` nodes and both participate in the `--resume` idempotency contract documented in `specs/commands.md`. The difference: `script_file=` resolves to an external file with a defined interface (positional args, exit codes, JSON stdout), which can be tested in isolation and can implement explicit idempotency checks. `tool_command=` is raw shell — no interface boundary, no natural test seam, and no mechanism to express "this is already done." The contract is stated once in the spec and then silently assumed.

The concrete violation: `delete_file [type="tool", tool_command="rm $illumination_path"]` in `pipelines/illumination-to-implementation.dot`. `rm` on a non-existent file exits non-zero. If the pipeline is resumed after the delete succeeded on a previous run, the node re-executes, `rm` fails, and the engine routes to failure. The fix is one character: `rm -f`. But the deeper issue is that `tool_command` nodes have no structural pressure toward idempotency — the author must remember the spec rule and apply it correctly for every inline command, with no test harness to catch failures.

## Why It Matters

`--resume` is the recovery mechanism for the full `illumination-to-implementation` pipeline. The pipeline runs for minutes, involves human gates, and can be interrupted at any point. A user who presses Ctrl-C after the `delete_file` node succeeds and then runs `--resume` will get a confusing failure on a node that "already worked." The error message — `Command exited with code 1: rm: $illumination_path: No such file or directory` — gives no indication that this is a resume-idempotency problem, not a real error.

The asymmetry between `tool_command` and `script_file` is sharpest in `illumination-to-implementation.dot`:

- `mark_dispatched [type="tool", script_file="scripts/mark-dispatched.mjs"]` — the script explicitly detects the already-dispatched state, returns `idempotent: true`, and exits 0. Resume is safe.
- `commit_push [type="tool", tool_command="cd $project && git push ..."]` — git push is naturally idempotent (pushing the same commits again is a no-op). Resume is accidentally safe.
- `delete_file [type="tool", tool_command="rm $illumination_path"]` — `rm` is not idempotent. Resume is broken.

The `mark-dispatched.mjs` script is explicitly cited in `specs/commands.md` as the "reference pattern" for tool-node idempotency. But the document only describes the pattern for `script_file` nodes — it does not name `rm -f`, `git push -f || true`, or any `tool_command`-level idioms.

## Revised Implementation Steps

1. **Fix `delete_file` in `illumination-to-implementation.dot`.** Change `tool_command="rm $illumination_path"` to `tool_command="rm -f $illumination_path"`. One character. This makes the delete idempotent: `rm -f` exits 0 whether or not the file exists.

2. **Audit all `tool_command=` nodes in `pipelines/` for resume safety.** Run `grep -r 'tool_command=' pipelines/` and check each inline command against the idempotency requirement. `git push` is safe; `rm` without `-f` is not; `mkdir` without `-p` is not. Document findings inline (a comment in the `.dot` file is acceptable).

3. **Add a note to `specs/commands.md` under "Tool-node idempotency requirement".** After the existing `script_file` guidance, add: "`tool_command=` nodes must also be idempotent. Common idioms: `rm -f` (not `rm`), `mkdir -p` (not `mkdir`), `git push` (naturally idempotent for identical commits). Inline commands with no idempotency story should be extracted to a `script_file=` instead."

4. **Consider whether `delete_file` should be a `script_file=` node.** The current `rm $illumination_path` is one-line shell, so the pressure to extract it is low. But if the node ever needs to verify the file exists before deleting, log deletion, or handle the case where archiving was chosen instead — it should become a script. Flag this in the pipeline as a `# TODO: extract to script_file= if pre-delete verification is needed` comment.

5. **Add `ralph pipeline validate illumination-to-implementation.dot` to any CI or smoke-test gate.** `validate` catches structural errors — missing nodes, bad edge labels — but not idempotency bugs. The point of adding it is to ensure modifications to the flagship pipeline are caught structurally before running. Currently this pipeline has no automated validation gate at all.
