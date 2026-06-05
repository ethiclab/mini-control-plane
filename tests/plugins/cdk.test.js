'use strict';

const { test, describe, before, after } = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');
const fs = require('fs');

const { captureOutput } = require('../helpers/mock-exec');
const { createMockContext } = require('../helpers/mock-context');

const plugin = require('../../plugins/cdk');

// Profili/bundle reali stanno in config/cdk.json (gitignored); i test usano una
// fixture deterministica via MINI_CDK_CONFIG, così non dipendono dall'ambiente.
const FIXTURE_CONFIG = path.join(__dirname, '..', 'fixtures', 'cdk', 'cdk.json');
let origCdkConfigEnv;
before(() => { origCdkConfigEnv = process.env.MINI_CDK_CONFIG; process.env.MINI_CDK_CONFIG = FIXTURE_CONFIG; });
after(() => {
  if (origCdkConfigEnv === undefined) delete process.env.MINI_CDK_CONFIG;
  else process.env.MINI_CDK_CONFIG = origCdkConfigEnv;
});

function ctxWithShell(shellCapture) {
  const ctx = createMockContext([]);
  ctx.shell.capture = shellCapture;
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
  test('elenca profili con fallback login required', async () => {
    const ctx = ctxWithShell(() => ({ ok: false, error: 'No credentials' }));
    const out = await captureOutput(() => plugin.run(['profiles'], ctx));
    assert.ok(out.stdout.includes('login required'));
    assert.ok(out.stdout.includes('acme-test'));
    assert.ok(out.stdout.includes('acme-prod'));
  });

  test('elenca profili con account ID se autenticato', async () => {
    const ctx = ctxWithShell(() => ({ ok: true, stdout: '{"Account":"123456789012","Arn":"arn:aws:iam::123456789012:user/test","UserId":"AIDA..."}' }));
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
