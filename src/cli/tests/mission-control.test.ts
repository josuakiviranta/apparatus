import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync, rmSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";
import { withFakeApparatHome, type FakeApparatHome } from "./_apparatHome.js";
import { getMissionControlState } from "../lib/mission-control.js";

vi.mock("../../lib/daemon-client.js", () => ({
  request: vi.fn().mockResolvedValue({ type: "tasks", data: [] }),
}));

let scratch: FakeApparatHome;

beforeEach(() => {
  scratch = withFakeApparatHome("mission-control-home");
});
afterEach(() => {
  scratch.cleanup();
});

function registerProject(absPath: string, lastSeen = Date.now()): void {
  const projectsFile = join(scratch.path, "projects.json");
  let list: Array<{ path: string; lastSeen: number }> = [];
  if (existsSync(projectsFile)) {
    list = JSON.parse(readFileSync(projectsFile, "utf8"));
  }
  list.push({ path: absPath, lastSeen });
  writeFileSync(projectsFile, JSON.stringify(list, null, 2) + "\n");
}

describe("getMissionControlState — level: all", () => {
  it("returns empty projects + empty runningNow when no projects registered", async () => {
    const s = await getMissionControlState({ level: "all" });
    expect(s.level).toBe("all");
    if (s.level !== "all") throw new Error("type guard");
    expect(s.projects).toEqual([]);
    expect(s.runningNow).toEqual([]);
    expect(s.zoomHint).toBe("");
  });

  it("includes a running-now entry when a project has an in-progress run", async () => {
    const projDir = mkdtempSync(join(tmpdir(), "mc-proj-"));
    const runsRoot = join(projDir, ".apparat", "runs");
    mkdirSync(join(runsRoot, "run-x"), { recursive: true });
    writeFileSync(join(runsRoot, "run-x", "pipeline.jsonl"),
      JSON.stringify({ kind: "pipeline-start", pipelineName: "demo", timestamp: "2026-05-11T10:00:00Z" }) + "\n"
    );
    registerProject(projDir);

    const s = await getMissionControlState({ level: "all" });
    if (s.level !== "all") throw new Error("type guard");
    expect(s.runningNow.length).toBe(1);
    expect(s.runningNow[0].runId).toBe("run-x");
    expect(s.zoomHint).toContain(projDir);
    rmSync(projDir, { recursive: true });
  });

  it("returns tasks = 'daemon-offline' when the daemon RPC fails", async () => {
    const { request } = await import("../../lib/daemon-client.js");
    (request as any).mockRejectedValueOnce(new Error("ECONNREFUSED"));
    const s = await getMissionControlState({ level: "all" });
    if (s.level !== "all") throw new Error("type guard");
    expect(s.tasks).toBe("daemon-offline");
  });
});

describe("getMissionControlState — level: project", () => {
  it("returns project + pipelines roster + recent runs when project is registered", async () => {
    const projDir = mkdtempSync(join(tmpdir(), "mc-proj-one-"));
    mkdirSync(join(projDir, ".apparat", "pipelines"), { recursive: true });
    writeFileSync(join(projDir, ".apparat", "pipelines", "demo.dot"),
      `digraph g { goal="x" start [shape=Mdiamond] done [shape=Msquare] start -> done }`);
    registerProject(projDir);

    const s = await getMissionControlState({ level: "project", projectPath: projDir });
    if (s.level !== "project") throw new Error("type guard");
    expect(s.project.path).toBe(projDir);
    expect(s.pipelines.some(p => p.name === "demo")).toBe(true);
    expect(s.zoomHint).toContain(projDir);
    rmSync(projDir, { recursive: true });
  });

  it("returns level: 'error' when projectPath is not registered", async () => {
    const s = await getMissionControlState({ level: "project", projectPath: "/no/such/path" });
    expect(s.level).toBe("error");
    if (s.level !== "error") throw new Error("type guard");
    expect(s.message).toContain("project not registered");
  });
});
