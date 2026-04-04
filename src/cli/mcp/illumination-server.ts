import { mkdirSync, writeFileSync, statSync } from "fs";
import { join } from "path";

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

    server.registerTool(
      "write_illumination",
      {
        description:
          "Write a meditation illumination file to meditations/illuminations/. " +
          "Use filename format: YYYY-MM-DDTHHMM-kebab-slug.md (e.g. 2026-04-04T1430-my-insight.md).",
        inputSchema: {
          filename: z.string(),
          content: z.string(),
        },
      },
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

    process.on("SIGINT", async () => {
      await server.close();
      process.exit(0);
    });

    const transport = new StdioServerTransport();
    await server.connect(transport);
  });
}
