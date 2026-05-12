import fs from "node:fs";

let notes = "";
try {
  const raw = fs.readFileSync(".apparat/notes.md", "utf8");
  const open = [];
  for (const line of raw.split("\n")) {
    if (/^\s*-\s+\[x\]\s/.test(line)) continue;
    const m = line.match(/^\s*-\s+\[ \]\s+(.+?)\s*$/);
    if (m) open.push(m[1]);
  }
  notes = open.map((t) => `- ${t}`).join("\n");
} catch {
  // .apparat/notes.md absent — empty string is the contract.
}
console.log(JSON.stringify({ notes }));
