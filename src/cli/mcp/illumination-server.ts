import { mkdirSync, writeFileSync, statSync, readFileSync, readdirSync, existsSync, rmSync } from "fs";
import { execSync } from "node:child_process";
import { join, resolve, isAbsolute, relative } from "path";
import ignore from "ignore";
import fg from "fast-glob";
import { illuminationsDir, stimuliDir } from "../lib/apparat-paths.js";

// ─── Exported pure helpers (for testing) ──────────────────────────────────────

const FILENAME_RE = /^[\w-]+\.md$/;
const SLUG_RE = /^[a-z0-9][a-z0-9-]*$/;

export function validateFilename(filename: string): string | null {
  if (!FILENAME_RE.test(filename)) {
    return `Invalid filename "${filename}". Must match [\\w-]+\\.md (no slashes, colons, or path components).`;
  }
  return null;
}

export function validateSlug(slug: string): string | null {
  if (!slug) return "slug is required";
  if (!SLUG_RE.test(slug)) {
    return `Invalid slug "${slug}". Must be lowercase alphanumeric with hyphens (e.g. "janitor-doc-drift").`;
  }
  return null;
}

export function composeIlluminationFilename(slug: string, now: Date = new Date()): string {
  const err = validateSlug(slug);
  if (err) throw new Error(err);
  const yyyy = String(now.getFullYear()).padStart(4, "0");
  const mm = String(now.getMonth() + 1).padStart(2, "0");
  const dd = String(now.getDate()).padStart(2, "0");
  const hh = String(now.getHours()).padStart(2, "0");
  const mi = String(now.getMinutes()).padStart(2, "0");
  return `${yyyy}-${mm}-${dd}T${hh}${mi}-${slug}.md`;
}

export function writeIllumination(
  projectRoot: string,
  filename: string,
  description: string,
  content: string,
): string {
  const err = validateFilename(filename);
  if (err) throw new Error(err);
  if (!description || !description.trim()) throw new Error("description is required");
  const date = new Date().toISOString().slice(0, 10);
  const frontmatter = `---\ndate: ${date}\ndescription: ${description.trim()}\n---\n\n`;
  const dir = illuminationsDir(projectRoot);
  mkdirSync(dir, { recursive: true });
  const filePath = join(dir, filename);
  writeFileSync(filePath, frontmatter + content, "utf8");
  try {
    execSync(`git -C "${projectRoot}" add "${filePath}"`, { stdio: "ignore" });
    execSync(
      `git -C "${projectRoot}" commit -m "meditate: add illumination ${filename}"`,
      { stdio: "ignore" },
    );
  } catch {
    // git not available, not a git repo, or nothing to commit (idempotent re-run).
    // The file is already written; commit failure must not break the tool call.
  }
  return filePath;
}

export type ConsumeReason = "implemented" | "declined";

export function consume(
  projectRoot: string,
  filename: string,
  reason: ConsumeReason,
): { success: true; filename: string; reason: ConsumeReason }
  | { success: false; error: string } {
  const fnErr = validateFilename(filename);
  if (fnErr) throw new Error(fnErr);
  if (reason !== "implemented" && reason !== "declined") {
    throw new Error(`Invalid reason "${reason}". Must be "implemented" or "declined".`);
  }

  const filePath = join(illuminationsDir(projectRoot), filename);
  if (!existsSync(filePath)) {
    return { success: false, error: "Illumination file not found" };
  }

  rmSync(filePath);

  try {
    execSync(`git -C "${projectRoot}" rm "${filePath}"`, { stdio: "ignore" });
    execSync(
      `git -C "${projectRoot}" commit -m "meditate: consume ${filename} (${reason})"`,
      { stdio: "ignore" },
    );
  } catch {
    // git unavailable / not a repo / nothing to commit — non-fatal, file already removed.
  }

  return { success: true, filename, reason };
}

