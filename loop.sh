#!/bin/bash
# Usage: ./loop.sh <prompt-file-path> [max_iterations]
# Examples:
#   ./loop.sh /path/to/PROMPT_build.md
#   ./loop.sh /path/to/PROMPT_build.md 20

if [ -z "$1" ]; then
    echo "Error: prompt file path required"
    echo "Usage: $0 <prompt-file-path> [max_iterations]"
    exit 1
fi

PROMPT_FILE="$1"
MAX_ITERATIONS=${2:-0}
MODE="build"

ITERATION=0
CURRENT_BRANCH=$(git branch --show-current)
CLAUDE_PID=""

cleanup() {
    [ -n "$CLAUDE_PID" ] && kill "$CLAUDE_PID" 2>/dev/null
    exit 0
}
trap cleanup INT TERM

echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "Mode:   $MODE"
echo "Prompt: $PROMPT_FILE"
echo "Branch: $CURRENT_BRANCH"
echo "PID:    $$ (kill $$ to stop)"
[ $MAX_ITERATIONS -gt 0 ] && echo "Max:    $MAX_ITERATIONS iterations"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"

# Verify prompt file exists
if [ ! -f "$PROMPT_FILE" ]; then
    echo "Error: $PROMPT_FILE not found"
    exit 1
fi

while true; do
    if [ $MAX_ITERATIONS -gt 0 ] && [ $ITERATION -ge $MAX_ITERATIONS ]; then
        echo "Reached max iterations: $MAX_ITERATIONS"
        break
    fi

    # Run Ralph iteration with selected prompt
    # -p: Headless mode (non-interactive, reads from stdin)
    # --dangerously-skip-permissions: Auto-approve all tool calls (YOLO mode)
    # --output-format=stream-json: Structured output for logging/monitoring
    # --model opus: Primary agent uses Opus for complex reasoning (task selection, prioritization)
    #               Can use 'sonnet' in build mode for speed if plan is clear and tasks well-defined
    # --verbose: Detailed execution logging
    claude -p \
        --dangerously-skip-permissions \
        --output-format=stream-json \
        --model opus \
        < "$PROMPT_FILE" \
        > >(jq -r '
          if .type == "assistant" then
            .message.content[]? |
            if .type == "text" then .text
            elif .type == "tool_use" then "→ [tool] \(.name)"
            else empty end
          else empty end
        ' 2>/dev/null) &
    CLAUDE_PID=$!
    wait $CLAUDE_PID
    CLAUDE_PID=""

    # Push changes after each iteration
    git push origin "$CURRENT_BRANCH" || {
        echo "Failed to push. Creating remote branch..."
        git push -u origin "$CURRENT_BRANCH"
    }

    ITERATION=$((ITERATION + 1))
    echo -e "\n\n======================== LOOP $ITERATION ========================\n"
done
