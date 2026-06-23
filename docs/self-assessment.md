# A Friend's Audit: Holding `mini-control-plane` to Its Own Bar

A paid scanner recently scored this repo 40/100; we think the tool is fine and simply mis-scaled for a three-command personal CLI, so rather than argue a number we did the more useful thing and turned its own stated principles back on it. What follows is a self-assessment — strong where it needs to be, but from a friend who wants the project to live up to what its README promises.

> **Update (post-audit):** the `bb` (Bitbucket) plugin was removed entirely — it was unused and was the locus of findings **#1** and **#2** below. Those two are **resolved by removal**; the orphaned `tests/helpers/mock-https.js` (which existed only because that plugin bypassed `ctx.http`) was removed with it. A design handoff for any future reimplementation lives in [`docs/bitbucket-plugin-handoff.md`](bitbucket-plugin-handoff.md). The remaining findings (#3–#5 and proportionality) still stand. The findings below are kept verbatim as the record that motivated the removal.

## What the repo gets genuinely right

Before the critique, credit where it's earned — specifically, not as throat-clearing.

- **The dispatcher is as thin as advertised.** `bin/mini` is 67 lines: discover plugins, build a context, route on `command`. It does exactly what Principle #2 says ("thin dispatcher, fat-free plugins") and nothing more. The plugin contract (`commands`, `describe`, `run(args, ctx)`) is uniform across all three plugins, so the "three worked examples at increasing complexity" framing in the README is accurate.

- **The injected-context seam is real, and it works.** This is the project's central bet — `createContext(develRoot)` (`lib/plugin-context.js:158`) hands plugins `http`, `shell`, `prompt`, `format`, `config`. In `plugins/cdk.js` and `plugins/yt.js` it is honored completely: every HTTP call, every shell-out, every prompt goes through `ctx`. That's *why* their tests replay recorded fixtures with zero network and zero monkeypatching. The thesis demonstrably holds for two of three plugins.

- **Zero-dependency is delivered, not just claimed.** `package.json` carries no `dependencies` and no `devDependencies`. The runner is `node:test`; coverage is native `--experimental-test-coverage`; the fakes (`mock-https`, `mock-context`, `mock-exec`) plus recorded fixtures are a clean, framework-free pattern. 106 tests pass, fast. This is the project's strongest principle and it fully holds.

- **Secrets stay out of the tree, in practice.** `config/cdk.json` is gitignored and untracked; `cdk.example.json` ships only `000000000000` placeholders; credentials live in `$HOME` dotfiles; the Bitbucket token file is written `mode: 0o600`; `yt config` masks `TOKEN`/`PASSWORD`/`SECRET` keys. Principle #5 is lived, not just stated.

- **The high-blast-radius path is the safe one.** `plugins/cdk.js` orchestrates a multi-step AWS deploy entirely through `ctx.shell.run`/`capture` with **argument arrays** (no shell strings), passes the AWS profile via env, threads CDK context as discrete `-c key=value` array entries, and gates destructive operations behind an STS identity check and an interactive confirmation. This is the design working under real complexity.

- **Fail-loud is exemplary where it's applied.** Missing YouTrack token and missing Bitbucket credentials (`plugins/bitbucket.js:121-133`) exit non-zero and name exactly what to add and where.

That foundation is what makes the following critique fair: the gaps below are inconsistencies against a genuinely good design, not symptoms of a bad one.

## Where the repo falls short of its own principles

### 1. A shipped crash, and a test shaped to hide it — `[HIGH]`

`createContext` exposes `develRoot` (lowercase, `lib/plugin-context.js:180`). But `plugins/bitbucket.js:66` destructures the context as `async run(args, { DEVEL_ROOT })` (uppercase), then calls `path.join(DEVEL_ROOT, '..')` at lines 71 and 152. There is no `DEVEL_ROOT` on the real context, so the value is `undefined`. Reproduced directly:

```
$ node bin/mini bb local
The "path" argument must be of type string. Received undefined
```

