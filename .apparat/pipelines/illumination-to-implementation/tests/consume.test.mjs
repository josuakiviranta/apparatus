import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { spawnSync } from "node:child_process";
import {
  mkdtempSync,
  rmSync,
  mkdirSync,
  existsSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const SCRIPT = resolve(__dirname, "..", "consume.mjs");

function runScript(args, cwd) {
  return spawnSync(process.execPath, [SCRIPT, ...args], { encoding: "utf8", cwd });
}

function setupRepo() {
  const tmp = mkdtempSync(join(tmpdir(), "consume-test-"));
  const illumDir = join(tmp, ".apparat", "meditations", "illuminations");
  mkdirSync(illumDir, { recursive: true });
  const illumPath = join(illumDir, "2026-04-30T1200-x.md");
  writeFileSync(illumPath, `---\ndate: 2026-04-30\ndescription: test\n---\n\nbody\n`);
  spawnSync("git", ["-C", tmp, "init", "-b", "main"], { stdio: "ignore" });
  spawnSync("git", ["-C", tmp, "config", "user.email", "test@example.com"], { stdio: "ignore" });
  spawnSync("git", ["-C", tmp, "config", "user.name", "Test"], { stdio: "ignore" });
  spawnSync("git", ["-C", tmp, "add", "."], { stdio: "ignore" });
  spawnSync("git", ["-C", tmp, "commit", "-m", "seed"], { stdio: "ignore" });
  return { tmp, illumPath };
}

describe("consume.mjs", () => {
  let tmp, illumPath;

  beforeEach(() => {
    ({ tmp, illumPath } = setupRepo());
  });

  afterEach(() => {
    rmSync(tmp, { recursive: true, force: true });
  });

  it("deletes the illumination file with reason=declined", () => {
    const result = runScript([illumPath, "declined"], tmp);
    expect(result.status).toBe(0);
    expect(existsSync(illumPath)).toBe(false);
  });

  it("deletes the illumination file with reason=implemented", () => {
    const result = runScript([illumPath, "implemented"], tmp);
    expect(result.status).toBe(0);
    expect(existsSync(illumPath)).toBe(false);
  });

  it("creates a commit with reason in the message — declined", () => {
    runScript([illumPath, "declined"], tmp);
    const log = spawnSync("git", ["-C", tmp, "log", "-1", "--pretty=%s"], { encoding: "utf8" });
    expect(log.stdout.trim()).toBe("meditate: consume 2026-04-30T1200-x.md (declined)");
  });

  it("creates a commit with reason in the message — implemented", () => {
    runScript([illumPath, "implemented"], tmp);
    const log = spawnSync("git", ["-C", tmp, "log", "-1", "--pretty=%s"], { encoding: "utf8" });
    expect(log.stdout.trim()).toBe("meditate: consume 2026-04-30T1200-x.md (implemented)");
  });

  it("rejects unknown reasons with exit 2", () => {
    const result = runScript([illumPath, "archived"], tmp);
    expect(result.status).toBe(2);
    expect(result.stderr).toMatch(/reason must be implemented or declined/i);
    expect(existsSync(illumPath)).toBe(true);
  });

  it("exits with usage error when args are missing", () => {
    const result = runScript([], tmp);
    expect(result.status).toBe(2);
    expect(result.stderr).toMatch(/usage:/i);
  });

  it("emits JSON {success: true, filename, reason} on stdout", () => {
    const result = runScript([illumPath, "implemented"], tmp);
    const payload = JSON.parse(result.stdout);
    expect(payload).toEqual({
      success: true,
      filename: "2026-04-30T1200-x.md",
      reason: "implemented",
    });
  });

  it("resolves a verifier-style relative path (legacy 'meditations/illuminations/...' prefix) when run from cwd=$project", () => {
    // Verifier emits illumination_path with the legacy 'meditations/illuminations/' prefix,
    // but the file actually lives at $project/.apparat/meditations/illuminations/.
    // Script must locate the file by basename under .apparat/meditations/illuminations/.
    const legacyArg = "meditations/illuminations/2026-04-30T1200-x.md";
    const result = runScript([legacyArg, "declined"], tmp);
    expect(result.status).toBe(0);
    expect(existsSync(illumPath)).toBe(false);
  });

  it("resolves a bare basename when run from cwd=$project", () => {
    const result = runScript(["2026-04-30T1200-x.md", "declined"], tmp);
    expect(result.status).toBe(0);
    expect(existsSync(illumPath)).toBe(false);
  });
});
