import { describe, it, expect } from "vitest";
import { newRunId } from "../lib/apparat-paths.js";

describe("newRunId(pipelineName) slug shape", () => {
  it("returns <slug>-<uuid8> when given a simple name", () => {
    expect(newRunId("meditate")).toMatch(/^meditate-[0-9a-f]{8}$/);
  });

  it("preserves hyphens in compound names", () => {
    expect(newRunId("illumination-to-implementation"))
      .toMatch(/^illumination-to-implementation-[0-9a-f]{8}$/);
  });

  it("lower-cases and collapses runs of non-alphanumeric chars to a single dash", () => {
    expect(newRunId("My Pipeline!")).toMatch(/^my-pipeline-[0-9a-f]{8}$/);
    expect(newRunId("Foo___Bar  Baz")).toMatch(/^foo-bar-baz-[0-9a-f]{8}$/);
  });

  it("trims leading/trailing dashes from slug", () => {
    expect(newRunId("--weird--")).toMatch(/^weird-[0-9a-f]{8}$/);
  });

  it("caps slug length at 40 chars before the dash+uuid8", () => {
    const long = "a".repeat(80);
    const id = newRunId(long);
    const slug = id.slice(0, id.length - 9); // strip "-<8hex>"
    expect(slug.length).toBeLessThanOrEqual(40);
    expect(id).toMatch(/^a{1,40}-[0-9a-f]{8}$/);
  });

  it("falls back to bare uuid8 when slug would be empty (e.g. only special chars)", () => {
    expect(newRunId("!!!")).toMatch(/^[0-9a-f]{8}$/);
  });

  it("returns a different id on each call (collision-resistant)", () => {
    expect(newRunId("x")).not.toBe(newRunId("x"));
  });
});

describe("newRunId() — no-arg back-compat", () => {
  it("returns the bare 8-char hex shape (daemon-side path)", () => {
    expect(newRunId()).toMatch(/^[0-9a-f]{8}$/);
  });
});