Two of the three Bitbucket subcommands (`local`, `compare`) crash on invocation. Worse is *why the suite stays green*: the test hand-builds its own context with the same wrong key —

```js
// tests/plugins/bitbucket.test.js:13
const CONTEXT = { DEVEL_ROOT: path.join(__dirname, '../..'), path, fs };
```

So the test and the bug agree, and 106 passing tests *validate* the defect rather than catch it. This is the most important finding precisely because it's a textbook demonstration of the project's own thesis: injecting the world only protects you if the test world matches the real one. `cdk.js:31` reads `ctx.develRoot` correctly — the Bitbucket plugin is simply inconsistent with its siblings.

**Fix:** destructure `{ develRoot }` (update lines 66/71/152), delete the local `CONTEXT` literal, and have the test consume the real `createContext(...)` output. A single shared fake-context helper for all plugin tests would stop this class of drift permanently.

### 2. "Inject the world" — broken in the one plugin that touches the world — `[MED]`

Principle #3 — the one the README calls *"the single design decision that makes 100% offline tests possible,"* and which `plugins/README.md:36` restates in bold ("never use `require('https')`/`child_process` directly") — is violated on every path in `plugins/bitbucket.js`. It does `const https = require('https')` at module load (line 3), `const { execSync } = require('child_process')` inside `run` (line 67), and builds shell strings by interpolation:

```js
execSync(`find "${clusterRoot}" -maxdepth 4 -name "config" -path "*/.git/config"`, ...)  // :76
execSync(`git -C "${repoDir}" remote -v`, ...)                                            // :82
```

Two consequences, in order of importance:

1. **The seam is broken**, so these paths can't be exercised by the record-and-replay fakes — which is exactly why the test resorts to monkeypatching `cp.execSync = () => ''` (`tests/plugins/bitbucket.test.js:150`), violating Principle #6 ("add a fixture, not mock logic") as a direct downstream effect. `compare` (lines 152-183) ends up uncovered entirely.
2. **A small injection surface**, which is genuinely **low** risk: `clusterRoot`/`repoDir` are locally derived from a `find` walk under `develRoot/..`, not user input. An attacker would already need write access under the cluster root. Worth fixing for correctness and seam-hygiene, not because it's an imminent breach.

**Fix:** route `find`/`git` through `ctx.shell.capture` with argument arrays (`cdk.js` shows how), then cover `local`/`compare` with the standard fixture approach and drop the monkeypatch.

### 3. The "100% coverage" story has three cracks — `[MED]` / `[LOW]`

- **The gate can't pass.** `.coverage-thresholds.json` declares `lines/branches/functions/statements: 100` with `blockPRCreation: true` and `blockTaskCompletion: true`. The actual enforced command reports **82.19% lines / 79.00% branches / 85.32% functions** (reproduced). An honest agent running the documented gate before a PR blocks itself every time. CLAUDE.md is admirably candid that 100% is aspirational and not yet met — so the fault is not dishonesty, it's that a machine-readable, PR-blocking config disagrees with the committed prose. A gate that is always red is identical to no gate. `[MED]`

- **The headline omits the entry point.** The enforcement command globs only `tests/plugins/*.test.js` and `tests/lib/*.test.js`. `grep -rn bin/mini tests/` returns nothing — the 67-line dispatcher every invocation runs through is **0% covered and not even counted**. "100% on production code" carries an unstated asterisk: it means `lib/` + `plugins/` only. `[LOW]`

**Fix:** set thresholds to the real current floor and ratchet upward (the incremental approach CLAUDE.md already advocates), reserving `blockPRCreation: true` for a number you actually meet; add a small `tests/bin/mini.test.js` and fold `bin/` into the coverage scope, or state plainly in the README that the figure excludes the dispatcher.

### 4. "Fail loud" vs. the silent plugin-load swallow — `[LOW]`

