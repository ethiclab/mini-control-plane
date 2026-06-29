'use strict';

const { test, describe, before, after } = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');
const fs = require('fs');

const { captureOutput } = require('../helpers/capture-output');
const { createMockContext } = require('../helpers/mock-context');

const plugin = require('../../plugins/cdk');

const FIXTURE_CONFIG = path.join(__dirname, '..', 'fixtures', 'cdk', 'cdk.json');
let origCdkConfigEnv;
before(() => { origCdkConfigEnv = process.env.MINI_CDK_CONFIG; process.env.MINI_CDK_CONFIG = FIXTURE_CONFIG; });
after(() => {
  if (origCdkConfigEnv === undefined) delete process.env.MINI_CDK_CONFIG;
  else process.env.MINI_CDK_CONFIG = origCdkConfigEnv;
});

function ctxWithShell(captureFn) {
  const ctx = createMockContext([]);
  ctx.shell.capture = captureFn;
  ctx.shell.run = () => {};
  return ctx;
}

describe('cdk plugin — module', () => {
  test('esporta name, commands, describe, run', () => {
    assert.equal(plugin.name, 'cdk');
    assert.deepEqual(plugin.commands, ['cdk', 'webapp']);
    assert.ok(plugin.describe.startsWith('Deploy webapp statiche'));
    assert.equal(typeof plugin.run, 'function');
  });
});

describe('cdk plugin — help', () => {
  test('mini cdk help stampa il manuale', async () => {
    const out = await captureOutput(() => plugin.run(['help'], createMockContext([])));
    assert.ok(out.stdout.includes('USAGE'));
    assert.ok(out.stdout.includes('mini cdk deploy'));
    assert.ok(out.stdout.includes('mini cdk destroy'));
    assert.ok(out.stdout.includes('mini cdk profiles'));
    assert.ok(out.stdout.includes('mini cdk status'));
  });

  test('--help e -h sono alias', async () => {
    const out1 = await captureOutput(() => plugin.run(['--help'], createMockContext([])));
    const out2 = await captureOutput(() => plugin.run(['-h'], createMockContext([])));
    assert.ok(out1.stdout.includes('USAGE'));
    assert.ok(out2.stdout.includes('USAGE'));
  });

  test('azione sconosciuta mostra help ed esce con 1', async () => {
    const origExit = process.exit;
    let exitCode;
    process.exit = (code) => { exitCode = code; };
    const out = await captureOutput(() => plugin.run(['unknown-action'], createMockContext([])));
    process.exit = origExit;
    assert.equal(exitCode, 1);
    assert.ok(out.stdout.includes('USAGE'));
  });
});

describe('cdk plugin — profiles', () => {
  test('mostra messaggio se nessun profilo trovato', async () => {
    const ctx = ctxWithShell(() => ({ ok: true, stdout: '' }));
    const out = await captureOutput(() => plugin.run(['profiles'], ctx));
    assert.ok(out.stdout.includes('Nessun profilo AWS trovato'));
  });

  test('elenca profili con fallback login required', async () => {
    const ctx = ctxWithShell((cmd, args) => {
      if (args.includes('list-profiles')) return { ok: true, stdout: 'acme-test\nacme-prod\n' };
      return { ok: false, error: 'No credentials' };
    });
    const out = await captureOutput(() => plugin.run(['profiles'], ctx));
    assert.ok(out.stdout.includes('login required'));
    assert.ok(out.stdout.includes('acme-test'));
    assert.ok(out.stdout.includes('acme-prod'));
  });

  test('elenca profili con account ID se autenticato', async () => {
    const ctx = ctxWithShell((cmd, args) => {
      if (args.includes('list-profiles')) return { ok: true, stdout: 'acme-test\nacme-prod\n' };
      return { ok: true, stdout: '{"Account":"123456789012","Arn":"arn:aws:iam::123456789012:user/test","UserId":"AIDA..."}' };
    });
    const out = await captureOutput(() => plugin.run(['profiles'], ctx));
    assert.ok(out.stdout.includes('123456789012'));
    assert.ok(!out.stdout.includes('login required'));
  });
});

describe('cdk plugin — bundles', () => {
  test('elenca bundle web conosciuti', async () => {
    const out = await captureOutput(() => plugin.run(['bundles'], createMockContext([])));
    assert.ok(out.stdout.includes('web-a'));
    assert.ok(out.stdout.includes('web-b'));
  });
});

