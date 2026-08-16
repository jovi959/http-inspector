import { readdir, readFile } from "node:fs/promises";
import { join, relative } from "node:path";

const root = process.cwd();
const roots = ["src", "crates", "src-tauri"];
const ignoredSegments = new Set(["generated", "target", "node_modules"]);
const genericNames = new Set(["utils", "helpers", "common", "misc", "manager"]);
const hardLimit = 400;
const reviewLimit = { ts: 300, tsx: 200, rs: 300 };

// This walks only handwritten source areas; fixtures and generated contracts are intentionally excluded.
async function collectFiles(directory) {
  const entries = await readdir(directory, { withFileTypes: true });
  const nested = await Promise.all(entries.map(async (entry) => {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) {
      return ignoredSegments.has(entry.name) ? [] : collectFiles(path);
    }
    return [path];
  }));
  return nested.flat();
}

const files = (await Promise.all(roots.map((directory) => collectFiles(join(root, directory))))).flat();
const failures = [];
const reviewWarnings = [];

for (const file of files) {
  const extension = file.split(".").at(-1);
  if (extension !== "ts" && extension !== "tsx" && extension !== "rs") continue;

  const name = file.split("/").at(-1)?.split(".")[0].toLowerCase();
  if (name && genericNames.has(name)) failures.push(`${relative(root, file)} uses forbidden generic module name '${name}'.`);

  const lines = (await readFile(file, "utf8")).split("\n").length;
  if (lines > hardLimit) failures.push(`${relative(root, file)} has ${lines} lines; hard limit is ${hardLimit}.`);
  else if (lines > reviewLimit[extension]) reviewWarnings.push(`${relative(root, file)} has ${lines} lines; review threshold is ${reviewLimit[extension]}.`);
}

for (const warning of reviewWarnings) console.warn(`ARCHITECTURE REVIEW: ${warning}`);
if (failures.length > 0) {
  for (const failure of failures) console.error(`ARCHITECTURE ERROR: ${failure}`);
  process.exitCode = 1;
}