`bin/mini:14-18` wraps `require()` of each plugin in a `try/catch` that writes a one-line stderr warning and continues. A plugin with a syntax error doesn't crash the tool — its command simply vanishes from `help`, and invoking it later reports the misleading `Unknown command: X` rather than the real cause. Resilience (one bad plugin shouldn't kill the others) is a legitimate choice, which is why this is `[LOW]` and debatable rather than a bug — but it's the *unstated opposite* of a loudly-declared principle. Make the choice explicit: either name the dropped command and have "Unknown command" hint that a load failed this run, or document load errors as intentionally non-fatal. Either way, pin it with a test.

### 5. A real (small) wart in `yt.js` — `[LOW]`

`yt.js` at 614 lines holding ~16 verbs is, frankly, still plausibly readable in one sitting — it's clean, well-factored into named functions, and the README's Principle #7 challenge doesn't clearly fail here. We won't overstate it. The genuine, falsifiable smell is the **reassigned module-level global**: `let YT_BASE = '...'` (`yt.js:5`) is mutated at runtime inside `run` (`YT_BASE = cfg.YT_BASE || YT_BASE`, line 579) and read by builders and `showIssue` (line 366). That's shared mutable state in a file whose siblings pass everything through `ctx`. Thread `YT_BASE` through `cfg`/`ctx` instead; if a split ever feels warranted, the loader already ignores `_`-prefixed files.

## Proportionality: is the ceremony earning its keep?

This is a fair, common-sense question — and one the README *invites* by openly asking whether zero-dependency is "a virtue or a vanity." Around ~1,420 lines of production code sit metaswarm, a BEADS knowledge base, PR-blocking coverage gates, and an RFC-grade README. Most of this is fine, and some of it is genuinely admirable: CLAUDE.md explicitly declares metaswarm runs in "lightweight mode" with no mandatory pipeline, and the self-critical README posture is exactly right. So this is a *watch-the-trend* note, not a fault.

The one narrow, verifiable point: the BEADS knowledge files are provisioned but near-empty — each of the seven `.beads/knowledge/*.jsonl` files is ~4 lines. They signal a practice not yet exercised. That's the gap to close, and the `DEVEL_ROOT` bug above is a perfect first entry. Either populate them with real gotchas or drop the stubs; scaffolding that suggests more rigor than it delivers is the only place rigor tips into ceremony here.

We are explicitly **not** faulting the repo for being small, single-author, zero-dependency, or `node:test`-based — those are intended and well-executed. Nor the Italian-English string mixing, the emoji output, or the CLI-token-in-history detail (the `0o600` write shows the author cares; for a solo local tool the exposure is the user's own shell history — a minor consistency aside at most).

## What's actually worth fixing, in priority order

1. **Fix the `DEVEL_ROOT` → `develRoot` crash** and make plugin tests consume the real `createContext` so the test world can't drift from the runtime world again. `[HIGH]`
2. **Stand up CI** that runs `npm test` on push, so green-but-wrong (finding #1) and an unenforced gate stop being possible at the same time.
3. **Add a `bin/mini` test** (load, dispatch, unknown-command, the silent-load branch) and fold `bin/` into the coverage scope — or state the scope explicitly.
4. **Move `bitbucket.js` onto `ctx.shell`/`ctx.http`**, which closes the seam break, the injection surface, and the monkeypatch all at once.
5. **Align the coverage gate with reality** — real floor + ratchet, or relabel as aspirational with enforcement off.
6. **Thread `YT_BASE` through `ctx`/`cfg`** to remove the mutable global; optionally split out pure helpers.

## Closing

This is a well-architected little tool that mostly honors a deliberately high bar — and the places it slips are precisely the places that bar predicts. The repo asks, in its own README, whether zero-dependency is a virtue or a vanity. The honest answer isn't rhetorical: it's a virtue exactly as long as the discipline it buys is *exercised* — the seam used everywhere, the gate green and meaningful, the entry point tested, the knowledge base actually written down. Keep testing that in practice, not just in prose, and the 40/100 from a mis-scaled scanner stays as irrelevant as it should be.
