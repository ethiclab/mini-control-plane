'use strict';

/**
 * Mock helper per child_process.execSync.
 *
 * Strategia: sostituisce `require('child_process').execSync` PRIMA di caricare
 * il modulo da testare, sfruttando la module cache di Node. Il plugin che fa
 * `const { execSync } = require('child_process')` riceve la versione mock.
 *
 * Usage:
 *   const { withExecMock, urlMatcher } = require('./mock-exec');
 *
 *   withExecMock(
 *     [urlMatcher('youtrack.cloud/api/agiles', board), urlMatcher('sprints/current', sprint)],
 *     '../plugins/yt.js',
 *     (plugin) => { plugin.run([]); }
 *   );
 */

const cp = require('child_process');
const path = require('path');

/**
 * Crea un matcher che restituisce `responseData` (come JSON string) se
 * il comando curl contiene `urlFragment`.
 */
function urlMatcher(urlFragment, responseData) {
  return {
    match: (cmd) => typeof cmd === 'string' && cmd.includes(urlFragment),
    response: JSON.stringify(responseData),
  };
}

/**
 * Matcher che risponde a qualsiasi chiamata con `responseData`.
 */
function anyMatcher(responseData) {
  return {
    match: () => true,
    response: JSON.stringify(responseData),
  };
}

/**
 * Esegue `fn(plugin)` con child_process.execSync sostituito da un mock
 * che risponde ai comandi in base ai `matchers` (in ordine, primo match vince).
 *
 * Il modulo del plugin viene ricaricato fresh (cache pulita) per ricevere il mock.
 * Dopo l'esecuzione, la cache viene pulita di nuovo e execSync viene ripristinato.
 *
 * @param {Array<{match: Function, response: string}>} matchers
 * @param {string} pluginPath - path relativo a questo file (../plugins/yt.js)
 * @param {Function} fn - fn(plugin) — il plugin è già caricato con il mock attivo
 */
function withExecMock(matchers, pluginPath, fn) {
  const resolved = require.resolve(pluginPath);
  const original = cp.execSync;
  const calls = [];

  cp.execSync = (cmd, opts) => {
    calls.push(cmd);
    for (const m of matchers) {
      if (m.match(cmd)) return m.response;
    }
    throw new Error(`[mock-exec] Unexpected execSync call:\n  ${cmd}\n\nRegistered matchers:\n${matchers.map((m, i) => `  [${i}] ${m.match.toString().substring(0, 60)}`).join('\n')}`);
  };

  delete require.cache[resolved];
  let plugin;
  try {
    plugin = require(pluginPath);
    fn(plugin, calls);
  } finally {
    cp.execSync = original;
    delete require.cache[resolved];
  }
}

/**
 * Cattura stdout/stderr prodotti da console.log/console.error durante fn().
 * Restituisce { stdout: string, stderr: string }.
 */
function captureOutput(fn) {
  const logLines = [];
  const errLines = [];
  const origLog = console.log;
  const origErr = console.error;
  console.log = (...args) => logLines.push(args.map(String).join(' '));
  console.error = (...args) => errLines.push(args.map(String).join(' '));
  const finish = () => {
    console.log = origLog;
    console.error = origErr;
    return { stdout: logLines.join('\n'), stderr: errLines.join('\n') };
  };
  try {
    const result = fn();
    if (result && typeof result.then === 'function') {
      return result.then(finish, finish);
    }
    return finish();
  } catch (e) {
    return finish();
  }
}

module.exports = { withExecMock, urlMatcher, anyMatcher, captureOutput };
