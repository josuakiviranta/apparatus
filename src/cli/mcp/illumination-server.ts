import { mkdirSync, writeFileSync, statSync, readFileSync, readdirSync, existsSync, rmSync } from "fs";
import { execSync } from "node:child_process";
import { join, resolve, isAbsolute, relative } from "path";
import ignore from "ignore";
import fg from "fast-glob";

// ─── Exported pure helpers (for testing) ──────────────────────────────────────

const FILENAME_RE = /^[\w-]+\.md$/;

export function validateFilename(filename: string): string | null {
  if (!FILENAME_RE.test(filename)) {
    return `Invalid filename "${filename}". Must match [\\w-]+\\.md (no slashes, colons, or path components).`;
  }
  return null;
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
  const frontmatter = `---\ndate: ${date}\nstatus: open\ndescription: ${description.trim()}\n---\n\n`;
  const dir = join(projectRoot, "meditations", "illuminations");
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

export function markImplemented(
  projectRoot: string,
  filename: string,
): { success: true; filename: string; previous_status: string; new_status: string }
  | { success: false; error: string } {
  const fnErr = validateFilename(filename);
  if (fnErr) return { success: false, error: fnErr };

  const illumDir = join(projectRoot, "meditations", "illuminations");
  const filePath = join(illumDir, filename);

  if (!existsSync(filePath)) {
    return { success: false, error: "Illumination file not found" };
  }

  const raw = readFileSync(filePath, "utf-8");

  // Parse frontmatter block: content between first --- and second ---
  const fmMatch = raw.match(/^---\n([\s\S]*?)\n---\n/);
  if (!fmMatch) {
    return { success: false, error: "No frontmatter found in illumination file" };
  }

  const fmBlock = fmMatch[1];
  const body = raw.slice(fmMatch[0].length);

  // Extract current status
  const statusMatch = fmBlock.match(/^status:\s*(.+)$/m);
  const currentStatus = statusMatch ? statusMatch[1].trim() : "open";

  // Validate transition
  const allowed = ["open", "dispatched"];
  if (!allowed.includes(currentStatus)) {
    return {
      success: false,
      error: `Cannot mark as implemented: current status is ${currentStatus}`,
    };
  }

  // Update frontmatter
  const today = new Date().toISOString().slice(0, 10);
  let updatedFm = statusMatch
    ? fmBlock.replace(/^status:\s*.+$/m, "status: implemented")
    : fmBlock + "\nstatus: implemented";
  updatedFm += `\nimplemented_at: ${today}`;

  const updatedContent = `---\n${updatedFm}\n---\n${body}`;
  writeFileSync(filePath, updatedContent);

  return {
    success: true,
    filename,
    previous_status: currentStatus,
    new_status: "implemented",
  };
}

export function markDispatched(
  projectRoot: string,
  filename: string,
  planPath: string,
): { success: true; filename: string; previous_status: string; new_status: string }
  | { success: false; error: string } {
  const fnErr = validateFilename(filename);
  if (fnErr) return { success: false, error: fnErr };

  const illumDir = join(projectRoot, "meditations", "illuminations");
  const filePath = join(illumDir, filename);

  if (!existsSync(filePath)) {
    return { success: false, error: `Illumination file not found: ${filename}` };
  }

  const raw = readFileSync(filePath, "utf-8");
  const fmMatch = raw.match(/^---\n([\s\S]*?)\n---\n/);
  if (!fmMatch) {
    return { success: false, error: "No frontmatter found in illumination file" };
  }

  const fmBlock = fmMatch[1];
  const body = raw.slice(fmMatch[0].length);

  const statusMatch = fmBlock.match(/^status:\s*(.+)$/m);
  const currentStatus = statusMatch ? statusMatch[1].trim() : "open";

  if (currentStatus !== "open") {
    return {
      success: false,
      error: `Cannot mark as dispatched: current status is ${currentStatus}`,
    };
  }

  const today = new Date().toISOString().slice(0, 10);
  let updatedFm = statusMatch
    ? fmBlock.replace(/^status:\s*.+$/m, "status: dispatched")
    : fmBlock + "\nstatus: dispatched";
  updatedFm += `\ndispatched_at: ${today}`;
  updatedFm += `\nplan_path: ${planPath}`;

  const updatedContent = `---\n${updatedFm}\n---\n${body}`;
  writeFileSync(filePath, updatedContent);

  return {
    success: true,
    filename,
    previous_status: currentStatus,
    new_status: "dispatched",
  };
}

export function markArchived(
  projectRoot: string,
  filename: string,
  reason: string,
): { success: true; filename: string; previous_status: string; new_status: string; archive_path: string }
  | { success: false; error: string } {
  const fnErr = validateFilename(filename);
  if (fnErr) return { success: false, error: fnErr };

  const illumDir = join(projectRoot, "meditations", "illuminations");
  const filePath = join(illumDir, filename);

  if (!existsSync(filePath)) {
    return { success: false, error: `Illumination file not found: ${filename}` };
  }

  const raw = readFileSync(filePath, "utf-8");
  const fmMatch = raw.match(/^---\n([\s\S]*?)\n---\n/);
  if (!fmMatch) {
    return { success: false, error: "No frontmatter found in illumination file" };
  }

  const fmBlock = fmMatch[1];
  const body = raw.slice(fmMatch[0].length);

  const statusMatch = fmBlock.match(/^status:\s*(.+)$/m);
  const currentStatus = statusMatch ? statusMatch[1].trim() : "open";

  if (currentStatus === "archived") {
    return {
      success: false,
      error: "Cannot archive: current status is already archived",
    };
  }

  const today = new Date().toISOString().slice(0, 10);
  let updatedFm = statusMatch
    ? fmBlock.replace(/^status:\s*.+$/m, "status: archived")
    : fmBlock + "\nstatus: archived";
  updatedFm += `\narchived_at: ${today}`;
  updatedFm += `\narchive_reason: ${reason}`;

  const archiveDir = join(illumDir, "archive");
  mkdirSync(archiveDir, { recursive: true });

  const archivePath = join(archiveDir, filename);
  const updatedContent = `---\n${updatedFm}\n---\n${body}`;
  writeFileSync(archivePath, updatedContent);

  rmSync(filePath);

  return {
    success: true,
    filename,
    previous_status: currentStatus,
    new_status: "archived",
    archive_path: join("meditations", "illuminations", "archive", filename),
  };
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

const NO_META_MEDITATIONS_MESSAGE =
  "No meta-meditations found. You can still proceed — reflect on the project code " +
  "directly and write your illumination using write_illumination.\n\n" +
  "To add meta-meditations: create .md files in the meditations/ folder of your " +
  "ralph-cli installation (e.g. ~/.npm-global/lib/node_modules/ralph-cli/meditations/). " +
  "Each file is a lens the agent will use to reflect on your project.";

export function listMetaMeditations(meditationsDir: string): string {
  try {
    const files = readdirSync(meditationsDir)
      .filter((f) => f.endsWith(".md"))
      .sort();
    if (files.length === 0) return NO_META_MEDITATIONS_MESSAGE;
    return files.join("\n");
  } catch {
    return NO_META_MEDITATIONS_MESSAGE;
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

export function listIlluminations(projectRoot: string, status?: string): string {
  const dir = join(projectRoot, "meditations", "illuminations");
  try {
    let files = readdirSync(dir)
      .filter((f) => f.endsWith(".md"))
      .sort();
    if (status) {
      files = files.filter((f) => {
        const content = readFileSync(join(dir, f), "utf-8");
        const fmMatch = content.match(/^---\n([\s\S]*?)\n---\n/);
        if (!fmMatch) return status === "open"; // no frontmatter = open
        const statusMatch = fmMatch[1].match(/^status:\s*(.+)$/m);
        const fileStatus = statusMatch ? statusMatch[1].trim() : "open";
        return fileStatus === status;
      });
    }
    if (files.length === 0) return NO_ILLUMINATIONS_MESSAGE;
    return files
      .map((f) => `${f} — ${parseIlluminationDescription(join(dir, f))}`)
      .join("\n");
  } catch {
    return NO_ILLUMINATIONS_MESSAGE;
  }
}

export function readMetaMeditation(meditationsDir: string, filename: string): string {
  const err = validateFilename(filename);
  if (err) return `Error: ${err}`;
  try {
    return readFileSync(join(meditationsDir, filename), "utf8");
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
  const meditationsDir = process.argv[3] ?? "";

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
      "Write a meditation illumination file to meditations/illuminations/. " +
        "Use filename format: YYYY-MM-DDTHHMM-kebab-slug.md (e.g. 2026-04-04T1430-my-insight.md). " +
        "Provide a one-sentence description summarizing the core insight — this is required.",
      {
        filename: z.string(),
        description: z.string(),
        content: z.string(),
      },
      async ({ filename, description, content }: { filename: string; description: string; content: string }) => {
        try {
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
      "list_meta_meditations",
      "List available meta-meditation lens files from the ralph-cli installation. " +
        "Call this first to see which lenses are available before reading any.",
      {},
      async () => {
        const result = listMetaMeditations(meditationsDir);
        return { content: [{ type: "text" as const, text: result }] };
      },
    );

    server.tool(
      "read_meta_meditation",
      "Read a specific meta-meditation lens file by filename. " +
        "Use list_meta_meditations first to get available filenames.",
      { filename: z.string() },
      async ({ filename }: { filename: string }) => {
        const result = readMetaMeditation(meditationsDir, filename);
        return { content: [{ type: "text" as const, text: result }] };
      },
    );

    server.tool(
      "list_illuminations",
      "List illuminations written to this project, with descriptions. " +
        "Call this at the start of a session to orient yourself before writing new insights. " +
        "Optionally filter by lifecycle status.",
      {
        status: z.enum(["open", "dispatched", "implemented", "archived"]).optional(),
      },
      async ({ status }: { status?: string }) => {
        const result = listIlluminations(projectRoot, status);
        return { content: [{ type: "text" as const, text: result }] };
      },
    );

    server.tool(
      "mark_implemented",
      "Mark an illumination as implemented. Valid from status open or dispatched.",
      {
        filename: z.string(),
      },
      async ({ filename }: { filename: string }) => {
        const result = markImplemented(projectRoot, filename);
        return {
          content: [{ type: "text" as const, text: JSON.stringify(result, null, 2) }],
        };
      },
    );

    server.tool(
      "mark_dispatched",
      "Mark an illumination as dispatched after a plan has been generated. Valid only from status open.",
      {
        filename: z.string(),
        plan_path: z.string(),
      },
      async ({ filename, plan_path }: { filename: string; plan_path: string }) => {
        const result = markDispatched(projectRoot, filename, plan_path);
        return {
          content: [{ type: "text" as const, text: JSON.stringify(result, null, 2) }],
        };
      },
    );

    server.tool(
      "mark_archived",
      "Archive an illumination. Moves file to archive/ subdirectory. Valid from any status except archived.",
      {
        filename: z.string(),
        reason: z.string(),
      },
      async ({ filename, reason }: { filename: string; reason: string }) => {
        const result = markArchived(projectRoot, filename, reason);
        return {
          content: [{ type: "text" as const, text: JSON.stringify(result, null, 2) }],
        };
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
