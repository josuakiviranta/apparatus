#!/usr/bin/env bash
# pipelines/smoke/parallel-illumination-to-implementation/batch-orchestrator-stub.sh
# Deterministic stand-in for the batch_orchestrator agent during smoke runs.
# Reads $1 = dag.json path, $2 = plan path.
# cwd is already set to the project directory by the pipeline (cwd=$project).
# Creates foo.txt and bar.txt in the project's main worktree (no real worktree fan-out),
# marks both chunks merged in dag.json, flips plan checkboxes, commits, and emits the
# orchestrator's JSON output to stdout.
set -euo pipefail
dag=$1
plan=$2
project=$(pwd)
echo "foo" > foo.txt
echo "bar" > bar.txt
git add -A
git commit -q -m "smoke: chunks c1 and c2 implemented"

# Flip dag.json statuses
node -e "
const fs = require('fs');
const dag = JSON.parse(fs.readFileSync('$dag', 'utf-8'));
for (const c of dag.chunks) {
  c.status = 'merged';
  c.head_sha = '$(git rev-parse HEAD)';
  c.merge_sha = '$(git rev-parse HEAD)';
}
fs.writeFileSync('$dag', JSON.stringify(dag, null, 2));
"

# Flip plan checkboxes (no-op for this fixture; the fixture plan has no checkboxes)

printf '{"done":true,"conflicts_present":false,"reason":"no_chunks_remaining"}\n'
