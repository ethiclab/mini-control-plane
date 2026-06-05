'use strict';

const { test, describe, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');
const fs = require('fs');
const os = require('os');

const { createContext } = require('../../lib/plugin-context');

describe('plugin-context — format.table', () => {
  test('rende tabella con header e righe', () => {
    const ctx = createContext('/tmp');
    const result = ctx.format.table(['name', 'value'], [['a', '1'], ['bb', '22']]);
    assert.ok(result.includes('| a'));
    assert.ok(result.includes('| bb'));
    assert.ok(result.includes('| 22'));
    assert.ok(result.startsWith('+'));
    assert.ok(result.endsWith('+'));
  });

  test('tabella vuota (solo header)', () => {
    const ctx = createContext('/tmp');
    const result = ctx.format.table(['k', 'v'], []);
    assert.ok(result.includes('k'));
    assert.ok(result.includes('v'));
  });

  test('cella con null/undefined viene mostrata vuota', () => {
    const ctx = createContext('/tmp');
    const result = ctx.format.table(['x'], [[null], [undefined]]);
    assert.ok(result.includes('|'));
  });
});

describe('plugin-context — config.read', () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'pctx-test-'));
  const dotfile = path.join(tmpDir, '.testcfg');

  afterEach(() => {
    if (fs.existsSync(dotfile)) fs.unlinkSync(dotfile);
  });

  test('legge valori da dotfile', () => {
    fs.writeFileSync(dotfile, 'MY_KEY=hello\nOTHER_KEY=world\n', 'utf8');
    const ctx = createContext('/tmp');
    const cfg = ctx.config.read(['MY_KEY', 'OTHER_KEY'], dotfile, { MY_KEY: 'default' });
    assert.equal(cfg.MY_KEY, 'hello');
    assert.equal(cfg.OTHER_KEY, 'world');
  });

  test('valori env sovrascrivono dotfile', () => {
    process.env.MY_KEY = 'from-env';
    fs.writeFileSync(dotfile, 'MY_KEY=from-dotfile\n', 'utf8');
    const ctx = createContext('/tmp');
    const cfg = ctx.config.read(['MY_KEY'], dotfile, {});
    assert.equal(cfg.MY_KEY, 'from-env');
    delete process.env.MY_KEY;
  });

  test('default usati se assenti in dotfile ed env', () => {
    const ctx = createContext('/tmp');
    const cfg = ctx.config.read(['MISSING'], dotfile, { MISSING: 'fallback' });
    assert.equal(cfg.MISSING, 'fallback');
  });

  test('ignora righe non corrispondenti a KEY=value', () => {
    fs.writeFileSync(dotfile, '# commento\n=bad\n  \nMY_KEY=ok\n', 'utf8');
    const ctx = createContext('/tmp');
    const cfg = ctx.config.read(['MY_KEY'], dotfile, {});
    assert.equal(cfg.MY_KEY, 'ok');
  });

  test('ignora chiavi non richieste presenti nel dotfile', () => {
    fs.writeFileSync(dotfile, 'MY_KEY=x\nUNRELATED=y\n', 'utf8');
    const ctx = createContext('/tmp');
    const cfg = ctx.config.read(['MY_KEY'], dotfile, {});
    assert.equal(cfg.MY_KEY, 'x');
    assert.equal(cfg.UNRELATED, undefined);
  });
});

describe('plugin-context — shell.capture', () => {
  test('cattura stdout di echo', () => {
    const ctx = createContext('/tmp');
    const result = ctx.shell.capture('echo', ['hello world']);
    assert.ok(result.ok);
    assert.equal(result.status, 0);
    assert.ok(result.stdout.includes('hello world'));
  });

  test('stdout vuoto per comando senza output', () => {
    const ctx = createContext('/tmp');
    const result = ctx.shell.capture('true', []);
    assert.ok(result.ok);
    assert.equal(result.stdout, '');
  });

  test('status non-zero per comando fallito', () => {
    const ctx = createContext('/tmp');
    const result = ctx.shell.capture('false', []);
    assert.equal(result.ok, false);
    assert.notEqual(result.status, 0);
  });
});

describe('plugin-context — shell.run', () => {
  test('esegue comando con successo', () => {
    const ctx = createContext('/tmp');
    ctx.shell.run('echo', ['ok']);
  });

  test('lancia errore per comando fallito', () => {
    const ctx = createContext('/tmp');
    assert.throws(() => ctx.shell.run('false', []), /failed/);
  });
});

describe('plugin-context — createContext', () => {
  test('contest contiene tutti i servizi', () => {
    const ctx = createContext('/my/root');
    assert.ok(ctx.http);
    assert.ok(ctx.http.request);
    assert.ok(ctx.format);
    assert.ok(ctx.format.table);
    assert.ok(ctx.prompt);
    assert.ok(ctx.prompt.yesNo);
    assert.ok(ctx.prompt.input);
    assert.ok(ctx.prompt.choice);
    assert.ok(ctx.config);
    assert.ok(ctx.config.read);
    assert.ok(ctx.shell);
    assert.ok(ctx.shell.run);
    assert.ok(ctx.shell.capture);
    assert.equal(ctx.develRoot, '/my/root');
    assert.equal(ctx.fs, require('fs'));
    assert.equal(ctx.path, require('path'));
  });
});
