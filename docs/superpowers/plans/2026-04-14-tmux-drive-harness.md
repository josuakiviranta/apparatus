---
status: implemented
---

# Tmux Drive Harness Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship a single authoritative document (`docs/harness/tmux-drive.md`) plus two discoverability pointers that let Claude autonomously drive ralph-cli inside tmux, observe its Ink TUI, and analyze results — all via Bash, with no new code or dependencies.

**Architecture:** Pure documentation + filesystem conventions. One markdown file containing six Bash patterns (start/capture/wait-stable/wait-for-source/send-input/cleanup) plus visual capture, recovery, gotchas. Scratchpad at `~/.ralph/harness/<run-id>/` slots next to existing `~/.ralph/runs/`. Two pointers (in `MEMORY.md` and `CLAUDE.md`) ensure discoverability in fresh sessions.

**Tech Stack:** macOS bash, tmux, ripgrep, `screencapture`, stock coreutils. No Node, no Python, no jq, no npm packages. Node is used only for a one-shot JSON validation check in smoke tests (ralph already depends on Node).

**Source spec:** `docs/superpowers/specs/2026-04-14-tmux-drive-harness-design.md`

**TDD adaptation for documentation:** Each pattern follows a red/green cycle adapted for Bash-in-Markdown: (1) write a smoke-test scenario that exercises the pattern, (2) run it against a deliberately-incomplete snippet and watch it fail, (3) write the snippet per spec, (4) run the smoke test and watch it pass, (5) commit. Documentation that cannot be executed is not trustworthy.

---

## File Structure

Files created:

| Path | Responsibility |
|---|---|
| `docs/harness/tmux-drive.md` | The patterns document. Single file, sectioned. Authoritative source of truth. |
| `docs/harness/README.md` | One-paragraph index pointing at `tmux-drive.md`. Keeps the new top-level directory obvious to casual browsers. |

Files modified:

| Path | Change |
|---|---|
| `MEMORY.md` | Add a "Harness" pointer as a new `## Harness` section appended after the existing `## Known Issues` section. |
| `CLAUDE.md` | Add a `## Debugging the Ink TUI` section as a new top-level section at the end. |
| `docs/superpowers/specs/2026-04-14-tmux-drive-harness-design.md` | Update `Status:` to `Implemented — 2026-04-14` after smoke tests pass (final task only). |

Files NOT touched:

- No `src/**` changes. The spec forbids ralph-cli source modifications.
- No `package.json`, no `tsup.config.ts`, no build changes.
- No new test files in `src/cli/tests/` — smoke tests are ad-hoc shell runs documented in this plan, not committed test code.

---

## Chunk 1: Environment Probing, Doc Skeleton, `wait_stable`

**Why this chunk first:** Patterns 1, 3, 4 depend on `date +%s%N` being available (or a fallback). If the probe fails on the developer's macOS, we hard-code the working alternative before writing the patterns — otherwise the doc ships broken. Pattern 6 uses a pure-bash `meta.json` rewrite (no `sed -i.bak`) so there is no sed portability probe. `wait_stable` (Pattern 3) is the foundation every other pattern calls, so it goes first.

### Task 1.1: Probe the environment

**Why this task exists:** Task 1.3 writes the canonical `now_ns()` helper into the patterns doc. That helper must work on THIS machine. This task runs concrete bash checks and prints the right incantation so Task 1.3 can paste it verbatim. The patterns doc is the durable record — no probe log, no scratch file, no hidden state.

- [ ] **Step 1: Confirm tmux is installed and a recent version**

```bash
tmux -V || { echo "STOP: tmux is required"; exit 1; }
```

Expected: `tmux 3.x` or newer. If the command aborts, STOP and surface to the human — the entire plan is infeasible without tmux.

- [ ] **Step 2: Decide which command `now_ns()` will use**

Run this concrete check and read the final line. A valid nanosecond timestamp is all-digits and at least 18 characters long. BSD `date +%s%N` prints a trailing literal `N`, which fails the all-digits case; the length check catches other malformed outputs.

```bash
is_ns_ok() {
  local out=$1
  [ -n "$out" ] || return 1
  case "$out" in
    *[!0-9]*) return 1 ;;   # contains a non-digit — reject
  esac
  [ "${#out}" -ge 18 ]
}

if out=$(date +%s%N 2>/dev/null) && is_ns_ok "$out"; then
  echo "TIME_SRC_CMD='date +%s%N'"
elif out=$(gdate +%s%N 2>/dev/null) && is_ns_ok "$out"; then
  echo "TIME_SRC_CMD='gdate +%s%N'"
elif out=$(perl -MTime::HiRes=time -e 'printf "%d\n", time()*1000000000' 2>/dev/null) && is_ns_ok "$out"; then
  echo "TIME_SRC_CMD='perl -MTime::HiRes=time -e \"printf \\\"%d\\\\n\\\", time()*1000000000\"'"
else
  echo "STOP: no nanosecond time source"
fi
```

Expected: exactly one line starting with `TIME_SRC_CMD=`, or `STOP:` (surface to human and abort). Sanity-check on macOS: `date +%s%N` prints `<unix-seconds>N` (with a trailing literal `N`), so the `*[!0-9]*` pattern rejects it and the probe falls through to `gdate` / `perl`. On Linux, `date +%s%N` prints 19 digits and is selected.

**Record the result:** Copy the printed `TIME_SRC_CMD=...` value into the task's commit message in Task 1.3 Step 7 (e.g., `docs(harness): wait_stable (pattern 3) + sourceable block skeleton — TIME_SRC_CMD='gdate +%s%N'`). That way the decision is permanent in git history and the patterns doc itself already encodes the chosen command in `now_ns()`.

- [ ] **Step 3: Probe `osascript` terminal detection (screenshot prerequisite)**

```bash
osascript -e 'tell application "System Events" to get name of first application process whose frontmost is true' \
  && echo "OSA_WORKS=yes" \
  || echo "OSA_WORKS=no  # screenshot helper will fail until accessibility access is granted"
```

Expected: a non-empty app name followed by `OSA_WORKS=yes`. If `OSA_WORKS=no`, the text patterns still work — only the opt-in `screenshot` helper in Task 3.2 will be non-functional. Continue the plan; surface this to the human at Task 3.2 time.

- [ ] **Step 4: Confirm ripgrep and Node are available**

```bash
rg --version >/dev/null && echo "RG=ok" || { echo "STOP: ripgrep required"; exit 1; }
node --version >/dev/null && echo "NODE=ok" || { echo "STOP: node required"; exit 1; }
```

Expected: `RG=ok` and `NODE=ok`. ripgrep is used by Pattern 4; Node is used by smoke tests for one-shot JSON validation.

- [ ] **Step 5: No state to save**

This task writes nothing to disk. The `TIME_SRC_CMD` decision lives in Task 1.3's commit message and in the `now_ns()` body inside the patterns doc. There is no `/tmp` scratchpad to avoid committing.

---

### Task 1.2: Scaffold `docs/harness/` and the skeleton of `tmux-drive.md`

**Files:**
- Create: `docs/harness/README.md`
- Create: `docs/harness/tmux-drive.md` (skeleton only; patterns added in later tasks)

- [ ] **Step 1: Write the failing test — verify the doc file does not exist yet**

Run: `test -f docs/harness/tmux-drive.md && echo "FAIL: already exists" || echo "OK: not yet created"`
Expected: `OK: not yet created`

- [ ] **Step 2: Create `docs/harness/README.md`**

```markdown
# docs/harness/

Authoritative harness documentation for Claude driving ralph-cli under tmux.

- [`tmux-drive.md`](./tmux-drive.md) — the patterns document. Start here.

This directory is a sibling of `docs/superpowers/` and does not conflict with it.
```

- [ ] **Step 3: Create `docs/harness/tmux-drive.md` skeleton**

