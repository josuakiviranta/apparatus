import { describe, it, expect } from "vitest";
import { resolveProjectFromArgs, injectRunArgs } from "../runner-args.js";

describe("resolveProjectFromArgs", () => {
  it("returns the value following --project", () => {
    expect(resolveProjectFromArgs(["pipeline.dot", "--project", "/work/app"])).toBe("/work/app");
  });

  it("returns null when --project is absent", () => {
    expect(resolveProjectFromArgs(["pipeline.dot"])).toBe(null);
  });

  it("returns null when --project is the last arg with no value", () => {
    expect(resolveProjectFromArgs(["pipeline.dot", "--project"])).toBe(null);
  });

  it("tolerates --project appearing anywhere in argv", () => {
    expect(resolveProjectFromArgs(["--project", "/work/app", "pipeline.dot"])).toBe("/work/app");
  });
});

describe("injectRunArgs", () => {
  it("appends --run-id and --logs-root", () => {
    const out = injectRunArgs(["pipeline.dot", "--project", "/work/app"], "abcd1234", "/work/app/.apparat/runs/abcd1234");
    expect(out).toEqual([
      "pipeline.dot",
      "--project", "/work/app",
      "--run-id", "abcd1234",
      "--logs-root", "/work/app/.apparat/runs/abcd1234",
    ]);
  });

  it("is idempotent: skips --run-id if already present", () => {
    const out = injectRunArgs(
      ["pipeline.dot", "--run-id", "manualxx"],
      "abcd1234",
      "/runs/abcd1234",
    );
    // --run-id already present → keep manualxx, only inject --logs-root
    expect(out).toContain("manualxx");
    expect(out).not.toContain("abcd1234");
    expect(out).toContain("--logs-root");
  });

  it("is idempotent: skips --logs-root if already present", () => {
    const out = injectRunArgs(
      ["pipeline.dot", "--logs-root", "/manual/path"],
      "abcd1234",
      "/runs/abcd1234",
    );
    expect(out).toContain("/manual/path");
    expect(out).not.toContain("/runs/abcd1234");
    expect(out).toContain("--run-id");
  });

  it("does not mutate the input array", () => {
    const input = ["pipeline.dot"];
    injectRunArgs(input, "abcd1234", "/runs/abcd1234");
    expect(input).toEqual(["pipeline.dot"]);
  });
});
