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

describe("getMissionControlState — level: pipeline", () => {
  it("returns runs filtered to the named pipeline", async () => {
    const projDir = mkdtempSync(join(tmpdir(), "mc-proj-pipe-"));
    mkdirSync(join(projDir, ".apparat", "pipelines"), { recursive: true });
    writeFileSync(join(projDir, ".apparat", "pipelines", "demo.dot"),
      `digraph g { goal="x" start [shape=Mdiamond] done [shape=Msquare] start -> done }`);
    mkdirSync(join(projDir, ".apparat", "runs", "r-a"), { recursive: true });
    writeFileSync(join(projDir, ".apparat", "runs", "r-a", "pipeline.jsonl"),
      JSON.stringify({ kind: "pipeline-start", pipelineName: "demo", timestamp: "2026-05-11T10:00:00Z" }) + "\n" +
      JSON.stringify({ kind: "pipeline-end",   outcome: "success", timestamp: "2026-05-11T10:00:01Z" }) + "\n"
    );
    registerProject(projDir);
    const s = await getMissionControlState({
      level: "pipeline", projectPath: projDir, pipelineName: "demo",
    });
    if (s.level !== "pipeline") throw new Error("type guard");
    expect(s.runs.length).toBe(1);
    expect(s.runs[0].runId).toBe("r-a");
    expect(s.zoomHint).toContain("r-a");
    rmSync(projDir, { recursive: true });
  });

  it("returns level: 'error' when pipeline name not in roster", async () => {
    const projDir = mkdtempSync(join(tmpdir(), "mc-proj-pipe-"));
    registerProject(projDir);
    const s = await getMissionControlState({
      level: "pipeline", projectPath: projDir, pipelineName: "does-not-exist",
    });
    expect(s.level).toBe("error");
    if (s.level !== "error") throw new Error("type guard");
    expect(s.message).toContain("pipeline not found");
    rmSync(projDir, { recursive: true });
  });
});

describe("getMissionControlState — level: run", () => {
  it("returns isLive=false + tracePath for a finished run", async () => {
    const projDir = mkdtempSync(join(tmpdir(), "mc-proj-run-"));
    const runDir = join(projDir, ".apparat", "runs", "r-fin");
    mkdirSync(runDir, { recursive: true });
    writeFileSync(join(runDir, "pipeline.jsonl"),
      JSON.stringify({ kind: "pipeline-start", pipelineName: "demo", timestamp: "2026-05-11T10:00:00Z" }) + "\n" +
      JSON.stringify({ kind: "pipeline-end",   outcome: "success", timestamp: "2026-05-11T10:00:01Z" }) + "\n"
    );
    registerProject(projDir);
    const s = await getMissionControlState({
      level: "run", projectPath: projDir, pipelineName: "demo", runId: "r-fin",
    });
    if (s.level !== "run") throw new Error("type guard");
    expect(s.isLive).toBe(false);
    expect(s.tracePath).toBe(join(runDir, "pipeline.jsonl"));
    expect(s.zoomHint).toBe("");
    rmSync(projDir, { recursive: true });
  });

  it("returns isLive=true for an in-progress run", async () => {
    const projDir = mkdtempSync(join(tmpdir(), "mc-proj-run-live-"));
    const runDir = join(projDir, ".apparat", "runs", "r-live");
    mkdirSync(runDir, { recursive: true });
    writeFileSync(join(runDir, "pipeline.jsonl"),
      JSON.stringify({ kind: "pipeline-start", pipelineName: "demo", timestamp: "2026-05-11T10:00:00Z" }) + "\n"
    );
    registerProject(projDir);
    const s = await getMissionControlState({
      level: "run", projectPath: projDir, pipelineName: "demo", runId: "r-live",
    });
    if (s.level !== "run") throw new Error("type guard");
    expect(s.isLive).toBe(true);
    rmSync(projDir, { recursive: true });
  });

  it("returns level: 'error' when runId not found", async () => {
    const projDir = mkdtempSync(join(tmpdir(), "mc-proj-run-missing-"));
    registerProject(projDir);
    const s = await getMissionControlState({
      level: "run", projectPath: projDir, pipelineName: "demo", runId: "nope",
    });
    expect(s.level).toBe("error");
    if (s.level !== "error") throw new Error("type guard");
    expect(s.message).toContain("run not found");
    rmSync(projDir, { recursive: true });
  });
});
