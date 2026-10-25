---
name: anti-slop-review
description: >
  Review frontend code and documentation for "AI slop" before a commit, PR
  or publishing a repository: generator leftovers, dead and half-finished
  options, claims in README and comments not backed by code, marketing tone
  and emoji, unnecessary abstractions, fragile error handling, personal data
  in logs, nonexistent style classes. Use when asked to check code or a
  repository "for slop", prepare a project for publishing or a demo, review
  AI-assisted code, or before committing your own large change.
---

# Slop review

Slop is not a style; it is **claims that aren't backed up and code that has
no reason to exist**. Every finding below is verified by a fact: a line of
code, a command's output, the absence of a consumer. Matters of taste and
anything the linter catches are out of scope.

**Principles.**
1. **Deleting beats adding.** A dead option is deleted, not documented; a
   marketing phrase is replaced with a fact or removed.
2. **A claim is checked against the code, not memory.** Before calling a
   README line false or true, open the file it talks about.
3. **A finding without evidence is not a finding.** If you can't show a
   `file:line` or command output, don't write it.
4. Edits only on request. By default the review result is a list.

---

## 1. Procedure

1. Define the scope: a diff (`git diff main...HEAD`), specific files, or the
   whole repository before publishing.
2. Run the searches from section 3 — they produce candidates, not findings.
3. Verify each candidate by reading the code and discard false positives.
4. Go through the section 2 checklist for what search doesn't catch: README
   vs. code, UI states, abstractions.
5. If you can run the app, look at the pages: template screens and unstyled
   components are obvious immediately.
6. Produce a report in the section 4 format.

---

## 2. Checklist

### 2.1. Generator and template leftovers

- Generator starter pages and blocks: "Get started by editing", links to the
  framework's and tools' docs, `utm_source=…-project`, "Give us a star",
  blocks about the tool's cloud services.
- Template files: `example.spec.ts`, tests that only check the template's
  title; SVGs and images from the template in `public/`; the generator's README.
- Empty stubs: `.gitkeep` in folders that already have files; empty
  `index.ts`; layer folders with no code.

### 2.2. Dead and half-finished

- Config values or `switch` branches that throw "not implemented" /
  "pending".
- Single-value unions that look like extension points
  (`type: "graphql" | "msw"` where `msw` isn't implemented).
- Commented-out code, `TODO` without a reason or link, unused exports,
  dependencies in `package.json` that are never imported.
- `package.json` scripts that don't run (refer to deleted files or
  nonexistent targets).

### 2.3. Documentation vs. code

Every claim in README, ADRs, comments and commit messages is checked:
- **Names and paths:** the mentioned files, commands and environment variables
  exist (`next.config.ts` in the text and `next.config.js` in the repo is a
  finding).
- **Behavior:** "requests go directly", "tokens are not accessible to JS",
  "protected against open redirects" — find the code that does it and check
  the edge cases.
- **Versions and numbers:** library versions, token lifetimes, coverage.
- **The future in the present tense:** something planned described as done.
- Markdown links and anchors point where they should (anchors break when
  headings are edited).

### 2.4. Tone

- Evaluative words instead of facts: premium, state-of-the-art, cutting-edge,
  blazing/lightning-fast, seamless, robust, powerful, modern,
  production-ready, enterprise-grade, "more than just".
- Emoji in documentation headings, UI, logs and commit messages.
- "Designed with ❤️", "Carefully crafted", badges for the sake of badges.
- Comments that restate the code ("// Get the user" above `getUser()`),
  history comments ("// Fixed", "// Updated to X"), all-caps comments,
  "IMPORTANT" markers without an explanation.
- Headings and comments like "🚀 Production Roadmap" and "(Premium
  Aesthetic)".

The replacement is a fact: what it does, why it's done this way, what the
constraint is.

### 2.5. Unnecessary abstractions

- An interface or factory with a single implementation and no fake in tests.
- A layer, zone, monorepo package, state manager or Storybook without a
  consumer or a recorded reason (ADR, README section).
- Wrappers that only rename (`useAuthApi = () => useStrictContext(Ctx)`
  without logic is acceptable; a wrapper over a wrapper is not).
- "For the future": parameters nobody passes, config options with a single
  value.

### 2.6. Errors and async

- The error kind is determined by message text (`message === "unauthorized"`,
  `includes("invalid password")`) without a comment explaining why and tests.
- Only the first element of the errors array is checked (`errors[0]`).
- `throw { status, ... }` — an object instead of an `Error`.
- Empty `catch`, a `catch` that returns empty data, `.catch(() => {})`.
- A shared in-flight promise whose result the waiters don't read (token
  refresh as "wait, then retry" without checking whether it succeeded).
