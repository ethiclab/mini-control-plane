'use strict';

const { test, describe } = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');
const fs = require('fs');
const os = require('os');

const { withHttpsMock, pathMatcher } = require('../helpers/mock-https');
const { captureOutput } = require('../helpers/mock-exec');

const PLUGIN_PATH = path.join(__dirname, '../../plugins/bitbucket.js');
const CONTEXT = { DEVEL_ROOT: path.join(__dirname, '../..'), path, fs };

// ── Fixture helpers ────────────────────────────────────────────────────────────

function fixture(name) {
  return JSON.parse(fs.readFileSync(path.join(__dirname, '../fixtures/bitbucket', name), 'utf8'));
}

function bbPage(values) {
  return { values, next: null };
}

// ── Setup / teardown inline per test ──────────────────────────────────────────

const TEST_HOME = path.join(os.tmpdir(), 'mini-test-home');

function setupFakeHome(withCredentials = true) {
  if (!fs.existsSync(TEST_HOME)) fs.mkdirSync(TEST_HOME, { recursive: true });
  const dotfile = path.join(TEST_HOME, '.bitbucket');
  if (withCredentials) {
    fs.writeFileSync(dotfile,
      'BITBUCKET_USERNAME=testuser\nBITBUCKET_APP_PASSWORD=testpassword\nBITBUCKET_WORKSPACE=acme\n',
      { mode: 0o600 }
    );
  } else if (fs.existsSync(dotfile)) {
    fs.unlinkSync(dotfile);
  }
  const origHome = process.env.HOME;
  process.env.HOME = TEST_HOME;
  return () => { process.env.HOME = origHome; };
}

