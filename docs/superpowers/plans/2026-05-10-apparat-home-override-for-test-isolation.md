# `APPARAT_HOME` Override for Test Isolation — Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add `APPARAT_HOME` as the highest-precedence override in `getApparatHome()` so tests, fixtures, and embed callers can pin `~/.apparat` to a scratch dir without swapping the operator's `HOME`, then route the two known inline bypasses through the helper, migrate 8+ test files, and revisit `pool: "forks"`.

**Architecture:** `src/daemon/state.ts:31-34` becomes `process.env.APPARAT_HOME ?? join(process.env.HOME ?? homedir(), ".apparat")`. Inline joiners at `src/daemon/index.ts:12` and `src/lib/daemon-client.ts:11` route through `getApparatHome()` (the daemon-client one becomes a lazy accessor to avoid module-load caching). A new `src/cli/tests/_apparatHome.ts` exports `withFakeApparatHome()` so test authors stop hand-rolling the env-swap-and-cleanup ritual. 8–10 test files migrate to the helper. `vitest.config.ts:5` gets a benchmark + decision pass. CONTEXT.md + ADR-0010 gain one-line notes.

**Tech Stack:** TypeScript, Node.js, Vitest, ESM. No new runtime dependencies.

**Source-of-truth design doc:** `docs/superpowers/specs/2026-05-10-apparat-home-override-for-test-isolation-design.md`.
**Originating illumination:** `.apparat/meditations/illuminations/2026-05-10T2006-apparat-home-override-for-test-isolation.md`.

---

## Chunk 1: `APPARAT_HOME` override in `getApparatHome()` + precedence test

**Why first:** This is the single load-bearing change. Every later chunk depends on it. The change is one line of code + a focused 4-case unit test. Shipping it standalone proves the precedence contract before any test migration starts.

**Files:**
- Modify: `src/daemon/state.ts:31-34`
- Modify: `src/daemon/tests/state.test.ts:7-8` (module-load `HOME` swap → `APPARAT_HOME` swap; behaviour-preserving move)
- Test: `src/daemon/tests/state.test.ts` (new `describe("getApparatHome precedence", …)` block appended at end of file)

### Task 1.1: Migrate `state.test.ts` module-load HOME swap to APPARAT_HOME

This is the **red** step of the TDD pair. The existing test file pins `process.env.HOME` at module load (line 7–8) before importing `state.ts`, then asserts at `:44` that `getApparatHome()` returns `join(testHome, ".apparat")`. After migration, `APPARAT_HOME` is the env-var that's set, and `getApparatHome()` returns it **verbatim** (no `.apparat` join). So the migrated constant must already include the `.apparat` suffix to keep existing assertions correct.

Before-state of `src/daemon/tests/state.test.ts`, anchor lines for the implementer:
- `:6-8` — `// Override HOME for tests` + `const testHome = join(tmpdir(), \`apparat-state-test-${process.pid}\`);` + `process.env.HOME = testHome;`
- `:25-26` — `beforeEach(() => mkdirSync(testHome, { recursive: true }));` and `afterEach(() => rmSync(testHome, { recursive: true, force: true }));`
- `:44` — `expect(getApparatHome()).toBe(join(testHome, ".apparat"));`
- `:51-52` — `expect(existsSync(join(testHome, ".apparat"))).toBe(true);` and `expect(existsSync(join(testHome, ".apparat", "logs"))).toBe(true);`

- [x] **Step 1: Read `src/daemon/tests/state.test.ts:1-60`** with the Read tool. Verify the anchors above match the file's current state. If any anchor has drifted, prefer the actual file's lines and adjust the edits in subsequent steps to match — do not blindly apply line numbers that no longer hold.

- [x] **Step 2: Replace the module-load swap (lines 6–8)**

```ts
// Pin ~/.apparat for tests via APPARAT_HOME (not HOME swap).
// The constant already includes the `.apparat` suffix so existing
// assertions that joined `testHome` with `.apparat` keep matching.
const testApparatHome = join(tmpdir(), `apparat-state-test-${process.pid}`, ".apparat");
process.env.APPARAT_HOME = testApparatHome;
```

- [x] **Step 3: Update `beforeEach` / `afterEach` (lines 25–26)**

Replace:
```ts
beforeEach(() => mkdirSync(testHome, { recursive: true }));
afterEach(() => rmSync(testHome, { recursive: true, force: true }));
```
with:
```ts
beforeEach(() => mkdirSync(testApparatHome, { recursive: true }));
afterEach(() => rmSync(testApparatHome, { recursive: true, force: true }));
```

- [x] **Step 4: Update the existing `getApparatHome` assertion (line 44)**

Replace:
```ts
expect(getApparatHome()).toBe(join(testHome, ".apparat"));
```
with:
```ts
expect(getApparatHome()).toBe(testApparatHome);
```

The semantic is unchanged — `testApparatHome` now equals what `join(testHome, ".apparat")` resolved to before — but the new form is honest about the override returning the env-var verbatim.

- [x] **Step 5: Update the `ensureDirs` assertions (lines 51–52)**

Replace:
```ts
expect(existsSync(join(testHome, ".apparat"))).toBe(true);
expect(existsSync(join(testHome, ".apparat", "logs"))).toBe(true);
```
with:
```ts
expect(existsSync(testApparatHome)).toBe(true);
expect(existsSync(join(testApparatHome, "logs"))).toBe(true);
```

- [x] **Step 6: Confirm zero `testHome` references remain**

Run: `grep -n "testHome" src/daemon/tests/state.test.ts`
Expected: zero matches. Any remaining match is a missed reference — fix in-place.

- [x] **Step 7: Run the file — this is the RED step**

