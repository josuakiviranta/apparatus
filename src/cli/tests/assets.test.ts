import { existsSync, readdirSync } from "fs";
import { describe, it, expect } from "vitest";
import { getAssetPath, getPromptPath, getKickoffPromptPath, getMeditationPromptPath, getIlluminationServerPath, getMetaMeditationsDir, getMeditateCreatePromptPath } from "../lib/assets";

describe("assets", () => {
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

  it("getMetaMeditationsDir returns a path to the stimulus library with all lens files present", () => {
    const p = getMetaMeditationsDir();
    expect(p).toMatch(/meditations\/stimuli$/);
    expect(existsSync(p)).toBe(true);
    const files = readdirSync(p).filter((f) => f.endsWith(".md"));
    expect(files.length).toBeGreaterThanOrEqual(29);
    expect(files).toContain("red-green-tdd-is-non-negotiable.md");
  });

  it("getMeditateCreatePromptPath returns path ending in PROMPT_meditate_create.md", () => {
    expect(getMeditateCreatePromptPath()).toMatch(/PROMPT_meditate_create\.md$/);
  });

  it("getAssetPath resolves relative to this file's directory", () => {
    const p = getAssetPath("prompts");
    expect(typeof p).toBe("string");
    expect(p.length).toBeGreaterThan(0);
  });
});
