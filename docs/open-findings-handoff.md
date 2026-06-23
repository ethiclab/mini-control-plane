# Handoff: open findings to fix

**One-line task:** Read [`docs/self-assessment.md`](self-assessment.md) (the Round 2 audit) and this file, then work the items below **test-first**, smallest-blast-radius first.

These are the carry-over + new findings from the Round 2 self-assessment. None is a shipped bug (the one of those, `bb`, is gone) — they are process/consistency/robustness items. Tackle them independently; each is its own small PR-sized unit.

## Ground rules (do not violate)

- **Zero dependencies**, runtime *and* dev. No new `dependencies`/`devDependencies`. Test runner stays `node:test`; coverage stays native `--experimental-test-coverage`.
- **Inject the world**: plugins never `require('https')`/`child_process`; all network/shell/prompt I/O goes through `ctx`. Tests replay fixtures — **add a fixture, not mock logic**; no monkeypatching of production code.
- **TDD**: write the failing test first for anything non-trivial. `npm test` must stay green.
- **Commits**: branch off `main` (work continues on `refactor/remove-bb-plugin` or a fresh branch); never `--no-verify` / force-push without approval; end commit messages with the `Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>` trailer.
- Coverage command (source of truth in `.coverage-thresholds.json`):
  ```
  node --test --experimental-test-coverage --test-coverage-exclude='tests/**' \
    --test-coverage-lines=100 --test-coverage-functions=100 --test-coverage-branches=100 \
    tests/plugins/*.test.js tests/lib/*.test.js
  ```

## Recommended sequence

Quick mechanical wins first (4 → 5), then the structural fix that unblocks the rest (6 → 2), then the honesty/process items (1 → 3), then optional (7). Items 6 and 2 are linked: build the shared fake-context first, then write the `bin/mini` test on top of it.

---

### A. Sweep the dead `mock-exec.js` machinery — `[LOW]` `[NEW]`
- **Where:** `tests/helpers/mock-exec.js`. Only `captureOutput` (lines ~83–104) is imported (`yt.test.js:8`, `cdk.test.js:8`). `withExecMock` + `urlMatcher`/`anyMatcher` + the `const cp = require('child_process')` reassignment (lines ~20, 27–77) are orphaned (the matchers tests use come from `mock-context.js:57`).
- **Fix:** move `captureOutput` into its own `tests/helpers/capture-output.js`, update the two imports, delete `mock-exec.js`. Finishes the cleanup the `mock-https.js` removal started — and removes the last `child_process` monkeypatch from the tree.
- **DoD:** `mock-exec.js` gone; no test imports it; `npm test` green; `grep -rn child_process tests/` returns nothing.

