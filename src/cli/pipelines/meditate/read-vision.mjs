import fs from "node:fs";

let vision = "";
try {
  vision = fs.readFileSync("VISION.md", "utf8");
} catch {
  // VISION.md absent — empty string is the contract.
}
console.log(JSON.stringify({ vision }));
