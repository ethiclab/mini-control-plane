'use strict';

/**
 * Mock helper per https.get (usato da bitbucket.js).
 *
 * Strategia analoga a mock-exec.js: sostituisce `require('https').get`
 * prima di caricare il plugin, poi ripristina e pulisce la cache.
 *
 * Usage:
 *   const { withHttpsMock, pathMatcher } = require('./mock-https');
 *
 *   withHttpsMock(
 *     [pathMatcher('/2.0/repositories/', repos)],
 *     '../plugins/bitbucket.js',
 *     async (plugin) => { await plugin.run(['list'], context); }
 *   );
 */

const https = require('https');
const { EventEmitter } = require('events');
const path = require('path');

/**
 * Crea un matcher per https.get basato su urlPath.
 */
function pathMatcher(urlFragment, responseData) {
  return {
    match: (urlPath) => urlPath.includes(urlFragment),
    responseData,
    hasError: false,
  };
}

/**
 * Crea un matcher che simula un errore di rete.
 */
function errorMatcher(urlFragment, errorMessage) {
  return {
    match: (urlPath) => urlPath.includes(urlFragment),
    responseData: null,
    hasError: true,
    errorMessage,
  };
}

/**
 * Crea una risposta https fake che emette i dati e poi chiude.
 */
function fakeResponse(data) {
  const emitter = new EventEmitter();
  process.nextTick(() => {
    emitter.emit('data', JSON.stringify(data));
    emitter.emit('end');
  });
  return emitter;
}

/**
 * Esegue `fn(plugin)` (può essere async) con https.get sostituito.
 * Restituisce una Promise.
 */
async function withHttpsMock(matchers, pluginPath, fn) {
  const resolved = require.resolve(pluginPath);
  const originalGet = https.get;
  const calls = [];

  https.get = (opts, callback) => {
    const urlPath = typeof opts === 'string' ? opts : (opts.path || opts.pathname || '');
    const hostname = typeof opts === 'string' ? null : (opts.hostname || null);
    // calls: array di { path, hostname } per asserzioni su path e host delle richieste.
    calls.push({ path: urlPath, hostname });

    for (const m of matchers) {
      if (m.match(urlPath)) {
        if (m.hasError) {
          const req = new EventEmitter();
          process.nextTick(() => req.emit('error', new Error(m.errorMessage)));
          return req;
        }
        const emitter = new EventEmitter();
        const responseStr = JSON.stringify(m.responseData);
        // Chiama callback synchronously: i listener vengono registrati prima che emettiamo
        callback(emitter);
        // Emetti i dati nel prossimo tick, dopo che i listener sono stati registrati
        process.nextTick(() => {
          emitter.emit('data', responseStr);
          emitter.emit('end');
        });
        return new EventEmitter();
      }
    }
    throw new Error(`[mock-https] Unexpected https.get:\n  ${urlPath}`);
  };

  delete require.cache[resolved];
  let plugin;
  try {
    plugin = require(pluginPath);
    await fn(plugin, calls);
  } finally {
    https.get = originalGet;
    delete require.cache[resolved];
  }
}

module.exports = { withHttpsMock, pathMatcher, errorMatcher };
