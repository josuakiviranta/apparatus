#!/usr/bin/env node
import { readFileSync } from "fs";
import { spawnSync } from "child_process";
import { resolve } from "path";

const issuesPath = process.argv[2];
if (!issuesPath) {
  console.error("publish_issues: pass issues_path as the first arg");
  process.exit(2);
}

const slices = JSON.parse(readFileSync(resolve(issuesPath), "utf8"));

const indegree = slices.map(s => (s.blocked_by ?? []).length);
const queue = [];
indegree.forEach((d, i) => { if (d === 0) queue.push(i); });

const childrenOf = slices.map((_, i) =>
  slices.flatMap((s, j) => (s.blocked_by ?? []).includes(i) ? [j] : []),
);

const order = [];
while (queue.length) {
  const i = queue.shift();
  order.push(i);
  for (const j of childrenOf[i]) {
    indegree[j] -= 1;
    if (indegree[j] === 0) queue.push(j);
  }
}

if (order.length !== slices.length) {
  console.error("publish_issues: cycle detected in blocked_by graph");
  process.exit(3);
}

const numbers = new Array(slices.length);
const urls = new Array(slices.length);

for (const i of order) {
  const s = slices[i];
  const labels = ["needs-triage", s.type === "HITL" ? "hitl" : "afk"];

  const blockedRefs = (s.blocked_by ?? []).length
    ? s.blocked_by.map(idx => `#${numbers[idx]}`).join(", ")
    : null;

  const fullBody = blockedRefs
    ? `${s.body}\n\n## Blocked by\n${blockedRefs}`
    : s.body;

  const args = [
    "issue", "create",
    "--title", s.title,
    "--body", fullBody,
    ...labels.flatMap(l => ["--label", l]),
  ];

  const r = spawnSync("gh", args, { encoding: "utf8" });
  if (r.status !== 0) {
    console.error(`publish_issues: gh failed for slice ${i}:`, r.stderr.trim());
    process.exit(4);
  }

  const url = r.stdout.trim().split("\n").find(l => l.startsWith("https://"));
  const num = url ? Number(url.split("/").pop()) : null;
  if (!num) {
    console.error(`publish_issues: could not parse issue number for slice ${i}`);
    console.error("gh stdout:", r.stdout);
    process.exit(5);
  }

  numbers[i] = num;
  urls[i] = url;
  console.error(`published slice ${i} → #${num} ${url}`);
}

console.log(JSON.stringify({
  published_count: slices.length,
  first_issue_number: numbers[order[0]],
  first_issue_url: urls[order[0]],
}));
