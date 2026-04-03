import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync, existsSync, readFileSync, writeFileSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";
import {
  cronId,
  buildCronExpression,
  isCleanInterval,
  buildCronLine,
  insertCronEntry,
  deleteCronEntry,
  readSentinel,
  writeSentinel,
  removeSentinel,
  ensureMeditationDirs,
  appendMeditateGitignore,
  MeditationSentinel,
} from "../commands/meditate";

describe("cronId", () => {
  it("returns ralph-meditate-<basename>", () => {
    expect(cronId("/home/user/my-project")).toBe("ralph-meditate-my-project");
    expect(cronId("/projects/foo-bar")).toBe("ralph-meditate-foo-bar");
  });
});

describe("buildCronExpression", () => {
  it("returns */N * * * * for given minutes", () => {
    expect(buildCronExpression(30)).toBe("*/30 * * * *");
    expect(buildCronExpression(60)).toBe("*/60 * * * *");
    expect(buildCronExpression(15)).toBe("*/15 * * * *");
  });
});

describe("isCleanInterval", () => {
  it("returns true for values that divide 60", () => {
    for (const n of [1, 2, 3, 4, 5, 6, 10, 12, 15, 20, 30, 60]) {
      expect(isCleanInterval(n), `${n} should be clean`).toBe(true);
    }
  });

  it("returns false for values that do not divide 60", () => {
    for (const n of [7, 11, 13, 17, 25, 45]) {
      expect(isCleanInterval(n), `${n} should not be clean`).toBe(false);
    }
  });
});

describe("buildCronLine", () => {
  it("includes the cron expression, ralph meditate command, and bash log redirect", () => {
    const line = buildCronLine("/abs/project", 30);
    expect(line).toContain("*/30 * * * *");
    expect(line).toContain("ralph meditate /abs/project");
    expect(line).toContain(".meditate.log");
    expect(line).toContain("&>>");
  });
});

describe("insertCronEntry", () => {
  it("appends cron line and anchor to empty crontab", () => {
    const result = insertCronEntry("", "*/30 * * * * ralph meditate /p >> /p/.meditate.log 2>&1", "# ralph-meditate-p");
    expect(result).toContain("*/30 * * * *");
    expect(result).toContain("# ralph-meditate-p");
  });

  it("appends to existing crontab with newline separator", () => {
    const existing = "0 * * * * some-other-job\n";
    const result = insertCronEntry(existing, "*/30 * * * * ralph meditate /p >> /p/.meditate.log 2>&1", "# ralph-meditate-p");
    expect(result).toContain("some-other-job");
    expect(result).toContain("# ralph-meditate-p");
  });

  it("is idempotent — does not insert twice if anchor already present", () => {
    const existing = "*/30 * * * * ralph meditate /p >> /p/.meditate.log 2>&1\n# ralph-meditate-p\n";
    const result = insertCronEntry(existing, "*/30 * * * * ralph meditate /p >> /p/.meditate.log 2>&1", "# ralph-meditate-p");
    expect(result).toBe(existing);
  });
});

describe("deleteCronEntry", () => {
  it("removes cron line and anchor from crontab", () => {
    const crontab = "0 * * * * other-job\n*/30 * * * * ralph meditate /p >> /p/.meditate.log 2>&1\n# ralph-meditate-p\n";
    const result = deleteCronEntry(crontab, "# ralph-meditate-p");
    expect(result).not.toContain("# ralph-meditate-p");
    expect(result).not.toContain("ralph meditate /p");
    expect(result).toContain("other-job");
  });

  it("returns crontab unchanged if anchor not found", () => {
    const crontab = "0 * * * * other-job\n";
    expect(deleteCronEntry(crontab, "# ralph-meditate-missing")).toBe(crontab);
  });
});

let tmpDir: string;

beforeEach(() => {
  tmpDir = mkdtempSync(join(tmpdir(), "ralph-meditate-test-"));
});

afterEach(() => {
  rmSync(tmpDir, { recursive: true, force: true });
});

describe("readSentinel", () => {
  it("returns null when .meditate.json does not exist", () => {
    expect(readSentinel(tmpDir)).toBeNull();
  });

  it("returns parsed sentinel when .meditate.json exists", () => {
    const sentinel = { every: 30, cronId: "ralph-meditate-proj" };
    writeFileSync(join(tmpDir, ".meditate.json"), JSON.stringify(sentinel));
    expect(readSentinel(tmpDir)).toEqual(sentinel);
  });
});

describe("writeSentinel / removeSentinel", () => {
  it("writes and reads back a sentinel", () => {
    const sentinel: MeditationSentinel = {
      every: 60,
      until: "2026-04-05T08:00:00",
      cronId: "ralph-meditate-test",
    };
    writeSentinel(tmpDir, sentinel);
    expect(existsSync(join(tmpDir, ".meditate.json"))).toBe(true);
    expect(readSentinel(tmpDir)).toEqual(sentinel);
  });

  it("removeSentinel deletes the file if present", () => {
    writeSentinel(tmpDir, { every: 30, cronId: "ralph-meditate-test" });
    removeSentinel(tmpDir);
    expect(existsSync(join(tmpDir, ".meditate.json"))).toBe(false);
  });

  it("removeSentinel is a no-op if file does not exist", () => {
    expect(() => removeSentinel(tmpDir)).not.toThrow();
  });
});

describe("ensureMeditationDirs", () => {
  it("creates meditations/illuminations/ nested structure", () => {
    ensureMeditationDirs(tmpDir);
    expect(existsSync(join(tmpDir, "meditations", "illuminations"))).toBe(true);
  });

  it("is idempotent — does not throw if dirs already exist", () => {
    ensureMeditationDirs(tmpDir);
    expect(() => ensureMeditationDirs(tmpDir)).not.toThrow();
  });
});

describe("appendMeditateGitignore", () => {
  it("adds .meditate.json and .meditate.log to .gitignore", () => {
    appendMeditateGitignore(tmpDir);
    const content = readFileSync(join(tmpDir, ".gitignore"), "utf8");
    expect(content).toContain(".meditate.json");
    expect(content).toContain(".meditate.log");
  });

  it("creates .gitignore if it does not exist", () => {
    expect(existsSync(join(tmpDir, ".gitignore"))).toBe(false);
    appendMeditateGitignore(tmpDir);
    expect(existsSync(join(tmpDir, ".gitignore"))).toBe(true);
  });

  it("does not duplicate entries if called twice", () => {
    appendMeditateGitignore(tmpDir);
    appendMeditateGitignore(tmpDir);
    const content = readFileSync(join(tmpDir, ".gitignore"), "utf8");
    const count = (content.match(/\.meditate\.json/g) ?? []).length;
    expect(count).toBe(1);
  });
});
