import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const DOT = resolve(__dirname, "../illumination-to-implementation.dot");
const SCHEMA = resolve(__dirname, "../schemas/verifier.json");
const RUBRIC = resolve(__dirname, "../../src/cli/agents/verifier.md");

describe("illumination-to-implementation.dot — archive_reason_short wiring", () => {
  const dot = readFileSync(DOT, "utf8");

  it("verifier node's produces= list includes archive_reason_short", () => {
    const verifierLine = dot.split("\n").find((l) => l.includes('agent="verifier"'));
    expect(verifierLine).toBeDefined();
    expect(verifierLine).toMatch(/produces="[^"]*\barchive_reason_short\b[^"]*"/);
  });

  it("mark_archived node passes $archive_reason_short, not $choice", () => {
    const match = dot.match(/mark_archived\s*\[[^\]]*script_args="([^"]+)"/s);
    expect(match).not.toBeNull();
    expect(match![1]).toContain("$archive_reason_short");
    expect(match![1]).not.toContain("$choice");
  });

  it("mark_archived node does not declare default_archive_reason_short (verifier always emits)", () => {
    const match = dot.match(/mark_archived\s*\[[^\]]*default_archive_reason_short=/s);
    expect(match).toBeNull();
  });
});

describe("verifier.json schema — archive_reason_short property", () => {
  const schema = JSON.parse(readFileSync(SCHEMA, "utf8"));

  it("declares archive_reason_short as a required string property (verifier always emits)", () => {
    expect(schema.properties.archive_reason_short).toBeDefined();
    expect(schema.properties.archive_reason_short.type).toBe("string");
    expect(schema.required).toContain("archive_reason_short");
  });

  it("preserves additionalProperties: false", () => {
    expect(schema.additionalProperties).toBe(false);
  });
});

describe("verifier.md rubric — archive_reason_short rule", () => {
  const rubric = readFileSync(RUBRIC, "utf8");

  it("mentions archive_reason_short in Output section and Hard rules", () => {
    expect(rubric).toMatch(/archive_reason_short/);
    expect(rubric).toMatch(/MUST emit `archive_reason_short`/);
  });
});
