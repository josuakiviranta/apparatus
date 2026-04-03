import { describe, it, expect } from "vitest";
import {
  cronId,
  buildCronExpression,
  isCleanInterval,
  buildCronLine,
  insertCronEntry,
  deleteCronEntry,
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
