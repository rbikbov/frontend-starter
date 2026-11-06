// PostToolUse hook for Edit/Write: runs on the edited file what lint-staged runs on commit
// (same order, same extensions; keep in sync with "lint-staged" in package.json), so the
// agent sees lint errors right away. Exit code 2 reports errors to the agent.
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { extname, isAbsolute, join, relative } from "node:path";
import { pathToFileURL } from "node:url";

const LINTED = new Set([".js", ".mjs", ".ts", ".tsx"]);
const FORMATTED = new Set([".json", ".css", ".md", ".yml", ".yaml"]);

export function toolsFor(file, root) {
  const path = relative(root, file);
  if (path.startsWith("..") || isAbsolute(path)) return [];
  if (LINTED.has(extname(file))) return ["eslint", "prettier"];
  if (FORMATTED.has(extname(file))) return ["prettier"];
  return [];
}

function main() {
  const input = JSON.parse(readFileSync(0, "utf8"));
  const file = input.tool_input?.file_path;
  const root = process.env.CLAUDE_PROJECT_DIR ?? process.cwd();
  if (!file) return;

  const args = {
    eslint: ["--fix", "--no-warn-ignored", file],
    prettier: ["--write", "--log-level", "warn", file],
  };

  // Every tool runs even if an earlier one fails, so the file is formatted either way.
  const problems = [];
  for (const tool of toolsFor(file, root)) {
    const result = spawnSync(join(root, "node_modules/.bin", tool), args[tool], {
      cwd: root,
      encoding: "utf8",
    });
    if (result.error) {
      problems.push(`could not run ${tool}: ${result.error.message}`);
    } else if (result.status !== 0) {
      problems.push(`${tool} found problems in ${file}:\n${result.stdout}${result.stderr}`);
    }
  }
  if (problems.length > 0) {
    console.error(problems.join("\n\n"));
    process.exit(2);
  }
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) main();
