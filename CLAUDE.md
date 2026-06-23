# Project Instructions

`mini-cli` — EthicLab personal CLI orchestrator. Solo-maintained, zero-dependency Node.js.

This project has [metaswarm](https://github.com/dsifry/metaswarm) installed but runs it in a **lightweight mode**: use its commands when they help, skip the heavy multi-agent gates. There is no mandatory pipeline — match process to the size of the change.

## How to Work

- **Small change (1 file, obvious):** just do it. Write/adjust a test, make it pass, commit. No ceremony.
- **Larger change (multi-file, new plugin, refactor):** sketch the approach, optionally use `/brainstorm` or `/start-task` to scope it, then implement test-first.
- Use `EnterPlanMode` freely when you want a plan — there is no requirement to route through `/start-task`.
- Optional commands (all real shims in `.claude/commands/`): `/start-task`, `/prime`, `/brainstorm`, `/review-design`, `/self-reflect`, `/pr-shepherd`. Reach for them when useful, not because a gate demands it.

## Testing

- **TDD is the default for non-trivial code** — write the test first, watch it fail, then implement. For a trivial one-liner, a test-after is fine.
- Test command: `npm test` (= `node --test tests/bin/*.test.js tests/plugins/*.test.js tests/lib/*.test.js`)
- Coverage command: `node --test --experimental-test-coverage --test-coverage-exclude='tests/**' --test-coverage-lines=86 --test-coverage-functions=86 --test-coverage-branches=80 tests/bin/*.test.js tests/plugins/*.test.js tests/lib/*.test.js` (excludes `tests/` so the gate measures only production code: `bin/` + `lib/` + `plugins/`)
- Test runner is Node's built-in `node:test` — **no test framework dependency**. Keep it that way.
- **Fakes over live calls**: network/IO services (YouTrack, AWS, `exec`) are tested through extensible simulators in `tests/helpers/` (`mock-context.js`, `mock-exec.js`) backed by recorded fixtures in `tests/fixtures/`. To cover a new branch, capture the real interaction from the tool's logs, drop a new fixture JSON, and let the simulator replay it — add data, not mock logic. Keep recorded fixtures (what the server returned) separate from simulator logic (how the fake picks a fixture).

## Coverage

`.coverage-thresholds.json` is the **source of truth** for coverage. Its thresholds are the **honest current floor**, not the 100% aspiration — set so the documented command actually *passes* (a gate that's always red is no gate). **Ratchet policy:** when coverage improves, raise the thresholds to lock it in; never lower them to make a change pass. 100% on production code remains the target to drive toward incrementally by growing fixtures/simulators, not by deleting code paths.

Current floor (2026-06-23, 115 tests, production code = `bin/` + `lib/` + `plugins/`): **86.61% lines / 80.50% branches / 86.54% functions** (thresholds ratcheted to 86/80/86). Largest gap: `lib/plugin-context.js` (~58% — the real `prompt`/`http` impls use `readline`/`https`, so closing it cleanly needs stream/server test seams without breaking the no-network rule; left as documented ongoing work).

## Code Quality

- Plain Node.js / JavaScript (CommonJS, `require`), targeting `node >=18`
- **Zero runtime and dev dependencies** — `package.json` has no `dependencies`/`devDependencies`. Do not add a dependency without explicit approval; prefer Node built-ins.
- No linter/formatter configured — match the surrounding code style (2-space indent, single quotes, semicolons)
- `bin/mini` is a plugin dispatcher; capabilities live in `plugins/*.js`, each exporting `commands`, `describe`, `run(args, ctx)`. Add new capabilities as plugins, not by editing the dispatcher.

## Subagent Discipline

When dispatching subagents (coding or review), they must:

- **NEVER** use `--no-verify` on git commits or `git push --force` without explicit approval
- **STAY** within the declared file scope
- Follow the testing rules above; the orchestrator verifies, agents don't self-certify

## Key Decisions

- **Zero-dependency by design** — `mini` is a plugin dispatcher built only on Node built-ins. The test runner is `node:test`, coverage is native (`--experimental-test-coverage`). Reaching 100% must not require adding a test framework, mocking library, or coverage tool. If a task seems to need one, stop and reconsider.
- **Record-and-replay fake services** — External integrations (YouTrack, AWS, shell `exec`) are never hit live in tests. They are replayed through extensible simulators in `tests/helpers/` against recorded fixtures in `tests/fixtures/`. Coverage of error/edge branches (timeouts, 401/404, malformed JSON/XML, non-zero exit codes) is achieved by capturing real interactions from the tool's own logs and adding them as new fixtures. **Invariant:** recorded fixtures (raw server responses) stay separate from simulator logic (how a fake selects a fixture for a request) — extend the fakes by adding data files, not by editing mock code.

<!-- Add further project-specific notes or constraints below. -->
