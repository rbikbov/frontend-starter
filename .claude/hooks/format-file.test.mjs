import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";

import { toolsFor } from "./format-file.mjs";

const hook = join(import.meta.dirname, "format-file.mjs");

test("lints, then formats code, like lint-staged", () => {
  for (const file of ["src/a.ts", "app/page.tsx", "a.js", ".claude/hooks/x.mjs"]) {
    assert.deepEqual(toolsFor(join("/repo", file), "/repo"), ["eslint", "prettier"], file);
  }
});

test("only formats the other files lint-staged formats", () => {
  for (const file of ["README.md", "package.json", "a.css", "ci.yml", "a.yaml"]) {
    assert.deepEqual(toolsFor(join("/repo", file), "/repo"), ["prettier"], file);
  }
});

test("skips files lint-staged doesn't touch and files outside the project", () => {
  for (const file of ["/repo/a.jsx", "/repo/a.cjs", "/repo/notes.txt", "/tmp/x.ts", "/repo-other/x.ts"]) {
    assert.deepEqual(toolsFor(file, "/repo"), [], file);
  }
});

// A project root whose prettier and eslint are shell scripts: each appends its name to
// calls.log and exits with the code from `exitCodes`.
function fakeProject(exitCodes = {}) {
  const root = mkdtempSync(join(tmpdir(), "format-file-"));
  const bin = join(root, "node_modules/.bin");
  mkdirSync(bin, { recursive: true });
  for (const tool of ["prettier", "eslint"]) {
    const code = exitCodes[tool] ?? 0;
    writeFileSync(
      join(bin, tool),
      `#!/bin/sh\necho ${tool} >> "${root}/calls.log"\necho "${tool} says no"\nexit ${code}\n`,
    );
    chmodSync(join(bin, tool), 0o755);
  }
  return root;
}

function runHook(root, file) {
  return spawnSync("node", [hook], {
    input: JSON.stringify({ tool_input: { file_path: join(root, file) } }),
    env: { ...process.env, CLAUDE_PROJECT_DIR: root },
    encoding: "utf8",
  });
}

const calls = (root) => readFileSync(join(root, "calls.log"), "utf8");

test("runs eslint, then prettier on an edited file", () => {
  const root = fakeProject();
  const result = runHook(root, "src/a.ts");
  assert.equal(result.status, 0);
  assert.equal(calls(root), "eslint\nprettier\n");
});

test("reports lint errors to the agent and still formats the file", () => {
  const root = fakeProject({ eslint: 1 });
  const result = runHook(root, "src/a.ts");
  assert.equal(result.status, 2);
  assert.match(result.stderr, /eslint found problems in .*a\.ts:\neslint says no/);
  assert.equal(calls(root), "eslint\nprettier\n");
});

test("says that a tool could not run instead of blaming the file", () => {
  const root = mkdtempSync(join(tmpdir(), "format-file-"));
  const result = runHook(root, "src/a.ts");
  assert.equal(result.status, 2);
  assert.match(result.stderr, /could not run eslint/);
  assert.doesNotMatch(result.stderr, /undefined/);
});

test("doesn't run the tools on a file outside the project", () => {
  const root = fakeProject();
  const file = join(mkdtempSync(join(tmpdir(), "format-file-")), "x.ts");
  writeFileSync(file, "const  x=1\n");
  const result = spawnSync("node", [hook], {
    input: JSON.stringify({ tool_input: { file_path: file } }),
    env: { ...process.env, CLAUDE_PROJECT_DIR: root },
  });
  assert.equal(result.status, 0);
  assert.equal(existsSync(join(root, "calls.log")), false);
});
