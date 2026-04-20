import fs from "node:fs";

const [illuminationPath, ...reasonArgs] = process.argv.slice(2);
if (!illuminationPath || reasonArgs.length === 0) {
  console.error("usage: mark-archived.mjs <illumination> <reason-or-reason-file>");
  process.exit(2);
}
const reasonArg = reasonArgs.join(" ");

// Arg2 is either a path to a reason file (used on the invalid path when the
// reason is multi-word prose) or a literal reason string (decline path).
// Resolve to the actual reason text here.
let reason;
if (fs.existsSync(reasonArg) && fs.statSync(reasonArg).isFile()) {
  reason = fs.readFileSync(reasonArg, "utf8");
} else {
  reason = reasonArg;
}
// Collapse newlines and consecutive whitespace so the YAML `reason:` line
// stays single-line regardless of how the caller framed the prose.
reason = reason.replace(/\s+/g, " ").trim();

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
  const existingReason = parts[1].match(/reason:\s*(.+)\n/)?.[1].trim();
  if (existingReason === reason) {
    console.log(JSON.stringify({ marked_archived: illuminationPath, idempotent: true }));
    process.exit(0);
  }
  console.error(`already archived with a different reason: ${existingReason} (wanted ${reason})`);
  process.exit(1);
}

if (status !== "open") {
  console.error(`status not open: ${status}`);
  process.exit(1);
}

const frontmatter =
  parts[1].replace(/status:\s*open\n/, "status: archived\n") +
  `archived_at: ${today}\n` +
  `reason: ${reason}\n`;

fs.writeFileSync(
  illuminationPath,
  `---\n${frontmatter}---\n${parts.slice(2).join("---\n")}`,
);
console.log(JSON.stringify({ marked_archived: illuminationPath }));
