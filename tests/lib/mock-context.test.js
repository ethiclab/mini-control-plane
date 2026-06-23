'use strict';

const { test, describe } = require('node:test');
const assert = require('node:assert/strict');

const { createContext } = require('../../lib/plugin-context');
const { createMockContext } = require('../helpers/mock-context');

// Guard against the class of bug that hid finding #1: a test fake whose shape
// drifts from the real context (e.g. DEVEL_ROOT vs develRoot). The fake must be
// derived from createContext, not re-declared by hand.
describe('mock-context — derived from the real createContext', () => {
  test('espone tutte le chiavi del context reale (più _calls)', () => {
    const real = createContext('/tmp/x');
    const mock = createMockContext([]);
    for (const key of Object.keys(real)) {
      assert.ok(key in mock, `il fake deve esporre la chiave "${key}" del context reale`);
    }
    assert.ok('develRoot' in mock, 'develRoot (lowercase) deve esistere, come nel context reale');
    assert.equal(mock.develRoot, '/tmp/test-devel');
  });

  test('opts.develRoot sovrascrive la root', () => {
    const mock = createMockContext([], { develRoot: '/custom/root' });
    assert.equal(mock.develRoot, '/custom/root');
  });

  test('config.read è ermetico: ignora il dotfile reale, usa defaults + env', () => {
    const ctx = createMockContext([]);
    assert.equal(ctx.config.read(['FOO_X'], '~/.nonexistent', { FOO_X: 'default' }).FOO_X, 'default');
    process.env.FOO_X = 'fromenv';
    try {
      assert.equal(ctx.config.read(['FOO_X'], '~/.nonexistent', { FOO_X: 'default' }).FOO_X, 'fromenv');
    } finally {
      delete process.env.FOO_X;
    }
  });
});