Write the file with these section headers and nothing else under them yet:

```markdown
# Tmux Drive Harness — Patterns

Read this document at the start of any debugging session that needs to observe ralph's Ink TUI. All six patterns below are presented as sections of a single sourceable bash block. Copy the whole block into your shell before calling any pattern individually.

## When to use this

## Prerequisites

## Setup: source the patterns block

## Pattern 1 — Start a run

## Pattern 2 — Capture

## Pattern 3 — Wait for stable UI

## Pattern 4 — Wait for a precise state (source grep)

## Pattern 5 — Send input

## Pattern 6 — Cleanup

## Visual capture (opt-in)

## Recovery from orphaned runs

## Pruning the scratchpad

## Gotchas
```

- [ ] **Step 4: Run the existence test again to verify it passes**

Run: `test -f docs/harness/tmux-drive.md && echo "OK: exists" || echo "FAIL"`
Expected: `OK: exists`

Also run: `grep -c "^## " docs/harness/tmux-drive.md`
Expected: `13` (thirteen top-level section headers).

- [ ] **Step 5: Commit**

```bash
git add docs/harness/README.md docs/harness/tmux-drive.md
git commit -m "docs(harness): scaffold tmux-drive patterns document"
```

---

### Task 1.3: Write and validate `wait_stable` (Pattern 3)

**Files:**
- Modify: `docs/harness/tmux-drive.md` (fill in "Pattern 3" and "Setup" sections)

- [ ] **Step 1: Write the failing smoke test**

Paste this into a shell (do NOT save in git) — it exercises `wait_stable` against a live tmux window before we have written it:

```bash
# Smoke test for wait_stable: create a window that sits idle, wait for it to stabilize.
SESSION=$(tmux display-message -p '#S')
WIN="wait-stable-probe-$$"
tmux new-window -t "$SESSION" -n "$WIN" -d
sleep 0.5  # let the shell initialize
# At this point the pane is stable (a bash prompt waiting).
# wait_stable should return 0 within its default budget.
if declare -F wait_stable >/dev/null; then
  wait_stable 5000 && echo "PASS: stabilized" || echo "FAIL: timed out"
else
  echo "FAIL: wait_stable not defined"
fi
tmux kill-window -t "$SESSION:$WIN"
```

Expected BEFORE implementation: `FAIL: wait_stable not defined`.

- [ ] **Step 2: Run the smoke test to confirm it fails**

Paste the snippet above into a shell and confirm it prints `FAIL: wait_stable not defined`. This is the "red" state.

- [ ] **Step 3: Fill in the "Setup: source the patterns block" section of `tmux-drive.md`**

Add this content under the `## Setup: source the patterns block` header:

````markdown
Copy the entire fenced block below into your current shell. It defines every helper function used by the patterns that follow. Nothing is executed by sourcing — you still need to call the individual helpers.

```bash
# ---------- tmux drive harness helpers ----------
# Source this block before using any pattern.

# Globals filled in by Pattern 1 (start_run). Every other helper reads them.
: "${SESSION:=}"
: "${WIN:=}"
: "${RUN_DIR:=}"
: "${RUN_ID:=}"
: "${CAPTURE_INDEX:=0}"

# Time source — resolved at source time based on what the probe found.
# Pattern 3 and Pattern 4 call now_ns() for deadline math.
now_ns() {
  date +%s%N    # <-- replace with gdate or perl fallback if the probe required it
}

# ---------- Pattern 3: wait_stable ----------
wait_stable() {
  local budget_ms=${1:-10000}
  local start_ns deadline_ns t
  start_ns=$(now_ns)
  deadline_ns=$((start_ns + budget_ms * 1000000))
  local prev=$'\x01'   # control-byte sentinel; tmux capture-pane never emits it
  while : ; do
    t=$(now_ns)
    if [ "$t" -ge "$deadline_ns" ]; then
      local spent=$(( (t - start_ns) / 1000000 ))
      echo "$(date -u +%Y-%m-%dT%H:%M:%SZ) wait-stable TIMEOUT elapsed=${spent}ms" >> "$RUN_DIR/events.log" 2>/dev/null || true
      return 1
    fi
    local now
    now=$(tmux capture-pane -p -t "$SESSION:$WIN")
    if [ "$prev" != $'\x01' ] && [ "$prev" = "$now" ]; then
      local spent=$(( ($(now_ns) - start_ns) / 1000000 ))
      echo "$(date -u +%Y-%m-%dT%H:%M:%SZ) wait-stable elapsed=${spent}ms" >> "$RUN_DIR/events.log" 2>/dev/null || true
      return 0
    fi
    prev="$now"
    sleep 0.2
  done
}
```
````

Important substitution: if Task 1.1 Step 2 recorded `TIME_SRC=gdate`, replace `date +%s%N` inside `now_ns()` with `gdate +%s%N`. If `TIME_SRC=perl`, replace with `perl -MTime::HiRes=time -e 'printf "%d\n", time()*1000000000'`. The doc must contain the working incantation verbatim; no "if/else" in the patterns document itself.

- [ ] **Step 4: Fill in the "Pattern 3 — Wait for stable UI" section with the explanatory prose**

Add under `## Pattern 3 — Wait for stable UI`:

```markdown
`wait_stable` is the default synchronization primitive. It polls `tmux capture-pane` every 200ms and returns 0 as soon as two consecutive captures match. Works for every Ink surface without knowing what is being rendered.

Call it:
- Before the first capture after `start_run`, to let the new window's shell print its prompt.
- Before and after every `send_input` call, to let Ink absorb the input.
- Whenever you need to treat `current.txt` as authoritative.

Failure mode: if the UI keeps changing past `budget_ms` (default 10000), it returns 1 and logs `wait-stable TIMEOUT` to `events.log`. The timeout is measured by wall clock via `now_ns()`, so heavy `capture-pane` calls do not inflate the budget.

Gotcha: the control-byte sentinel `$'\x01'` lets an empty pane be "stable" (a genuinely empty capture is distinct from the pre-loop sentinel). Without it, `wait_stable` would hang on any pane that captures to an empty string.
```

- [ ] **Step 5: Source the patterns block and re-run the smoke test**

In a fresh shell:

```bash
# Extract the fenced bash block from the doc and source it.
# A copy-paste equivalent that the document itself instructs users to do.
eval "$(sed -n '/^# ---------- tmux drive harness helpers ----------/,/^# ---------- end helpers ----------/p' docs/harness/tmux-drive.md 2>/dev/null | sed '1d;$d')" 2>/dev/null || {
  # If the sed extraction fails (the block has no end marker yet), paste the
  # block manually or use the Read tool to grab it.
  echo "NOTE: paste the bash block manually for this smoke test"
}

# Now run the smoke test from Step 1.
SESSION=$(tmux display-message -p '#S')
WIN="wait-stable-probe-$$"
RUN_DIR=/tmp/wait-stable-probe   # wait_stable logs to this dir
mkdir -p "$RUN_DIR"
tmux new-window -t "$SESSION" -n "$WIN" -d
sleep 0.5
wait_stable 5000 && echo "PASS: stabilized" || echo "FAIL: timed out"
tmux kill-window -t "$SESSION:$WIN"
rm -rf "$RUN_DIR"
```

Expected: `PASS: stabilized`, and `$RUN_DIR/events.log` contains a `wait-stable elapsed=...ms` line.

- [ ] **Step 6: Add the end-marker comment to the bash block**

