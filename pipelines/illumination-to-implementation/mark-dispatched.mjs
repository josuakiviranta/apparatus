import fs from "node:fs";

const [, , illuminationPath, planPath] = process.argv;
if (!illuminationPath || !planPath) {
  console.error("usage: mark-dispatched.mjs <illumination> <plan>");
  process.exit(2);
}

const today = new Date().toISOString().slice(0, 10);
const raw = fs.readFileSync(illuminationPath, "utf8");
const parts = raw.split("---\n");
if (parts.length < 3) {
  console.error("no frontmatter");
  process.exit(1);
}

const statusMatch = parts[1].match(/status:\s*(.+)\n/);
const status = statusMatch ? statusMatch[1].trim() : "";

if (status === "dispatched") {
  const existingPlan = parts[1].match(/plan_path:\s*(.+)\n/)?.[1].trim();
  if (existingPlan === planPath) {
    console.log(JSON.stringify({ marked_dispatched: illuminationPath, idempotent: true }));
    process.exit(0);
  }
  console.error(`already dispatched to a different plan: ${existingPlan} (wanted ${planPath})`);
  process.exit(1);
}

if (status !== "open") {
  console.error(`status not open: ${status}`);
  process.exit(1);
}

const frontmatter =
  parts[1].replace(/status:\s*open\n/, "status: dispatched\n") +
  `dispatched_at: ${today}\n` +
  `plan_path: ${planPath}\n`;

fs.writeFileSync(
  illuminationPath,
  `---\n${frontmatter}---\n${parts.slice(2).join("---\n")}`,
);
console.log(JSON.stringify({ marked_dispatched: illuminationPath }));
