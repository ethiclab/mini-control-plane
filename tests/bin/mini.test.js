'use strict';

const { test, describe, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');

const { captureOutput } = require('../helpers/capture-output');
const cli = require('../../bin/mini');

const REAL_ROOT = path.resolve(__dirname, '..', '..');

const tmpRoots = [];
afterEach(() => {
  while (tmpRoots.length) {
    const dir = tmpRoots.pop();
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

function tmpRootWith(pluginFiles) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'mini-bin-test-'));
  tmpRoots.push(root);
  if (pluginFiles) {
    fs.mkdirSync(path.join(root, 'plugins'), { recursive: true });
    for (const [name, content] of Object.entries(pluginFiles)) {
      fs.writeFileSync(path.join(root, 'plugins', name), content);
    }
  }
  return root;
}

const ECHO_PLUGIN = `module.exports = {
  name: 'echo', commands: ['echo', 'e'], describe: 'echo test args',
  run: (args) => { console.log('ECHO:' + args.join(',')); },
};`;

async function runMain(argv, root) {
  let exitCode;
  const origExit = process.exit;
  const origWrite = process.stderr.write;
  process.exit = (c) => { exitCode = c; };
  process.stderr.write = () => true; // silence loadPlugins() warning lines
  let out;
  try {
    out = await captureOutput(async () => { await cli.main(argv, root); });
  } finally {
    process.exit = origExit;
    process.stderr.write = origWrite;
  }
  return { exitCode, out };
}

describe('bin/mini — exports', () => {
  test('espone loadPlugins, usage, main', () => {
    assert.equal(typeof cli.loadPlugins, 'function');
    assert.equal(typeof cli.usage, 'function');
    assert.equal(typeof cli.main, 'function');
  });
});

describe('bin/mini — loadPlugins', () => {
  test('dir plugins assente → nessun plugin, nessun fallimento', () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'mini-bin-empty-'));
    tmpRoots.push(root);
    const { plugins, failures } = cli.loadPlugins(root);
    assert.deepEqual(plugins, []);
    assert.deepEqual(failures, []);
  });

  test('carica .js, ignora file _-prefissati e non-.js', () => {
    const root = tmpRootWith({
      'echo.js': ECHO_PLUGIN,
      '_helper.js': 'module.exports = {};',
      'readme.txt': 'not a plugin',
    });
    const { plugins, failures } = cli.loadPlugins(root);
    assert.equal(plugins.length, 1);
    assert.equal(plugins[0].name, 'echo');
    assert.deepEqual(failures, []);
  });

  test('un plugin rotto finisce in failures (non fa crashare il resto)', () => {
    const root = tmpRootWith({
      'echo.js': ECHO_PLUGIN,
      'broken.js': "throw new Error('boom load');",
    });
    const origWrite = process.stderr.write;
    process.stderr.write = () => true;
    let result;
    try { result = cli.loadPlugins(root); } finally { process.stderr.write = origWrite; }
    assert.equal(result.plugins.length, 1, 'il plugin buono resta caricato');
    assert.equal(result.failures.length, 1);
    assert.equal(result.failures[0].file, 'broken.js');
    assert.match(result.failures[0].error, /boom load/);
  });
});

describe('bin/mini — main', () => {
  test('nessun comando → usage con i plugin', async () => {
    const root = tmpRootWith({ 'echo.js': ECHO_PLUGIN });
    const { out } = await runMain(['node', 'mini'], root);
    assert.match(out.stderr, /Usage: mini/);
    assert.match(out.stderr, /echo, e/);
  });

  test('help è alias di nessun comando', async () => {
    const root = tmpRootWith({ 'echo.js': ECHO_PLUGIN });
    const { out } = await runMain(['node', 'mini', 'help'], root);
    assert.match(out.stderr, /Usage: mini/);
  });

  test('version stampa la versione dal package.json', async () => {
    const { out } = await runMain(['node', 'mini', 'version'], REAL_ROOT);
    assert.match(out.stdout, /^mini v\d+\.\d+\.\d+/);
  });

  test('instrada un comando valido al plugin', async () => {
    const root = tmpRootWith({ 'echo.js': ECHO_PLUGIN });
    const { out } = await runMain(['node', 'mini', 'echo', 'a', 'b'], root);
    assert.match(out.stdout, /ECHO:a,b/);
  });

  test('comando sconosciuto → exit 1 e messaggio', async () => {
    const root = tmpRootWith({ 'echo.js': ECHO_PLUGIN });
    const { exitCode, out } = await runMain(['node', 'mini', 'nope'], root);
    assert.equal(exitCode, 1);
    assert.match(out.stderr, /Unknown command: nope/);
  });

  test('comando sconosciuto con plugin non caricato → collega causa e sintomo', async () => {
    const root = tmpRootWith({
      'echo.js': ECHO_PLUGIN,
      'broken.js': "throw new Error('boom load');",
    });
    const { exitCode, out } = await runMain(['node', 'mini', 'nope'], root);
    assert.equal(exitCode, 1);
    assert.match(out.stderr, /Unknown command: nope/);
    assert.match(out.stderr, /non caricato/);
    assert.match(out.stderr, /broken\.js: boom load/);
  });
});
