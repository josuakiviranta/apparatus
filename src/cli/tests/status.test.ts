import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";

vi.mock("../../lib/daemon-client.js", () => ({
  request: vi.fn(),
}));

import { request } from "../../lib/daemon-client.js";
import { recordProject } from "../lib/projects-registry.js";
import { statusCommand } from "../commands/status.js";

let testHome: string;
let captured: string[];

beforeEach(() => {
  testHome = mkdtempSync(join(tmpdir(), "apparat-status-"));
  process.env.HOME = testHome;
  captured = [];
  vi.spyOn(process.stdout, "write").mockImplementation((chunk: any) => {
    captured.push(String(chunk));
    return true;
  });
});
afterEach(() => {
  vi.restoreAllMocks();
  rmSync(testHome, { recursive: true, force: true });
  delete process.env.HOME;
});

function output(): string {
  return captured.join("");
}

describe("apparat status", () => {
  it("prints empty-registry message when no projects are registered", async () => {
    vi.mocked(request).mockResolvedValue({ type: "tasks", data: [] });
    await statusCommand();
    expect(output()).toContain("No projects registered yet");
  });

  it("lists registered projects with task counts", async () => {
    const project = mkdtempSync(join(tmpdir(), "apparat-status-proj-"));
    recordProject(project);
    vi.mocked(request).mockResolvedValue({
      type: "tasks",
      data: [{ id: "pipeline:" + project, command: "pipeline", args: ["run", "x.dot", "--project", project] }],
    });
    await statusCommand();
    const out = output();
    expect(out).toContain(project);
    expect(out).toContain("heartbeat tasks");
    rmSync(project, { recursive: true, force: true });
  });

  it("renders (daemon offline) when request times out / rejects", async () => {
    const project = mkdtempSync(join(tmpdir(), "apparat-status-proj-"));
    recordProject(project);
    vi.mocked(request).mockRejectedValue(new Error("ECONNREFUSED"));
    await statusCommand();
    expect(output()).toContain("(daemon offline)");
    rmSync(project, { recursive: true, force: true });
  });

  it("prints '(no runs yet)' for projects with no runs dir", async () => {
    const project = mkdtempSync(join(tmpdir(), "apparat-status-proj-"));
    recordProject(project);
    vi.mocked(request).mockResolvedValue({ type: "tasks", data: [] });
    await statusCommand();
    expect(output()).toContain("(no runs yet)");
    rmSync(project, { recursive: true, force: true });
  });

  it("prints last run outcome when project has a run with pipeline-end", async () => {
    const project = mkdtempSync(join(tmpdir(), "apparat-status-proj-"));
    recordProject(project);
    const runDir = join(project, ".apparat", "runs", "abcd1234");
    mkdirSync(runDir, { recursive: true });
    writeFileSync(join(runDir, "pipeline.jsonl"),
      JSON.stringify({ kind: "pipeline-end", runId: "abcd1234", outcome: "success", timestamp: "2026-05-09T12:00:00Z" }) + "\n");
    vi.mocked(request).mockResolvedValue({ type: "tasks", data: [] });
    await statusCommand();
    const out = output();
    expect(out).toContain("abcd1234");
    expect(out).toContain("success");
    rmSync(project, { recursive: true, force: true });
  });
});
