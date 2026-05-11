import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { mkdtempSync, writeFileSync, rmSync, readFileSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";
import { withFakeApparatHome, type FakeApparatHome } from "./_apparatHome.js";
import * as output from "../lib/output.js";
import { statusCommand } from "../commands/status.js";

vi.mock("../../lib/daemon-client.js", () => ({
  request: vi.fn().mockResolvedValue({ type: "tasks", data: [] }),
}));

let scratch: FakeApparatHome;

beforeEach(() => {
  scratch = withFakeApparatHome("status-cmd-home");
  vi.spyOn(output, "info").mockResolvedValue();
});
afterEach(() => {
  (output.info as any).mockRestore();
  scratch.cleanup();
});

function registerProject(absPath: string): void {
  const projectsFile = join(scratch.path, "projects.json");
  let list: Array<{ path: string; lastSeen: number }> = [];
  try { list = JSON.parse(readFileSync(projectsFile, "utf8")); } catch {}
  list.push({ path: absPath, lastSeen: Date.now() });
  writeFileSync(projectsFile, JSON.stringify(list, null, 2) + "\n");
}

describe("statusCommand (no args)", () => {
  it("prints the 'No projects registered yet.' message when registry empty", async () => {
    await statusCommand({});
    const all = (output.info as any).mock.calls.map((c: any) => String(c[0])).join("\n");
    expect(all).toContain("No projects registered yet.");
  });

  it("prints a 'zoom in:' hint line when one project is registered", async () => {
    const p = mkdtempSync(join(tmpdir(), "status-cmd-"));
    registerProject(p);
    await statusCommand({});
    const all = (output.info as any).mock.calls.map((c: any) => String(c[0])).join("\n");
    expect(all).toContain(`zoom in: apparat status ${p}`);
    rmSync(p, { recursive: true });
  });
});

describe("statusCommand (project arg)", () => {
  it("writes a clear error to stderr and exits 1 for unknown project", async () => {
    const stderrSpy = vi.spyOn(process.stderr, "write").mockImplementation(() => true);
    const exitSpy = vi.spyOn(process, "exit").mockImplementation(((code?: number) => {
      throw new Error(`__exit__${code}`);
    }) as any);
    await expect(statusCommand({ project: "/nonexistent/dir" })).rejects.toThrow("__exit__1");
    const err = stderrSpy.mock.calls.map(c => String(c[0])).join("");
    expect(err).toContain("project not registered");
    stderrSpy.mockRestore();
    exitSpy.mockRestore();
  });
});