export function consumePlan(
  projectRoot: string,
  filename: string,
  reason: ConsumeReason,
): { success: true; filename: string; reason: ConsumeReason }
  | { success: false; error: string } {
  const fnErr = validateFilename(filename);
  if (fnErr) throw new Error(fnErr);
  if (reason !== "implemented" && reason !== "declined") {
    throw new Error(`Invalid reason "${reason}". Must be "implemented" or "declined".`);
  }

  const filePath = join(projectRoot, "docs", "superpowers", "plans", filename);
  if (!existsSync(filePath)) {
    return { success: false, error: "Plan file not found" };
  }

  rmSync(filePath);

  try {
    execSync(`git -C "${projectRoot}" rm "${filePath}"`, { stdio: "ignore" });
    execSync(
      `git -C "${projectRoot}" commit -m "meditate: consume ${filename} (${reason})"`,
      { stdio: "ignore" },
    );
  } catch {
    // git unavailable / not a repo / nothing to commit — non-fatal, file already removed.
  }

  return { success: true, filename, reason };
}

const OPEN_NOTE_RE = /^(\s*)-\s+\[ \]\s+(.+?)\s*$/;
const CLOSED_NOTE_PREFIX_RE = /^\s*-\s+\[x\]\s/;

export function parseOpenNotes(content: string): string[] {
  const out: string[] = [];
  for (const line of content.split("\n")) {
    if (CLOSED_NOTE_PREFIX_RE.test(line)) continue;
    const m = line.match(OPEN_NOTE_RE);
    if (m) out.push(m[2]);
  }
  return out;
}

export function notesFile(projectRoot: string): string {
  return join(projectRoot, ".apparat", "notes.md");
}

export type MarkNoteResult =
  | { success: true; text: string }
  | { success: false; error: string };

export function markNotePicked(projectRoot: string, text: string): MarkNoteResult {
  const filePath = notesFile(projectRoot);
  if (!existsSync(filePath)) {
    return { success: false, error: `notes.md not found at ${filePath}` };
  }
  const original = readFileSync(filePath, "utf8");
  const lines = original.split("\n");
  let flipped = false;
  for (let i = 0; i < lines.length; i++) {
    if (flipped) break;
    const m = lines[i].match(OPEN_NOTE_RE);
    if (!m) continue;
    if (m[2] !== text) continue;
    lines[i] = `${m[1]}- [x] ${m[2]}`;
    flipped = true;
  }
  if (!flipped) {
    return { success: false, error: `Open note matching "${text}" not found in notes.md` };
  }
  writeFileSync(filePath, lines.join("\n"), "utf8");
  try {
    execSync(`git -C "${projectRoot}" add "${filePath}"`, { stdio: "ignore" });
    execSync(
      `git -C "${projectRoot}" commit -m "meditate: mark note picked"`,
      { stdio: "ignore" },
    );
  } catch {
    // git unavailable / not a repo / nothing to commit — non-fatal.
  }
  return { success: true, text };
}

export function assertWithinRoot(inputPath: string, projectRoot: string): void {
  const resolvedPath = resolve(inputPath);
  const resolvedRoot = resolve(projectRoot);
  if (!resolvedPath.startsWith(resolvedRoot + "/") && resolvedPath !== resolvedRoot) {
    throw new Error("Path is outside the project folder");
  }
}

export function readFile(projectRoot: string, filePath: string): string {
  const resolvedPath = isAbsolute(filePath)
    ? filePath
    : resolve(projectRoot, filePath);
  assertWithinRoot(resolvedPath, projectRoot);
  return readFileSync(resolvedPath, "utf8");
}

export function validateGlobPattern(pattern: string): string | null {
  if (pattern.startsWith("/")) return "Pattern must be relative (cannot start with /)";
  if (pattern.split("/").some((p) => p === "..")) return "Pattern must not contain .. segments";
  return null;
}

export async function globFiles(projectRoot: string, pattern: string): Promise<string> {
  const err = validateGlobPattern(pattern);
  if (err) throw new Error(err);
  const matches = await fg(pattern, { cwd: projectRoot, dot: true });
  if (matches.length === 0) return `No files matched pattern: ${pattern}`;
  return matches.join("\n");
}

