// PreToolUse hook for Bash: blocks commands that skip the git hooks (lint-staged,
// commitlint). Exit code 2 blocks the call and shows stderr to the agent.
//
// It catches an accidental skip in the usual form of a command, not a deliberate one.
// Not checked: commands in `bash -c "…"`, on the line of a heredoc or in its body; quoted
// options (`"--no-verify"`); options after `--git-dir`/`--work-tree`; `-n)` in a subshell.
import { readFileSync } from "node:fs";

function block(reason) {
  console.error(`Blocked: ${reason} Fix the failing check instead.`);
  process.exit(2);
}

let command;
try {
  command = JSON.parse(readFileSync(0, "utf8")).tool_input?.command ?? "";
} catch {
  block("the hook could not read the command.");
}

// Line continuations are joined first. Heredoc bodies and quoted strings (commit messages,
// script text) are dropped so that their content is not mistaken for flags. A quoted HUSKY
// value is unquoted first, since the shell passes it unquoted. Then each simple command is
// checked separately.
const segments = command
  .replace(/\\\n/g, " ")
  .replace(/\bHUSKY=(['"])0\1/g, "HUSKY=0")
  .replace(/<<-?\s*['"]?(\w+)['"]?[^\n]*\n[\s\S]*?\n\s*\1(?=\n|$)/g, "")
  .replace(/"(?:\\.|[^"\\])*"|'[^']*'/g, '""')
  .split(/[\n;|&]+/)
  .map((s) => s.trim());

// The git subcommand and its arguments: options before the subcommand are skipped,
// including the values of -c and -C.
function gitArgs(segment) {
  const words = segment.split(/\s+/);
  let i = words.indexOf("git") + 1;
  if (i === 0) return null;
  while (i < words.length && words[i].startsWith("-")) {
    i += words[i] === "-c" || words[i] === "-C" ? 2 : 1;
  }
  return { subcommand: words[i], args: words.slice(i + 1) };
}

// Short options of git commit whose value may follow in the same word (-uno, -mtext):
// letters after them are the value, not options.
const COMMIT_OPTIONS_WITH_VALUE = "mFCctuS";

function hasShortN(args) {
  return args.some((word) => {
    if (!/^-[a-zA-Z]+$/.test(word)) return false;
    for (const letter of word.slice(1)) {
      if (letter === "n") return true;
      if (COMMIT_OPTIONS_WITH_VALUE.includes(letter)) return false;
    }
    return false;
  });
}

for (const segment of segments) {
  if (/(^|\s)HUSKY=0\b/.test(segment)) {
    block("disabling git hooks (HUSKY=0) is not allowed.");
  }
  const git = gitArgs(segment);
  if (!git) continue;

  if (/core\.hookspath(=|\s+\S)/i.test(segment)) {
    block("changing core.hooksPath disables git hooks.");
  }
  // git accepts any unique prefix of a long option: --no-veri works like --no-verify.
  if (/\s--no-veri\w*/.test(segment) || (git.subcommand === "commit" && hasShortN(git.args))) {
    block("skipping git hooks (--no-verify / -n) is not allowed.");
  }
}