The extraction script in Step 5 expects `# ---------- end helpers ----------` at the end of the sourceable block. Add this line inside the fenced block at the very end (after `wait_stable`'s closing brace):

```bash
# ---------- end helpers ----------
```

Re-run Step 5 and confirm `PASS`.

- [ ] **Step 7: Commit**

```bash
git add docs/harness/tmux-drive.md
git commit -m "docs(harness): wait_stable (pattern 3) + sourceable block skeleton"
```

---

## Chunk 2: Core Lifecycle — Patterns 1, 2, 5, 6

**Why this chunk next:** Patterns 1, 2, 5, 6 are the happy path: start a run, capture output, send input, clean up. Together they cover Smoke Test 1 in the spec ("round-trip a trivial command"). Pattern 4 (source grep) and the opt-in features (visual capture, recovery) go into Chunk 3 because they are not needed for the core happy path.

### Task 2.1: Pattern 1 — Start a run

**Files:**
- Modify: `docs/harness/tmux-drive.md` (fill in "Pattern 1" section and add `start_run` to the sourceable block)

- [ ] **Step 1: Write the failing smoke test**

```bash
# Self-contained smoke test for start_run.
unset SESSION WIN RUN_DIR RUN_ID CAPTURE_INDEX
if declare -F start_run >/dev/null; then
  start_run "echo hello && sleep 10"
  test -f "$RUN_DIR/meta.json" && echo "PASS: meta.json written" || echo "FAIL: meta.json missing"
  tmux list-windows -t "$SESSION" -F '#W' | grep -q "^$WIN$" && echo "PASS: window exists" || echo "FAIL: window missing"
  tmux kill-window -t "$SESSION:$WIN" 2>/dev/null
  rm -rf "$RUN_DIR"
else
  echo "FAIL: start_run not defined"
fi
```

Expected BEFORE implementation: `FAIL: start_run not defined`.

- [ ] **Step 2: Run the smoke test and confirm failure**

Expected: `FAIL: start_run not defined`.

- [ ] **Step 3: Add `start_run` to the sourceable block in `tmux-drive.md`**

Inside the bash block in "Setup", BEFORE `# ---------- end helpers ----------`:

```bash
# ---------- Pattern 1: start_run ----------
# Usage: start_run "<command to run in the new window>"
# Side effects: sets SESSION, WIN, RUN_DIR, RUN_ID, CAPTURE_INDEX; creates the
# scratchpad directory; creates a new tmux window in the current session; writes
# meta.json; launches the command.
start_run() {
  local cmd=$1
  if [ -z "$cmd" ]; then
    echo "start_run: command is required" >&2
    return 2
  fi

  RUN_ID="drive-$(date +%s)-$$"
  SESSION=$(tmux display-message -p '#S')
  WIN="ralph-$RUN_ID"
  RUN_DIR="$HOME/.ralph/harness/$RUN_ID"
  CAPTURE_INDEX=0
  mkdir -p "$RUN_DIR"

  # -d = don't steal focus
  tmux new-window -t "$SESSION" -n "$WIN" -d

  # Wait for the fresh shell to finish printing its prompt.
  wait_stable 5000 || true

  local pane_size win_index
  pane_size=$(tmux display-message -t "$SESSION:$WIN" -p '#{pane_width}x#{pane_height}')
  win_index=$(tmux display-message -t "$SESSION:$WIN" -p '#I')

  # Escape embedded double quotes in $cmd so meta.json stays valid JSON.
  local cmd_json
  cmd_json=$(printf '%s' "$cmd" | sed 's/"/\\"/g')

  cat > "$RUN_DIR/meta.json" <<EOF
{
  "session": "$SESSION",
  "window": "$WIN",
  "window_index": "$win_index",
  "run_id": "$RUN_ID",
  "pid": "$$",
  "pane_size": "$pane_size",
  "started": "$(date -u +%Y-%m-%dT%H:%M:%SZ)",
  "command": "$cmd_json"
}
EOF

  # Launch: text via -l, then Enter as a separate call.
  tmux send-keys -t "$SESSION:$WIN" -l "$cmd"
  tmux send-keys -t "$SESSION:$WIN" Enter

  echo "$(date -u +%Y-%m-%dT%H:%M:%SZ) start window=$WIN" >> "$RUN_DIR/events.log"
}
```

- [ ] **Step 4: Fill in the "Pattern 1 — Start a run" prose section**

```markdown
`start_run "<cmd>"` creates a new tmux window in your current session (without stealing focus), waits for the shell to print its prompt, records run metadata, and launches the command.

After it returns, these globals are set and are used implicitly by every other pattern:

- `RUN_ID` — `drive-<unix-seconds>-<pid>`, unique even when two runs start in the same second.
- `SESSION` — the tmux session you were attached to.
- `WIN` — the new window's name, `ralph-<run-id>`.
- `RUN_DIR` — `~/.ralph/harness/<run-id>/`, the scratchpad for this run.
- `CAPTURE_INDEX` — starts at `0`; Pattern 2 increments it.

`meta.json` is written once here. Pattern 6 appends `ended` and `exit_reason` before kill. Embedded `"` characters in the command are escaped with `sed` so the JSON stays valid.
```

- [ ] **Step 5: Re-source the block and run the smoke test**

Expected: `PASS: meta.json written` and `PASS: window exists`.

- [ ] **Step 6: Validate the generated `meta.json` is valid JSON**

Re-run Step 1 (start_run produces a fresh `$RUN_DIR`), then:

```bash
node -e 'const j=JSON.parse(require("fs").readFileSync(process.argv[1],"utf8")); console.log("OK", Object.keys(j).length, "keys")' "$RUN_DIR/meta.json" || echo "FAIL: JSON invalid"
```

Expected: `OK 8 keys` (session, window, window_index, run_id, pid, pane_size, started, command). If you see `FAIL: JSON invalid`, the command-escaping in `start_run` is broken — fix before proceeding.

- [ ] **Step 7: Commit**

```bash
git add docs/harness/tmux-drive.md
git commit -m "docs(harness): start_run (pattern 1)"
```

---

### Task 2.2: Pattern 2 — Capture

**Files:**
- Modify: `docs/harness/tmux-drive.md` (add `capture` to the sourceable block + Pattern 2 prose)

- [ ] **Step 1: Write the failing smoke test**

```bash
# Self-contained: reset all globals and drive the full happy path.
unset SESSION WIN RUN_DIR RUN_ID CAPTURE_INDEX
if declare -F capture >/dev/null; then
  start_run "echo hello && sleep 10"
  wait_stable 3000 || true
  capture
  test -f "$RUN_DIR/current.txt" && echo "PASS: current.txt exists" || echo "FAIL: current.txt missing"
  test -f "$RUN_DIR/current.ansi" && echo "PASS: current.ansi exists" || echo "FAIL: current.ansi missing"
  test -f "$RUN_DIR/capture-001.txt" && echo "PASS: capture-001.txt exists" || echo "FAIL: capture-001.txt missing"
  grep -q "hello" "$RUN_DIR/current.txt" && echo "PASS: captured hello output" || echo "FAIL: hello not captured"
  # Best-effort cleanup so subsequent smoke tests start clean.
  tmux kill-window -t "$SESSION:$WIN" 2>/dev/null
  rm -rf "$RUN_DIR"
else
  echo "FAIL: capture not defined"
fi
```

Expected BEFORE implementation: `FAIL: capture not defined`.

- [ ] **Step 2: Run the smoke test and confirm failure**

- [ ] **Step 3: Add `capture` to the sourceable block**

Before `# ---------- end helpers ----------`:

```bash
# ---------- Pattern 2: capture ----------
# Writes both ANSI-stripped and ANSI-preserved versions. Atomically swaps the
# current.txt / current.ansi pointers via rename.
capture() {
  CAPTURE_INDEX=$((CAPTURE_INDEX + 1))
  local n
  n=$(printf "%03d" "$CAPTURE_INDEX")

  # ANSI-stripped
  tmux capture-pane -p -t "$SESSION:$WIN" > "$RUN_DIR/capture-$n.txt"
  cp "$RUN_DIR/capture-$n.txt" "$RUN_DIR/current.txt.tmp"
  mv "$RUN_DIR/current.txt.tmp" "$RUN_DIR/current.txt"

  # ANSI-preserved
  tmux capture-pane -e -p -t "$SESSION:$WIN" > "$RUN_DIR/capture-$n.ansi"
  cp "$RUN_DIR/capture-$n.ansi" "$RUN_DIR/current.ansi.tmp"
  mv "$RUN_DIR/current.ansi.tmp" "$RUN_DIR/current.ansi"

  echo "$(date -u +%Y-%m-%dT%H:%M:%SZ) capture $n" >> "$RUN_DIR/events.log"
}
```

- [ ] **Step 4: Fill in the "Pattern 2 — Capture" prose section**

```markdown
`capture` writes the current pane contents to two archive files and atomically updates the `current.*` pointers. Default analysis uses `current.txt` (ANSI-stripped, clean through the Read tool). `current.ansi` is the escalation path when colors or cursor state matter.

After calling `capture`, read `current.txt` — that is the authoritative snapshot. The numbered archive files (`capture-001.txt`, `capture-002.txt`, ...) support retrospective diffs: `diff capture-005.txt capture-006.txt` shows exactly what changed between two stable states.

Both `current.txt` and `current.ansi` are overwritten atomically via `mv` (POSIX rename is atomic within a filesystem), so a concurrent reader cannot see a half-written file. The two files are swapped independently; a consumer that reads *both* in one operation could briefly see a new `.txt` paired with a stale `.ansi`. This is intentional — analyze them independently, not as a matched pair.

Always call `wait_stable` before `capture` unless you are intentionally catching a mid-render frame.
```

- [ ] **Step 5: Re-source and run the smoke test**

Expected: all four `PASS` lines.

- [ ] **Step 6: Commit**

```bash
git add docs/harness/tmux-drive.md
git commit -m "docs(harness): capture (pattern 2)"
```

---

### Task 2.3: Pattern 5 — Send input

**Files:**
- Modify: `docs/harness/tmux-drive.md` (add `send_input` + Pattern 5 prose)

- [ ] **Step 1: Write the failing smoke test**

```bash
# Self-contained.
unset SESSION WIN RUN_DIR RUN_ID CAPTURE_INDEX
if declare -F send_input >/dev/null; then
  start_run "cat"
  wait_stable 3000 || true
  send_input "hello from test"
  wait_stable 3000 || true
  capture
  grep -q "hello from test" "$RUN_DIR/current.txt" && echo "PASS: input echoed" || echo "FAIL: input not echoed"
  tmux kill-window -t "$SESSION:$WIN" 2>/dev/null
  rm -rf "$RUN_DIR"
else
  echo "FAIL: send_input not defined"
fi
```

Expected BEFORE implementation: `FAIL: send_input not defined`.

- [ ] **Step 2: Run and confirm failure**

- [ ] **Step 3: Add `send_input` to the sourceable block**

Before `# ---------- end helpers ----------`:

```bash
# ---------- Pattern 5: send_input ----------
# Sends text followed by Enter. Always pair with wait_stable on both sides.
# Control keys (Escape, C-c, etc.) should be sent directly via tmux send-keys,
# not through this helper.
send_input() {
  local text=$1
  wait_stable 3000 || true
  tmux send-keys -t "$SESSION:$WIN" -l "$text"
  tmux send-keys -t "$SESSION:$WIN" Enter
  wait_stable 3000 || true
  echo "$(date -u +%Y-%m-%dT%H:%M:%SZ) send-input \"$text\" Enter" >> "$RUN_DIR/events.log"
}

# For control keys and non-text sequences, use tmux send-keys directly:
#   tmux send-keys -t "$SESSION:$WIN" Escape
#   tmux send-keys -t "$SESSION:$WIN" C-c
```

- [ ] **Step 4: Fill in the "Pattern 5 — Send input" prose**

```markdown
`send_input "<text>"` sends a literal string followed by Enter. It calls `wait_stable` before and after, so the UI has a chance to absorb the input and render the response.

For control keys, use `tmux send-keys` directly:

```bash
tmux send-keys -t "$SESSION:$WIN" Escape
tmux send-keys -t "$SESSION:$WIN" C-c
```

Gotcha: `send_input` is two `tmux send-keys` calls (text, then Enter). If you are interrupted between them, the pane holds text with no newline. Mitigation: keep `send_input` calls in a single shell command group so the interrupt window is tiny, and let the trailing `wait_stable` surface any stuck state.
```

- [ ] **Step 5: Re-source and run the smoke test**

Expected: `PASS: input echoed`.

- [ ] **Step 6: Commit**

```bash
git add docs/harness/tmux-drive.md
git commit -m "docs(harness): send_input (pattern 5)"
```

---

### Task 2.4: Pattern 6 — Cleanup

**Files:**
- Modify: `docs/harness/tmux-drive.md` (add `cleanup_run` + Pattern 6 prose)

- [ ] **Step 1: Write the failing smoke test**

```bash
# Self-contained.
unset SESSION WIN RUN_DIR RUN_ID CAPTURE_INDEX
if declare -F cleanup_run >/dev/null; then
  start_run "sleep 30"
  SAVED_SESSION=$SESSION
  SAVED_DIR=$RUN_DIR
  SAVED_WIN=$WIN
  cleanup_run clean
  # Window should be dead
  tmux list-windows -t "$SAVED_SESSION" -F '#W' | grep -q "^$SAVED_WIN$" && echo "FAIL: window still exists" || echo "PASS: window killed"
  # meta.json should have ended + exit_reason
  grep -q '"ended"' "$SAVED_DIR/meta.json" && echo "PASS: ended present" || echo "FAIL: ended missing"
  grep -q '"exit_reason"' "$SAVED_DIR/meta.json" && echo "PASS: exit_reason present" || echo "FAIL: exit_reason missing"
  # meta.json must still parse — echo FAIL on parse error (node exits non-zero, shell moves on)
  node -e 'JSON.parse(require("fs").readFileSync(process.argv[1],"utf8")); console.log("PASS: JSON valid")' "$SAVED_DIR/meta.json" || echo "FAIL: JSON invalid"
  rm -rf "$SAVED_DIR"
else
  echo "FAIL: cleanup_run not defined"
fi
```

Expected BEFORE implementation: `FAIL: cleanup_run not defined`.

- [ ] **Step 2: Run and confirm failure**

- [ ] **Step 3: Add `cleanup_run` to the sourceable block**

Before `# ---------- end helpers ----------`:

```bash
# ---------- Pattern 6: cleanup_run ----------
# Updates meta.json FIRST (so the audit trail survives even if kill-window fails),
# then kills the window. Pure-bash rewrite — no sed, no jq, no portability traps.
cleanup_run() {
  local exit_reason=${1:-clean}
  local ended
  ended=$(date -u +%Y-%m-%dT%H:%M:%SZ)

  # Rewrite meta.json line-by-line, inserting "ended" + "exit_reason" before the
  # closing brace. Pattern 1's heredoc always writes "}" on its own line, so a
  # literal string compare is enough.
  local tmp="$RUN_DIR/meta.json.tmp"
  : > "$tmp"
  while IFS= read -r line; do
    if [ "$line" = "}" ]; then
      printf '  ,"ended": "%s",\n  "exit_reason": "%s"\n}\n' "$ended" "$exit_reason" >> "$tmp"
    else
      printf '%s\n' "$line" >> "$tmp"
    fi
  done < "$RUN_DIR/meta.json"
  mv "$tmp" "$RUN_DIR/meta.json"

  echo "$ended cleanup exit_reason=$exit_reason" >> "$RUN_DIR/events.log"
  tmux kill-window -t "$SESSION:$WIN" 2>/dev/null || true
}
```

Rationale: BSD `sed -i.bak` does not reliably honor `\n` in the replacement side of a substitution (it varies by macOS version), and GNU-vs-BSD divergence here would silently produce malformed JSON. The pure-bash rewrite works identically on every POSIX system and uses no tools beyond `printf`, `while read`, and `mv`.

- [ ] **Step 4: Fill in the "Pattern 6 — Cleanup" prose**

```markdown
`cleanup_run [exit_reason]` finalizes a run. It updates `meta.json` with `ended` + `exit_reason`, logs the cleanup event, then kills the tmux window.

The `meta.json` update happens *before* `kill-window` so the audit trail survives even if the kill fails. `exit_reason` defaults to `clean`; pass `aborted` or `orphaned` when appropriate.

After cleanup, the scratchpad at `$RUN_DIR` stays on disk for post-mortem analysis. Prune manually — see "Pruning the scratchpad" below.
```

- [ ] **Step 5: Re-source and run the smoke test**

Expected: `PASS: window killed`, `PASS: ended present`, `PASS: exit_reason present`, `PASS: JSON valid`.

- [ ] **Step 6: Commit**

```bash
git add docs/harness/tmux-drive.md
git commit -m "docs(harness): cleanup_run (pattern 6)"
```

---

## Chunk 3: Advanced Patterns — Pattern 4, Visual Capture, Recovery

**Why this chunk:** Pattern 4 (source grep) is opt-in for precision waits. Visual Capture and `recover_orphans` are also opt-in features that are not needed for the core happy path. They have enough complexity to warrant a distinct review cycle.

### Task 3.1: Pattern 4 — Wait for a precise state via source grep

**Files:**
- Modify: `docs/harness/tmux-drive.md` (add `wait_for_string` + Pattern 4 prose + usage notes)

- [ ] **Step 1: Pick a verifiable literal that ralph --help actually renders**

Before writing the smoke test, run `ralph --help` directly in your shell and eyeball a short, stable, unambiguous literal from the output (e.g., a command name like `implement`, or a flag description like `Run the implement loop`). Capture it in a variable:

```bash
# Choose a stable literal you just confirmed by eye.
KNOWN="implement"   # <-- replace with whatever you verified is in `ralph --help` output
ralph --help 2>&1 | grep -qF -- "$KNOWN" && echo "OK: '$KNOWN' is rendered" || { echo "STOP: picked a literal that ralph --help does not render"; }
```

If `STOP` is printed, pick a different literal and re-run until `OK` — do NOT proceed to Step 2 with an unverified needle.

- [ ] **Step 2: Write the failing smoke test**

```bash
# Self-contained. KNOWN was verified in Step 1.
unset SESSION WIN RUN_DIR RUN_ID CAPTURE_INDEX
if declare -F wait_for_string >/dev/null; then
  start_run "ralph --help"
  wait_for_string "$KNOWN" 5000 && echo "PASS: found '$KNOWN'" || echo "FAIL: timed out"
  cleanup_run
  rm -rf "$RUN_DIR"
else
  echo "FAIL: wait_for_string not defined"
fi
```

Expected BEFORE implementation: `FAIL: wait_for_string not defined`.

- [ ] **Step 3: Run the Step 2 snippet and confirm failure**

- [ ] **Step 4: Add `wait_for_string` to the sourceable block**

Before `# ---------- end helpers ----------`:

```bash
# ---------- Pattern 4: wait_for_string ----------
# Polls the pane until a literal substring appears, or the budget expires.
# Use when wait_stable is not precise enough (e.g., distinguishing
# "overlay is waiting for input" from "overlay is still opening").
wait_for_string() {
  local needle=$1
  local budget_ms=${2:-10000}
  if [ -z "$needle" ]; then
    echo "wait_for_string: needle is required" >&2
    return 2
  fi
  local start_ns deadline_ns t
  start_ns=$(now_ns)
  deadline_ns=$((start_ns + budget_ms * 1000000))
  while : ; do
    t=$(now_ns)
    if [ "$t" -ge "$deadline_ns" ]; then
      local spent=$(( (t - start_ns) / 1000000 ))
      echo "$(date -u +%Y-%m-%dT%H:%M:%SZ) wait-for-string TIMEOUT needle=\"$needle\" elapsed=${spent}ms" >> "$RUN_DIR/events.log" 2>/dev/null || true
      return 1
    fi
    if tmux capture-pane -p -t "$SESSION:$WIN" | grep -qF -- "$needle"; then
      local spent=$(( ($(now_ns) - start_ns) / 1000000 ))
      echo "$(date -u +%Y-%m-%dT%H:%M:%SZ) wait-for-string MATCH needle=\"$needle\" elapsed=${spent}ms" >> "$RUN_DIR/events.log" 2>/dev/null || true
      return 0
    fi
    sleep 0.2
  done
}
```

- [ ] **Step 5: Fill in the "Pattern 4" prose**

```markdown
When `wait_stable` is too coarse — e.g., you need to distinguish "the overlay is waiting for your input" from "the overlay is still opening its box" — extract the literal string the component renders by grepping the source, then wait for it.

Example: find the current ChatUI submit hint by its anchor words and wait for it.

```bash
HINT=$(rg -o '"[^"]*(Press|submit|↵)[^"]*"' src/cli/lib/ src/cli/commands/ | head -1 | sed 's/^"//;s/"$//')
wait_for_string "$HINT" 10000
```

Source directories worth grepping:

- `src/cli/lib/output.ts` — shared Ink components
- `src/cli/commands/` — command-specific overlays
- `src/attractor/handlers/` — interactive handler prompts

Known limitations:

- **Only matches double-quoted string literals.** Template literals (backticks) and JSX text nodes split across lines are not found. Fall back to `wait_stable` + visual inspection of `current.txt` in those cases.
- **False positives possible** when two unrelated strings share an anchor word. Verify the extracted needle by eye (`echo "$HINT"`) before waiting on it.
- **`src/cli/mcp/` is not in the grep list** — MCP server code does not render user-visible TUI strings.
```

- [ ] **Step 6: Re-source and run the smoke test**

Expected: `PASS: found '<needle>'`.

- [ ] **Step 7: Commit**

```bash
git add docs/harness/tmux-drive.md
git commit -m "docs(harness): wait_for_string (pattern 4)"
```

---

### Task 3.2: Visual Capture

**Files:**
- Modify: `docs/harness/tmux-drive.md` (add `screenshot` + Visual Capture section)

- [ ] **Step 1: Write the failing smoke test**

```bash
# Self-contained. Must be run with the terminal emulator frontmost.
unset SESSION WIN RUN_DIR RUN_ID CAPTURE_INDEX
if declare -F screenshot >/dev/null; then
  start_run "sleep 30"
  wait_stable 3000 || true
  capture   # bump CAPTURE_INDEX so screenshot's PNG has a matching index
  screenshot && {
    PNG="$RUN_DIR/capture-$(printf %03d "$CAPTURE_INDEX").png"
    test -s "$PNG" && echo "PASS: PNG exists and non-empty at $PNG" || echo "FAIL: PNG missing or empty"
  }
  cleanup_run
  rm -rf "$RUN_DIR"
else
  echo "FAIL: screenshot not defined"
fi
```

Expected BEFORE implementation: `FAIL: screenshot not defined`.

- [ ] **Step 2: Run and confirm failure**

- [ ] **Step 3: Add `screenshot` to the sourceable block**

```bash
# ---------- Visual capture: screenshot ----------
# Briefly switches tmux to the harness window, screenshots the entire screen,
# then switches back. Requires the terminal emulator to be the frontmost app.
screenshot() {
  local front
  front=$(osascript -e 'tell application "System Events" to get name of first application process whose frontmost is true' 2>/dev/null)
  case "$front" in
    Terminal|iTerm2|Ghostty|kitty|WezTerm|Alacritty|"Terminal.app") ;;
    *)
      echo "screenshot aborted: frontmost app is '$front', not a known terminal" >&2
      return 1
      ;;
  esac

  local n current
  n=$(printf "%03d" "$CAPTURE_INDEX")
  current=$(tmux display-message -p '#I')

  tmux select-window -t "$SESSION:$WIN"
  sleep 0.3   # let the terminal emulator redraw
  screencapture -x "$RUN_DIR/capture-$n.png"
  tmux select-window -t "$SESSION:$current"

  echo "$(date -u +%Y-%m-%dT%H:%M:%SZ) screenshot $n" >> "$RUN_DIR/events.log"
}
```

- [ ] **Step 4: Fill in the "Visual capture (opt-in)" prose**

```markdown
`screenshot` briefly switches your tmux view to the harness window, captures the whole screen via macOS `screencapture`, then switches back. The PNG lands in `$RUN_DIR/capture-<NNN>.png` with the same index as the most recent `capture` call.

**Opt-in, not default.** Screenshots are disruptive (they flash your view). Call `screenshot` only when text capture is insufficient — e.g., to verify Ink box alignment, color bleed, or cursor placement that strips out of `current.txt`.

**Requires terminal focus.** The helper aborts with a clear message if the frontmost macOS app is not a known terminal emulator. If you are in another app when you call `screenshot`, `screencapture` would grab the wrong window.

**Captures the whole screen.** Cropping to the tmux pane is out of scope — Claude can identify the tmux content visually. Computing pane pixel bounds requires additional AppleScript and is explicitly deferred.
```

- [ ] **Step 5: Re-source and run the smoke test (foreground this terminal first)**

Expected: `PASS: PNG exists and non-empty at ...`. You will see a brief flash as tmux switches windows.

- [ ] **Step 6: Commit**

```bash
git add docs/harness/tmux-drive.md
git commit -m "docs(harness): screenshot (visual capture)"
```

---

### Task 3.3: Recovery from orphaned runs

**Files:**
- Modify: `docs/harness/tmux-drive.md` (add `recover_orphans` + Recovery section)

- [ ] **Step 1: Write the failing smoke test**

```bash
# Create a fake orphan: a run dir with meta.json lacking "ended".
ORPHAN_ID="drive-$(date +%s)-$$-fake"
ORPHAN_DIR="$HOME/.ralph/harness/$ORPHAN_ID"
mkdir -p "$ORPHAN_DIR"
cat > "$ORPHAN_DIR/meta.json" <<EOF
{
  "session": "nosuch",
  "window": "ralph-$ORPHAN_ID",
  "run_id": "$ORPHAN_ID",
  "started": "2026-04-14T00:00:00Z"
}
EOF

if declare -F recover_orphans >/dev/null; then
  OUTPUT=$(recover_orphans)
  echo "$OUTPUT" | grep -q "$ORPHAN_ID" && echo "PASS: orphan listed" || echo "FAIL: orphan not listed"
  echo "$OUTPUT" | grep -q "tmux list-windows" && echo "PASS: kill recipe shown"
  echo "$OUTPUT" | grep -q "find ~/.ralph/harness" && echo "PASS: prune recipe shown"
else
  echo "FAIL: recover_orphans not defined"
fi

# Cleanup the fake orphan
rm -rf "$ORPHAN_DIR"
```

Expected BEFORE implementation: `FAIL: recover_orphans not defined`.

- [ ] **Step 2: Run and confirm failure**

- [ ] **Step 3: Add `recover_orphans` to the sourceable block**

```bash
# ---------- Recovery: recover_orphans ----------
# A run is orphaned when meta.json has no "ended" field. Lists orphans and
# prints the recipes for killing stale windows / pruning stale scratch dirs.
# Never kills or deletes automatically.
recover_orphans() {
  local found=0
  local dir
  for dir in "$HOME/.ralph/harness"/drive-*/; do
    [ -d "$dir" ] || continue
    if ! grep -q '"ended"' "$dir/meta.json" 2>/dev/null; then
      found=$((found + 1))
      local win
      win=$(grep -o '"window"[[:space:]]*:[[:space:]]*"[^"]*"' "$dir/meta.json" \
             | head -1 \
             | sed 's/.*"\([^"]*\)"$/\1/')
      echo "orphan: $dir window=$win"
    fi
  done

  if [ "$found" -eq 0 ]; then
    echo "no orphans"
    return 0
  fi

  echo ""
  echo "To kill all orphan windows:"
  echo "  tmux list-windows -a -F '#S:#W' | grep ':ralph-drive-' | xargs -n1 tmux kill-window -t"
  echo ""
  echo "To prune orphan scratch dirs:"
  echo "  find ~/.ralph/harness -maxdepth 1 -type d -name 'drive-*' \\"
  echo "    -exec sh -c 'grep -q \"\\\"ended\\\"\" \"\$1/meta.json\" 2>/dev/null || rm -rf \"\$1\"' _ {} \\;"
}
```

- [ ] **Step 4: Fill in the "Recovery from orphaned runs" prose**

```markdown
A run is **orphaned** when its `meta.json` has no `ended` field (i.e., `cleanup_run` was never reached — a crash, Ctrl-C, or terminal close). At the start of any new session, call `recover_orphans` to list stale runs:

```bash
recover_orphans
```

Output looks like:

```
orphan: /Users/you/.ralph/harness/drive-1712950000-38291/ window=ralph-drive-1712950000-38291
orphan: /Users/you/.ralph/harness/drive-1712950123-40104/ window=ralph-drive-1712950123-40104

To kill all orphan windows:
  tmux list-windows -a -F '#S:#W' | grep ':ralph-drive-' | xargs -n1 tmux kill-window -t

To prune orphan scratch dirs:
  find ~/.ralph/harness -maxdepth 1 -type d -name 'drive-*' \
    -exec sh -c 'grep -q "\"ended\"" "$1/meta.json" 2>/dev/null || rm -rf "$1"' _ {} \;
```

`recover_orphans` prints recipes but never runs them. Review the orphan list, then run the kill/prune commands manually.

Note on the prune one-liner: the inline `sh -c` wrapper is *required*. A naive `find -exec grep -L \; -exec rm +` chain would delete every run (including finished ones), because `-exec` returns the command's exit status and `grep -L` always succeeds when the target file exists.
```

- [ ] **Step 5: Re-source and run the smoke test**

Expected: `PASS: orphan listed`, `PASS: kill recipe shown`, `PASS: prune recipe shown`.

- [ ] **Step 6: Commit**

```bash
git add docs/harness/tmux-drive.md
git commit -m "docs(harness): recover_orphans"
```

---

## Chunk 4: Gotchas, Pruning, Discoverability, Full Smoke Tests

**Why this chunk last:** The patterns document is functionally complete after Chunk 3. This chunk adds the human-facing documentation (Gotchas, Pruning, When to use this), wires up discoverability pointers (`MEMORY.md`, `CLAUDE.md`), then runs each of the four smoke tests from the spec as its own task (4.3–4.6) so defects surface one at a time. Task 4.7 finalizes the spec status.

### Task 4.1: Fill in "When to use this", "Prerequisites", "Pruning the scratchpad", and "Gotchas"

**Files:**
- Modify: `docs/harness/tmux-drive.md`

- [ ] **Step 1: Fill in "When to use this"**

```markdown
Use this harness when debugging ralph's Ink TUI — pipeline display, ChatUI overlay, meditate session, implement loop output, run-scenarios progress — and you need to *observe* what the UI actually does (not what the code says it should do).

Not for:

- **Automated regression tests.** See `src/cli/tests/scenarios/` and the existing `run-scenarios` command.
- **User-facing demos.** This is a dev-time debugging tool.
- **Driving commands that do not spawn a TUI.** For non-TUI commands, just run them in your current shell.
```

- [ ] **Step 2: Fill in "Prerequisites"**

```markdown
- **tmux** (any 3.x version).
- **macOS** (the `screenshot` helper is mac-specific; text patterns are portable but not validated elsewhere).
- **ripgrep** (`rg`) for Pattern 4 source grep.
- **Node** (already a ralph dependency) for validating `meta.json` in smoke tests.

No jq, no Python, no npm packages.
```

- [ ] **Step 3: Fill in "Pruning the scratchpad"**

```markdown
Runs accumulate under `~/.ralph/harness/`. The harness never auto-deletes them. Prune manually:

```bash
# Delete runs older than 7 days
find ~/.ralph/harness -maxdepth 1 -type d -mtime +7 -exec rm -rf {} +

# Or delete everything that is definitely orphaned (no "ended" field)
find ~/.ralph/harness -maxdepth 1 -type d -name 'drive-*' \
  -exec sh -c 'grep -q "\"ended\"" "$1/meta.json" 2>/dev/null || rm -rf "$1"' _ {} \;
```

7 days is a suggestion, not a policy. Claude runs these when the developer asks.
```

- [ ] **Step 4: Fill in "Gotchas"**

```markdown
1. **Screenshots require terminal focus.** `screencapture` captures whatever is currently on screen. `screenshot` aborts if the frontmost app is not a known terminal, but even then the capture reflects the current view, not "the harness window in isolation."
2. **Pane size drifts after start.** `meta.json.pane_size` is the size at window creation. Re-read live via `tmux display-message -t "$SESSION:$WIN" -p '#{pane_width}x#{pane_height}'` when geometry matters.
3. **`current.txt` is racy with in-flight renders.** Atomic rename on write protects against torn reads of a single file but does nothing for rendering races inside ralph. Always `wait_stable` before treating `current.txt` as authoritative. `current.txt` and `current.ansi` are swapped independently — do not read them as a matched pair.
4. **`send-keys` is instantaneous.** Ink may not have a reader ready at that moment. Always `wait_stable` before and after `send_input`, and also after `new-window -d` in Pattern 1 before sending the launch command.
5. **Long payloads need `-l`.** Spaces, quotes, and `$` are parsed by tmux unless `send-keys -l` is used. Control keys must be sent as separate `send-keys` arguments.
6. **No auto-cleanup of scratchpad.** See "Pruning the scratchpad".
7. **Abort leaves orphaned windows.** Run `recover_orphans` at session start to list them.
8. **macOS-only for screenshots.** Text patterns are portable; the screenshot helper is not.
9. **Two-call input race.** `send_input` is two tmux calls (text, then Enter). An interrupt between them leaves the pane with text but no newline. Mitigation: keep `send_input` within a single shell command group and let the trailing `wait_stable` surface stuck state.
10. **BSD `date` does not support `%N`.** `now_ns` in the sourceable block uses whichever of `date`/`gdate`/`perl` the Task 1.1 probe selected. If you move to a machine without that binary, re-run the probe.
11. **`cleanup_run`'s rewrite depends on the closing-brace format.** The heredoc in Pattern 1 always writes `}` on its own line, and `cleanup_run` does a literal `[ "$line" = "}" ]` compare. If that format ever changes, `cleanup_run` silently does nothing. The smoke tests exercise this end-to-end.
```