const NO_STIMULI_MESSAGE =
  "No stimuli found. You can still proceed — reflect on the project code directly " +
  "and write your illumination using write_illumination.\n\n" +
  "To add stimuli: create .md files in this project's .apparat/meditations/stimuli/ " +
  "folder. Each file is a lens the agent will use to reflect on your project.";

export function listStimuli(projectRoot: string): string {
  const dir = stimuliDir(projectRoot);
  try {
    const files = readdirSync(dir)
      .filter((f) => f.endsWith(".md"))
      .sort();
    if (files.length === 0) return NO_STIMULI_MESSAGE;
    return files
      .map((name) => `${name} — ${parseIlluminationDescription(join(dir, name))}`)
      .join("\n");
  } catch {
    return NO_STIMULI_MESSAGE;
  }
}

const NO_ILLUMINATIONS_MESSAGE = "No illuminations found.";

function parseIlluminationDescription(filePath: string): string {
  try {
    const content = readFileSync(filePath, "utf8");
    if (!content.startsWith("---\n")) return "(no description)";
    const end = content.indexOf("\n---\n", 4);
    if (end === -1) return "(no description)";
    const frontmatter = content.slice(4, end);
    const match = frontmatter.match(/^description:\s*(.+)$/m);
    return match ? match[1].trim() : "(no description)";
  } catch {
    return "(no description)";
  }
}

export function listIlluminations(projectRoot: string): string {
  const dir = illuminationsDir(projectRoot);
  let files: string[];
  try {
    files = readdirSync(dir).filter((f) => f.endsWith(".md")).sort();
  } catch {
    files = [];
  }
  if (files.length === 0) return NO_ILLUMINATIONS_MESSAGE;
  return files
    .map((name) => `${name} — ${parseIlluminationDescription(join(dir, name))}`)
    .join("\n");
}

const NO_PLANS_MESSAGE = "No plans found.";

