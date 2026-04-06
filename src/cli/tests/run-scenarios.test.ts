import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";
import {
  parseScenarioHeader,
  slugify,
  discoverScenarios,
  buildScenarioPrompt,
} from "../commands/run-scenarios";

let tmpDir: string;

beforeEach(() => {
  tmpDir = mkdtempSync(join(tmpdir(), "ralph-scenarios-test-"));
});

afterEach(() => {
  rmSync(tmpDir, { recursive: true, force: true });
});

describe("slugify", () => {
  it("converts name to kebab-case", () => {
    expect(slugify("Auth Flow Integration")).toBe("auth-flow-integration");
  });

  it("handles special characters and extra spaces", () => {
    expect(slugify("API: Contract Tests!")).toBe("api-contract-tests");
  });

  it("strips leading and trailing hyphens", () => {
    expect(slugify("  My Test  ")).toBe("my-test");
  });
});

describe("parseScenarioHeader", () => {
  it("parses # prefixed header (shell style)", () => {
    const file = join(tmpDir, "test.sh");
    writeFileSync(file, "#!/bin/bash\n# @name: Auth Test\n# @description: Tests auth flow\n");
    expect(parseScenarioHeader(file)).toEqual({ name: "Auth Test", description: "Tests auth flow" });
  });

  it("parses // prefixed header (Go/JS style)", () => {
    const file = join(tmpDir, "test.go");
    writeFileSync(file, "// @name: Go Integration\n// @description: Tests API contracts\n");
    expect(parseScenarioHeader(file)).toEqual({ name: "Go Integration", description: "Tests API contracts" });
  });

  it("parses -- prefixed header (SQL style)", () => {
    const file = join(tmpDir, "test.sql");
    writeFileSync(file, "-- @name: Migration Test\n-- @description: Verifies schema\n");
    expect(parseScenarioHeader(file)).toEqual({ name: "Migration Test", description: "Verifies schema" });
  });

  it("returns empty strings when no header found", () => {
    const file = join(tmpDir, "test.sh");
    writeFileSync(file, "#!/bin/bash\necho hello\n");
    expect(parseScenarioHeader(file)).toEqual({ name: "", description: "" });
  });

  it("returns empty description when only @name is present", () => {
    const file = join(tmpDir, "test.sh");
    writeFileSync(file, "# @name: Only Name\necho hi\n");
    expect(parseScenarioHeader(file)).toEqual({ name: "Only Name", description: "" });
  });

  it("only reads the first 10 lines", () => {
    const lines = Array.from({ length: 12 }, (_, i) => `# line${i}`);
    lines[11] = "# @name: Too Late";
    const file = join(tmpDir, "test.sh");
    writeFileSync(file, lines.join("\n"));
    expect(parseScenarioHeader(file)).toEqual({ name: "", description: "" });
  });
});

describe("discoverScenarios", () => {
  it("returns empty array when scenario-tests/ folder is absent", () => {
    expect(discoverScenarios(tmpDir)).toEqual([]);
  });

  it("discovers files in scenario-tests/", () => {
    mkdirSync(join(tmpDir, "scenario-tests"));
    writeFileSync(
      join(tmpDir, "scenario-tests", "test-auth.sh"),
      "#!/bin/bash\n# @name: Auth Test\n# @description: Tests auth\n"
    );
    const results = discoverScenarios(tmpDir);
    expect(results).toHaveLength(1);
    expect(results[0].name).toBe("Auth Test");
    expect(results[0].description).toBe("Tests auth");
    expect(results[0].filename).toBe("test-auth.sh");
  });

  it("falls back to filename (without extension) when no header", () => {
    mkdirSync(join(tmpDir, "scenario-tests"));
    writeFileSync(join(tmpDir, "scenario-tests", "my-scenario.sh"), "#!/bin/bash\necho hi\n");
    const results = discoverScenarios(tmpDir);
    expect(results[0].name).toBe("my-scenario");
    expect(results[0].description).toBe("");
  });

  it("ignores subdirectories inside scenario-tests/", () => {
    const scenDir = join(tmpDir, "scenario-tests");
    mkdirSync(scenDir);
    mkdirSync(join(scenDir, "subdir"));
    writeFileSync(join(scenDir, "test.sh"), "# @name: Real\n# @description: desc\n");
    const results = discoverScenarios(tmpDir);
    expect(results).toHaveLength(1);
    expect(results[0].name).toBe("Real");
  });
});

describe("buildScenarioPrompt", () => {
  it("substitutes all four placeholders", () => {
    const template =
      "Run {{SCRIPT_PATH}} → {{OUTPUT_PATH}} for {{SCENARIO_NAME}}: {{SCENARIO_DESCRIPTION}}";
    const result = buildScenarioPrompt(
      template,
      "Auth Test",
      "Tests auth flow",
      "/project/scenario-tests/test.sh",
      "/project/scenario-runs/out.md"
    );
    expect(result).toBe(
      "Run /project/scenario-tests/test.sh → /project/scenario-runs/out.md for Auth Test: Tests auth flow"
    );
  });

  it("replaces all occurrences of each placeholder", () => {
    const template = "{{SCENARIO_NAME}} and {{SCENARIO_NAME}}";
    const result = buildScenarioPrompt(template, "My Test", "", "", "");
    expect(result).toBe("My Test and My Test");
  });
});