- [ ] **Step 5: Verify the doc renders cleanly**

Run: `grep -c "^## " docs/harness/tmux-drive.md`
Expected: `13` (same count as the skeleton — no new top-level sections added).

Run: `wc -l docs/harness/tmux-drive.md`
Expected: Reasonable (~500-800 lines).

- [ ] **Step 6: Commit**

```bash
git add docs/harness/tmux-drive.md
git commit -m "docs(harness): prose sections (when to use, prereqs, pruning, gotchas)"
```

---

### Task 4.2: Wire discoverability into `MEMORY.md` and `CLAUDE.md`

**Files:**
- Modify: `MEMORY.md` (add "Harness" subsection)
- Modify: `CLAUDE.md` (add "Debugging the Ink TUI" subsection)

- [ ] **Step 1: Add the `MEMORY.md` pointer**

Insert this block as a new `## Harness` section immediately after the existing `## Known Issues` section (per the Files modified table at the top of this plan):

```markdown
## Harness

**Tmux debugging harness:** When you need to observe ralph's Ink TUI, read `docs/harness/tmux-drive.md` at session start. Source the bash block it contains, then use `start_run`, `capture`, `wait_stable`, `send_input`, `cleanup_run`. Scratchpad lives at `~/.ralph/harness/<run-id>/`.
```

