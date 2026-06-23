# Handoff: a `bb` (Bitbucket) plugin, done right

**Status:** the previous `plugins/bitbucket.js` was **removed** (unused, and the locus of findings #1–#2 in [`self-assessment.md`](self-assessment.md)). This document is the design brief for a clean reimplementation, *if and when* it's wanted. It is not a TODO — `mini` is happy with two plugins.

**One-line task for a future implementer:**
> Read this file plus `plugins/cdk.js` (the reference for the injected-`context` seam) and implement `plugins/bitbucket.js` honoring every rule in §3, with tests that consume the real `createContext` and replay fixtures.

The old implementation is recoverable for reference — endpoints, auth, output format:
```bash
git show HEAD:plugins/bitbucket.js          # before the removal commit
git show HEAD:tests/plugins/bitbucket.test.js
```
Treat it as a **behavioral spec, not a template** — it worked, but it violated the project's own principles in exactly the ways §3 forbids.

---

## 1. What it should do (command surface worth keeping)

| Subcommand | Behavior | Needs network? |
|---|---|---|
| `bb local` | List local repos under the workspace root that have a Bitbucket remote, with slug + current branch. | No (local git only) |
| `bb list` | List all repos in the Bitbucket workspace (slug, language, privacy, last-updated), newest first. | Yes |
| `bb compare` | Diff workspace repos ↔ local clones: which remote repos are/aren't cloned locally, and which local clones have a BB remote that's gone from the server. | Yes + local git |
| `bb update-token <T>` | Write/replace `BITBUCKET_TOKEN` in the dotfile (`mode 0o600`), stamp a 90-day expiry. | No |
| `bb help` | Usage + resolved config (workspace, API host), no creds required. | No |

## 2. Contract & config

Standard plugin contract (`plugins/README.md`): export `{ name, commands: ['bitbucket','bb'], describe, async run(args, ctx) }`. The loader picks it up automatically.

Config via **`ctx.config.read`** (not a hand-rolled `fs` read), dotfile `~/.bitbucket`, env overrides:

| Key | Purpose |
|---|---|
| `BITBUCKET_TOKEN` | Bearer token (alternative to user+app-password) |
| `BITBUCKET_USERNAME` + `BITBUCKET_APP_PASSWORD` | Basic auth (preferred; scope: Repositories\:Read) |
| `BITBUCKET_WORKSPACE` | Workspace slug — **never hardcode** |
| `BITBUCKET_API_HOST` | Default `api.bitbucket.org`; overridable for self-hosted **and for test fakes** |

REST specifics (from the old code): `GET https://{host}/2.0/repositories/{workspace}?pagelen=50&sort=-updated_on`, follow the `next` URL for pagination, surface `body.error.message` on API errors. Auth header: `Basic base64(user:app_password)` or `Bearer {token}`.

## 3. Design rules — non-negotiable (these are why the old one was deleted)

1. **Use `ctx.develRoot` (lowercase).** The old plugin destructured `{ DEVEL_ROOT }`, which doesn't exist on the context — so `bb local`/`compare` threw `path.join(undefined, ...)` on every real invocation while the test passed a matching wrong key and stayed green. The root cluster dir is `path.join(ctx.develRoot, '..')`.

2. **Never `require('https')` or `require('child_process')` directly.** This is Principle #3, "the single design decision that makes 100% offline tests possible."
   - Bitbucket REST → **`ctx.http.request('GET', url, { headers })`**. (`ctx.http` is backed by the real `https` in `lib/plugin-context.js`; tests fake it through `mock-context`.)
   - Local `git`/`find` → **`ctx.shell.capture([...])` with an argument array**, never an interpolated shell string. Follow `plugins/cdk.js`, which runs every AWS/CDK call this way.

3. **No string-interpolated shell.** The old `execSync(\`git -C "${repoDir}" remote -v\`)` is both a (low, local) injection surface and an untestable path. Use `ctx.shell.capture(['git', '-C', repoDir, 'remote', '-v'])`. For the repo walk, prefer `ctx.fs` recursion or `ctx.shell.capture(['find', clusterRoot, '-maxdepth', '4', '-name', 'config', '-path', '*/.git/config'])`.

4. **Fail loud, naming what's missing.** Keep the old plugin's one genuinely good behavior: when creds are absent (for `list`/`compare`), exit non-zero with a message that says exactly which keys to add to `~/.bitbucket` and how to get an App Password. `help` and `local` must work with no creds.

5. **Tests consume the real `createContext`** (or a single shared fake-context helper) — never re-declare the context shape inline. That inline re-declaration is precisely what let the runtime/test worlds drift in finding #1. Cover `list`/`compare`/error paths by **adding fixtures** under `tests/fixtures/bitbucket/` and replaying them through `mock-context` (Principle #6) — **no monkeypatching** of `https`/`execSync`. If you route all I/O through `ctx`, you won't need a raw-`https` fake at all (that's why `mock-https.js` was deleted).

## 4. Definition of Done

- [ ] All five subcommands work against a real `createContext(develRoot)` (manually verify `node bin/mini bb local` and `bb help` don't throw).
- [ ] Zero direct `require('https'|'child_process')` in the plugin; all I/O via `ctx`.
- [ ] Tests build context via the real `createContext` / shared helper; HTTP + git replayed from fixtures; no monkeypatching; suite green.
- [ ] Coverage on the new file at or above the project floor (grow fixtures for error branches: 401, malformed JSON, empty workspace, paginated `next`).
- [ ] Zero deps added. `~/.bitbucket` stays out of the tree; no real workspace/creds committed.
- [ ] Re-add the rows removed from `README.md` (§4 plugins table) and `plugins/README.md` (plugin table + credentials list).
