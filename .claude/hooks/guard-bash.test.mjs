import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { join } from "node:path";
import { test } from "node:test";

const hook = join(import.meta.dirname, "guard-bash.mjs");

function run(command) {
  return spawnSync("node", [hook], { input: JSON.stringify({ tool_input: { command } }) })
    .status;
}

const allowed = [
  'git commit -m "feat: x"',
  'git commit -am "fix: y"',
  'git commit -m "fix: handle -n and --no-verify in text"',
  "git commit -m 'docs: mention HUSKY=0'",
  "git commit -q -m \"$(cat <<'EOF'\nfeat: x\n\nmention -n and --no-verify\nEOF\n)\"",
  "git config core.hooksPath",
  "git push --force-with-lease",
  "ls -n | grep x",
  "git commit -m x\nls -n",
  "cat > f.sh <<'EOF'\ngit commit -n\nEOF\necho ok",
  "git commit -uno -m x",
  "git commit -S -m x",
  "git log -n 5",
  "git log --grep=commit -n 5",
  "git -C /tmp/repo log -n 3",
];

const blocked = [
  "git commit --no-verify -m x",
  'git commit -nm "x"',
  "git add . && git commit -n -m x",
  "git push --no-verify",
  "HUSKY=0 git commit -m x",
  "git -c core.hooksPath=/dev/null commit -m x",
  "git config core.hooksPath /dev/null",
  "git -c core.hookspath=/dev/null commit -m x",
  "git commit --no-verif -m x",
  "git commit --no-veri -m x",
  "git commit -anm x",
  "git -C /tmp/repo commit -n -m x",
  "HUSKY='0' git commit -m x",
  'HUSKY="0" git commit -m x',
  "FOO=1 HUSKY=0 git commit -m x",
  "git commit \\\n  --no-verify -m x",
  "git commit \\\n  -n -m x",
];

for (const command of allowed) {
  test(`allows ${JSON.stringify(command)}`, () => assert.equal(run(command), 0));
}

for (const command of blocked) {
  test(`blocks ${JSON.stringify(command)}`, () => assert.equal(run(command), 2));
}

test("blocks when the input can't be parsed", () => {
  assert.equal(spawnSync("node", [hook], { input: "not json" }).status, 2);
});