- [ ] **Step 2: Add the `CLAUDE.md` pointer**

Append as a new top-level section:

```markdown
## Debugging the Ink TUI

When you need to observe or interact with ralph's Ink TUI (pipeline display, ChatUI overlay, meditate session, etc.), read `docs/harness/tmux-drive.md` first. It contains the complete, authoritative set of bash patterns for driving ralph inside tmux. Do not invent your own tmux incantations — the document already accounts for edge cases (nanosecond timing, atomic JSON updates, orphan recovery, terminal focus).
```

- [ ] **Step 3: Verify the discoverability path (Success Criterion 1)**

Simulate a fresh Claude session: the CLAUDE.md pointer must literally contain the path `docs/harness/tmux-drive.md`, not merely the word "harness".

```bash
grep -qF "docs/harness/tmux-drive.md" CLAUDE.md && echo "PASS: CLAUDE.md points at the doc" || echo "FAIL: CLAUDE.md missing path"
grep -qF "docs/harness/tmux-drive.md" MEMORY.md && echo "PASS: MEMORY.md points at the doc" || echo "FAIL: MEMORY.md missing path"
```

Expected: both PASS lines. A fresh session reads `CLAUDE.md` (already loaded by default) or `MEMORY.md` (already loaded by default), sees the exact path, and the single follow-up `Read docs/harness/tmux-drive.md` finishes the bootstrap. That is the "exactly two effective operations" success criterion.