export function parsePlanDescription(filePath: string): string {
  try {
    const content = readFileSync(filePath, "utf8");
    let body = content;
    if (content.startsWith("---\n")) {
      const end = content.indexOf("\n---\n", 4);
      if (end === -1) return "(no description)";
      body = content.slice(end + 5);
    }
    const match = body.match(/^#\s+(.+)$/m);
    return match ? match[1].trim() : "(no description)";
  } catch {
    return "(no description)";
  }
}

export function listPlans(projectRoot: string): string {
  const dir = join(projectRoot, "docs", "superpowers", "plans");
  try {
    const files = readdirSync(dir)
      .filter((f) => f.endsWith(".md"))
      .sort();
    if (files.length === 0) return NO_PLANS_MESSAGE;
    return files
      .map((f) => `${f} — ${parsePlanDescription(join(dir, f))}`)
      .join("\n");
  } catch {
    return NO_PLANS_MESSAGE;
  }
}

export function readStimulus(projectRoot: string, filename: string): string {
  const err = validateFilename(filename);
  if (err) return `Error: ${err}`;
  try {
    return readFileSync(join(stimuliDir(projectRoot), filename), "utf8");
  } catch {
    return `Error: file not found: ${filename}`;
  }
}

const SKIP_DIRS = new Set([
  ".git", "node_modules", "dist", "build", "coverage", "node-compile-cache",
]);

function buildIgnoreFilter(projectRoot: string): (relativePath: string) => boolean {
  const gitignorePath = join(projectRoot, ".gitignore");
  try {
    const content = readFileSync(gitignorePath, "utf-8");
    const ig = ignore().add(content);
    return (relativePath: string) => ig.ignores(relativePath);
  } catch {
    return () => false;
  }
}

export function projectTree(projectRoot: string, subPath?: string): string {
  const root = subPath
    ? (isAbsolute(subPath) ? subPath : resolve(projectRoot, subPath))
    : projectRoot;
  assertWithinRoot(root, projectRoot);

  const isIgnored = buildIgnoreFilter(projectRoot);

  function walk(dir: string, prefix: string): string {
    const entries = readdirSync(dir, { withFileTypes: true })
      .sort((a, b) => a.name.localeCompare(b.name));
    let out = "";
    for (const entry of entries) {
      if (!entry.isDirectory()) {
        out += `${prefix}${entry.name}\n`;
        continue;
      }
      const relativePath = relative(projectRoot, join(dir, entry.name)) + "/";
      if (SKIP_DIRS.has(entry.name) || isIgnored(relativePath)) continue;
      out += `${prefix}${entry.name}/\n`;
      out += walk(join(dir, entry.name), prefix + "  ");
    }
    return out;
  }

  const result = walk(root, "").trimEnd();
  return result || "Directory is empty";
}

// ─── Server bootstrap ─────────────────────────────────────────────────────────

const isTestEnv =
  typeof process !== "undefined" && process.env.VITEST === "true";

if (!isTestEnv) {
  const projectRoot = process.argv[2];

  if (!projectRoot) {
    console.error("Error: project root must be passed as first argument");
    process.exit(1);
  }

  try {
    const stat = statSync(projectRoot);
    if (!stat.isDirectory()) {
      console.error(`Error: "${projectRoot}" is not a directory`);
      process.exit(1);
    }
  } catch {
    console.error(
      `Error: "${projectRoot}" does not exist or is not accessible`,
    );
    process.exit(1);
  }

  // Dynamic import to avoid pulling in MCP SDK during tests
  Promise.all([
    import("@modelcontextprotocol/sdk/server/mcp.js"),
    import("@modelcontextprotocol/sdk/server/stdio.js"),
    import("zod"),
  ]).then(async ([{ McpServer }, { StdioServerTransport }, z]) => {
    const server = new McpServer({ name: "illumination", version: "1.0.0" });

    server.tool(
      "write_illumination",
      "Write a meditation illumination file to .apparat/meditations/illuminations/. " +
        "Provide a kebab-case `slug` (lowercase alphanumeric + hyphens, e.g. `janitor-doc-drift` or `my-insight`); " +
        "the server prepends the current YYYY-MM-DDTHHMM- timestamp and appends .md — do not include either yourself. " +
        "Provide a one-sentence `description` summarizing the core insight — this is required. " +
        "Frontmatter is auto-generated as `date` + `description` only — no status field. " +
        "Use the `consume` tool with reason='implemented' or 'declined' to remove an illumination after the work it represents is done.",
      {
        slug: z.string(),
        description: z.string(),
        content: z.string(),
      },
      async ({ slug, description, content }: { slug: string; description: string; content: string }) => {
        try {
          const filename = composeIlluminationFilename(slug);
          const filePath = writeIllumination(projectRoot, filename, description, content);
          return {
            content: [{ type: "text" as const, text: `Written to ${filePath}` }],
          };
        } catch (err: unknown) {
          const msg = err instanceof Error ? err.message : String(err);
          return {
            content: [{ type: "text" as const, text: `Error: ${msg}` }],
          };
        }
      },
    );

    server.tool(
      "read_file",
      "Read a file within the project folder. Accepts a path relative to project root or an absolute path inside it.",
      { path: z.string() },
      async ({ path: filePath }: { path: string }) => {
        try {
          const content = readFile(projectRoot, filePath);
          return { content: [{ type: "text" as const, text: content }] };
        } catch (err: unknown) {
          const msg = err instanceof Error ? err.message : String(err);
          return { content: [{ type: "text" as const, text: `Error: ${msg}` }] };
        }
      },
    );

    server.tool(
      "glob_files",
      "Find files matching a glob pattern within the project folder. Pattern must be relative to project root.",
      { pattern: z.string() },
      async ({ pattern }: { pattern: string }) => {
        try {
          const result = await globFiles(projectRoot, pattern);
          return { content: [{ type: "text" as const, text: result }] };
        } catch (err: unknown) {
          const msg = err instanceof Error ? err.message : String(err);
          return { content: [{ type: "text" as const, text: `Error: ${msg}` }] };
        }
      },
    );

    server.tool(
      "project_tree",
      "Show the full recursive file and folder tree of the project or a subdirectory. Skips noise folders (node_modules, dist, .git, etc.).",
      { path: z.string().optional() },
      async ({ path: subPath }: { path?: string }) => {
        try {
          const result = projectTree(projectRoot, subPath);
          return { content: [{ type: "text" as const, text: result }] };
        } catch (err: unknown) {
          const msg = err instanceof Error ? err.message : String(err);
          return { content: [{ type: "text" as const, text: `Error: ${msg}` }] };
        }
      },
    );

    server.tool(
      "list_stimuli",
      "List available stimulus lens files from this project's .apparat/meditations/stimuli/ folder. " +
        "Call this first to see which lenses are available before reading any.",
      {},
      async () => {
        const result = listStimuli(projectRoot);
        return { content: [{ type: "text" as const, text: result }] };
      },
    );

    server.tool(
      "read_stimulus",
      "Read a specific stimulus lens file by filename. " +
        "Use list_stimuli first to get available filenames.",
      { filename: z.string() },
      async ({ filename }: { filename: string }) => {
        const result = readStimulus(projectRoot, filename);
        return { content: [{ type: "text" as const, text: result }] };
      },
    );

    server.tool(
      "list_illuminations",
      "List illuminations in .apparat/meditations/illuminations/, with descriptions. " +
        "Call this at the start of a session to orient yourself before writing new insights. " +
        "No filters — every file in the folder is alive.",
      {},
      async () => {
        const result = listIlluminations(projectRoot);
        return { content: [{ type: "text" as const, text: result }] };
      },
    );

    server.tool(
      "consume",
      "Consume an illumination — delete the file from .apparat/meditations/illuminations/ and commit the deletion. " +
        "Use reason='implemented' after the implement loop succeeds and a memory file has been written. " +
        "Use reason='declined' when the operator rejects an illumination at the gate. " +
        "Commit message format: 'meditate: consume <filename> (<reason>)' — searchable via git log --grep.",
      {
        filename: z.string(),
        reason: z.enum(["implemented", "declined"]),
      },
      async ({ filename, reason }: { filename: string; reason: "implemented" | "declined" }) => {
        const result = consume(projectRoot, filename, reason);
        return {
          content: [{ type: "text" as const, text: JSON.stringify(result, null, 2) }],
        };
      },
    );

    server.tool(
      "mark_note_picked",
      "Mark an open note in .apparat/notes.md as picked — flips '- [ ] <text>' to '- [x] <text>'. " +
        "Pass the exact note body (everything after '- [ ] ' on the line, trimmed). " +
        "Call this once per note the meditation actually drew on. " +
        "Returns success=false if the file is missing or no matching open note is found — non-fatal; the meditate run continues. " +
        "Commits the change with message 'meditate: mark note picked'.",
      { text: z.string() },
      async ({ text }: { text: string }) => {
        const result = markNotePicked(projectRoot, text);
        return {
          content: [{ type: "text" as const, text: JSON.stringify(result, null, 2) }],
        };
      },
    );

    server.tool(
      "consume_plan",
      "Consume an implementation plan — delete the file from docs/superpowers/plans/ and commit the deletion. " +
        "Use reason='implemented' after the implement loop succeeds and the plan's work has shipped. " +
        "Use reason='declined' when the operator rejects the plan at the gate. " +
        "Commit message format: 'meditate: consume <filename> (<reason>)' — searchable via git log --grep.",
      {
        filename: z.string(),
        reason: z.enum(["implemented", "declined"]),
      },
      async ({ filename, reason }: { filename: string; reason: "implemented" | "declined" }) => {
        const result = consumePlan(projectRoot, filename, reason);
        return {
          content: [{ type: "text" as const, text: JSON.stringify(result, null, 2) }],
        };
      },
    );

    server.tool(
      "list_plans",
      "List implementation plans in docs/superpowers/plans/, with their H1 titles. " +
        "No filters — every file in the folder is alive (consumed plans are deleted by consume_plan).",
      {},
      async () => {
        const result = listPlans(projectRoot);
        return { content: [{ type: "text" as const, text: result }] };
      },
    );

    process.on("SIGINT", async () => {
      await server.close();
      process.exit(0);
    });

    const transport = new StdioServerTransport();
    await server.connect(transport);
  });
}
