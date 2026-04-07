#!/bin/bash
# @name: stream-formatter output markers
# @description: Pipes synthetic stream-json through stream-formatter.js and asserts all expected output markers appear (MAIN AGENT header, file tool labels, subagent boundaries, token counts)

set -e

REPO_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
FORMATTER="$REPO_ROOT/dist/cli/lib/stream-formatter.js"

if [ ! -f "$FORMATTER" ]; then
  echo "FAIL: formatter not built at $FORMATTER — run: npm run build"
  exit 1
fi

# Synthetic stream-json: one turn with text + Read + Agent dispatch,
# then a subagent assistant event (buffered), then a user-wrapped tool_result
# closing the subagent, then a second turn with Bash (ctx growth: 5200 > 5000)
INPUT=$(cat <<'EOF'
{"type":"assistant","message":{"content":[{"type":"text","text":"Analyzing codebase..."},{"type":"tool_use","name":"Read","id":"t1","input":{"file_path":"/src/foo.ts"}},{"type":"tool_use","name":"Agent","id":"a1","input":{"description":"Explore auth patterns"}}],"usage":{"input_tokens":5000,"output_tokens":20}}}
{"type":"assistant","parent_tool_use_id":"a1","message":{"content":[{"type":"tool_use","name":"Glob","id":"t2","input":{"pattern":"**/*.ts"}}],"usage":{"input_tokens":300,"output_tokens":5}}}
{"type":"user","message":{"content":[{"type":"tool_result","tool_use_id":"a1","content":[]}]}}
{"type":"assistant","message":{"content":[{"type":"tool_use","name":"Bash","id":"t3","input":{"command":"npm test"}}],"usage":{"input_tokens":5200,"output_tokens":5}}}
{"type":"system","session_id":"abc123"}
{"type":"result","result":"done"}
EOF
)

OUTPUT=$(echo "$INPUT" | node "$FORMATTER")

PASS=0
FAIL=0

check() {
  if echo "$OUTPUT" | grep -qF "$1"; then
    echo "  PASS: '$1'"
    PASS=$((PASS + 1))
  else
    echo "  FAIL: missing '$1'"
    FAIL=$((FAIL + 1))
  fi
}

echo "=== Scenario: stream-formatter output markers ==="
echo ""

check "┌─ MAIN AGENT"
check "Analyzing codebase..."
check "→ [read] /src/foo.ts"
check "▶ SUBAGENT: Explore auth patterns"
check "┌─ SUBAGENT: Explore auth patterns"
check "  → [glob] **/*.ts"
check "◀ ──"
check "◈ ctx: 5,000 tokens"
check "→ [bash] npm test"
check "◈ ctx: 5,200 tokens"

echo ""
echo "Results: $PASS passed, $FAIL failed"

if [ "$FAIL" -gt 0 ]; then
  echo ""
  echo "--- actual output ---"
  printf '%s\n' "$OUTPUT"
  echo "---------------------"
  echo ""
  echo "=== FAIL ==="
  exit 1
fi

echo "=== PASS ==="
