import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";

const [illuminationArg, ...reasonArgs] = process.argv.slice(2);
if (!illuminationArg || reasonArgs.length === 0) {
  console.error("usage: mark-archived.mjs <illumination> <reason-or-reason-file>");
  process.exit(2);
}
const illuminationPath = path.resolve(illuminationArg);

const reasonArg = reasonArgs.join(" ");
let reason;
if (fs.existsSync(reasonArg) && fs.statSync(reasonArg).isFile()) {
  reason = fs.readFileSync(reasonArg, "utf8");
} else {
  reason = reasonArg;
}
reason = reason.replace(/\s+/g, " ").trim();

const filename = path.basename(illuminationPath);
const meditationsDir = path.dirname(path.dirname(illuminationPath));
const projectRoot = path.dirname(meditationsDir);
const targetDir = path.join(meditationsDir, "archived-illuminations");
const targetPath = path.join(targetDir, filename);

const today = new Date().toISOString().slice(0, 10);
const raw = fs.readFileSync(illuminationPath, "utf8");
const parts = raw.split("---\n");
if (parts.length < 3) {
  console.error("no frontmatter");
  process.exit(1);
}

const statusMatch = parts[1].match(/status:\s*(.+)\n/);
const status = statusMatch ? statusMatch[1].trim() : "";

if (status === "archived") {
  // Idempotent: already archived. File may already live in the new dir or still in the old.
  const archivePathRel = path.relative(
    projectRoot,
    fs.existsSync(targetPath) ? targetPath : illuminationPath,
  );
  console.log(JSON.stringify({
    marked_archived: illuminationPath,
    archive_path: archivePathRel,
    idempotent: true,
  }));
  process.exit(0);
}

if (status !== "open") {
  console.error(`status not open: ${status}`);
  process.exit(1);
}

const frontmatter =
  parts[1].replace(/status:\s*open\n/, "status: archived\n") +
  `archived_at: ${today}\n` +
  `reason: ${reason}\n`;
const updated = `---\n${frontmatter}---\n${parts.slice(2).join("---\n")}`;

fs.mkdirSync(targetDir, { recursive: true });
fs.writeFileSync(targetPath, updated);
fs.rmSync(illuminationPath);

try {
  execFileSync("git", ["-C", projectRoot, "add", "-A", "meditations"], { stdio: "ignore" });
  execFileSync("git", ["-C", projectRoot, "commit", "-m", `meditate: archive ${filename} (${reason})`], { stdio: "ignore" });
} catch {
  // git unavailable / nothing to commit — non-fatal.
}

const archivePathRel = path.relative(projectRoot, targetPath);
console.log(JSON.stringify({ marked_archived: illuminationPath, archive_path: archivePathRel }));