- The server's `error.message` is shown to the user as is.
- Missing loading, error and empty-list states.

### 2.7. Security and privacy

- Personal data in logs: email, phone, name; tokens; request bodies.
- Secrets in the repository or its history (`git log -p`), `.env` in the
  index, secrets with the `NEXT_PUBLIC_` prefix.
- Redirects from a parameter (`callbackUrl`, `next`, `returnTo`) without
  validation, or validated only with `startsWith("/")`/`!startsWith("//")` —
  that lets through `/\evil.com` and control characters.
- Tokens in `localStorage`/`sessionStorage`; a token in the URL that isn't
  removed from the address bar after reading.
- `dangerouslySetInnerHTML` without a sanitizer.

### 2.8. UI

- Classes missing from the theme: tokens copied from shadcn/ui (`bg-card`,
  `text-muted-foreground`, `bg-primary`) in a project without those tokens —
  the component silently has no styles.
- Raw HEX and arbitrary values in components when tokens exist.
- A "field is filled" state set in `onChange`: breaks with autofill and
  `reset()`.
- `key={index}` in mutable lists; buttons without `type` inside forms;
  icon buttons without `aria-label`.
- SVGs from a design with filters (shadows, glow) clipped by the `viewBox` —
  a visible rectangle around the logo.

### 2.9. Tests

- Tests that check mocks, not behavior; snapshots of large trees.
- e2e against a shared or production backend that mutates data.
- Tests that pass only because jsdom doesn't apply CSS (an element is
  "hidden" by a class but the test finds it), and broad selectors
  (`/password/i`, which also matches "Show password").

### 2.10. Git

- Unrelated changes in one commit; a "fix stuff" commit.
- Generated files and build artifacts in the index (except a deliberately
  committed generated API client).
- A commit message that doesn't describe what's in the diff.

---

## 3. Finding candidates

The commands produce candidates. Every match is verified by reading the code.

```bash
# Generator templates and marketing
rg -n -i "utm_source|get started by editing|give us a star|nx cloud|welcome to|carefully crafted|designed with" \
  --glob '!**/node_modules/**' --glob '!*.lock' --glob '!pnpm-lock.yaml'
rg -n -i "premium|state-of-the-art|cutting-edge|blazing|lightning|seamless|robust|enterprise-grade|production-ready" \
  --glob '!**/node_modules/**'

# Emoji in code, UI and docs
rg -n --pcre2 '[\x{1F300}-\x{1FAFF}\x{2600}-\x{27BF}]' --glob '!**/node_modules/**' --glob '!*.lock'

# Half-finished
rg -n -i "not implemented|pending implementation|todo|fixme|hack" --glob '!**/node_modules/**'

# Fragile errors
rg -n "errors\?\.\[0\]|errors\[0\]|message ===|message\.includes|\.includes\(['\"][a-z ]+['\"]\)" src app
rg -n "throw \{" src app
rg -n "catch \{\s*\}|catch \(\w*\) \{\s*\}|\.catch\(\(\) => \{\s*\}\)" src app

# Logs with personal data
rg -n "(logger|console)\.\w+\(.*(email|phone|password|token)" src app

# Redirects and tokens
rg -n "callbackUrl|returnTo|redirectTo|searchParams.get\(['\"]next" src app
rg -n "localStorage|sessionStorage" src app

# shadcn classes without tokens: find the classes and compare with @theme / the tailwind config
rg -n -o "\b(bg|text|border)-(card|muted|popover|accent|primary|secondary|destructive)(-foreground)?\b" src app | sort -u

# Unused dependencies and exports (if knip is installed)
pnpm dlx knip

# Secrets in history
git log -p --all | rg -n -i "(api[_-]?key|secret|password|token)\s*[:=]\s*['\"][A-Za-z0-9_\-]{16,}"
git ls-files | rg -n "(^|/)\.env($|\.)" | rg -v "\.env\.example$"
```

---

## 4. Report format

Findings in order of severity: security and privacy → false claims in the
documentation → error-handling bugs → dead and half-finished → templates →
tone.

```text
<file>:<line> — <category>
What: <one sentence: what's wrong, with the fact>
Why it matters: <consequence for the user, reviewer or maintainer>
Fix: <specific; most often "delete" or "replace with the fact: …">
```

At the end: what was checked with no findings, and what wasn't checked (for
example, the app wasn't run). If there are no findings, say so, without
stretched remarks.
