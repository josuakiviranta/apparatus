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
  newRunId,
} from "../lib/apparat-paths";

describe("apparat-paths", () => {
  const project = "/abs/project";

  it("apparatDir joins project + .apparat", () => {
    expect(apparatDir(project)).toBe("/abs/project/.apparat");
  });
  it("meditationsDir joins .apparat/meditations", () => {
    expect(meditationsDir(project)).toBe("/abs/project/.apparat/meditations");
  });
  it("illuminationsDir joins .apparat/meditations/illuminations", () => {
    expect(illuminationsDir(project)).toBe(
      "/abs/project/.apparat/meditations/illuminations",
    );
  });
  it("stimuliDir joins .apparat/meditations/stimuli", () => {
    expect(stimuliDir(project)).toBe(
      "/abs/project/.apparat/meditations/stimuli",
    );
  });
  it("sessionsDir joins .apparat/sessions", () => {
    expect(sessionsDir(project)).toBe("/abs/project/.apparat/sessions");
  });
  it("pipelinesDir joins .apparat/pipelines", () => {
    expect(pipelinesDir(project)).toBe("/abs/project/.apparat/pipelines");
  });
  it("runsDir joins .apparat/runs", () => {
    expect(runsDir(project)).toBe("/abs/project/.apparat/runs");
  });
  it("runDir joins .apparat/runs/<runId>", () => {
    expect(runDir(project, "2026-05-04T12-00")).toBe(
      "/abs/project/.apparat/runs/2026-05-04T12-00",
    );
  });
  it("runDir composes from runsDir", () => {
    const runId = "abc";
    expect(runDir(project, runId).startsWith(runsDir(project))).toBe(true);
  });
});

describe("newRunId", () => {
  it("returns an 8-char hex slice when no pipelineName provided (back-compat)", () => {
    const id = newRunId();
    expect(id).toMatch(/^[0-9a-f]{8}$/);
  });

  it("returns <slug>-<uuid8> when pipelineName provided", () => {
    expect(newRunId("meditate")).toMatch(/^meditate-[0-9a-f]{8}$/);
  });

  it("returns a different id on each call (collision-resistant for solo dev tooling)", () => {
    const a = newRunId();
    const b = newRunId();
    expect(a).not.toBe(b);
  });
});
