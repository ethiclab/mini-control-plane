'use strict';

const { createContext } = require('../../lib/plugin-context');

function urlMatcher(method, urlFragment, responseData) {
  return {
    match: (m, url) => m === method && url.includes(urlFragment),
    response: responseData,
  };
}

function anyMatcher(responseData) {
  return { match: () => true, response: responseData };
}

/**
 * Fake `context` per i test, DERIVATO dal vero `createContext()`.
 *
 * Le chiavi della forma (develRoot, fs, path, format, …) vengono ereditate dal
 * context reale via spread, così il mondo-dei-test non può divergere dal mondo
 * di runtime: se la forma cambia (es. una chiave rinominata), il fake la segue
 * invece di restare allineato a un literal scritto a mano. Si sostituiscono solo:
 *   - i bordi verso il mondo (http, shell, prompt) con fake deterministici;
 *   - config.read con una versione ERMETICA (defaults + env, MAI il dotfile reale).
 */
function createMockContext(matchers = [], opts = {}) {
  const calls = [];

  async function httpRequest(method, url, reqOpts = {}) {
    calls.push({
      method,
      url,
      opts: { ...reqOpts, body: reqOpts.body ? JSON.parse(JSON.stringify(reqOpts.body)) : undefined },
    });
    for (const m of matchers) {
      if (m.match(method, url)) {
        if (m.error) throw new Error(m.error);
        return m.response !== undefined ? JSON.parse(JSON.stringify(m.response)) : null;
      }
    }
    throw new Error(`[mock-context] Unexpected HTTP: ${method} ${url}`);
  }

  return {
    ...createContext(opts.develRoot || '/tmp/test-devel'),
    http: { request: httpRequest },
    shell: {
      run: () => {},
      capture: () => ({ ok: true, status: 0, stdout: '', stderr: '' }),
    },
    prompt: {
      yesNo: () => Promise.resolve(true),
      input: () => Promise.resolve(''),
      choice: (q, items) => Promise.resolve(items[0] || ''),
    },
    config: {
      // Ermetico: non legge il dotfile reale (~/.<tool>); solo defaults + env.
      read: (keys, dotfile, defaults) => {
        const cfg = { ...defaults };
        for (const k of keys) {
          if (process.env[k]) cfg[k] = process.env[k];
        }
        return cfg;
      },
    },
    _calls: calls,
  };
}

module.exports = { createMockContext, urlMatcher, anyMatcher };
