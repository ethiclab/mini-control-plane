'use strict';

function urlMatcher(method, urlFragment, responseData) {
  return {
    match: (m, url) => m === method && url.includes(urlFragment),
    response: responseData,
  };
}

function anyMatcher(responseData) {
  return { match: () => true, response: responseData };
}

function createMockContext(matchers) {
  const calls = [];

  async function httpRequest(method, url, opts) {
    calls.push({ method, url, opts: { ...opts, body: opts.body ? JSON.parse(JSON.stringify(opts.body)) : undefined } });
    for (const m of matchers) {
      if (m.match(method, url)) {
        if (m.error) throw new Error(m.error);
        return m.response !== undefined ? JSON.parse(JSON.stringify(m.response)) : null;
      }
    }
    throw new Error(`[mock-context] Unexpected HTTP: ${method} ${url}`);
  }

  return {
    http: { request: httpRequest },
    format: { table: () => '' },
    prompt: {
      yesNo: () => Promise.resolve(true),
      input: () => Promise.resolve(''),
      choice: (q, items) => Promise.resolve(items[0] || ''),
    },
    config: {
      read: (keys, dotfile, defaults) => {
        const cfg = { ...defaults };
        for (const k of keys) {
          if (process.env[k]) cfg[k] = process.env[k];
        }
        if (!cfg.YT_TOKEN) cfg.YT_TOKEN = 'perm:test-token-fake';
        return cfg;
      },
    },
    shell: {
      run: () => {},
      capture: () => ({ ok: true, status: 0, stdout: '', stderr: '' }),
    },
    fs: require('fs'),
    path: require('path'),
    develRoot: '/tmp/test-devel',
    _calls: calls,
  };
}

module.exports = { createMockContext, urlMatcher, anyMatcher };
