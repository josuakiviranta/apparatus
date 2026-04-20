import { describe, expect, it } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

const REPO_ROOT = process.cwd();
const SCHEMAS_DIR = join(REPO_ROOT, "pipelines", "schemas");
const FIXTURES_DIR = join(REPO_ROOT, "src", "cli", "tests", "__fixtures__", "schemas");
const MAX_DESCRIPTION_LENGTH = 160;

// Fields whose description carries content rules (not prose shape) that a
// rubric cannot enforce. Each entry requires an inline justification.
const ALLOW_LIST = new Set<string>([
  // allow-listed: shell-safety metacharacter ban + emit-when semantics
  // are downstream-script content rules, not prose-rendering shape.
  "verifier.json:archive_reason_short",
]);

const BANNED_WORDS = [
  "section",
  "sections",
  "bullet",
  "bullets",
  "heading",
  "headings",
  "tier",
  "tiers",
];
const BANNED_LITERALS = ["##", "###", "MUST lead"];
const NUMERIC_SHAPE_RE =
  /\b(max|≤|<=|at most|up to)\s*\d+\s*(word|words|sentence|sentences|paragraph|paragraphs|bullet|bullets|char|chars|characters)\b/i;
// Augments the design's numeric regex to catch bare ranges like "3-5 short sentences"
// or "1 to 3 bullets" — required to flag `meditate-observe.kid_summary` ("3-5 short
// sentences, no jargon") on the pre-rewrite tree. Without this augmentation the field
// passes the length check (79 chars) and the design's `max N` regex does not match
// bare ranges, so red-phase enforcement would miss it. Documented in plan Chunk 1 notes.
const NUMERIC_RANGE_RE =
  /\b\d+\s*(?:[-–—]|\s+to\s+)\s*\d+\s+(?:short\s+|long\s+)?(word|words|sentence|sentences|paragraph|paragraphs|bullet|bullets)\b/i;

interface Violation {
  file: string;
  path: string;
  description: string;
  reason: string;
}

function collectDescriptions(
  node: unknown,
  path: string[],
  out: Array<{ path: string; description: string }>,
): void {
  if (!node || typeof node !== "object") return;
  const obj = node as Record<string, unknown>;
  if (typeof obj.description === "string") {
    out.push({ path: path.join("."), description: obj.description });
  }
  if (obj.properties && typeof obj.properties === "object") {
    for (const [k, v] of Object.entries(obj.properties as Record<string, unknown>)) {
      collectDescriptions(v, [...path, "properties", k], out);
    }
  }
  if (obj.items) collectDescriptions(obj.items, [...path, "items"], out);
}

function fieldKey(file: string, path: string): string {
  const leafMatch = path.match(/properties\.([^.]+)\.?$/);
  const leaf = leafMatch ? leafMatch[1] : path || "<root>";
  return `${file}:${leaf}`;
}

function lintSchema(file: string): Violation[] {
  const full = join(SCHEMAS_DIR, file);
  const schema = JSON.parse(readFileSync(full, "utf8"));
  const descriptions: Array<{ path: string; description: string }> = [];
  collectDescriptions(schema, [], descriptions);

  const violations: Violation[] = [];
  for (const { path, description } of descriptions) {
    const key = fieldKey(file, path);
    if (ALLOW_LIST.has(key)) continue;

    if (description.length > MAX_DESCRIPTION_LENGTH) {
      violations.push({
        file,
        path,
        description,
        reason: `description length ${description.length} > ${MAX_DESCRIPTION_LENGTH}`,
      });
    }

    const lower = description.toLowerCase();
    for (const word of BANNED_WORDS) {
      const re = new RegExp(`\\b${word}\\b`, "i");
      if (re.test(description)) {
        violations.push({
          file,
          path,
          description,
          reason: `contains banned shape vocabulary '${word}'`,
        });
      }
    }
    for (const lit of BANNED_LITERALS) {
      if (lower.includes(lit.toLowerCase())) {
        violations.push({
          file,
          path,
          description,
          reason: `contains banned shape literal '${lit}'`,
        });
      }
    }
    const numericHit = description.match(NUMERIC_SHAPE_RE);
    if (numericHit) {
      violations.push({
        file,
        path,
        description,
        reason: `contains numeric shape pattern '${numericHit[0]}'`,
      });
    }
    const rangeHit = description.match(NUMERIC_RANGE_RE);
    if (rangeHit) {
      violations.push({
        file,
        path,
        description,
        reason: `contains numeric range shape pattern '${rangeHit[0]}'`,
      });
    }
  }
  return violations;
}

function formatViolation(v: Violation): string {
  return (
    `pipelines/schemas/${v.file}:${v.path} ${v.reason}. ` +
    `Output shape lives in the agent rubric, not the schema description. ` +
    `See specs/pipeline.md § Agent Schema Descriptions.`
  );
}

describe("pipelines/schemas/*.json description shape-vocabulary lint", () => {
  const files = readdirSync(SCHEMAS_DIR).filter((f) => f.endsWith(".json"));

  for (const file of files) {
    it(`${file} descriptions do not encode output shape`, () => {
      const violations = lintSchema(file);
      if (violations.length > 0) {
        throw new Error(
          `schema description lint failed:\n${violations.map(formatViolation).join("\n")}`,
        );
      }
      expect(violations).toEqual([]);
    });
  }

  it("fixture: description-ok.json passes", () => {
    const full = join(FIXTURES_DIR, "description-ok.json");
    const schema = JSON.parse(readFileSync(full, "utf8"));
    const descriptions: Array<{ path: string; description: string }> = [];
    collectDescriptions(schema, [], descriptions);
    const offenders = descriptions.filter(({ description }) => {
      return (
        description.length > MAX_DESCRIPTION_LENGTH ||
        BANNED_WORDS.some((w) => new RegExp(`\\b${w}\\b`, "i").test(description)) ||
        BANNED_LITERALS.some((l) => description.toLowerCase().includes(l.toLowerCase())) ||
        NUMERIC_SHAPE_RE.test(description) ||
        NUMERIC_RANGE_RE.test(description)
      );
    });
    expect(offenders).toEqual([]);
  });

  it("fixture: description-bad.json fails", () => {
    const full = join(FIXTURES_DIR, "description-bad.json");
    const schema = JSON.parse(readFileSync(full, "utf8"));
    const descriptions: Array<{ path: string; description: string }> = [];
    collectDescriptions(schema, [], descriptions);
    const offenders = descriptions.filter(({ description }) => {
      return (
        description.length > MAX_DESCRIPTION_LENGTH ||
        BANNED_WORDS.some((w) => new RegExp(`\\b${w}\\b`, "i").test(description)) ||
        BANNED_LITERALS.some((l) => description.toLowerCase().includes(l.toLowerCase())) ||
        NUMERIC_SHAPE_RE.test(description) ||
        NUMERIC_RANGE_RE.test(description)
      );
    });
    expect(offenders.length).toBeGreaterThan(0);
  });
});
