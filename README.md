# `mini` — a personal control-plane CLI

> **Status:** experimental · single-author · **Request for Comments**
> **Stack:** Node.js ≥ 18 · zero runtime dependencies · `node:test`
> **This document is an invitation.** Ideas, pull requests, critiques, and "why on earth did you do *that*" are all welcome — see [§8 Request for Comments](#8-request-for-comments).

---

## Abstract

`mini` is a tiny command-line orchestrator for a personal multi-repository workspace.
It is built around one claim worth arguing about:

> A useful internal CLI can be **read in a single sitting**, ship with **zero dependencies**, and still be **fully testable** — if you inject the outside world instead of reaching for it.

Everything that touches the world (HTTP, the shell, the filesystem prompts, config) arrives through an injected `context` object. The core is a ~60-line dispatcher. Each capability is a self-contained plugin. There are no secrets, accounts, or environment-specific values in the source tree — they live in user dotfiles and git-ignored config. The test suite never makes a network call; it replays recorded fixtures through extensible fakes.

This repo is published less as a product and more as a **design artifact** — a small, complete example of a set of opinions. Tell me where they break.

---

## 1. Motivation

Anyone maintaining several repositories accumulates glue: "open the dirty repo", "deploy that static site", "move this ticket to done". The usual answers are unsatisfying at personal scale:

- **Bespoke shell scripts** rot quietly. They reach straight for `curl`, `aws`, environment variables, and hard-coded hostnames, so they are essentially untestable and quietly leak secrets and customer names into history.
- **Heavyweight task runners / frameworks** invert the cost: a lot of machinery, dependency trees, and concepts for what is, honestly, a handful of commands.

`mini` is a deliberate point between the two: small enough to fully understand, structured enough to test, and disciplined about never baking environment- or customer-specific knowledge into the code.

---

## 2. Design principles

1. **Zero dependencies.** Runtime and dev. `package.json` has empty (absent) `dependencies`/`devDependencies`. The test runner is Node's built-in `node:test`; coverage is `--experimental-test-coverage`. Adding a dependency is a deliberate, justified event — not a reflex.
2. **Thin dispatcher, fat-free plugins.** `bin/mini` only discovers plugins and routes a command to one. All behavior lives in `plugins/*.js`.
3. **Inject the world.** Plugins never `require('https')` or call `aws` directly. They receive a `context` with `http`, `shell`, `config`, `prompt`, `format`. This is the single design decision that makes 100% offline tests possible.
4. **Everything explicit.** No silent environment defaults that could send a deploy to the wrong region or account. Missing required config fails loudly, with a message that names what's missing.
5. **Secrets and environment out of the tree.** Tokens, accounts, hostnames, customer domains live in `~/.<tool>` dotfiles and git-ignored `config/*.json`. The committed code ships only generic placeholders. (This repo's history was rewritten once to enforce this retroactively.)
6. **Record-and-replay tests.** External services are replayed from fixtures through extensible simulators in `tests/helpers/`. To cover a new branch you add a captured fixture, not mock logic.
7. **Readable in one sitting.** If a contributor can't hold the whole thing in their head, the abstraction is wrong.

---

## 3. Architecture

```
              $ mini yt done ABC-12
                      │
                      ▼
        ┌───────────────────────────┐
        │  bin/mini  (dispatcher)    │   loads plugins/*.js,
        │  ~60 lines                 │   routes command → plugin
        └───────────────────────────┘
                      │ run(args, context)
                      ▼
        ┌───────────────────────────┐        ┌──────────────────────┐
        │  plugins/<name>.js         │ ◀───── │  context (injected)  │
        │  { name, commands,         │        │  http   · shell      │
        │    describe, run }         │        │  config · prompt     │
        └───────────────────────────┘        │  format · fs · path  │
                      │                        └──────────────────────┘
                      ▼                              ▲ real impl in prod
            YouTrack / AWS                           ▲ fakes in tests
```

**Plugin contract** — each file in `plugins/` exports:

```js
module.exports = {
  name: 'example',                 // canonical name
  commands: ['example', 'ex'],     // command + aliases that route here
  describe: 'one-line summary',    // shown in `mini help`
  async run(args, context) { /* ... */ },
};
```

**The `context` object** (built in `lib/plugin-context.js`, faked in `tests/helpers/`):

| Service | Shape | Purpose |
|---|---|---|
| `context.http` | `request(method, url, opts)` | HTTP, faked in tests |
| `context.shell` | `run(...)`, `capture(...)` | subprocess, faked in tests |
| `context.config` | `read(keys, dotfile, defaults)` | read `~/.<tool>` + env, with defaults |
| `context.prompt` | `yesNo`, `input`, `choice` | interactive prompts |
| `context.format` | `table(headers, rows)` | ASCII tables |
| `context.fs`, `context.path`, `context.develRoot` | Node built-ins + repo root | filesystem helpers |

**Configuration model.** Each tool reads a user dotfile (`~/.youtrack`) in `KEY=value` form, with environment variables taking precedence and code shipping generic defaults. The CDK tool reads git-ignored `config/cdk.json` (template: `config/cdk.example.json`). The source tree contains **no** real accounts, domains, hostnames, or tokens.

**Testing model.** `node:test` only. No network, ever. HTTP and shell are replaced by fakes (`tests/helpers/mock-*.js`) that match requests and replay JSON fixtures (`tests/fixtures/`). Coverage is enforced against `.coverage-thresholds.json`.

---

## 4. The plugins today

| Command | What it does |
|---|---|
| `mini yt` | YouTrack: queue, board, search, create/edit/move tickets, comments, links, tags, `config` |
| `mini cdk` | Deploy static web apps to AWS (CDK + CloudFront + S3) via an interactive wizard |

These are the author's tools; they are also meant as **two worked examples** of the plugin contract at increasing complexity (paginated read/write API client → interactive multi-step orchestration).

> A third plugin, `bb` (Bitbucket), was removed — it was unused and bypassed the injected-`context` seam (see [`docs/self-assessment.md`](docs/self-assessment.md)). A design handoff for any future reimplementation lives in [`docs/bitbucket-plugin-handoff.md`](docs/bitbucket-plugin-handoff.md).

---

## 5. Getting started

```bash
git clone <this-repo> && cd <repo>
node --version            # need ≥ 18
./bin/mini help           # list plugins
npm test                  # 100+ tests, no network

# configure a tool (example, YouTrack):
printf 'YT_TOKEN=perm:...\nYT_BASE=https://your-instance.youtrack.cloud\n' >> ~/.youtrack
./bin/mini yt config      # shows the config path + content (token masked)
```

For the CDK tool, copy `config/cdk.example.json` → `config/cdk.json` and fill in your AWS profiles.

---

## 6. Writing a plugin

1. Create `plugins/your-plugin.js` exporting the contract from [§3](#3-architecture).
2. Use `context.http` / `context.shell` for all I/O — never reach for `https`/`child_process` directly (that's what makes it testable).
3. Read config via `context.config.read(KEYS, '~/.yourtool', DEFAULTS)`. Ship generic defaults; never commit real values.
4. Add tests in `tests/plugins/` using the fake helpers and JSON fixtures. Keep coverage at the project bar.
5. Files prefixed with `_` are ignored by the loader — use them for shared helpers.

---

## 7. Non-goals

- Not a general-purpose task runner or a replacement for `make`/`just`/`task`.
- Not a framework. There is no plugin marketplace, no lifecycle hooks, no config DSL — on purpose.
- Not trying to support every OS or shell. Primary target is a Unix-like dev machine.

---

## 8. Request for Comments

This is the part that matters. The design above is a set of bets, and I'd like them stress-tested. Open an issue (or a PR) on any of these — **disagreement is the most useful contribution**:

- **Is zero-dependency a virtue or a vanity?** Where does it cost more than it saves?
- **Is `context` the right seam?** Should it be a documented, versioned contract? Too coarse? Too fine?
- **Config & secrets.** Dotfiles + git-ignored JSON works, but should this integrate with the OS keychain / a secrets manager? Is "everything explicit, fail loud" the right default, or is it just friction?
- **Plugin distribution.** Right now plugins live in one repo. Is cross-repo / installable plugins worth the complexity, or does that betray the "readable in one sitting" goal?
- **Composition.** Should plugins be able to call each other / pipe results, or is independence more valuable?
- **Testing model.** Is record-and-replay with hand-curated fixtures sustainable, or does it become a maintenance tax at scale?
- **Internationalization.** Help text is currently Italian; the contract and code are English. Worth unifying?
- **What's missing entirely?** A plugin idea, a safety rail, a footgun you can see coming.

If you just want to lurk: ⭐ and watch. If you want to argue: issues are open. If you want to build: PRs welcome — see below.

---

## 9. Contributing

- **Ideas / critiques / questions** → open an issue. No template, no ceremony. Half-formed is fine.
- **Code** → PRs welcome. The bar:
  - no new runtime/dev dependencies without discussion;
  - tests for new behavior (`node:test`, fakes + fixtures, no network);
  - coverage stays at or above the project threshold;
  - no real secrets/accounts/hostnames in code — config stays external;
  - match the surrounding style (2-space indent, single quotes, semicolons).
- Be kind. This is a small, opinionated project maintained in spare time.

---

## License

[MIT](LICENSE) © EthicLab. Use it, fork it, learn from it.

---

*`mini` is a personal project from the [EthicLab](https://ethiclab.net) workspace. It is shared as a design study, not a supported product.*
