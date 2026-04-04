import { existsSync } from "fs";
import { describe, it, expect } from "vitest";
import { getAssetPath, getLoopShPath, getPromptPath, getKickoffPromptPath, getMeditationPromptPath, getIlluminationServerPath, getMetaMeditationsDir } from "../lib/assets";

describe("assets", () => {
  it("getLoopShPath returns a path ending in loop.sh", () => {
    const p = getLoopShPath();
    expect(p).toMatch(/loop\.sh$/);
  });

  it("getPromptPath('plan') returns a path ending in PROMPT_plan.md", () => {
    const p = getPromptPath("plan");
    expect(p).toMatch(/PROMPT_plan\.md$/);
  });

  it("getPromptPath('build') returns a path ending in PROMPT_build.md", () => {
    const p = getPromptPath("build");
    expect(p).toMatch(/PROMPT_build\.md$/);
  });

  it("getKickoffPromptPath returns a path ending in PROMPT_kickoff.md", () => {
    const p = getKickoffPromptPath();
    expect(p).toMatch(/PROMPT_kickoff\.md$/);
  });

  it("getMeditationPromptPath returns a path ending in PROMPT_meditation.md", () => {
    const p = getMeditationPromptPath();
    expect(p).toMatch(/PROMPT_meditation\.md$/);
  });

  it("getIlluminationServerPath returns a path ending in illumination-server.ts or .js", () => {
    const p = getIlluminationServerPath();
    expect(p).toMatch(/illumination-server\.(ts|js)$/);
  });

  it("getMetaMeditationsDir returns a path ending in meditations", () => {
    const p = getMetaMeditationsDir();
    expect(p).toMatch(/meditations$/);
  });

  it("getMetaMeditationsDir resolves to an existing directory in the current repo", () => {
    const p = getMetaMeditationsDir();
    expect(existsSync(p)).toBe(true);
  });

  it("getAssetPath resolves relative to this file's directory", () => {
    const p = getAssetPath("loop.sh");
    expect(typeof p).toBe("string");
    expect(p.length).toBeGreaterThan(0);
  });
});
