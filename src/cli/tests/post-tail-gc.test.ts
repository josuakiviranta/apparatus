import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, mkdirSync, rmSync, existsSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { gcRunScopedArtefactsOnSuccess } from "../commands/pipeline/runs-gc.js";

describe("gcRunScopedArtefactsOnSuccess", () => {
  let project: string;
  beforeEach(() => {
    project = mkdtempSync(join(tmpdir(), "apparat-post-tail-gc-"));
  });
  afterEach(() => {
    rmSync(project, { recursive: true, force: true });
  });

  it("removes a populated .apparat/runs/<runId>/ dir", () => {
    const runId = "meditate-abc12345";
    const runDir = join(project, ".apparat", "runs", runId);
    mkdirSync(join(runDir, "some-node"), { recursive: true });
    writeFileSync(join(runDir, "pipeline.jsonl"), "{}\n");
    writeFileSync(join(runDir, "some-node", "prompt.md"), "x");

    gcRunScopedArtefactsOnSuccess(project, runId);

    expect(existsSync(runDir)).toBe(false);
  });

  it("removes a populated .triage/<runId>/ dir (chat-notes)", () => {
    const runId = "meditate-abc12345";
    const triageDir = join(project, ".apparat", "meditations", "illuminations", ".triage", runId);
    mkdirSync(triageDir, { recursive: true });
    writeFileSync(join(triageDir, "chat-notes.md"), "notes");

    gcRunScopedArtefactsOnSuccess(project, runId);

    expect(existsSync(triageDir)).toBe(false);
  });

  it("is a no-op when neither path exists (does not throw)", () => {
    expect(() => gcRunScopedArtefactsOnSuccess(project, "never-existed-xyz")).not.toThrow();
  });

  it("is a no-op for the missing path when the other exists", () => {
    const runId = "meditate-only-runs";
    const runDir = join(project, ".apparat", "runs", runId);
    mkdirSync(runDir, { recursive: true });
    writeFileSync(join(runDir, "pipeline.jsonl"), "{}\n");

    expect(() => gcRunScopedArtefactsOnSuccess(project, runId)).not.toThrow();
    expect(existsSync(runDir)).toBe(false);
  });

  it("does not touch sibling runs/<otherId>/ dirs", () => {
    const targetId = "meditate-target";
    const otherId = "meditate-other";
    mkdirSync(join(project, ".apparat", "runs", targetId), { recursive: true });
    mkdirSync(join(project, ".apparat", "runs", otherId), { recursive: true });
    writeFileSync(join(project, ".apparat", "runs", otherId, "pipeline.jsonl"), "{}\n");

    gcRunScopedArtefactsOnSuccess(project, targetId);

    expect(existsSync(join(project, ".apparat", "runs", targetId))).toBe(false);
    expect(existsSync(join(project, ".apparat", "runs", otherId))).toBe(true);
  });

  it("does not touch sibling .triage/<otherId>/ dirs", () => {
    const targetId = "meditate-target";
    const otherId = "meditate-other";
    const triageRoot = join(project, ".apparat", "meditations", "illuminations", ".triage");
    mkdirSync(join(triageRoot, targetId), { recursive: true });
    mkdirSync(join(triageRoot, otherId), { recursive: true });
    writeFileSync(join(triageRoot, otherId, "chat-notes.md"), "keep");

    gcRunScopedArtefactsOnSuccess(project, targetId);

    expect(existsSync(join(triageRoot, targetId))).toBe(false);
    expect(existsSync(join(triageRoot, otherId))).toBe(true);
  });

  it("does not touch sessions/, specs/, or non-.triage illuminations siblings", () => {
    const runId = "meditate-abc12345";
    mkdirSync(join(project, ".apparat", "runs", runId), { recursive: true });
    mkdirSync(join(project, ".apparat", "sessions"), { recursive: true });
    writeFileSync(join(project, ".apparat", "sessions", "2026-05-12-x.md"), "session");
    mkdirSync(join(project, "docs", "superpowers", "specs"), { recursive: true });
    writeFileSync(join(project, "docs", "superpowers", "specs", "x-design.md"), "spec");
    mkdirSync(join(project, ".apparat", "meditations", "illuminations"), { recursive: true });
    writeFileSync(
      join(project, ".apparat", "meditations", "illuminations", "2026-05-12T0900-keep.md"),
      "illumination",
    );

    gcRunScopedArtefactsOnSuccess(project, runId);

    expect(existsSync(join(project, ".apparat", "sessions", "2026-05-12-x.md"))).toBe(true);
    expect(existsSync(join(project, "docs", "superpowers", "specs", "x-design.md"))).toBe(true);
    expect(
      existsSync(join(project, ".apparat", "meditations", "illuminations", "2026-05-12T0900-keep.md")),
    ).toBe(true);
  });

  it("removes a populated .apparat/meditations/stimuli/.triage/<runId>/ dir", () => {
    const runId = "meditate-abc12345";
    const stimuliTriageDir = join(
      project,
      ".apparat",
      "meditations",
      "stimuli",
      ".triage",
      runId,
    );
    mkdirSync(stimuliTriageDir, { recursive: true });
    writeFileSync(join(stimuliTriageDir, "lens.md"), "stimuli notes");

    gcRunScopedArtefactsOnSuccess(project, runId);

    expect(existsSync(stimuliTriageDir)).toBe(false);
  });

  it("does not touch sibling stimuli/.triage/<otherId>/ dirs", () => {
    const targetId = "meditate-target";
    const otherId = "meditate-other";
    const stimuliTriageRoot = join(
      project,
      ".apparat",
      "meditations",
      "stimuli",
      ".triage",
    );
    mkdirSync(join(stimuliTriageRoot, targetId), { recursive: true });
    mkdirSync(join(stimuliTriageRoot, otherId), { recursive: true });
    writeFileSync(join(stimuliTriageRoot, otherId, "lens.md"), "keep");

    gcRunScopedArtefactsOnSuccess(project, targetId);

    expect(existsSync(join(stimuliTriageRoot, targetId))).toBe(false);
    expect(existsSync(join(stimuliTriageRoot, otherId))).toBe(true);
  });
});