- [ ] **Step 4: Commit**

```bash
git add MEMORY.md CLAUDE.md
git commit -m "docs: discoverability pointers for tmux drive harness"
```

---

### Task 4.3: Smoke test 1 — round-trip a trivial command

**Files:** None modified (diagnostic only; if the test fails, you fix `docs/harness/tmux-drive.md`).

- [ ] **Step 1: Pick a verified literal from `ralph --help`**

Same verify-or-STOP pattern as Task 3.1 Step 1. Do not ship an unverified needle:

```bash
KNOWN="Usage:"   # <-- replace with whatever you verified is in `ralph --help` output
ralph --help 2>&1 | grep -qF -- "$KNOWN" && echo "OK: '$KNOWN' is rendered" || { echo "STOP: picked a literal that ralph --help does not render"; }
```

If `STOP` is printed, pick another literal and re-run until `OK`. Commander.js emits `Usage:` with a colon on the first line by default, so that is usually a safe starting point — but verify it on THIS binary before running the smoke test.

- [ ] **Step 2: Run the smoke test in a fresh shell with the patterns block sourced**

```bash
unset SESSION WIN RUN_DIR RUN_ID CAPTURE_INDEX
# Paste the bash block from docs/harness/tmux-drive.md into this shell first.
# $KNOWN was verified in Step 1.
start_run "ralph --help"
wait_stable 5000
capture
grep -qF -- "$KNOWN" "$RUN_DIR/current.txt" && echo "PASS: literal captured" || echo "FAIL: literal missing"
SAVED_DIR=$RUN_DIR
cleanup_run
node -e 'const j=JSON.parse(require("fs").readFileSync(process.argv[1],"utf8")); console.log(j.ended ? "PASS: ended set" : "FAIL: ended not set")' "$SAVED_DIR/meta.json" || echo "FAIL: JSON invalid"
rm -rf "$SAVED_DIR"
```

