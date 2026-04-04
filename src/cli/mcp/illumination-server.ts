import { mkdirSync, writeFileSync, statSync, readFileSync, readdirSync } from "fs";
import { join, resolve, isAbsolute } from "path";
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
  content: string,
): string {
  const err = validateFilename(filename);
  if (err) throw new Error(err);
  const dir = join(projectRoot, "meditations", "illuminations");
  mkdirSync(dir, { recursive: true });
  const filePath = join(dir, filename);
  writeFileSync(filePath, content, "utf8");
  return filePath;
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

const SKIP_DIRS = new Set([
  ".git", "node_modules", "dist", "build", "coverage",
  ".next", ".turbo", "__pycache__", ".cache",
]);

export function projectTree(projectRoot: string, subPath?: string): string {
  const root = subPath
    ? (isAbsolute(subPath) ? subPath : resolve(projectRoot, subPath))
    : projectRoot;
  assertWithinRoot(root, projectRoot);

  function walk(dir: string, prefix: string): string {
    const entries = readdirSync(dir, { withFileTypes: true })
      .sort((a, b) => a.name.localeCompare(b.name));
    let out = "";
    for (const entry of entries) {
      if (entry.isDirectory() && SKIP_DIRS.has(entry.name)) continue;
      if (entry.isDirectory()) {
        out += `${prefix}${entry.name}/\n`;
        out += walk(join(dir, entry.name), prefix + "  ");
      } else {
        out += `${prefix}${entry.name}\n`;
      }
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
      "Write a meditation illumination file to meditations/illuminations/. " +
        "Use filename format: YYYY-MM-DDTHHMM-kebab-slug.md (e.g. 2026-04-04T1430-my-insight.md).",
      {
        filename: z.string(),
        content: z.string(),
      },
      // @ts-expect-error — SDK overloads cause deep type instantiation with dynamically-imported zod
      async ({ filename, content }: { filename: string; content: string }) => {
        try {
          const filePath = writeIllumination(projectRoot, filename, content);
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

    process.on("SIGINT", async () => {
      await server.close();
      process.exit(0);
    });

    const transport = new StdioServerTransport();
    await server.connect(transport);
  });
}
