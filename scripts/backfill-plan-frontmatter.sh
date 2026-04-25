#!/usr/bin/env bash
# One-shot backfill: prepend status frontmatter to every file in
# docs/superpowers/plans/. Idempotent — files that already carry a
# `status: pending` or `status: implemented` frontmatter are skipped.
# Files with `status: proposed` (legacy) have ONLY their status line
# rewritten to `implemented`; other frontmatter fields are preserved.
#
# Requires bash 4+ (associative arrays). macOS default /bin/bash is 3.2;
# install GNU bash via `brew install bash` and run with /usr/local/bin/bash.

set -euo pipefail

PLANS_DIR="docs/superpowers/plans"

# status assignment: pending|implemented per file
declare -A STATUS=(
  [2026-04-03-ralph-new-command.md]=implemented
  [2026-04-10-interactive-ink-overlay.md]=implemented
  [2026-04-12-headless-governance-gates.md]=pending
  [2026-04-12-illumination-auto-commit.md]=implemented
  [2026-04-12-illumination-state-machine.md]=implemented
  [2026-04-12-mark-implemented-lifecycle.md]=implemented
  [2026-04-12-meditate-backpressure-guard.md]=pending
  [2026-04-12-meditate-tool-whitelist-gap.md]=implemented
  [2026-04-12-top-level-directory-inventory.md]=implemented
  [2026-04-12-top-level-directory-map.md]=pending
  [2026-04-13-path1-structured-interactive-handoff.md]=implemented
  [2026-04-13-undefined-variable-backpressure-guard.md]=implemented
  [2026-04-14-handler-context-registry-dedup.md]=implemented
  [2026-04-14-ink-native-gate-prompt.md]=implemented
  [2026-04-14-livefooter-stable-height.md]=implemented
  [2026-04-14-mcp-gitignore-pattern-fix.md]=implemented
  [2026-04-14-meditate-steer-flag.md]=implemented
  [2026-04-14-pipeline-ctrlc-kill.md]=implemented
  [2026-04-14-pipeline-renderer-redesign.md]=implemented
  [2026-04-14-pipeline-static-streaming.md]=implemented
  [2026-04-14-pipeline-tui-flicker-fix.md]=implemented
  [2026-04-14-portable-pipeline-schema-resolution.md]=implemented
  [2026-04-14-store-node-handler.md]=implemented
  [2026-04-14-tmux-drive-harness.md]=implemented
  [2026-04-15-pipeline-agent-stream-output.md]=implemented
  [2026-04-16-implement-as-pipeline.md]=implemented
  [2026-04-16-markdown-rendering.md]=implemented
  [2026-04-16-pipeline-context-observability.md]=implemented
  [2026-04-16-pipeline-portability.md]=implemented
  [2026-04-16-pipeline-refine-command.md]=implemented
  [2026-04-16-preflight-variable-check.md]=implemented
  [2026-04-17-pipeline-script-files.md]=implemented
  [2026-04-17-refine-authoring-loop.md]=implemented
  [2026-04-17-refine-run-history-and-failure-tip.md]=implemented
  [2026-04-18-implement-retry-tmux-context.md]=pending
  [2026-04-18-pipeline-commands-spec-backfill.md]=implemented
  [2026-04-18-pipeline-validator-trust-upgrade.md]=implemented
  [2026-04-19-fenced-code-block-var-skip.md]=implemented
  [2026-04-19-gate-choice-namespacing.md]=implemented
  [2026-04-19-gate-validator-producer-declaration.md]=implemented
  [2026-04-19-mark-archived-reason-split.md]=implemented
  [2026-04-20-dot-parser-ast-migration.md]=implemented
  [2026-04-20-mark-archived-spec-drift.md]=implemented
  [2026-04-20-schema-description-overrides-agent-rubric.md]=implemented
  [2026-04-20-source-location-diagnostics.md]=implemented
  [2026-04-20-validator-and-runtime-disagree-on-defaults.md]=implemented
  [2026-04-22-agent-rubric-prepend.md]=implemented
  [2026-04-25-state-machine-exists-verifier-ignores-it.md]=pending
)

for filename in "${!STATUS[@]}"; do
  status="${STATUS[$filename]}"
  path="${PLANS_DIR}/${filename}"
  if [[ ! -f "$path" ]]; then
    echo "MISS: $path not found — table out of sync with filesystem" >&2
    exit 1
  fi
  first_line="$(head -n1 "$path")"
  if [[ "$first_line" == "---" ]]; then
    # Existing frontmatter: rewrite the status line in place.
    if grep -qE '^status: (pending|implemented|proposed|open)$' "$path"; then
      # Already correctly stamped — but verify it matches the assigned status.
      current="$(grep -E '^status: (pending|implemented|proposed|open)$' "$path" | head -n1 | awk '{print $2}')"
      if [[ "$current" != "$status" ]]; then
        # Rewrite mismatched stamp (e.g., `proposed` → `implemented`).
        # Use awk for portability across macOS/Linux sed differences.
        tmp="$(mktemp)"
        awk -v want="$status" '
          BEGIN { in_fm=0; rewritten=0 }
          NR==1 && $0=="---" { in_fm=1; print; next }
          in_fm && $0=="---" { in_fm=0; print; next }
          in_fm && /^status:/ && !rewritten { print "status: " want; rewritten=1; next }
          { print }
        ' "$path" > "$tmp"
        mv "$tmp" "$path"
        echo "REWROTE: $filename (status: $current → $status)"
      else
        echo "SKIP:    $filename (already status: $status)"
      fi
    else
      # Frontmatter exists but no recognized status line — insert one.
      tmp="$(mktemp)"
      awk -v want="$status" '
        BEGIN { in_fm=0; inserted=0 }
        NR==1 && $0=="---" { in_fm=1; print; print "status: " want; inserted=1; next }
        in_fm && $0=="---" { in_fm=0; print; next }
        { print }
      ' "$path" > "$tmp"
      mv "$tmp" "$path"
      echo "INSERTED: $filename (status: $status)"
    fi
  else
    # No frontmatter: prepend a fresh block.
    tmp="$(mktemp)"
    {
      echo "---"
      echo "status: $status"
      echo "---"
      echo
      cat "$path"
    } > "$tmp"
    mv "$tmp" "$path"
    echo "PREPENDED: $filename (status: $status)"
  fi
done
