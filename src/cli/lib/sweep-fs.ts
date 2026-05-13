import { existsSync, readdirSync, lstatSync } from "fs";
import { join } from "path";

export interface Entry {
  /** Path relative to `.apparat/`; used for display and join. */
  relPath: string;
  tag: "curated" | "scratch" | "untagged";
  /** On-disk size in bytes. */
  size: number;
}

/**
 * Curated substrates — frontmattered, human-meaningful knowledge. Listed for
 * visibility but NEVER pre-selected; selecting one prompts a confirmation.
 * Top-level only — descendants like `.triage/<runId>/` are scratch and listed
 * separately.
 */
export const CURATED_PATHS = [
  "meditations/illuminations",
  "meditations/stimuli",
  "pipelines",
  "scenarios",
  "notes.md",
  "lessons",
  "reasoning-memory",
];

/**
 * Scratch substrates — run-id-keyed, opaque, machine-only. Pre-selected by
 * default; operator can deselect. `runs/` and both `.triage/` branches expand
 * into one row per `<runId>/` child.
 */
export const SCRATCH_PATHS = [
  "runs",
  "meditations/illuminations/.triage",
  "meditations/stimuli/.triage",
  "sessions",
];

export function listEntries(apparatDir: string): Entry[] {
  const out: Entry[] = [];

  for (const name of readdirSync(apparatDir)) {
    const top = join(apparatDir, name);

    if (name === "runs") {
      pushChildren(out, apparatDir, "runs", "scratch");
      continue;
    }

    if (name === "sessions") {
      out.push({ relPath: "sessions", tag: "scratch", size: dirSize(top) });
      continue;
    }

    if (name === "meditations") {
      for (const subName of readdirSync(top)) {
        const subRel = join("meditations", subName);
        const subAbs = join(top, subName);
        if (subName === "illuminations" || subName === "stimuli") {
          out.push({ relPath: subRel, tag: "curated", size: dirSize(subAbs) });
          const triageDir = join(subAbs, ".triage");
          if (existsSync(triageDir)) {
            pushChildren(out, apparatDir, join("meditations", subName, ".triage"), "scratch");
          }
        } else {
          out.push({ relPath: subRel, tag: tagOf(subRel), size: entrySize(subAbs) });
        }
      }
      continue;
    }

    if (CURATED_PATHS.includes(name)) {
      out.push({ relPath: name, tag: "curated", size: entrySize(top) });
      continue;
    }

    out.push({ relPath: name, tag: "untagged", size: entrySize(top) });
  }

  return out;
}

function pushChildren(
  out: Entry[],
  apparatDir: string,
  parentRel: string,
  tag: "scratch" | "curated",
): void {
  const parentAbs = join(apparatDir, parentRel);
  if (!existsSync(parentAbs)) return;
  for (const child of readdirSync(parentAbs)) {
    const childAbs = join(parentAbs, child);
    try {
      const st = lstatSync(childAbs);
      if (!st.isDirectory()) continue;
    } catch {
      continue;
    }
    out.push({
      relPath: join(parentRel, child),
      tag,
      size: dirSize(childAbs),
    });
  }
}

export function tagOf(rel: string): "curated" | "scratch" | "untagged" {
  for (const c of CURATED_PATHS) if (rel === c || rel.startsWith(c + "/")) return "curated";
  for (const s of SCRATCH_PATHS) if (rel === s || rel.startsWith(s + "/")) return "scratch";
  return "untagged";
}

function entrySize(p: string): number {
  try {
    const st = lstatSync(p);
    if (st.isFile()) return st.size;
    if (st.isDirectory()) return dirSize(p);
    return 0;
  } catch {
    return 0;
  }
}

export function dirSize(path: string): number {
  if (!existsSync(path)) return 0;
  let total = 0;
  const stack: string[] = [path];
  while (stack.length) {
    const cur = stack.pop()!;
    let names: string[];
    try {
      names = readdirSync(cur);
    } catch {
      continue;
    }
    for (const name of names) {
      const child = join(cur, name);
      try {
        const st = lstatSync(child);
        if (st.isDirectory()) stack.push(child);
        else if (st.isFile()) total += st.size;
      } catch {
        /* ENOENT or permission — skip */
      }
    }
  }
  return total;
}

export function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}
