import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";

const [illuminationArg, reason] = process.argv.slice(2);
if (!illuminationArg || !reason) {
  console.error("usage: consume.mjs <illumination-path> <implemented|declined>");
  process.exit(2);
}
if (reason !== "implemented" && reason !== "declined") {
  console.error("reason must be implemented or declined");
  process.exit(2);
}

const illuminationPath = path.resolve(illuminationArg);
if (!fs.existsSync(illuminationPath)) {
  console.error(`illumination not found: ${illuminationPath}`);
  process.exit(1);
}

const filename = path.basename(illuminationPath);
const meditationsDir = path.dirname(path.dirname(illuminationPath));
const projectRoot = path.dirname(meditationsDir);

fs.rmSync(illuminationPath);

try {
  execFileSync("git", ["-C", projectRoot, "rm", illuminationPath], { stdio: "ignore" });
  execFileSync(
    "git",
    ["-C", projectRoot, "commit", "-m", `meditate: consume ${filename} (${reason})`],
    { stdio: "ignore" },
  );
} catch {
  // git unavailable / not a repo / nothing to commit — non-fatal, file already removed.
}

console.log(JSON.stringify({ success: true, filename, reason }));
