# A Friend's Audit — Round 2: What Changed

*An updated self-assessment of `mini-control-plane`, written for someone who read the first one. The prior audit is preserved in git history; this replaces it as the canonical record.*

Since the last audit we did one decisive thing: we **deleted the `bb` (Bitbucket) plugin**. It was unused, and it happened to be the locus of the two heaviest findings. This round re-reads the actual current tree (`plugins/` now holds only `yt.js` and `cdk.js`), reproduces the numbers, and asks the honest question: did removing it actually make the repo better, or did it just relocate the problems?

The short answer: it genuinely improved the repo on the axis that matters most — the worst defect is gone at the source, and the central design bet now holds on **every** shipped plugin. But removal fixes only what removal can reach. Everything that required *discipline* rather than *deletion* is unchanged.

---

## What changed since the last audit

| # | Finding (baseline) | Severity | Status now |
|---|---|---|---|
| 1 | `bb` destructured `{ DEVEL_ROOT }` while context exposes `develRoot` → `bb local`/`compare` crashed; the test reused the same wrong key, so the suite stayed green | HIGH | **RESOLVED** (plugin removed) |
| 2 | "Inject the world" broken in `bb`: direct `require('https')` + `child_process` + `execSync` string interpolation, forcing a monkeypatch | MED | **RESOLVED** (plugin removed) |
| — | Orphaned `tests/helpers/mock-https.js` (existed only for `bb`'s raw `https`) | — | **RESOLVED** (deleted with `bb`) |
| 3 | "100% coverage" gate can't pass; `bin/mini` structurally excluded from scope | MED | **STILL OPEN** (now 83.46/80.21/86.60) |
| 4 | Silent plugin-load swallow in `bin/mini` contradicts "fail loud" | LOW | **STILL OPEN** |
| 5 | `yt.js` mutable module global `YT_BASE` | LOW | **STILL OPEN** |
| — | Seven `.beads/knowledge/*.jsonl` near-empty; `bb` lesson never recorded | LOW | **STILL OPEN** |

**Verified facts (reproduced this round):** 98 tests pass (down from 106 with `bb`'s tests gone), in well under half a second. Coverage on production code (`lib/` + `plugins/`, excluding `bin/`) is **83.46% lines / 80.21% branches / 86.60% functions** — up from the baseline 82.19 / 79.00 / 85.32. A small, real tick upward. `grep` across `plugins/` for `https` / `child_process` / `execSync` / `spawnSync` finds **only** the prose rule in `plugins/README.md:36`. The only `develRoot` reads (`cdk.js:31,34`) use the correct lowercase key matching `lib/plugin-context.js:180`. No residual key drift, no residual seam break.

### New this round

- **`tests/helpers/mock-exec.js` is now dead monkeypatch scaffolding.** `[LOW]` `[NEW]` It still does `const cp = require('child_process')` and reassigns `cp.execSync` (lines 20, 57, 60, 74) — the exact anti-pattern the README rejects — but `withExecMock` and *its own* `urlMatcher`/`anyMatcher` are no longer imported by any test. (To be precise: the `urlMatcher`/`anyMatcher` the tests actually use come from `mock-context.js:57`, imported at `yt.test.js:9`. Only `captureOutput` is consumed from `mock-exec.js`, at `yt.test.js:8` and `cdk.test.js:8`.) So roughly lines 1–77 of `mock-exec.js` are dead — the direct parallel to the `mock-https.js` orphan we *did* sweep. The cleanup stopped one file short.
- **The *structural cause* of #1 was never addressed.** `[MED]` `[CARRY-OVER, sharpened]` The acute crash is gone, but the mechanism that *hid* it still stands: `createMockContext` (`mock-context.js:14-55`) is a hand-rolled object literal with a hardcoded `develRoot: '/tmp/test-devel'` and a `config.read` (lines 37–44) that ignores the dotfile entirely and substitutes a fake token. It is **not** derived from, nor validated against, the real `createContext`. The prior audit itself prescribed "a single shared fake-context helper… to stop this class of drift permanently" — that fix was not built. If a future plugin drifts on a context key, a matching wrong key in this fake could again let the suite stay green on a real crash.
- **Two unguarded field accesses in `yt.js`.** `[LOW]` `[NEW]` `showQueue`/`listIssues`/`searchIssues` render `issue.idReadable.padEnd(...)` and `issue.summary.substring(...)` (yt.js:337, 403, 445) with no null guard. A YouTrack issue missing a `summary` would throw a raw `Cannot read properties of undefined` stack trace instead of the project's curated `✗` error. This is a thin robustness edge, not a likely crash — YouTrack reliably returns these fields for the explicit field-list queries the code issues — so keep it firmly LOW: a one-line defensive default, not a systemic fail-loud violation.

### Explicitly *not* a finding

An earlier draft flirted with faulting both plugins for calling `require('fs')`/`path`/`os` directly instead of `ctx.fs`/`ctx.path`. That is **not** a real violation. `plugins/README.md:36` binds only `https` and `child_process` ("è ciò che rende i plugin testabili offline"); `fs`/`path` are deterministic, `cdk.js` tests drive real temp dirs via `MINI_CDK_CONFIG`, and coverage is not blocked by it. At most this is a one-line README clarification (say plainly that only `http`/`shell`/`prompt` *must* be injected). It is not a seam break and is not counted against the project.

---

## Verdict

**The repo improved — really, but partially.** The single highest-severity finding (`[HIGH]` #1, a shipped crash masked by a complicit test) and the most important architectural finding (`[MED]` #2, the broken "inject the world" seam) are both **resolved at the source**, not papered over. With `bb` gone, the injected-context thesis — the project's central bet — now holds on **2 of 2** shipped plugins instead of 2 of 3: every HTTP call, every subprocess, every prompt in `yt.js` and `cdk.js` flows through `ctx`. The removal was disciplined: plugin, its test, *and* the orphaned `mock-https.js` were swept together, with a forward-looking `docs/bitbucket-plugin-handoff.md` preserved rather than silently dropped. The README was correctly updated to "two worked examples" / "YouTrack / AWS." That is the responsible way to retire dead code.

What removal could **not** fix, it did not fix. Every process-and-discipline carry-over survives unchanged: the always-red coverage gate, the untested entry point, the silent plugin-load swallow, the `YT_BASE` global, and seven near-empty knowledge files. And the cleanup left two new low-stakes residues (dead `mock-exec` machinery, plus the stale prose this document now replaces). So: a real step up in **code health and architectural consistency**, no movement on **process-vs-prose honesty**. Proportionate to a ~1,200-line, two-command, single-author, zero-dependency personal CLI, that is a good trade — but let's not call deleting a plugin a transformation.

---

## Current standing

### Genuine strengths that hold

- **The two worst baseline defects are gone, not hidden.** Verified by `grep`: `DEVEL_ROOT` appears only as `bin/mini`'s own local const; no plugin requires `https`/`child_process` or interpolates a shell string on any executed path.
- **The injected-context seam now holds on 100% of shipped plugins.** `cdk.js` orchestrates a genuinely high-blast-radius AWS deploy/destroy entirely through `ctx.shell` with **argument arrays** (no string interpolation; the one interpolated string at `cdk.js:252` is display-only, printed for the user to copy), gated behind an STS `get-caller-identity` check and an explicit interactive confirm before any destructive action. The design earns its keep under real complexity.
- **Zero-dependency is delivered, not merely claimed.** No `dependencies`, no `devDependencies`; runner is `node:test`; coverage is native `--experimental-test-coverage`; fakes replay recorded JSON fixtures with no network and no monkeypatching of production code. 98 tests pass fast. Coverage even ticked up post-removal.
- **Secrets discipline is lived.** `config/cdk.json` gitignored with `000000000000` placeholder account IDs, a `MINI_CDK_CONFIG` test escape hatch, `$HOME` dotfile for YouTrack, and `yt config` masks `TOKEN`/`PASSWORD`/`SECRET` keys (`yt.js:220`).
- **The dispatcher is as thin as advertised** (`bin/mini`, 67 lines: discover, build context, route) and the `commands` / `describe` / `run(args, ctx)` contract is uniform — the abstraction is still holdable in one sitting.
- **The project audits itself and acts.** It ran the prior audit, fixed its top two findings, and kept a written record. That responsiveness is itself a strength.

### Findings that remain (stated freshly)

- **`[MED]` `[CARRY-OVER]` The 100% coverage gate cannot pass and silently excludes the entry point.** `.coverage-thresholds.json` declares `lines/branches/functions/statements: 100` with `blockPRCreation: true` and `blockTaskCompletion: true`, while reproduced coverage is 83.46 / 80.21 / 86.60. The enforcement command globs only `tests/plugins` and `tests/lib`, so `bin/mini` — version path, unknown-command path, the silent-catch — is never executed by the gated suite and never measured. The largest gap shifted from `bb` to `lib/plugin-context.js` at **58.15% lines** (32–111: prompts, `httpRequest`, `shellRun`/`shellCapture`, `readConfig`). The fault is narrow and fair: not "coverage too low" (CLAUDE.md is candid the 100% target is aspirational), but a machine-readable PR/task-blocking config that an obedient agent would never satisfy. A gate that is always red is identical to no gate.
- **`[MED]` `[CARRY-OVER, sharpened]` The drift-prevention behind #1 was never built.** `createMockContext` re-declares the context shape by hand instead of deriving it from the real `createContext`, and re-implements `config.read` with different semantics (ignores the dotfile). The acute bug is gone; the latent risk class the self-assessment itself named is still here.
- **`[LOW]` `[CARRY-OVER]` Silent plugin-load swallow vs. "fail loud."** `bin/mini:14-18` catches a `require()` failure, writes a one-line stderr warning, and continues; if the broken plugin owned the typed command, the dispatcher then reports a misleading `Unknown command` (the cause and the symptom are decoupled). Defensible as resilience — which is why it stays LOW and reads as a design tension, not a defect — but it is the one spot that fails quiet.
- **`[LOW]` `[CARRY-OVER]` `yt.js` mutable module global.** `let YT_BASE` (yt.js:5) is reassigned at runtime inside `run()` (yt.js:579) and read by `ytGet`/`ytPost` (26, 30) and `showIssue`'s attachment URLs (366). Harmless in a one-shot CLI, but the lone piece of shared mutable state in a file whose every sibling concern flows through `ctx`.
- **`[LOW]` `[NEW]` Dead `mock-exec.js` machinery.** Only `captureOutput` is used; `withExecMock` + the `child_process` monkeypatch are orphaned — the unfinished half of the `mock-https.js` sweep.
- **`[LOW]` `[NEW]` Unguarded `issue.summary.substring` / `idReadable.padEnd`** (yt.js:337, 403, 445) — a partial API response would surface as a raw stack trace. Thin edge, defensive-default fix.
- **`[LOW]` `[CARRY-OVER]` Provisioned-but-empty knowledge base.** The seven `.beads/knowledge/*.jsonl` files are still 4 lines each (28 total) — unchanged foreign-project example stubs (TypeScript/Prisma/Vite), unrelated to this Node CLI. Notably, the `bb`-removal lesson — a textbook "the test world must match the real world" learning the prior audit *nominated as the obvious first entry* — was never recorded there; it lives only in prose. CLAUDE.md legitimately runs metaswarm in lightweight mode, so a sparse KB is a fair choice; the only sharp edge is scaffolding that signals more rigor than is exercised.

---

## What's still worth doing (prioritized)

1. **Align the coverage gate with reality, then ratchet.** Set thresholds to the honest current floor (~83 / 80 / 86) with `blockPRCreation`/`blockTaskCompletion` reflecting a number actually met, and raise them as fixtures grow — exactly the incremental path CLAUDE.md already advocates. The biggest single win is fixtures for `lib/plugin-context.js`'s prompt/http/shell branches.
2. **Add `tests/bin/mini.test.js` and fold `bin/` into the coverage scope** (or document explicitly that the dispatcher is out of scope). It has real branches — version, unknown-command, the silent catch — and right now none are measured.
3. **Make the plugin-load failure explicit.** Keep loading the other plugins, but track failures and, when a command isn't found, say `command X unavailable: plugin Y failed to load: <err>` instead of a generic `Unknown command`. Connect cause to symptom.
4. **Sweep the dead `mock-exec` machinery.** Move `captureOutput` into its own `capture-output.js` and delete `withExecMock` + the `child_process` require — finish the cleanup that `mock-https.js` started.
5. **Thread `YT_BASE` through `cfg`/`ctx`** into `ytGet`/`ytPost`/`showIssue` and drop the module-level `let`. Small, mechanical, removes the only mutable singleton.
6. **Build the shared fake-context helper** the prior audit prescribed: derive `createMockContext` from the real `createContext` so any context-shape change surfaces in one place. This closes the *class* of bug #1 belonged to.
7. **Either populate or prune the `.beads` stubs.** The `bb`-removal / test-world-drift lesson is the perfect first real entry in `gotchas.jsonl` + `decisions.jsonl`; if the KB isn't being used, delete the seven foreign-project stubs to match the project's own "readable in one sitting" bar.

---

The README leaves one question open: *is zero-dependency a virtue or a vanity?* This round gives the strongest evidence yet that it is a virtue. The discipline was tested the only way that counts — under pressure to keep a convenient, already-written plugin that quietly broke the rule — and the project chose to delete it rather than carry it. What remains now honors the seam on every path: no plugin reaches around `ctx` for the network or the shell, the tests replay fixtures with zero monkeypatching of production code, and the whole thing still fits in your head. The remaining work is bookkeeping — making the committed gates and docs tell the same true story the code now tells. A constraint you'll delete working code to preserve isn't vanity. It's a load-bearing wall.