Expected: `PASS: literal captured` and `PASS: ended set`. If either fails, fix the doc (not the shell) and re-run — the spec says workarounds in the test are forbidden.

---

### Task 4.4: Smoke test 2 — interactive pipeline (wait.human overlay)

**Files:** None modified (diagnostic only).

**Prerequisite verification:** This smoke test requires two things the plan did not yet confirm:

1. A real pipeline file in the repo that contains a `wait.human` node (not a synthetic one we invented).
2. The literal anchor string the wait.human overlay actually renders, extracted from source (Pattern 4 territory).

- [ ] **Step 1: Locate a real wait.human pipeline or STOP**

```bash
# Find pipeline files that reference wait.human.
PIPELINE=$(grep -rl "wait.human\|wait_human" pipelines/ 2>/dev/null | head -1)
echo "PIPELINE=$PIPELINE"
```

If the output is empty, STOP: the smoke test as written assumes a wait.human pipeline exists. Surface this to the human and either (a) have them point you at an existing pipeline with a human-interactive node, or (b) skip Smoke Test 2 and mark it N/A in the final verification. Do NOT invent a synthetic `.dot` file — the DOT schema used by ralph's pipeline engine is not validated by this plan and a synthetic file may be rejected by the parser.

- [ ] **Step 2: Extract the real overlay anchor string via source grep**