### B. Remove the `YT_BASE` mutable global — `[LOW]` `[CARRY-OVER]`
- **Where:** `plugins/yt.js:5` (`let YT_BASE = ...`), reassigned at `yt.js:579` inside `run()`, read at `yt.js:26,30` (`ytGet`/`ytPost`) and `yt.js:366` (`showIssue` attachment URLs).
- **Fix:** thread the resolved base URL through `cfg`/`ctx` (or pass it as an argument into the builders) and drop the module-level `let`. Mechanical; removes the file's only shared mutable singleton.
- **DoD:** no module-level reassignable state in `yt.js`; existing `yt` tests still green (add one asserting two runs with different `YT_BASE` don't leak into each other).

### C. Build the shared fake-context helper — `[MED]` `[CARRY-OVER, sharpened]` ← structural, do before D
- **Where:** `tests/helpers/mock-context.js:14-55`. `createMockContext` is hand-rolled with a hardcoded `develRoot: '/tmp/test-devel'` and a `config.read` (lines 37–44) that ignores the dotfile — **not derived from the real `createContext`** (`lib/plugin-context.js:158`). This is the exact mechanism that let baseline bug #1 hide (the test world drifted from the runtime world).
- **Fix:** build the fake by starting from the real `createContext(develRoot)` output and overriding *only* the outward-facing edges (`http`, `shell`, `prompt`) with fakes — keep `format`, `config` shape, `develRoot`, `fs`, `path` real. The goal: any change to the context shape surfaces in one place, so a wrong key can't silently match.
- **DoD:** `createMockContext` is provably derived from `createContext` (e.g. a test asserts the fake exposes the same own-keys as the real context); all plugin tests consume it; `npm test` green.

### D. Add a `bin/mini` test + fold `bin/` into coverage scope — `[MED]` `[CARRY-OVER]`
- **Where:** `bin/mini` (67 lines) has no test and is excluded from the coverage glob, so the "100% on production code" headline silently omits the entry point.
- **Fix:** add `tests/bin/mini.test.js` covering: plugin discovery, command routing, `version`, `help`/no-arg, unknown-command exit path, and the silent plugin-load `catch` branch (item E). Use the helper from C. Add `tests/bin/*.test.js` to the coverage command globs (or document explicitly that `bin/` is out of scope — but testing it is better).
- **DoD:** `bin/mini` exercised by tests and counted in coverage; the unknown-command and load-failure branches both hit.

### E. Make plugin-load failure explicit — `[LOW]` `[CARRY-OVER]`
- **Where:** `bin/mini:14-18` — a failed `require()` writes a one-line stderr warning and continues; if that plugin owned the typed command, the user later sees a misleading `Unknown command: X`.
- **Fix:** track load failures; when a command isn't found, if a plugin failed to load this run, report `command X unavailable: plugin Y failed to load: <err>` instead of the generic message. Connect cause to symptom while keeping the resilient "one bad plugin doesn't kill the rest" behavior.
- **DoD:** a test with a deliberately broken fixture plugin asserts the informative message; resilience preserved.

### F. Align the coverage gate with reality, then ratchet — `[MED]` `[CARRY-OVER]`
- **Where:** `.coverage-thresholds.json` declares `100` for all metrics with `blockPRCreation: true`/`blockTaskCompletion: true`; actual is **83.46 lines / 80.21 branches / 86.60 functions**. An honest agent running the gate blocks itself every time → a gate that's always red is no gate. Biggest single gap: `lib/plugin-context.js` at ~58% lines (prompt/http/shell/readConfig branches, lines 32–111).
- **Fix:** set thresholds to the honest current floor (after items C/D land, recompute), keep blocking flags pointed at a number actually met, and raise incrementally as fixtures grow — the path CLAUDE.md already advocates. Highest-yield: fixtures exercising `plugin-context.js`'s prompt/http/shell branches.
- **DoD:** running the documented coverage command passes; thresholds equal or just below measured; a short note in `CLAUDE.md` on the ratchet policy.

### G. Populate or prune the `.beads` knowledge stubs — `[LOW]` `[CARRY-OVER]` (optional)
- **Where:** the seven `.beads/knowledge/*.jsonl` files are ~4 lines each — unchanged foreign-project example stubs (TypeScript/Prisma/Vite), unrelated to this Node CLI.
- **Fix:** either record the real lessons (the `bb` test-world-drift gotcha is the obvious first entry in `gotchas.jsonl` + `decisions.jsonl`) or delete the foreign stubs to match the project's "readable in one sitting" bar. Don't keep scaffolding that signals more rigor than is exercised.
- **DoD:** the KB either reflects this project or is removed; no foreign-project examples left implying unused process.

---

## Out of scope / explicitly not findings

- Plugins using `require('fs')`/`path`/`os` directly is **fine** — the seam binds only `https`/`child_process`. At most a one-line README clarification that only `http`/`shell`/`prompt` *must* be injected.
- Do **not** re-add the `bb` plugin as part of this work. If it's ever wanted, follow [`docs/bitbucket-plugin-handoff.md`](bitbucket-plugin-handoff.md).