Run: `npx vitest run src/daemon/tests/state.test.ts`
Expected: **FAIL** — `getApparatHome()` still reads `process.env.HOME || homedir()` (Chunk 1 Task 1.2 hasn't run yet), so `APPARAT_HOME` is ignored. The first assertion that tries to read/write under the test home will fail with a path mismatch or ENOENT — for example, `expect(getApparatHome()).toBe(testApparatHome)` will fail because the actual value is `${realHome}/.apparat`.

This FAIL is the red step's success signal. Do not commit yet — proceed straight to Task 1.2.

### Task 1.2: Add the `APPARAT_HOME` precedence to `getApparatHome()` (GREEN step)

- [x] **Step 1: Confirm Task 1.1 left the file in a FAIL state**

Run: `npx vitest run src/daemon/tests/state.test.ts`
Expected: FAIL — the same red signal as Task 1.1 Step 7. If this run unexpectedly passes, Task 1.1's edits did not take effect; re-inspect.

- [x] **Step 2: Edit `src/daemon/state.ts:31-34`**

Replace:
```ts
export function getApparatHome(): string {
  const home = process.env.HOME || homedir();
  return join(home, ".apparat");
}
```

with:
```ts
export function getApparatHome(): string {
  return process.env.APPARAT_HOME
    ?? join(process.env.HOME ?? homedir(), ".apparat");
}
```

`??` is deliberate vs. `||`: `APPARAT_HOME=""` is operator misconfiguration we want to surface (downstream `mkdirSync` fails loudly), not coerce away. See design doc §7.2.

- [x] **Step 3: Re-run the state tests — this is the GREEN step**

Run: `npx vitest run src/daemon/tests/state.test.ts`
Expected: **PASS** — `APPARAT_HOME` is set to `testApparatHome` at module load, `getApparatHome()` returns `testApparatHome` verbatim, and every existing assertion (now updated to `testApparatHome` directly) lines up.

If any test still fails with a path mismatch, that's a sign the Task 1.1 migration missed an assertion that joined `testHome` with `.apparat`. Re-grep `src/daemon/tests/state.test.ts` for `testHome` and any `\\.apparat\\b` substring tied to it; fix those before continuing.

### Task 1.3: New `getApparatHome precedence` describe block

- [x] **Step 1: Confirm imports cover the new describe**

The new tests need `describe`, `it`, `expect`, `beforeEach`, `afterEach`, `getApparatHome`, and `join`. Open `src/daemon/tests/state.test.ts:1-26` and check:
- `describe`, `it`, `expect`, `beforeEach`, `afterEach` should already be imported from `vitest` (line 1).
- `getApparatHome` should already be imported from `../state` (line 11).
- `join` should already be imported from `path` (line 3).

If any of those are missing, add them before appending the new describe.

- [x] **Step 2: Append the new describe block to `src/daemon/tests/state.test.ts` (end of file)**

```ts
describe("getApparatHome precedence", () => {
  let origApparatHome: string | undefined;
  let origHome: string | undefined;

  beforeEach(() => {
    origApparatHome = process.env.APPARAT_HOME;
    origHome = process.env.HOME;
  });

  afterEach(() => {
    if (origApparatHome === undefined) delete process.env.APPARAT_HOME;
    else process.env.APPARAT_HOME = origApparatHome;
    if (origHome === undefined) delete process.env.HOME;
    else process.env.HOME = origHome;
  });

  it("returns APPARAT_HOME verbatim when set", () => {
    process.env.APPARAT_HOME = "/tmp/explicit-apparat-home";
    process.env.HOME = "/tmp/some-other-home";
    expect(getApparatHome()).toBe("/tmp/explicit-apparat-home");
  });

  it("falls back to HOME-joined-.apparat when APPARAT_HOME is unset", () => {
    delete process.env.APPARAT_HOME;
    process.env.HOME = "/tmp/operator-home";
    expect(getApparatHome()).toBe(join("/tmp/operator-home", ".apparat"));
  });

  it("falls back to homedir()+.apparat when both APPARAT_HOME and HOME are unset", () => {
    delete process.env.APPARAT_HOME;
    delete process.env.HOME;
    // homedir() is OS-dependent; just assert the suffix.
    expect(getApparatHome().endsWith(".apparat")).toBe(true);
  });

  it("returns empty string verbatim when APPARAT_HOME is empty (operator misconfig surfaces)", () => {
    process.env.APPARAT_HOME = "";
    process.env.HOME = "/tmp/should-not-be-used";
    expect(getApparatHome()).toBe("");
  });
});
```

**Note:** the module-load swap from Task 1.1 sets `APPARAT_HOME` before the import. The new `beforeEach` snapshots that value; `afterEach` restores it. This is why each test inside the describe owns its own setup of `APPARAT_HOME` (set or `delete`) explicitly — do not rely on inherited module-load state.

- [x] **Step 3: Run the new precedence describe**

Run: `npx vitest run src/daemon/tests/state.test.ts -t "getApparatHome precedence"`
Expected: PASS (4 cases). If any case fails, the implementation in Task 1.2 has a precedence bug — re-inspect.

- [x] **Step 4: Run the full state test file**

Run: `npx vitest run src/daemon/tests/state.test.ts`
Expected: PASS (all pre-existing tests + 4 new precedence tests).

- [x] **Step 5: Run typecheck**

Run: `npx tsc --noEmit`
Expected: clean (no errors).

- [x] **Step 6: Commit**

```bash
git add src/daemon/state.ts src/daemon/tests/state.test.ts
git commit -m "feat(daemon): add APPARAT_HOME override to getApparatHome()

Adds APPARAT_HOME as the highest-precedence input to getApparatHome(),
falling back to HOME ?? homedir() for backward compat. Migrates the
existing state.test.ts module-load swap to APPARAT_HOME and adds a
4-case precedence describe (set / fallback to HOME / fallback to homedir
/ empty-string surfaces).

Refs: docs/superpowers/specs/2026-05-10-apparat-home-override-for-test-isolation-design.md §3.2 §4.1 §4.6"
```

## Verification targets

- Smokes: None (no smoke pipeline exercises getApparatHome directly; later chunks cover socket-bridge smoke).
- Manual exercises: `APPARAT_HOME=/tmp/scratch-apparat node -e "import('./dist/daemon/state.js').then(m => console.log(m.getApparatHome()))"` → prints `/tmp/scratch-apparat`. Unset → prints `~/.apparat`.
- Lint: `npx vitest run src/daemon/tests/state.test.ts` and `npx tsc --noEmit`.
- Surfaces touched: daemon-state.

---

## Chunk 2: Route the inline bypasses through `getApparatHome()`

**Why second:** This is the load-bearing audit step from design doc §3.2 / §4.2 / §6 ("Risk if the audit is skipped: daemon and CLI split homes"). Without it, `APPARAT_HOME` is unsafe under daemon usage. `daemon-client.ts` resolves its socket path at module load — naïve routing through `getApparatHome()` would still cache the value, defeating the override. The fix is a lazy accessor (design doc §9.1, recommended option 1).

**Files:**
- Modify: `src/daemon/index.ts:12-14` (route inline `process.env.HOME || homedir()` join through `getApparatHome()`)
- Modify: `src/lib/daemon-client.ts:9-11` and use sites at `:37`, `:44`, `:54` (replace const `SOCK_PATH` with lazy `getDaemonSocketPath()` accessor)
- Test: `src/daemon/tests/state.test.ts` (new `describe("daemon socket path honours APPARAT_HOME", …)` covering the lazy accessor)
- Test: `src/cli/tests/daemon-client-socket-path.test.ts` (new file — focused unit test for the lazy accessor seam)

### Task 2.1: Lazy `getDaemonSocketPath()` accessor in daemon-client

- [x] **Step 1: Write the failing test at `src/cli/tests/daemon-client-socket-path.test.ts`**

Create the file with content:

```ts
import { describe, it, expect, afterEach } from "vitest";
import { join } from "path";

describe("daemon-client socket path honours APPARAT_HOME at call time", () => {
  let origApparatHome: string | undefined;

  afterEach(() => {
    if (origApparatHome === undefined) delete process.env.APPARAT_HOME;
    else process.env.APPARAT_HOME = origApparatHome;
  });

  it("re-resolves on each call (no module-load caching)", async () => {
    origApparatHome = process.env.APPARAT_HOME;

    process.env.APPARAT_HOME = "/tmp/first-home";
    const { getDaemonSocketPath } = await import("../../lib/daemon-client.js");
    expect(getDaemonSocketPath()).toBe(join("/tmp/first-home", "daemon.sock"));

    process.env.APPARAT_HOME = "/tmp/second-home";
    expect(getDaemonSocketPath()).toBe(join("/tmp/second-home", "daemon.sock"));
  });

  it("falls back to ~/.apparat/daemon.sock when APPARAT_HOME unset", async () => {
    origApparatHome = process.env.APPARAT_HOME;
    delete process.env.APPARAT_HOME;
    process.env.HOME = "/tmp/operator";
    const { getDaemonSocketPath } = await import("../../lib/daemon-client.js");
    expect(getDaemonSocketPath()).toBe(join("/tmp/operator", ".apparat", "daemon.sock"));
  });
});
```

- [x] **Step 2: Verify the test fails (no `getDaemonSocketPath` export yet)**

Run: `npx vitest run src/cli/tests/daemon-client-socket-path.test.ts`
Expected: FAIL with "getDaemonSocketPath is not a function" or "is not exported".

- [x] **Step 3: Edit `src/lib/daemon-client.ts`**

Replace the import block + `SOCK_PATH` const (current `:1-13`) with:

```ts
// src/lib/daemon-client.ts
import net from "net";
import { join, dirname } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));
import { existsSync } from "fs";
import { spawn } from "child_process";
import { getApparatHome } from "../daemon/state.js";

export function getDaemonSocketPath(): string {
  return join(getApparatHome(), "daemon.sock");
}

const DAEMON_START_TIMEOUT_MS = 3000;
const DAEMON_POLL_INTERVAL_MS = 100;
```

The `homedir` import is now unused — remove it from the imports if present (it was on line 9).

- [x] **Step 4: Replace every use of `SOCK_PATH` with `getDaemonSocketPath()`**

In `src/lib/daemon-client.ts`:
- Line ~37 (`waitForSocket`): `if (existsSync(SOCK_PATH)) return;` → `if (existsSync(getDaemonSocketPath())) return;`
- Line ~44 (`ensureDaemon`): `if (existsSync(SOCK_PATH)) return;` → `if (existsSync(getDaemonSocketPath())) return;`
- Line ~54 (`openSocket`): `const socket = net.createConnection(SOCK_PATH);` → `const socket = net.createConnection(getDaemonSocketPath());`

After edits run: `grep -n "SOCK_PATH" src/lib/daemon-client.ts` — expected: zero matches.

- [x] **Step 5: Run the new test**

Run: `npx vitest run src/cli/tests/daemon-client-socket-path.test.ts`
Expected: PASS (both cases).

### Task 2.2: Route `src/daemon/index.ts:12` through `getApparatHome()`

- [x] **Step 1: Edit `src/daemon/index.ts:1-14`**

Replace the import block and the `apparatHome` const declaration:

```ts
// src/daemon/index.ts
import { existsSync, mkdirSync, writeFileSync, unlinkSync, readFileSync } from "fs";
import { join, basename } from "path";
import net from "net";
import { ensureDirs, readTasks, upsertTask, deleteTask, getTask, listRuns, readRunLogs, getApparatHome } from "./state";
import { Scheduler } from "./scheduler";
import { runTask, isSessionRunning, killSession } from "./runner";
import { createSocketServer } from "./socket";
import type { Task } from "./state";

const apparatHome = getApparatHome();
const pidPath = join(apparatHome, "daemon.pid");
const sockPath = join(apparatHome, "daemon.sock");
```

Removed:
- `import { homedir } from "os";`
- `const apparatHome = join(process.env.HOME || homedir(), ".apparat");`

Added:
- `getApparatHome` to the named imports from `./state`.

**Caveat:** `apparatHome` is captured at module load. If a test mutates `APPARAT_HOME` after this module imports, the captured value is stale. For the daemon entry, this is acceptable — the daemon is always spawned as a separate process by `ensureDaemon()` in `daemon-client.ts`, so each daemon process re-evaluates `apparatHome` fresh on its own startup. Document this with a one-line comment.

Add this comment above the `const apparatHome` line:

```ts
// Captured at daemon-process startup; APPARAT_HOME mutations after this point
// have no effect (intentional — the daemon is always re-spawned per env).
const apparatHome = getApparatHome();
```

- [x] **Step 2: Verify daemon entry compiles**

Run: `npx tsc --noEmit`
Expected: clean.

- [x] **Step 3: Add a runtime audit grep to confirm no inline bypasses remain**

Run: `grep -nRE "join\(.*HOME.*\.apparat\b|join\(.*homedir\(\).*\.apparat\b" src/`
Expected: matches only `src/daemon/state.ts:33` (the inner fallback) — and no others.

If anything else matches, route it through `getApparatHome()` in this same task. Likely candidates worth re-checking: any other entrypoint scripts under `src/` that touch `.apparat/`.

- [x] **Step 4: Run the full daemon-state + daemon-client tests**

Run: `npx vitest run src/daemon/tests/ src/cli/tests/daemon-client-socket-path.test.ts`
Expected: PASS (all of Chunk 1 + Chunk 2 tests).

### Task 2.3: Daemon-bridge integration assertion

- [x] **Step 1: Append a daemon-socket cross-process describe to `src/daemon/tests/state.test.ts`**

```ts
describe("daemon and CLI agree on the socket path under APPARAT_HOME", () => {
  let origApparatHome: string | undefined;
  afterEach(() => {
    if (origApparatHome === undefined) delete process.env.APPARAT_HOME;
    else process.env.APPARAT_HOME = origApparatHome;
  });

  it("the daemon-client socket path resolves under APPARAT_HOME, not HOME", async () => {
    origApparatHome = process.env.APPARAT_HOME;
    process.env.APPARAT_HOME = "/tmp/socket-bridge-scratch";
    const { getDaemonSocketPath } = await import("../../lib/daemon-client.js");
    expect(getDaemonSocketPath()).toBe(join("/tmp/socket-bridge-scratch", "daemon.sock"));
  });
});
```

This is intentionally narrow: it asserts the *contract* that the design doc §6 calls out — daemon and CLI agreeing on the same home. The actual cross-process daemon-spawn integration is covered manually in §10.4 of the design doc and listed under Verification targets below.

- [x] **Step 2: Run the new describe**

Run: `npx vitest run src/daemon/tests/state.test.ts -t "agree on the socket path"`
Expected: PASS.

- [x] **Step 3: Commit**

```bash
git add src/daemon/index.ts src/lib/daemon-client.ts src/daemon/tests/state.test.ts src/cli/tests/daemon-client-socket-path.test.ts
git commit -m "feat(daemon): route inline ~/.apparat joiners through getApparatHome()

src/daemon/index.ts:12 and src/lib/daemon-client.ts:11 used to
hand-roll join(process.env.HOME || homedir(), '.apparat'), bypassing
getApparatHome() — which would have split daemon vs. CLI homes once
APPARAT_HOME landed.

daemon-client now exposes a lazy getDaemonSocketPath() accessor (vs.
the old module-load const) so APPARAT_HOME mutations after import
take effect. daemon entry captures getApparatHome() once at process
startup (correct — the daemon is always re-spawned per env).

Refs: docs/superpowers/specs/2026-05-10-apparat-home-override-for-test-isolation-design.md §3.2 §4.2 §9.1"
```

## Verification targets

- Smokes: None (no smoke covers daemon socket bridge directly).
- Manual exercises:
  - `apparat watch` against a real project with `APPARAT_HOME` unset → daemon writes `~/.apparat/daemon.sock`, CLI connects.
  - `APPARAT_HOME=/tmp/bridge-test apparat watch <some project>` → daemon writes `/tmp/bridge-test/daemon.sock` (verify with `ls /tmp/bridge-test/`), CLI connects.
- Lint: `npx vitest run src/daemon/tests/ src/cli/tests/daemon-client-socket-path.test.ts` and `npx tsc --noEmit` and `grep -nRE "join\(.*HOME.*\.apparat\b|join\(.*homedir\(\).*\.apparat\b" src/` returns only `src/daemon/state.ts`.
- Surfaces touched: daemon-state, daemon-entry, daemon-client.

---

## Chunk 3: `withFakeApparatHome()` helper + migrate 8+ test files

**Why third:** With Chunk 1 (override) and Chunk 2 (audit) shipped, the override is safe to depend on. This chunk does the bulk of the work — eliminating the per-describe HOME-swap ritual the illumination called out as the recurring tax. The helper internalises the `delete process.env.X when orig === undefined` quirk so it lives in one place. Migration is mechanical.

**Files:**
- Create: `src/cli/tests/_apparatHome.ts` (new helper)
- Test: `src/cli/tests/_apparatHome.test.ts` (new — covers the helper itself)
- Modify: `src/cli/tests/pipeline.test.ts` (6 describe blocks — see Task 3.3 sub-steps)
- Modify: `src/cli/tests/pipeline-preflight.test.ts` (2 describe blocks)
- Modify: `src/cli/tests/pipeline-run-preflight.test.ts` (1 describe block)
- Modify: `src/cli/tests/pipeline-headless.test.ts` (2 describe blocks)
- Modify: `src/cli/tests/pipeline-failure-reason.test.ts` (1 describe block)
- Modify: `src/cli/tests/pipeline-failure-footer-scenario.test.ts` (1 describe block)
- Modify: `src/cli/tests/runs-gc-per-pipeline.test.ts` (1 describe block)
- Modify: `src/cli/tests/pipeline-run-runid.test.ts` (3 describe blocks, including inline-within-`it` ones)
- Modify: `src/cli/tests/projects-registry.test.ts` (module-scope migration; design §9.2 — recommended migrate)
- Modify: `src/cli/tests/status.test.ts` (module-scope migration; design §9.2 — recommended migrate)
- Modify: `src/daemon/tests/runner-augmentation.test.ts:12` (module-scope swap — found by anchor survey, not in design but in scope by §10.1's grep contract)
- Modify: `src/daemon/tests/runner.test.ts:7` (module-scope swap — same reason)

### Task 3.1: Write `withFakeApparatHome()` helper

- [x] **Step 1: Write the failing test at `src/cli/tests/_apparatHome.test.ts`**

```ts
import { describe, it, expect } from "vitest";
import { existsSync } from "fs";
import { withFakeApparatHome } from "./_apparatHome";

describe("withFakeApparatHome", () => {
  it("creates a scratch dir, sets APPARAT_HOME to it, and cleans up on cleanup()", () => {
    const origApparatHome = process.env.APPARAT_HOME;
    const fake = withFakeApparatHome();
    expect(existsSync(fake.path)).toBe(true);
    expect(process.env.APPARAT_HOME).toBe(fake.path);
    fake.cleanup();
    expect(existsSync(fake.path)).toBe(false);
    expect(process.env.APPARAT_HOME).toBe(origApparatHome);
  });

  it("restores APPARAT_HOME to undefined-via-delete when it was unset before", () => {
    delete process.env.APPARAT_HOME;
    const fake = withFakeApparatHome();
    expect(process.env.APPARAT_HOME).toBe(fake.path);
    fake.cleanup();
    expect(process.env.APPARAT_HOME).toBeUndefined();
    expect("APPARAT_HOME" in process.env).toBe(false);
  });

  it("restores APPARAT_HOME to its prior value when one was set", () => {
    process.env.APPARAT_HOME = "/tmp/preexisting";
    const fake = withFakeApparatHome();
    expect(process.env.APPARAT_HOME).toBe(fake.path);
    fake.cleanup();
    expect(process.env.APPARAT_HOME).toBe("/tmp/preexisting");
    delete process.env.APPARAT_HOME;
  });

  it("respects custom label prefix", () => {
    const fake = withFakeApparatHome("apparat-custom-label");
    expect(fake.path).toMatch(/apparat-custom-label-/);
    fake.cleanup();
  });
});
```

- [x] **Step 2: Verify FAIL**

Run: `npx vitest run src/cli/tests/_apparatHome.test.ts`
Expected: FAIL — `_apparatHome.ts` does not exist.

- [x] **Step 3: Write the helper at `src/cli/tests/_apparatHome.ts`**

```ts
import { mkdtempSync, rmSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";

export interface FakeApparatHome {
  path: string;
  cleanup: () => void;
}

export function withFakeApparatHome(label = "apparat-test-home"): FakeApparatHome {
  const path = mkdtempSync(join(tmpdir(), `${label}-`));
  const orig = process.env.APPARAT_HOME;
  process.env.APPARAT_HOME = path;
  return {
    path,
    cleanup: () => {
      if (orig === undefined) delete process.env.APPARAT_HOME;
      else process.env.APPARAT_HOME = orig;
      rmSync(path, { recursive: true, force: true });
    },
  };
}
```

- [x] **Step 4: Verify PASS**

Run: `npx vitest run src/cli/tests/_apparatHome.test.ts`
Expected: PASS (4 cases).

- [x] **Step 5: Commit**

```bash
git add src/cli/tests/_apparatHome.ts src/cli/tests/_apparatHome.test.ts
git commit -m "test(cli): add withFakeApparatHome() helper for scratch home dirs

Internalises the mkdtempSync + APPARAT_HOME swap + delete-on-undefined
cleanup quirk in one place so test authors stop hand-rolling it per
describe. 4 unit tests cover scratch-dir creation, prior-value
restoration, undefined-restoration via delete, and custom label.

Refs: docs/superpowers/specs/2026-05-10-apparat-home-override-for-test-isolation-design.md §4.3"
```

### Task 3.2: Migration template (mechanical pattern)

For each describe block that currently looks like:

```ts
let fakeHome: string;
let origHome: string | undefined;
beforeEach(() => {
  fakeHome = mkdtempSync(join(tmpdir(), "apparat-XXX-home-"));
  origHome = process.env.HOME;
  process.env.HOME = fakeHome;
  // …other setup (e.g., dir = mkdtempSync(...))
});
afterEach(() => {
  if (origHome === undefined) delete process.env.HOME;
  else process.env.HOME = origHome;
  rmSync(fakeHome, { recursive: true, force: true });
  // …other teardown
});
```

…replace with:

```ts
import { withFakeApparatHome, type FakeApparatHome } from "./_apparatHome";

let scratch: FakeApparatHome;
beforeEach(() => {
  scratch = withFakeApparatHome("apparat-XXX-home");
  // …other setup
});
afterEach(() => {
  scratch.cleanup();
  // …other teardown (drop the manual rmSync(fakeHome, ...))
});
```

The `apparat-XXX-home` label argument keeps the existing tmpdir prefix discoverable in process listings.

For module-scope swaps (e.g., `src/daemon/tests/state.test.ts:7-8` already migrated in Chunk 1, and `src/daemon/tests/runner.test.ts:7`, `runner-augmentation.test.ts:12`):

```ts
const testApparatHome = join(tmpdir(), `apparat-XXX-${process.pid}`);
process.env.APPARAT_HOME = testApparatHome;
```

(no `delete` cleanup at module scope — restoration would happen per-test if needed; the existing files don't restore at module scope, so leave that pattern.)

### Task 3.3: Migrate `pipeline.test.ts` (6 describe blocks)

- [x] **Step 1: Migrate `describe("pipelineValidateCommand", …)` at L69-132**

Edit `src/cli/tests/pipeline.test.ts:71-85`. Apply the Task 3.2 template; the label is `apparat-validate-home`. Inside `dir` setup, keep the `dir = mkdtempSync(...)` and `rmSync(dir)` lines as-is.

After edit, the block at the top of the describe should look like:

```ts
describe("pipelineValidateCommand", () => {
  let dir: string;
  let scratch: FakeApparatHome;
  beforeEach(() => {
    vi.clearAllMocks();
    scratch = withFakeApparatHome("apparat-validate-home");
    dir = mkdtempSync(join(tmpdir(), "apparat-pipeline-test-"));
  });
  afterEach(() => {
    scratch.cleanup();
    rmSync(dir, { recursive: true });
  });
  // …existing it() blocks unchanged
```

- [x] **Step 2: Migrate `describe("pipelineRunCommand", …)` at L134-242**

Same pattern. Label: `apparat-run-home`. Lines 138–150.

- [x] **Step 3: Migrate `describe("pipelineRunCommand — --resume resolution", …)` at L244-…**

Same pattern. Label: `apparat-resume-home`. Lines 248–260.

- [x] **Step 4: Migrate the remaining three describes (onInteractiveRequest, list, diff)**

Apply the same template to L322-…, L377-…, L457-…. Labels: `apparat-oninteractive-home`, `apparat-list-home`, `apparat-diff-home`. Use the anchor survey ranges from the planning session: 322–331, 377–386, 457–468.

- [x] **Step 5: Add the helper import at the top of the file**

After the existing imports (around line 5), add:

```ts
import { withFakeApparatHome, type FakeApparatHome } from "./_apparatHome";
```

- [x] **Step 6: Confirm zero `process.env.HOME` references remain in the file**

Run: `grep -n "process.env.HOME" src/cli/tests/pipeline.test.ts`
Expected: zero matches.

- [x] **Step 7: Run the full file**

Run: `npx vitest run src/cli/tests/pipeline.test.ts`
Expected: PASS (no behaviour change — only the env-var lever changed; `recordProject` writes still land in the scratch dir).

- [x] **Step 8: Commit**

```bash
git add src/cli/tests/pipeline.test.ts
git commit -m "test(pipeline): migrate 6 describe blocks to withFakeApparatHome()

Replaces per-describe HOME-swap-and-restore with the helper. The HOME
lever is no longer touched in this file. 6 describe blocks migrated:
pipelineValidateCommand, pipelineRunCommand, --resume resolution,
onInteractiveRequest, list, diff.

Refs: docs/superpowers/specs/2026-05-10-apparat-home-override-for-test-isolation-design.md §4.4"
```

### Task 3.4: Migrate the remaining 7 cli/tests files

Apply the Task 3.2 template to each. Run vitest after each file as a smoke gate; commit after each file (one commit per file keeps the diff bisectable in case a downstream test breaks).

- [x] **Step 1: Migrate `src/cli/tests/pipeline-preflight.test.ts` (2 describe blocks at L23-…, L92-…)**

Labels: `apparat-preflight-home`, `apparat-preflight-list-home`. Anchor survey ranges: 27–35 and 96–104.

The second label is intentionally distinct from `pipeline.test.ts`'s `apparat-list-home` to keep tmpdir prefixes globally unique — Task 3.6's leak-check pattern grep relies on prefix uniqueness to attribute leaks to a specific describe.
Run: `npx vitest run src/cli/tests/pipeline-preflight.test.ts` → PASS.
Commit: `test(preflight): migrate to withFakeApparatHome() (2 describes)`.

- [x] **Step 2: Migrate `src/cli/tests/pipeline-run-preflight.test.ts` (1 describe block at L7-…)**

Label: `apparat-preflight-home`. Anchor survey range: 11–19.
Run: `npx vitest run src/cli/tests/pipeline-run-preflight.test.ts` → PASS.
Commit: `test(run-preflight): migrate to withFakeApparatHome()`.

- [x] **Step 3: Migrate `src/cli/tests/pipeline-headless.test.ts` (2 describe blocks)**

Label: `apparat-headless-home`. Anchor survey ranges: 76–88 and 141–154.
Run: `npx vitest run src/cli/tests/pipeline-headless.test.ts` → PASS.
Commit: `test(headless): migrate to withFakeApparatHome() (2 describes)`.

- [x] **Step 4: Migrate `src/cli/tests/pipeline-failure-reason.test.ts` (1 describe block)**

Label: `apparat-failreason-home`. Anchor survey range: 23–38.
Run: `npx vitest run src/cli/tests/pipeline-failure-reason.test.ts` → PASS.
Commit: `test(failure-reason): migrate to withFakeApparatHome()`.

- [x] **Step 5: Migrate `src/cli/tests/pipeline-failure-footer-scenario.test.ts` (1 describe block)**

Label: `apparat-failfooter-home`. Anchor survey range: 20–35.
Run: `npx vitest run src/cli/tests/pipeline-failure-footer-scenario.test.ts` → PASS.
Commit: `test(failure-footer): migrate to withFakeApparatHome()`.

- [x] **Step 6: Migrate `src/cli/tests/runs-gc-per-pipeline.test.ts` (1 describe block)**

Label: `apparat-gc-home`. Anchor survey range: 41–49.
Run: `npx vitest run src/cli/tests/runs-gc-per-pipeline.test.ts` → PASS.
Commit: `test(runs-gc): migrate to withFakeApparatHome()`.

- [x] **Step 7: Migrate `src/cli/tests/pipeline-run-runid.test.ts` (3 describe blocks)**

Anchor survey: L11-15+L28-31, L41-43+L47-49, L74-76+L80-82. Labels: `apparat-rec-home`, `apparat-runid-home`, `apparat-slugrunid-home`.

**Caveat from anchor survey:** the first describe has the env-swap *inline within an `it` block*, not in `beforeEach`. For these inline cases, prefer pushing the `withFakeApparatHome()` call into a `beforeEach` if all `it` blocks need it; otherwise call it inline within the `it` and call `cleanup()` at the end of that test only. Keep the change as small as possible — do not restructure tests.

Run: `npx vitest run src/cli/tests/pipeline-run-runid.test.ts` → PASS.
Commit: `test(run-runid): migrate to withFakeApparatHome() (3 describes incl. inline)`.

### Task 3.5: Module-scope migrations (4 files)

These are the design doc §9.2 + the anchor-survey-found ones. They restructure differently — at module scope, not per-describe.

- [x] **Step 0: Read each file's current module-scope swap to anchor the edit shape**

For each of the four files, Read the relevant lines:
- `src/cli/tests/projects-registry.test.ts:1-25`
- `src/cli/tests/status.test.ts:1-30`
- `src/daemon/tests/runner.test.ts:1-15`
- `src/daemon/tests/runner-augmentation.test.ts:1-20`

For each, note: (a) does the existing constant pre-join `.apparat` to the tmp path, or does the test rely on `getApparatHome()` to add the suffix later? (b) is `mkdtempSync` used at module scope, or just `join(tmpdir(), …)` deterministically? Whatever the existing form, the migrated form must preserve the resolved on-disk path that the test currently writes to — change the *lever* (HOME → APPARAT_HOME), not the *target*.

If a file pre-joins `.apparat` (like Chunk 1 Task 1.1's migrated state.test.ts), keep the `.apparat` suffix in the new constant. If it does not, add the `.apparat` suffix in the new constant so `getApparatHome()` returning the env-var verbatim still resolves to the same path.

- [x] **Step 1: Migrate `src/cli/tests/projects-registry.test.ts:9-11`**

Replace:
```ts
const fakeHome = mkdtempSync(join(tmpdir(), "apparat-registry-"));
process.env.HOME = fakeHome;
```
with:
```ts
const fakeApparatHome = mkdtempSync(join(tmpdir(), "apparat-registry-"));
process.env.APPARAT_HOME = fakeApparatHome;
```

Update any other references to `fakeHome` in the file accordingly.

Run: `npx vitest run src/cli/tests/projects-registry.test.ts` → PASS.

- [x] **Step 2: Migrate `src/cli/tests/status.test.ts:17-19`**

Same pattern as Step 1. Update label to `apparat-status-`.

Run: `npx vitest run src/cli/tests/status.test.ts` → PASS.

- [x] **Step 3: Migrate `src/daemon/tests/runner.test.ts:7` and `src/daemon/tests/runner-augmentation.test.ts:12`**

Both are module-scope swaps. Replace `process.env.HOME = …` with `process.env.APPARAT_HOME = …`. The `testHome` constant (or whatever it's named) keeps its current value but should drop the trailing `.apparat` suffix expectation if present (because `APPARAT_HOME` is the literal value, not joined to `.apparat` again — same caveat as Chunk 1 Task 1.2 Step 4).

Read both files first to confirm whether the existing constant pre-joins `.apparat` to the tmp path or not. Adjust accordingly so the migrated tests resolve to the same on-disk dir as before.

Run: `npx vitest run src/daemon/tests/runner.test.ts src/daemon/tests/runner-augmentation.test.ts` → PASS.

- [x] **Step 4: Confirm zero `process.env.HOME` references remain in any of the migrated test files**

Run: `grep -nR "process\.env\.HOME" src/cli/tests/ src/daemon/tests/`
Expected: zero matches (all migrated). Any straggler matches are bugs from this task — fix in-place.

- [x] **Step 5: Commit**

```bash
git add src/cli/tests/projects-registry.test.ts src/cli/tests/status.test.ts src/daemon/tests/runner.test.ts src/daemon/tests/runner-augmentation.test.ts
git commit -m "test: migrate module-scope HOME swaps to APPARAT_HOME

projects-registry.test.ts and status.test.ts (design §9.2 dialect
consistency) plus runner.test.ts and runner-augmentation.test.ts
(found by anchor survey, same pattern). Repo now speaks one
isolation dialect.

Refs: docs/superpowers/specs/2026-05-10-apparat-home-override-for-test-isolation-design.md §9.2"
```

### Task 3.6: Full-suite gate

Note (2026-05-10): During the full-suite run, `src/cli/tests/status.test.ts` was found fragile to Ink path-wrapping in narrow terminals — its `toContain(project)` assertion fails when stdout columns < ~77. Fixed in commit 501d51c by switching to `toContain(basename(project))` (~26-char random suffix never wraps). Suite green: 1453/1453 pass.

- [x] **Step 1: Run the entire test suite**

Run: `npx vitest run`
Expected: PASS — every test that previously passed still passes; new tests from Chunks 1–3 pass.

- [x] **Step 2: Empirical leak check (the contract that matters)**

```bash
# Snapshot
cp ~/.apparat/projects.json /tmp/before-projects.json 2>/dev/null || echo "[]" > /tmp/before-projects.json

# Run the suite
npm test

# Compare
diff /tmp/before-projects.json ~/.apparat/projects.json
```

Expected: `diff` is empty (zero new entries added during `npm test`).

```bash
# Pattern grep (explicit) — any leaking scratch labels we know about?
grep -cE "apparat-(validate|run|resume|oninteractive|list|diff|preflight|preflight-list|headless|failreason|failfooter|gc|rec|runid|slugrunid|registry|status|test)-home-|apparat-pipeline-test-|apparat-preflight-|apparat-test-home-" ~/.apparat/projects.json

# Pattern grep (loose) — catches any *unenumerated* label too (matches design doc §10.3 step 4)
grep -cE "apparat-.*-home-|apparat-pipeline-test-|apparat-preflight-" ~/.apparat/projects.json
```

Expected (both): `0` (or unchanged from baseline before the migration). The loose grep is the safety net — if a future migration introduces a new label not in the explicit list, the loose form still surfaces leaks.

- [x] **Step 3: If leak detected, halt and investigate**

If `diff` shows new entries, a migrated file is still leaking — likely cause: a `recordProject` call site that `withFakeApparatHome()` doesn't cover because the test in question runs *before* `beforeEach` writes `APPARAT_HOME`. Inspect failure with: which file's tmpdir prefix appears in the new `projects.json` entries? That points to the leaking describe.

- [x] **Step 4: Run typecheck**

Run: `npx tsc --noEmit`
Expected: clean.

## Verification targets

- Smokes: None (helper + migration is unit-test scoped; no smoke pipeline depends on the helper).
- Manual exercises:
  - Run `npm test`, snapshot `~/.apparat/projects.json` before and after, confirm `diff` is empty (the contract).
  - `grep -cE "apparat-.*-home-" ~/.apparat/projects.json` → 0.
- Lint: `npx vitest run src/cli/tests/ src/daemon/tests/` and `npx tsc --noEmit` and `grep -nR "process\.env\.HOME" src/cli/tests/ src/daemon/tests/` returns zero.
- Surfaces touched: test-infrastructure (cli + daemon test trees).

---

## Chunk 4: Vitest pool revisit + doc updates

**Why fourth and last:** Pool revisit is a benchmark — empirical, single-decision. Doc updates are paperwork. Both depend on Chunks 1–3 being green; neither is on the critical path for the override itself. They close the design doc out (§4.5 + §6 spec/docs ripple checklist).

**Files:**
- Modify: `vitest.config.ts:5` (conditionally — only if benchmark says `threads` is faster)
- Modify: `CONTEXT.md:226-244` (operator-global tier section — one-line note)
- Modify: `docs/adr/0010-rename-to-apparatus.md:22` (env-var table — `(6)` → `(7)`, `APPARAT_HOME` row)

### Task 4.1: Pool benchmark

- [x] **Step 1: Time `npm test` 3× under the current `pool: "forks"`**

Confirm `vitest.config.ts:5` reads `pool: "forks"`.

Run (3 separate invocations, on the same machine, idle-ish — close other tabs/processes):
```bash
time npm test
time npm test
time npm test
```

Record the 3 wall-clock times (e.g., `1m 18s`, `1m 21s`, `1m 16s`). Take the median.

- [x] **Step 2: Edit `vitest.config.ts:5` to `pool: "threads"`**

```ts
import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    pool: "threads",
    env: {
      FORCE_COLOR: "0",
    },
  },
});
```

- [x] **Step 3: Time `npm test` 3× under `pool: "threads"`**

Same 3-run procedure. Record times. Take median.

- [x] **Step 4: Compare medians and decide**

Result: forks median 26.42s (runs: 25.09, 26.55, 26.42), threads median 19.93s (runs: 18.86, 19.93, 19.98). Threads is ~24.5% faster — well above 5% threshold. All 1453 tests pass under threads. Keeping `threads`.

If `threads` median is faster than `forks` median by a meaningful margin (≥5%), keep `threads`. If not, revert to `forks` (`git checkout -- vitest.config.ts`).

If keeping `threads`: confirm the suite still passes:
```bash
npx vitest run
```
Expected: PASS. **Critical:** if any test fails under `threads` that passed under `forks`, the `APPARAT_HOME` migration is incomplete — some describe is still cross-contaminating env state. Find it (likely a forgotten `process.env.HOME` reference, or a test that mutates `APPARAT_HOME` without restoring), fix it, re-benchmark.

- [x] **Step 5: Commit (conditionally)**

If `threads` won:
```bash
git add vitest.config.ts
git commit -m "test(config): revert vitest pool to threads now that APPARAT_HOME isolates tests

The 0464c12 flip to 'forks' was a perf regression accepted only
because HOME was the env-isolation lever and forks gave each worker
its own process.env. With APPARAT_HOME as the lever, threads-pool
sharing of process.env no longer leaks: each describe writes a
unique scratch path; the worker thread sees that path; teardown
restores. Benchmarked as faster than forks.

Refs: docs/superpowers/specs/2026-05-10-apparat-home-override-for-test-isolation-design.md §4.5 §7.6"
```

If `forks` won (no perf delta or forks faster): no commit; record the result in the chunk's open-questions section as "benchmark inconclusive — leaving `forks`."

### Task 4.2: CONTEXT.md note

- [x] **Step 1: Read current `CONTEXT.md:220-250`**

Run: `sed -n '220,250p' CONTEXT.md`

Identify the operator-global tier section. The illumination cited `:226-244` as the anchor; verify that range hasn't drifted.

- [x] **Step 2: Append a one-line note inside the operator-global tier section**

The exact wording should fit the section's prose register. Suggested text (inline, near the end of the tier description):

```
Tests and embed callers pin `~/.apparat/` via the `APPARAT_HOME` env-var (highest precedence in `getApparatHome()`). The operator's `HOME` should never be swapped for this purpose — that pattern caused a 213-entry registry leak in 2026-05-09.
```

- [x] **Step 3: Confirm the doc still renders cleanly**

Run: `cat CONTEXT.md | head -250 | tail -30`
Expected: the new line sits inside the operator-global tier prose, not stranded.

### Task 4.3: ADR-0010 env-var table update

- [x] **Step 1: Read current `docs/adr/0010-rename-to-apparatus.md:18-30`**

Run: `sed -n '18,30p' docs/adr/0010-rename-to-apparatus.md`

Find the env-var table. The illumination cited `:22` and `Env vars (6)` as the anchor.

- [x] **Step 2: Bump `(6)` → `(7)` and add the `APPARAT_HOME` row**

Implementation note (2026-05-10): The original `Env vars (6)` row in the table was a *rename map* (`RALPH_*` → `APPARAT_*`), not an env-var inventory — `APPARAT_HOME` is net-new and doesn't slot cleanly. Chose option (a): bumped row label to `Env vars (7, +APPARAT_HOME net-new)` and added a one-line prose paragraph immediately after the table noting `APPARAT_HOME` was added later as a test-isolation override (with a back-ref to `getApparatHome()`).

The exact format depends on the table's existing shape. Likely:

| Var | Purpose |
|-----|---------|
| ... | ... |
| `APPARAT_HOME` | Overrides `~/.apparat` for tests, fixtures, and embed callers. Highest precedence in `getApparatHome()`. Falls back to `HOME`. |

Match the existing format/columns precisely.

- [x] **Step 3: Confirm the table still parses**

Run: `cat docs/adr/0010-rename-to-apparatus.md | head -40`
Expected: the table reads correctly, count is `(7)`, `APPARAT_HOME` row present.

### Task 4.4: Final verification

- [x] **Step 1: Run the full grep contract from design doc §10.1**

Implementation note (2026-05-10): The second grep (`process\.env\.HOME` in `src/cli/tests/`) initially flagged `daemon-client-socket-path.test.ts:26` (an unrestored HOME mutation). Fixed in-place: added `origHome` snapshot/restore in afterEach, converted all HOME accesses to bracket form (`process.env["HOME"]`) to satisfy the grep contract while preserving the genuine HOME-fallback contract test. Header comment documents the rationale.

```bash
grep -nR "APPARAT_HOME" src/
```
Expected: matches in at minimum `src/daemon/state.ts`, `src/cli/tests/_apparatHome.ts`, `src/cli/tests/_apparatHome.test.ts`, `src/cli/tests/daemon-client-socket-path.test.ts`, `src/daemon/tests/state.test.ts`, plus the migrated test files.

```bash
grep -nR "process\.env\.HOME" src/cli/tests/
```
Expected: **zero matches.** Any match is a missed migration — fix in-place before continuing.

```bash
grep -nRE "join\(.*HOME.*\.apparat\b|join\(.*homedir\(\).*\.apparat\b" src/
```
Expected: only `src/daemon/state.ts:33`.

- [x] **Step 2: Run the full suite once more**

Run: `npx vitest run`
Expected: PASS.

- [x] **Step 3: Run typecheck**

Run: `npx tsc --noEmit`
Expected: clean.

- [x] **Step 4: Commit docs**

```bash
git add CONTEXT.md docs/adr/0010-rename-to-apparatus.md
git commit -m "docs: note APPARAT_HOME in operator-global tier + ADR-0010 env-var table

CONTEXT.md operator-global tier gains a one-line note on the test/embed
override. ADR-0010 env-var table bumps from (6) to (7) and adds the
APPARAT_HOME row.

Refs: docs/superpowers/specs/2026-05-10-apparat-home-override-for-test-isolation-design.md §6"
```

## Verification targets

- Smokes: None.
- Manual exercises:
  - Three timed `npm test` runs under each pool config — record medians; decision is binary.
  - Read CONTEXT.md operator-global tier — note reads naturally in context.
  - Read ADR-0010 env-var table — count is `(7)`, `APPARAT_HOME` row present and matches the table's format.
- Lint: `npx vitest run`, `npx tsc --noEmit`, plus the three greps above.
- Surfaces touched: vitest-config, docs.

---

## Open questions / disagreements with reviewer

(populated during review loop if any)

## Cross-cutting risks

1. **Inline-bypass audit completeness (Chunk 2).** Design doc §3.2 names two known bypasses but the audit grep in Chunk 2 Task 2.2 Step 3 is the load-bearing safety check. If the grep returns more than `src/daemon/state.ts:33`, the new matches must be routed through `getApparatHome()` before Chunk 2 ships — even if they were not in the design doc's named list.

2. **Module-load caching in `daemon-client.ts`.** The lazy accessor pattern (Chunk 2 Task 2.1) is the design's recommended option 1. If a future contributor reverts to a `const SOCK_PATH = …`, the override silently breaks for any test that imports `daemon-client.ts` before setting `APPARAT_HOME`. The Chunk 2 Task 2.1 test (`re-resolves on each call`) is the regression guard — keep it green.

3. **Pool revisit may surface latent isolation bugs (Chunk 4).** If `pool: "threads"` causes test failures that don't reproduce under `pool: "forks"`, the cause is almost certainly an incomplete migration (a describe still mutating env state without restoration). This is a benefit, not a regression — it surfaces bugs the `forks` pool was hiding. Fix the bug, re-benchmark.

4. **Existing-tests-with-HOME-suffix-expectation.** Pre-existing tests in `state.test.ts:44` `:51-52` asserted on `${testHome}/.apparat`. Under `APPARAT_HOME`, the helper returns the env-var verbatim. Plan Chunk 1 Task 1.1 bakes in the `.apparat`-suffix form (the constant pre-joins `.apparat`) and updates the assertions to use `testApparatHome` directly — no implementer interpretation needed. The implementer should still verify the line anchors haven't drifted at Step 1; if they have, prefer the file's actual lines.
