import { describe, it, expect } from "vitest";
import { homedir } from "os";
import { join } from "path";
import { claudeTracePath } from "../lib/claudeTracePath.js";

describe("claudeTracePath", () => {
  it("encodes the project directory by replacing / with -", () => {
    const p = claudeTracePath("sid-abc", "/home/dev/projects/apparatus");
    expect(p).toBe(
      join(
        homedir(),
        ".claude",
        "projects",
        "-home-dev-projects-apparatus",
        "sid-abc.jsonl",
      ),
    );
  });

  it("handles a nested project directory with multiple segments", () => {
    const p = claudeTracePath("xyz", "/a/b/c");
    expect(p).toBe(join(homedir(), ".claude", "projects", "-a-b-c", "xyz.jsonl"));
  });

  it("appends .jsonl to the sessionId", () => {
    const p = claudeTracePath("fake-uuid", "/tmp");
    expect(p.endsWith("/fake-uuid.jsonl")).toBe(true);
  });

  it("defaults projectDir to process.cwd() when omitted", () => {
    const p = claudeTracePath("sid");
    const encoded = process.cwd().replace(/\//g, "-");
    expect(p).toBe(join(homedir(), ".claude", "projects", encoded, "sid.jsonl"));
  });
});