describe('cdk plugin — status', () => {
  const testDomain = 'cdk-test-domain.example.com';
  const testManifest = {
    profile: 'acme-test',
    region: 'eu-west-1',
    account: '123456789012',
    domainName: testDomain,
    stackName: 'web-cdk-test-domain-example-com',
    version: '1.0.0',
  };
  const manifestDir = path.join(__dirname, '..', '..', 'config', 'webapps');
  const manifestFilePath = path.join(manifestDir, `${testDomain.replace(/[^a-z0-9.-]+/g, '-')}.json`);

  test('mostra dettagli da manifest esistente', async () => {
    fs.mkdirSync(manifestDir, { recursive: true });
    fs.writeFileSync(manifestFilePath, JSON.stringify(testManifest), 'utf8');
    const ctx = createMockContext([]);
    ctx.format.table = (headers, rows) => rows.map((r) => `${r[0]}: ${r[1]}`).join('\n');
    try {
      const out = await captureOutput(() => plugin.run(['status', testDomain], ctx));
      assert.ok(out.stdout.includes(testDomain));
      assert.ok(out.stdout.includes('1.0.0'));
      assert.ok(out.stdout.includes('acme-test'));
    } finally {
      if (fs.existsSync(manifestFilePath)) fs.unlinkSync(manifestFilePath);
    }
  });

  test('mostra messaggio se nessun manifest', async () => {
    const out = await captureOutput(() => plugin.run(['status', 'nessun-dominio.esistente.com'], createMockContext([])));
    assert.ok(out.stdout.includes('Nessun manifest trovato'));
  });

  test('errore se dominio mancante', async () => {
    const origExit = process.exit;
    let exitCode;
    process.exit = (code) => { exitCode = code; };
    const out = await captureOutput(() => plugin.run(['status'], createMockContext([])));
    process.exit = origExit;
    assert.equal(exitCode, 1);
    assert.ok(out.stderr.includes('Usage'));
    assert.ok(out.stderr.includes('status'));
  });
});

describe('cdk plugin — fixture', () => {
  test('fixture ha solo bundles (nessun profile)', () => {
    const raw = JSON.parse(fs.readFileSync(FIXTURE_CONFIG, 'utf8'));
    assert.ok(raw.bundles);
    assert.ok(raw.bundles['web-a']);
    assert.ok(raw.bundles['web-b']);
    assert.equal(raw.profiles, undefined);
  });
});

describe('cdk plugin — discover', () => {
  test('cli profiles con sts error mostra login required', async () => {
    const ctx = ctxWithShell((cmd, args) => {
      if (args.includes('list-profiles')) return { ok: true, stdout: 'cli-only\n' };
      return { ok: false, error: 'Unable to locate credentials' };
    });
    const out = await captureOutput(() => plugin.run(['profiles'], ctx));
    assert.ok(out.stdout.includes('cli-only'));
    assert.ok(out.stdout.includes('login required'));
  });

  test('sts con json invalido mostra login required', async () => {
    const ctx = ctxWithShell((cmd, args) => {
      if (args.includes('list-profiles')) return { ok: true, stdout: 'broken\n' };
      return { ok: true, stdout: 'not-json-at-all' };
    });
    const out = await captureOutput(() => plugin.run(['profiles'], ctx));
    assert.ok(out.stdout.includes('broken'));
    assert.ok(out.stdout.includes('login required'));
  });
});

describe('cdk plugin — bundles empty message', () => {
  test('mostra messaggio se nessun bundle configurato', async () => {
    const emptyConfig = path.join(__dirname, '..', 'fixtures', 'cdk', 'empty-bundles.json');
    const orig = process.env.MINI_CDK_CONFIG;
    process.env.MINI_CDK_CONFIG = emptyConfig;
    try {
      fs.writeFileSync(emptyConfig, JSON.stringify({ bundles: {} }), 'utf8');
      const out = await captureOutput(() => plugin.run(['bundles'], createMockContext([])));
      assert.ok(out.stdout.includes('nessun bundle configurato'));
    } finally {
      if (fs.existsSync(emptyConfig)) fs.unlinkSync(emptyConfig);
      process.env.MINI_CDK_CONFIG = orig;
    }
  });
});
