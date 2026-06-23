# A Friend's Audit — Round 3: How High Is the Bar Now

*This document replaces the Round-2 self-assessment. Earlier rounds are preserved in git history (`b9e2cae`, `c3bb2f5`). A paid scanner prompted this pass; it is not the subject. The subject is whether the Round-2 fix list (items A–G) genuinely holds — verified by reading the current source on `main` (PR #2, `35fd1e5`), not by trusting the handoff.*

---

## Since Round 2 — the delta

Round 2 left a prioritized fix list (A–G) and two carry-over robustness notes. Every A–G item is now merged to `main`. I re-read the current tree and re-ran the documented gate; here is what each fix actually does, marked against an independent check.

| Fix | What it claimed | Status |
|-----|-----------------|--------|
| **A** | Dead `mock-exec.js` removed; only `captureOutput` survives, in `tests/helpers/capture-output.js`; no `child_process` anywhere in `tests/` | **VERIFIED** |
| **B** | Mutable module global `let YT_BASE` gone; base resolved per-invocation via `const YT_BASE_DEFAULT` + `ctx.ytBase`, read by `ytGet`/`ytPost`/`showIssue` | **VERIFIED** |
| **C** | `createMockContext` derived from the real `createContext` (spread + narrow overrides); a test asserts the fake exposes every real-context key | **VERIFIED** (strongest) |
| **D** | `bin/mini` testable (`require.main` guard, exported `loadPlugins`/`usage`/`main`, parameterized root) and now *measured* by coverage | **VERIFIED** |
| **E** | Unknown command names any plugin that failed to load this run — cause connected to symptom | **VERIFIED** |
| **F** | Coverage gate set to the honest floor (84/80/86), gate exits 0, ratchet policy documented | **VERIFIED** (re-ran: `EXIT=0`) |
| **G** | `.beads/knowledge/*.jsonl` hold real project entries; no foreign TS/Prisma/Vite stubs | **VERIFIED** |

No fix is PARTIAL. None is REFUTED. The commit log maps one fix per commit (`b8b6721`=A, `cab8966`=B, `1013ac3`=C, `e90d701`=D+E, `9572083`=F, `1abcdda`=G), each with a descriptive message — process matched the size of each change, exactly as `CLAUDE.md` prescribes.

**What remains:** one LOW correctness edge (unguarded `yt.js` field accesses, deliberately out of A–G scope), one MED process-honesty item (the Round-2 docs now describe finished work as open — addressed by this very document), one known-by-design coverage gap (`lib/plugin-context.js` ~58%), and two trivial doc lags. Nothing architectural.

---

## Verdict — how much did the bar rise?

**Substantially, and verifiably — this is a real step up, not a relabel.** Precisely:

- **No HIGH findings. No real bug.** The highest open *correctness* severity is **LOW** (the unguarded `yt.js` accesses). The one **MED** is purely process-honesty (stale audit docs), not behavior.
- **The seam holds on both shipped plugins.** `yt.js` and `cdk.js` reach the network, shell, and prompts only through `ctx`. No `https`/`child_process` require, no shell-string interpolation, on any executed path.
- **The gate is honest *and* green.** Round 2's single most damning finding was a `100%` coverage gate that could never pass and structurally excluded `bin/mini`. I re-ran the documented enforcement command: **`EXIT=0`**, 112 tests pass, totals **84.19% lines / 80.24% branches / 86.27% functions** across `bin/` + `lib/` + `plugins/`, with `bin/mini` itself now at **93.75% lines**.
- **The entry point is tested.** `bin/mini` went from untestable-and-unmeasured to exercised against temp-dir plugin fixtures, without ever spawning the CLI.
- **The knowledge base is real.** The actual hard-won lessons are recorded.
- **Quantified:** tests **98 → 112**; coverage gate **red → green** at the honest **84/80/86** floor.

The two fixes that mattered most are backed by tests that would *fail on regression*, not mere shape checks — that is what distinguishes a real fix from a cosmetic one.

---

## Current standing — genuine strengths

- **The drift class is closed at its source, not its symptom (Fix C).** `tests/helpers/mock-context.js` returns `{ ...createContext(opts.develRoot || '/tmp/test-devel'), http, shell, prompt, config(hermetic), _calls }`, and `tests/lib/mock-context.test.js` iterates `Object.keys(real)` from `createContext` asserting each `in mock`, plus pins lowercase `develRoot` — the exact key whose case-drift hid the original `bb` crash. The fake can no longer silently diverge from runtime shape. Best-in-class for a `node:test`, zero-dep setup.
- **The mutable `YT_BASE` global is genuinely eliminated (Fix B).** Only `const YT_BASE_DEFAULT` (`plugins/yt.js:6`) remains; `ytBase(ctx)` (`:26-27`) reads `ctx.ytBase || YT_BASE_DEFAULT`. `tests/plugins/yt.test.js` proves two consecutive runs with different `YT_BASE` hit different hosts with no leak.
- **`bin/mini` is testable and measured (Fix D).** `require.main === module` guard, `module.exports = { loadPlugins, usage, main }`, `main(argv, root)` and `loadPlugins(root)` parameterized. `tests/bin/*.test.js` is folded into both the `npm test` and the coverage globs.
- **Fail-loud is real and tested (Fix E).** On an unknown command, `bin/mini` lists each plugin that failed to load this run with its file and error before `usage()` + exit. A test loads a deliberately broken plugin and asserts the attribution appears.
- **The gate is honest, not gamed (Fix F).** Thresholds match the embedded enforcement command; `CLAUDE.md` documents a genuine ratchet (raise to lock gains, never lower to pass; 100% stays the target) and names `plugin-context.js` as the remaining gap.
- **Zero-dependency discipline held throughout.** 112 tests on `node:test`, native coverage, no framework / mocking lib / coverage tool added; the last `child_process` monkeypatch was *removed*, not retained.

---

## Current standing — remaining findings

### 1. Unguarded field accesses in `yt.js` render paths — `[LOW]` `[CARRY-OVER]`

`issue.idReadable.padEnd(...)` and `issue.summary.substring(...)` are called with no guard at three sites: `showQueue` (`plugins/yt.js:342`), `listIssues` (`:408`), `searchIssues` (`:450`). An issue missing either field throws a raw `Cannot read properties of undefined` mid-render instead of the project's curated `✗` error. Lines shifted ~+5 from Round 2 (was 337/403/445) after Fix B's additions — confirming this was never in the A–G handoff and is correctly still open.

Proportionate and near-theoretical: the code issues explicit field-list queries, so YouTrack reliably returns these fields. Cheap fix when `yt.js` is next touched: `(issue.idReadable || '?').padEnd(12)` and `(issue.summary || '').substring(...)`, plus a fixture with a null summary to cover the branch.

### 2. ~~The Round-2 audit docs describe completed work as open~~ — `[MED]` `[PROCESS-HONESTY]` — RESOLVED by this round

*Recorded for the trail.* The Round-2 `docs/self-assessment.md` still marked `#3`/`#4`/`#5`/the beads stubs as **STILL OPEN** and reported **98 tests** — all resolved and merged — and `docs/open-findings-handoff.md` framed the completed A–G work as TODO, even embedding the **old always-red command** (`--test-coverage-lines=100 … tests/plugins/*.test.js tests/lib/*.test.js`) that Fix F replaced. That was the project's recurring process-vs-prose theme moved up one floor into the docs — sharp, given Fix F. Closed here: this document supersedes the stale self-assessment, the defunct handoff was retired, and `README.md`'s reference to deleted `mock-*.js` fakes was corrected.

### 3. `lib/plugin-context.js` still ~58% lines — `[LOW]` `[STILL-OPEN-BY-DESIGN]`

Coverage report: `plugin-context.js | 58.15 | 92.31 | 76.47 | 32-111` — the prompt / http / shell / `readConfig` branches. This is **not a regression**: Fix F made the gate *honest*, it never claimed to raise coverage. This is the largest gap and the real next coverage work — grown by adding fixtures, per the documented invariant (add data, not mock logic), not by deleting code paths.

### 4. Minor smell: `run()` mutates the injected `ctx` — `[LOW]` `[NIT]`

Fix B resolves the reported defect cleanly, but `plugins/yt.js:584` does `ctx.ytBase = cfg.YT_BASE || YT_BASE_DEFAULT` — i.e. it *writes* onto the injected context rather than threading the resolved base as a parameter. It is the one spot where a plugin writes back onto the injected world instead of reading from it. Harmless here (`ctx` is freshly built per process, and the no-leak test proves it), and far milder than the original module global — so it does **not** count against Fix B. Optional: pass the base as an argument to `ytGet`/`ytPost`/`showIssue` to keep `ctx` read-only. Not worth a dedicated PR.

---

## What's left — prioritized

1. **Doc hygiene (MED, cheapest honest move):** *done this round* — retired `docs/open-findings-handoff.md`, fixed the `README.md` testing-model line, and replaced the stale self-assessment with this document.
2. **Robustness polish (LOW):** add the three one-line null-guards in `yt.js` plus a summary-less fixture.
3. **Coverage ratchet (LOW, ongoing):** grow `lib/plugin-context.js` fixtures toward the prompt/http/shell branches, then raise the floor to lock the gain.
4. **Optional nit:** thread the resolved `YT_BASE` as a parameter instead of writing `ctx.ytBase`.

---

## On "virtue or vanity?"

The README's open question — *is zero-dependency a virtue or a vanity?* — gets a clearer answer this round. The bar is now high enough that **every remaining item is robustness polish or doc-hygiene, not architecture.** The seam holds, the gate is honest and green, the entry point is tested, the test fake can no longer drift from runtime, and the knowledge base records the project's real lessons — all on `node:test` and native coverage, with no framework added. Zero-dependency did not cost correctness or testability here; it bought a codebase still holdable in one sitting. On the current evidence that reads as a virtue, not a vanity. The discipline that paid off most was not the dependency count — it was deriving the test world from the real one. Keep that invariant and the next round will be even shorter.