Before sending input, figure out what the wait.human overlay actually renders. Grep the source for the component's text:

```bash
# Candidate locations — the spec calls out these directories for Pattern 4.
rg -n '"[^"]*(Press|approve|reject|decision|Enter)[^"]*"' \
   src/attractor/handlers/ src/cli/lib/ src/cli/commands/ 2>/dev/null | head -20
```

Read the output by eye. Pick a literal that is clearly rendered by the wait.human overlay (not by some unrelated component). Put it in a variable you will use below:

```bash
OVERLAY_ANCHOR="<paste the literal you confirmed>"
```

If you cannot find a clearly-rendered literal, STOP and surface to the human. The smoke test cannot run against unverified anchors.

- [ ] **Step 3: Run the smoke test**

```bash
unset SESSION WIN RUN_DIR RUN_ID CAPTURE_INDEX
# PIPELINE and OVERLAY_ANCHOR set in previous steps.
start_run "ralph pipeline run $PIPELINE"
wait_for_string "$OVERLAY_ANCHOR" 15000 && echo "PASS: overlay visible" || echo "FAIL: overlay not visible"
capture
# Send whatever response the overlay expects. If you do not know, STOP.
# Example: send_input "approve" for an approve/reject overlay.
send_input "approve"
wait_stable 10000
capture
SAVED_DIR=$RUN_DIR
cleanup_run
rm -rf "$SAVED_DIR"
```

Expected: `PASS: overlay visible`. This smoke test verifies the full input loop: Pattern 1 (start) → Pattern 4 (wait for precise state) → Pattern 2 (capture) → Pattern 5 (send input) → Pattern 3 (wait stable) → Pattern 6 (cleanup). If the overlay is not visible, either `wait_for_string` is wrong (fix in doc) or `OVERLAY_ANCHOR` is wrong (re-run Step 2 and pick a different literal).

---

### Task 4.5: Smoke test 3 — orphan recovery

**Files:** None modified (diagnostic only).

- [ ] **Step 1: Run the smoke test**

```bash
unset SESSION WIN RUN_DIR RUN_ID CAPTURE_INDEX
start_run "sleep 300"
SAVED_SESSION=$SESSION
SAVED_DIR=$RUN_DIR
SAVED_WIN=$WIN
# Simulate a crash: do NOT call cleanup_run. Force-kill the window manually.
tmux kill-window -t "$SAVED_SESSION:$SAVED_WIN"

# The dir now lacks "ended". recover_orphans should find it.
recover_orphans | grep -q "$SAVED_DIR" && echo "PASS: orphan detected" || echo "FAIL: orphan not detected"

# Manual cleanup of the test-created orphan.
rm -rf "$SAVED_DIR"
```

Expected: `PASS: orphan detected`. If not, fix `recover_orphans` in the doc and re-run.

---

### Task 4.6: Smoke test 4 — visual capture

**Files:** None modified (diagnostic only).

**Prerequisite:** Your terminal emulator must be the frontmost macOS app. Run this test interactively.

- [ ] **Step 1: Run the smoke test**

```bash
unset SESSION WIN RUN_DIR RUN_ID CAPTURE_INDEX
start_run "ralph --help"
wait_stable 5000
capture
screenshot
PNG="$RUN_DIR/capture-$(printf %03d "$CAPTURE_INDEX").png"
test -s "$PNG" && echo "PASS: PNG exists and non-empty" || echo "FAIL: PNG missing or empty"
grep -q "screenshot" "$RUN_DIR/events.log" && echo "PASS: event logged" || echo "FAIL: event not logged"
SAVED_DIR=$RUN_DIR
cleanup_run
rm -rf "$SAVED_DIR"

# Sanity: your current tmux window should be whatever you were on before screenshot ran.
tmux display-message -p '#W'
```

Expected: `PASS: PNG exists and non-empty`, `PASS: event logged`, and your original tmux window active. If the `screencapture` call failed because Task 1.1 Step 3 recorded `OSA_WORKS=no`, skip this smoke test and note it in the final verification.

---

### Task 4.7: Finalize — mark spec implemented and sanity-check commits

- [ ] **Step 1: Sanity-check the commit trail**

```bash
git log --oneline -20
```

Expected: A clean series of `docs(harness): ...` commits, one per implementation task, plus the discoverability-wiring commit.

- [ ] **Step 2: Re-run the discoverability verification from Task 4.2 Step 3**

```bash
grep -qF "docs/harness/tmux-drive.md" CLAUDE.md && echo "PASS" || echo "FAIL"
grep -qF "docs/harness/tmux-drive.md" MEMORY.md && echo "PASS" || echo "FAIL"
```

- [ ] **Step 3: Update the spec status**

Edit `docs/superpowers/specs/2026-04-14-tmux-drive-harness-design.md`:

```markdown
**Status:** Implemented — 2026-04-14
```

- [ ] **Step 4: Commit**

```bash
git add docs/superpowers/specs/2026-04-14-tmux-drive-harness-design.md
git commit -m "docs(spec): mark tmux drive harness as implemented"
```

**Handling of required-but-skipped smoke tests:** If Smoke Test 2 or 4 was skipped because a prerequisite failed (no wait.human pipeline, or `OSA_WORKS=no`), note the skip in the commit message body so future readers know coverage is incomplete, and open a follow-up issue with the human.

---

## Final Verification

- [ ] Smoke tests 1, 3 pass without doc workarounds. Smoke tests 2 and 4 pass, or are explicitly marked skipped with the reason documented.
- [ ] `CLAUDE.md` literally contains the string `docs/harness/tmux-drive.md` (Task 4.2 Step 3 verification).
- [ ] `MEMORY.md` literally contains the string `docs/harness/tmux-drive.md`.
- [ ] `docs/harness/tmux-drive.md` and `docs/harness/README.md` exist.
- [ ] The sourceable bash block in `tmux-drive.md` has both start and end markers (`# ---------- tmux drive harness helpers ----------` and `# ---------- end helpers ----------`) and contains: `now_ns`, `wait_stable`, `start_run`, `capture`, `send_input`, `cleanup_run`, `wait_for_string`, `screenshot`, `recover_orphans`.
- [ ] No `src/**` files were modified.
- [ ] No new npm packages were added to `package.json`.
- [ ] Spec is marked Implemented.

---

## Out of Scope (Reference)

The following were considered and explicitly excluded during brainstorming. Do NOT add them in this plan:

- A `ralph drive` CLI subcommand.
- An MCP server exposing launch/capture/send tools.
- A static markers catalog mapping UI states to strings.
- Automatic cleanup / cron-based pruning.
- Linux or Windows support for `screenshot`.
- ANSI-to-PNG rendering (niche deps rejected by the developer).
- Pixel-level visual regression diffing.
- A separate isolated tmux session per run (dropped in favor of "new window in existing session").

If a future requirement needs any of these, it gets its own spec + plan.