// Cattura console.log/error per operazioni async
async function captureAsync(asyncFn) {
  const logLines = [];
  const errLines = [];
  const origLog = console.log;
  const origErr = console.error;
  console.log = (...args) => logLines.push(args.map(String).join(' '));
  console.error = (...args) => errLines.push(args.map(String).join(' '));
  try {
    await asyncFn();
  } finally {
    console.log = origLog;
    console.error = origErr;
  }
  return { stdout: logLines.join('\n'), stderr: errLines.join('\n') };
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('bitbucket plugin — list', () => {
  test('mostra la lista dei repo remoti', async () => {
    const restore = setupFakeHome(true);
    const repos = fixture('repos.json');
    const matchers = [pathMatcher('/2.0/repositories/', bbPage(repos))];

    let out;
    try {
      await withHttpsMock(matchers, PLUGIN_PATH, async (plugin) => {
        out = await captureAsync(() => plugin.run(['list'], CONTEXT));
      });
    } finally {
      restore();
    }

    assert.ok(out.stdout.includes('billing-api'), 'deve mostrare il repo billing-api');
    assert.ok(out.stdout.includes('payments-api'), 'deve mostrare il repo payments-api');
    assert.ok(out.stdout.includes('🔒'), 'deve mostrare icona repo privato');
  });

  test('mostra il conteggio dei repo trovati', async () => {
    const restore = setupFakeHome(true);
    const repos = fixture('repos.json');
    const matchers = [pathMatcher('/2.0/repositories/', bbPage(repos))];

    let out;
    try {
      await withHttpsMock(matchers, PLUGIN_PATH, async (plugin) => {
        out = await captureAsync(() => plugin.run(['list'], CONTEXT));
      });
    } finally {
      restore();
    }

    assert.ok(out.stdout.includes(`(${repos.length})`), 'deve mostrare il numero totale di repo');
  });
});

describe('bitbucket plugin — API host configurabile', () => {
  test('usa BITBUCKET_API_HOST (override env) → iniettabile come fake', async () => {
    const restore = setupFakeHome(true);
    const origHost = process.env.BITBUCKET_API_HOST;
    process.env.BITBUCKET_API_HOST = 'fake.bitbucket.local';
    const matchers = [pathMatcher('/2.0/repositories/', bbPage(fixture('repos.json')))];

    let captured;
    try {
      await withHttpsMock(matchers, PLUGIN_PATH, async (plugin, calls) => {
        await captureAsync(() => plugin.run(['list'], CONTEXT));
        captured = calls;
      });
    } finally {
      if (origHost === undefined) delete process.env.BITBUCKET_API_HOST;
      else process.env.BITBUCKET_API_HOST = origHost;
      restore();
    }

    assert.ok(captured.length > 0, 'almeno una richiesta effettuata');
    assert.ok(captured.every((c) => c.hostname === 'fake.bitbucket.local'), 'tutte le richieste usano l\'host configurato');
  });

  test('default = api.bitbucket.org se non configurato', async () => {
    const restore = setupFakeHome(true);
    const origHost = process.env.BITBUCKET_API_HOST;
    delete process.env.BITBUCKET_API_HOST;
    const matchers = [pathMatcher('/2.0/repositories/', bbPage(fixture('repos.json')))];

    let captured;
    try {
      await withHttpsMock(matchers, PLUGIN_PATH, async (plugin, calls) => {
        await captureAsync(() => plugin.run(['list'], CONTEXT));
        captured = calls;
      });
    } finally {
      if (origHost !== undefined) process.env.BITBUCKET_API_HOST = origHost;
      restore();
    }

    assert.ok(captured.every((c) => c.hostname === 'api.bitbucket.org'), 'usa l\'host di default');
  });
});

describe('bitbucket plugin — local', () => {
  test('mostra "(nessuno trovato)" in una dir senza repo Bitbucket', async () => {
    const restore = setupFakeHome(true);
    const cp = require('child_process');
    const origExecSync = cp.execSync;
    cp.execSync = () => '';

    let out;
    try {
      delete require.cache[require.resolve(PLUGIN_PATH)];
      const plugin = require(PLUGIN_PATH);
      delete require.cache[require.resolve(PLUGIN_PATH)];
      out = await captureOutput(() => plugin.run(['local'], CONTEXT));
    } finally {
      cp.execSync = origExecSync;
      restore();
    }

    assert.ok(out.stdout.includes('(nessuno trovato)'), 'nessun repo trovato');
  });

  test('mostra i repo con remote Bitbucket', async () => {
    const restore = setupFakeHome(true);
    const cp = require('child_process');
    const origExecSync = cp.execSync;
    const fakeRepoDir = '/fake/acme/lab/myrepo';

    cp.execSync = (cmd) => {
      if (cmd.includes('find') && cmd.includes('.git/config')) return `${fakeRepoDir}/.git/config\n`;
      if (cmd.includes('remote -v')) return `origin\tgit@bitbucket.org:acme/myrepo.git (fetch)\n`;
      if (cmd.includes('branch --show-current')) return 'main\n';
      return '';
    };

    let out;
    try {
      delete require.cache[require.resolve(PLUGIN_PATH)];
      const plugin = require(PLUGIN_PATH);
      delete require.cache[require.resolve(PLUGIN_PATH)];
      out = await captureOutput(() => plugin.run(['local'], CONTEXT));
    } finally {
      cp.execSync = origExecSync;
      restore();
    }

    assert.ok(out.stdout.includes('myrepo'), 'deve mostrare lo slug del repo');
    assert.ok(out.stdout.includes('[main]'), 'deve mostrare il branch corrente');
  });
});

describe('bitbucket plugin — credenziali mancanti', () => {
  test('esce con codice 1 se nessuna credenziale', async () => {
    const restore = setupFakeHome(false);
    let exitCode;
    const origExit = process.exit;
    // Lancia un'eccezione marcata per interrompere l'esecuzione come farebbe il vero process.exit
    process.exit = (code) => {
      exitCode = code;
      const err = new Error(`process.exit(${code})`);
      err.__isProcessExit = true;
      throw err;
    };

    let out;
    try {
      await withHttpsMock([], PLUGIN_PATH, async (plugin) => {
        out = await captureAsync(async () => {
          try { await plugin.run(['list'], CONTEXT); } catch (e) {
            if (!e.__isProcessExit) throw e;
          }
        });
      });
    } finally {
      process.exit = origExit;
      restore();
    }

    assert.equal(exitCode, 1, 'deve uscire con codice 1');
    assert.ok(out.stderr.includes('.bitbucket') || out.stderr.includes('credenziale'), 'errore deve citare il file config');
  });
});

describe('bitbucket plugin — help', () => {
  test('mostra usage senza credenziali', async () => {
    const restore = setupFakeHome(false);
    let out;
    try {
      await withHttpsMock([], PLUGIN_PATH, async (plugin) => {
        out = await captureAsync(() => plugin.run(['help'], CONTEXT));
      });
    } finally {
      restore();
    }

    assert.ok(out.stdout.includes('mini bitbucket'), 'deve mostrare il comando mini bitbucket');
    assert.ok(out.stdout.includes('local'), 'deve mostrare il subcommand local');
    assert.ok(out.stdout.includes('list'), 'deve mostrare il subcommand list');
  });
});
