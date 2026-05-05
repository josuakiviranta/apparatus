// src/cli/tests/apparat-paths.test.ts
import { describe, it, expect } from "vitest";
import {
  apparatDir,
  meditationsDir,
  illuminationsDir,
  stimuliDir,
  sessionsDir,
  pipelinesDir,
  runsDir,
  runDir,
} from "../lib/apparat-paths";

describe("apparat-paths", () => {
  const project = "/abs/project";

  it("apparatDir joins project + .ralph", () => {
    expect(apparatDir(project)).toBe("/abs/project/.ralph");
  });
  it("meditationsDir joins .ralph/meditations", () => {
    expect(meditationsDir(project)).toBe("/abs/project/.ralph/meditations");
  });
  it("illuminationsDir joins .ralph/meditations/illuminations", () => {
    expect(illuminationsDir(project)).toBe(
      "/abs/project/.ralph/meditations/illuminations",
    );
  });
  it("stimuliDir joins .ralph/meditations/stimuli", () => {
    expect(stimuliDir(project)).toBe(
      "/abs/project/.ralph/meditations/stimuli",
    );
  });
  it("sessionsDir joins .ralph/sessions", () => {
    expect(sessionsDir(project)).toBe("/abs/project/.ralph/sessions");
  });
  it("pipelinesDir joins .ralph/pipelines", () => {
    expect(pipelinesDir(project)).toBe("/abs/project/.ralph/pipelines");
  });
  it("runsDir joins .ralph/runs", () => {
    expect(runsDir(project)).toBe("/abs/project/.ralph/runs");
  });
  it("runDir joins .ralph/runs/<runId>", () => {
    expect(runDir(project, "2026-05-04T12-00")).toBe(
      "/abs/project/.ralph/runs/2026-05-04T12-00",
    );
  });
  it("runDir composes from runsDir", () => {
    const runId = "abc";
    expect(runDir(project, runId).startsWith(runsDir(project))).toBe(true);
  });
});
