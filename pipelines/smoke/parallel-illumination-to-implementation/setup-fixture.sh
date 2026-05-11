#!/usr/bin/env bash
# pipelines/smoke/parallel-illumination-to-implementation/setup-fixture.sh
# Bootstrap a throwaway project dir for the smoke. Caller passes $1 = target path.
set -euo pipefail
script_dir="$(cd "$(dirname "$0")" && pwd)"
target=$1
mkdir -p "$target"
cd "$target"
git init -q -b main
echo '{"scripts":{"test":"true"}}' > package.json
touch .gitignore
git add -A
git commit -q -m "init"
cp "$script_dir/plan.md" "$target/plan.md"
git add plan.md
git commit -q -m "add plan"
echo "$target"
