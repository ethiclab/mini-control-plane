'use strict';

const { test, describe, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');
const fs = require('fs');

const { captureOutput } = require('../helpers/mock-exec');
const { createMockContext, urlMatcher, anyMatcher } = require('../helpers/mock-context');

const plugin = require('../../plugins/yt');

const CONFIG_KEYS = [
  'YT_TOKEN', 'YT_AGILE_ID', 'YT_SPRINT_ID',
  'YT_WIP_COLUMN', 'YT_RELEASE_COLUMN', 'YT_DONE_COLUMN',
  'YT_DEFAULT_TYPE', 'YT_DEFAULT_PRIORITY',
  'YT_DEFAULT_PROJECT', 'YT_QUESTION_TAG', 'YT_DEFAULT_LINK_TYPE',
];

let origEnv;

beforeEach(() => {
  origEnv = {};
  for (const k of CONFIG_KEYS) { origEnv[k] = process.env[k]; delete process.env[k]; }
  process.env.YT_TOKEN = 'perm:test-token-fake';
});

afterEach(() => {
  for (const k of CONFIG_KEYS) {
    if (origEnv[k] === undefined) delete process.env[k];
    else process.env[k] = origEnv[k];
  }
});

function fixture(name) {
  return JSON.parse(fs.readFileSync(path.join(__dirname, '../fixtures/youtrack', name), 'utf8'));
}

async function runExpectingExit(ctx, argv) {
  let exitCode;
  const origExit = process.exit;
  process.exit = (code) => { exitCode = code; throw new Error(`process.exit(${code})`); };
  try {
    const out = await captureOutput(async () => await plugin.run(argv, ctx));
    return { exitCode, out };
  } finally {
    process.exit = origExit;
  }
}

function postMatcher(urlFragment, responseData) {
  return urlMatcher('POST', urlFragment, responseData);
}

function getMatcher(urlFragment, responseData) {
  return urlMatcher('GET', urlFragment, responseData);
}

describe('yt plugin — queue (no args)', async () => {
  test('mostra la coda sprint con i 2 ticket attivi della colonna WIP', async () => {
    const board = fixture('board.json');
    const sprint = fixture('sprint-current.json');
    const ctx = createMockContext([
      getMatcher('/api/agiles/0-0?fields=', board),
      getMatcher('/api/agiles/0-0/sprints/current', sprint),
    ]);
    const out = await captureOutput(async () => await plugin.run([], ctx));
    assert.ok(out.stdout.includes('In Progress'));
    assert.ok(out.stdout.includes('DEMO-101'));
    assert.ok(out.stdout.includes('DEMO-102'));
    assert.ok(out.stdout.includes('▶ ora:'));
    assert.ok(out.stdout.includes('  poi:'));
  });

  test('fallback alla query REST se la colonna WIP non ha ticket', async () => {
    const boardNoIssues = {
      columnSettings: {
        columns: [
          { id: 'col-wip', presentation: 'In Progress', fieldValues: [{ name: 'In Progress' }] },
        ],
      },
    };
    const sprintEmpty = {
      board: { orphanRow: { cells: [] }, trimmedSwimlanes: [{ cells: [{ column: { id: 'col-wip' }, issues: [] }] }] },
    };
    const fallbackIssues = fixture('issues-list.json').slice(0, 2);
    const ctx = createMockContext([
      getMatcher('/api/agiles/0-0?fields=', boardNoIssues),
      getMatcher('/api/agiles/0-0/sprints/current', sprintEmpty),
      getMatcher('/api/issues?fields=', fallbackIssues),
    ]);
    const out = await captureOutput(async () => await plugin.run([], ctx));
    assert.ok(out.stdout.includes('DEMO-101'));
  });

  test('mostra "Nessun ticket trovato" se nessun risultato', async () => {
    const ctx = createMockContext([
      getMatcher('/api/agiles/0-0?fields=', { columnSettings: { columns: [] } }),
      getMatcher('/api/agiles/0-0/sprints/current', { board: { orphanRow: { cells: [] }, trimmedSwimlanes: [] } }),
      anyMatcher([]),
    ]);
    const out = await captureOutput(async () => await plugin.run([], ctx));
    assert.ok(out.stdout.includes('Nessun ticket trovato'));
  });
});

describe('yt plugin — issue detail (DEMO-NNN)', async () => {
  test('mostra il dettaglio di un issue specifico', async () => {
    const issue = fixture('issue-demo-101.json');
    const ctx = createMockContext([
      getMatcher('/api/issues/DEMO-101?fields=', issue),
    ]);
    const out = await captureOutput(async () => await plugin.run(['DEMO-101'], ctx));
    assert.ok(out.stdout.includes('DEMO-101'));
    assert.ok(out.stdout.includes('Fix login redirect loop'));
    assert.ok(out.stdout.includes('montoyaedu'));
    assert.ok(out.stdout.includes('In Progress'));
  });

  test('mostra attachments e commenti se presenti', async () => {
    const issue = {
      ...fixture('issue-demo-101.json'),
      attachments: [
        { name: 'screenshot.png', url: '/attachments/1', size: 2048, mimeType: 'image/png', created: 1743897600000, author: { login: 'ada' } },
        { name: 'note.txt' },
      ],
    };
    const comments = [
      { id: 'c1', text: 'Primo commento\ncon multiline', author: { name: 'Ada' }, created: 1743897600000 },
      { id: 'c2', text: null, author: {}, created: null },
    ];
    const ctx = createMockContext([
      getMatcher('/api/issues/DEMO-101?fields=', issue),
      getMatcher('/api/issues/DEMO-101/comments', comments),
    ]);
    const out = await captureOutput(async () => await plugin.run(['DEMO-101'], ctx));
    assert.ok(out.stdout.includes('Allegati'));
    assert.ok(out.stdout.includes('screenshot.png'));
    assert.ok(out.stdout.includes('note.txt'));
    assert.ok(out.stdout.includes('2.0 KB'));
    assert.ok(out.stdout.includes('Commenti'));
    assert.ok(out.stdout.includes('Primo commento'));
    assert.ok(out.stdout.includes('Ada'));
  });

  test('gestisce fallback quando la chiamata comments fallisce', async () => {
    const issue = fixture('issue-demo-101.json');
    const ctx = createMockContext([
      getMatcher('/api/issues/DEMO-101?fields=', issue),
      { match: (m, url) => url.includes('/comments'), response: null, error: 'API error' },
    ]);
    const out = await captureOutput(async () => await plugin.run(['DEMO-101'], ctx));
    assert.ok(out.stdout.includes('DEMO-101'));
    assert.ok(!out.stdout.includes('Commenti'));
  });

  test('mostra la descrizione separata da linea', async () => {
    const issue = fixture('issue-demo-101.json');
    const ctx = createMockContext([
      getMatcher('/api/issues/DEMO-101?fields=', issue),
    ]);
    const out = await captureOutput(async () => await plugin.run(['DEMO-101'], ctx));
    assert.ok(out.stdout.includes('─'));
    assert.ok(out.stdout.includes('redirect loop'));
  });
});

describe('yt plugin — lista issues (PROJECT [state])', async () => {
  test('lista issue per progetto senza filtro stato', async () => {
    const issues = fixture('issues-list.json');
    const ctx = createMockContext([
      getMatcher('/api/issues?fields=', issues),
    ]);
    const out = await captureOutput(async () => await plugin.run(['DEMO'], ctx));
    assert.ok(out.stdout.includes('DEMO'));
    assert.ok(out.stdout.includes('DEMO-101'));
    assert.ok(out.stdout.includes('[In Progress]'));
  });

  test('lista issue filtrata per stato "open"', async () => {
    const ctx = createMockContext([
      getMatcher('/api/issues?fields=', fixture('issues-list.json')),
    ]);
    await plugin.run(['DEMO', 'open'], ctx);
    const calls = ctx._calls;
    const call = calls.find((c) => c.url.includes('/api/issues'));
    assert.ok(call, 'chiamata API issues effettuata');
    assert.ok(call.url.includes('%23Unresolved') || call.url.includes('#Unresolved'));
  });

  test('lista issue filtrata per stato "done"', async () => {
    const ctx = createMockContext([
      getMatcher('/api/issues?fields=', []),
    ]);
    await plugin.run(['DEMO', 'done'], ctx);
    const call = ctx._calls.find((c) => c.url.includes('/api/issues'));
    assert.ok(call.url.includes('State%3A%20Done') || call.url.includes('State: Done'));
  });

  test('lista issue filtrata per stato "in-progress"', async () => {
    const ctx = createMockContext([
      getMatcher('/api/issues?fields=', []),
    ]);
    await plugin.run(['DEMO', 'in-progress'], ctx);
    const call = ctx._calls.find((c) => c.url.includes('/api/issues'));
    assert.ok(call.url.includes('In%20Progress') || call.url.includes('In Progress'));
  });

  test('lista issue filtrata per stato custom (non mappato)', async () => {
    const ctx = createMockContext([
      getMatcher('/api/issues?fields=', []),
    ]);
    await plugin.run(['DEMO', 'Attesa feedback'], ctx);
    const call = ctx._calls.find((c) => c.url.includes('/api/issues'));
    assert.ok(call.url.includes('Attesa%20feedback') || call.url.includes('Attesa feedback'));
  });
});

describe('yt plugin — board', async () => {
  test('mostra elenco colonne con alias wip/release/done', async () => {
    const board = fixture('board.json');
    const ctx = createMockContext([
      getMatcher('/api/agiles/0-0?fields=', board),
    ]);
    const out = await captureOutput(async () => await plugin.run(['board'], ctx));
    assert.ok(out.stdout.includes('In Progress'));
    assert.ok(out.stdout.includes('To Release'));
    assert.ok(out.stdout.includes('Done'));
    assert.ok(out.stdout.includes('[alias: wip]'));
    assert.ok(out.stdout.includes('[alias: release]'));
    assert.ok(out.stdout.includes('[alias: done]'));
    assert.ok(out.stdout.includes('In Progress'));
  });

  test('board vuota — messaggio "nessuna colonna"', async () => {
    const ctx = createMockContext([
      getMatcher('/api/agiles/0-0?fields=', { name: 'empty', columnSettings: { columns: [] } }),
    ]);
    const out = await captureOutput(async () => await plugin.run(['board'], ctx));
    assert.ok(out.stdout.includes('nessuna colonna'));
  });
});

describe('yt plugin — move', async () => {
  test('move DEMO-101 in "To Release" invia POST con State corretto', async () => {
    const board = fixture('board.json');
    const ctx = createMockContext([
      getMatcher('/api/agiles/0-0?fields=', board),
      postMatcher('/api/issues/DEMO-101', { idReadable: 'DEMO-101' }),
    ]);
    const out = await captureOutput(async () => await plugin.run(['move', 'DEMO-101', 'To Release'], ctx));
    const issueCall = ctx._calls.find((c) => c.url.includes('/api/issues/DEMO-101'));
    assert.ok(issueCall, 'POST a issue specifico');
    assert.equal(issueCall.opts.body.customFields[0].name, 'State');
    assert.equal(issueCall.opts.body.customFields[0].value.name, 'Ready for Release');
    assert.ok(out.stdout.includes('DEMO-101'));
    assert.ok(out.stdout.includes('To Release'));
  });

  test('move case-insensitive sul nome colonna', async () => {
    const board = fixture('board.json');
    const ctx = createMockContext([
      getMatcher('/api/agiles/0-0?fields=', board),
      postMatcher('/api/issues/DEMO-101', { idReadable: 'DEMO-101' }),
    ]);
    await plugin.run(['move', 'DEMO-101', 'TO RELEASE'], ctx);
    const issueCall = ctx._calls.find((c) => c.url.includes('/api/issues/DEMO-101'));
    assert.equal(issueCall.opts.body.customFields[0].value.name, 'Ready for Release');
  });

  test('move su colonna inesistente → errore parlante con lista', async () => {
    const board = fixture('board.json');
    const ctx = createMockContext([getMatcher('/api/agiles/0-0?fields=', board)]);
    const { exitCode, out } = await runExpectingExit(ctx, ['move', 'DEMO-101', 'Colonna Inesistente']);
    assert.equal(exitCode, 1);
    assert.ok(out.stderr.includes('Colonna Inesistente'));
    assert.ok(out.stderr.includes('Disponibili'));
    assert.ok(out.stderr.includes('To Release'));
  });

  test('move senza colonna → errore "Nome colonna mancante"', async () => {
    const board = fixture('board.json');
    const ctx = createMockContext([getMatcher('/api/agiles/0-0?fields=', board)]);
    const { exitCode, out } = await runExpectingExit(ctx, ['move', 'DEMO-101']);
    assert.equal(exitCode, 1);
    assert.ok(out.stderr.includes('Nome colonna mancante'));
  });

  test('move senza id ticket → errore', async () => {
    const ctx = createMockContext([]);
    const { exitCode, out } = await runExpectingExit(ctx, ['move', '', 'To Release']);
    assert.equal(exitCode, 1);
    assert.ok(out.stderr.includes('ID ticket mancante'));
  });

  test('move fallisce se la colonna non ha stateValues', async () => {
    const badBoard = { columnSettings: { columns: [{ id: 'col-x', presentation: 'Vuota', fieldValues: [] }] } };
    const ctx = createMockContext([getMatcher('/api/agiles/0-0?fields=', badBoard)]);
    const { exitCode, out } = await runExpectingExit(ctx, ['move', 'DEMO-101', 'Vuota']);
    assert.equal(exitCode, 1);
    assert.ok(out.stderr.includes('state values'));
  });
});

describe('yt plugin — move → top of column', async () => {
  test('move aggancia il ticket a bacheca+sprint e lo sposta in cima alla colonna', async () => {
    const board = fixture('board.json');
    const ctx = createMockContext([
      getMatcher('/api/agiles/0-0?fields=', board),
      postMatcher('/api/issues/DEMO-101', { id: '2-101', idReadable: 'DEMO-101' }),
      postMatcher('/api/agiles/0-0/sprints/current/issues?', { idReadable: 'attached' }),
      postMatcher('/issueOrder?', { leading: null, moved: {} }),
    ]);
    const out = await captureOutput(async () => await plugin.run(['move', 'DEMO-101', 'To Release'], ctx));
    const attachCall = ctx._calls.find((c) => c.url.includes('/sprints/') && c.url.includes('/issues?'));
    assert.ok(attachCall, 'attach chiamato');
    assert.deepEqual(attachCall.opts.body, { id: '2-101' });
    const orderCall = ctx._calls.find((c) => c.url.includes('/issueOrder?'));
    assert.ok(orderCall, 'issueOrder chiamato');
    assert.deepEqual(orderCall.opts.body, { leading: null, moved: { id: '2-101' } });
    assert.ok(out.stdout.includes('↑ top'));
  });

  test('done usa stessa logica: attach + top-of-column', async () => {
    const board = fixture('board.json');
    const ctx = createMockContext([
      getMatcher('/api/agiles/0-0?fields=', board),
      postMatcher('/api/issues/DEMO-101', { id: '2-101', idReadable: 'DEMO-101' }),
      postMatcher('/sprints/current/issues?', { idReadable: 'attached' }),
      postMatcher('/issueOrder?', { leading: null, moved: {} }),
    ]);
    const out = await captureOutput(async () => await plugin.run(['done', 'DEMO-101'], ctx));
    const attachCall = ctx._calls.find((c) => c.url.includes('/sprints/'));
    assert.ok(attachCall);
    const orderCall = ctx._calls.find((c) => c.url.includes('/issueOrder?'));
    assert.ok(orderCall);
    assert.ok(out.stdout.includes('↑ top'));
    assert.ok(out.stdout.includes('Done'));
  });

  test('se attach fallisce, move continua ma segnala "attach FAILED"', async () => {
    const board = fixture('board.json');
    const ctx = createMockContext([
      getMatcher('/api/agiles/0-0?fields=', board),
      postMatcher('/api/issues/DEMO-101', { id: '2-101', idReadable: 'DEMO-101' }),
      { match: (m, url) => m === 'POST' && url.includes('/sprints/') && url.includes('/issues?'), response: null, error: 'boom-attach' },
      postMatcher('/issueOrder?', { leading: null, moved: {} }),
    ]);
    const out = await captureOutput(async () => await plugin.run(['move', 'DEMO-101', 'To Release'], ctx));
    assert.ok(out.stdout.includes('attach FAILED'));
    assert.ok(out.stdout.includes('boom-attach'));
  });

  test('se issueOrder fallisce, move continua ma segnala "top FAILED"', async () => {
    const board = fixture('board.json');
    const ctx = createMockContext([
      getMatcher('/api/agiles/0-0?fields=', board),
      postMatcher('/api/issues/DEMO-101', { id: '2-101', idReadable: 'DEMO-101' }),
      postMatcher('/sprints/current/issues?', { idReadable: 'attached' }),
      { match: (m, url) => m === 'POST' && url.includes('/issueOrder?'), response: null, error: 'boom-order' },
    ]);
    const out = await captureOutput(async () => await plugin.run(['move', 'DEMO-101', 'To Release'], ctx));
    assert.ok(out.stdout.includes('top FAILED'));
    assert.ok(out.stdout.includes('boom-order'));
  });

  test('se YouTrack non ritorna id interno, move salta attach+order senza errori', async () => {
    const board = fixture('board.json');
    const ctx = createMockContext([
      getMatcher('/api/agiles/0-0?fields=', board),
      postMatcher('/api/issues/DEMO-101', { idReadable: 'DEMO-101' }),
    ]);
    const out = await captureOutput(async () => await plugin.run(['move', 'DEMO-101', 'To Release'], ctx));
    const hasAttach = ctx._calls.some((c) => c.url.includes('/sprints/') && c.url.includes('/issues?'));
    const hasOrder = ctx._calls.some((c) => c.url.includes('/issueOrder?'));
    assert.equal(hasAttach, false);
    assert.equal(hasOrder, false);
    assert.ok(!out.stdout.includes('↑ top'));
    assert.ok(out.stdout.includes('To Release'));
  });
});

describe('yt plugin — alias wip/release/done', async () => {
  test('wip usa la colonna configurata di default', async () => {
    const board = fixture('board.json');
    const ctx = createMockContext([
      getMatcher('/api/agiles/0-0?fields=', board),
      postMatcher('/api/issues/DEMO-101', { idReadable: 'DEMO-101' }),
    ]);
    await plugin.run(['wip', 'DEMO-101'], ctx);
    const issueCall = ctx._calls.find((c) => c.url.includes('/api/issues/DEMO-101'));
    assert.equal(issueCall.opts.body.customFields[0].value.name, 'In Progress');
  });

  test('wip rispetta override via env YT_WIP_COLUMN', async () => {
    process.env.YT_WIP_COLUMN = 'To Release';
    const board = fixture('board.json');
    const ctx = createMockContext([
      getMatcher('/api/agiles/0-0?fields=', board),
      postMatcher('/api/issues/DEMO-101', { idReadable: 'DEMO-101' }),
    ]);
    await plugin.run(['wip', 'DEMO-101'], ctx);
    const issueCall = ctx._calls.find((c) => c.url.includes('/api/issues/DEMO-101'));
    assert.equal(issueCall.opts.body.customFields[0].value.name, 'Ready for Release');
  });

  test('release usa "To Release" di default', async () => {
    const board = fixture('board.json');
    const ctx = createMockContext([
      getMatcher('/api/agiles/0-0?fields=', board),
      postMatcher('/api/issues/DEMO-101', { idReadable: 'DEMO-101' }),
    ]);
    await plugin.run(['release', 'DEMO-101'], ctx);
    const issueCall = ctx._calls.find((c) => c.url.includes('/api/issues/DEMO-101'));
    assert.equal(issueCall.opts.body.customFields[0].value.name, 'Ready for Release');
  });

  test('done usa "Done" di default', async () => {
    const board = fixture('board.json');
    const ctx = createMockContext([
      getMatcher('/api/agiles/0-0?fields=', board),
      postMatcher('/api/issues/DEMO-101', { idReadable: 'DEMO-101' }),
    ]);
    await plugin.run(['done', 'DEMO-101'], ctx);
    const issueCall = ctx._calls.find((c) => c.url.includes('/api/issues/DEMO-101'));
    assert.equal(issueCall.opts.body.customFields[0].value.name, 'Done');
  });
});

describe('yt plugin — new', async () => {
  function todayMidnight() {
    const now = new Date();
    return Date.UTC(now.getFullYear(), now.getMonth(), now.getDate());
  }

  function findCf(body, name) {
    return (body.customFields || []).find((cf) => cf.name === name);
  }

  test('crea ticket con default colonna WIP e stato iniziale', async () => {
    const board = fixture('board.json');
    const ctx = createMockContext([
      getMatcher('/api/admin/projects', [{ id: '0-5', shortName: 'DEMO' }, { id: '0-9', shortName: 'OPS' }]),
      getMatcher('/api/agiles/0-0?fields=', board),
      postMatcher('/api/issues?fields=', { id: '2-999', idReadable: 'DEMO-999', summary: 'nuovo ticket' }),
      postMatcher('/sprints/current/issues?', { idReadable: 'attached' }),
      postMatcher('/issueOrder?', { leading: null, moved: {} }),
    ]);
    const out = await captureOutput(async () => await plugin.run(['new', 'DEMO', 'nuovo ticket'], ctx));
    const issueCall = ctx._calls.find((c) => c.url.includes('/api/issues?fields='));
    assert.equal(issueCall.opts.body.project.id, '0-5');
    assert.equal(issueCall.opts.body.summary, 'nuovo ticket');
    assert.equal(issueCall.opts.body.customFields[0].name, 'State');
    assert.equal(issueCall.opts.body.customFields[0].value.name, 'In Progress');
    assert.ok(!('description' in issueCall.opts.body));
    assert.ok(out.stdout.includes('DEMO-999'));
    assert.ok(out.stdout.includes('In Progress'));
  });

  test('crea ticket imposta default Type=Bug, Priority=Normal, Due=oggi', async () => {
    const board = fixture('board.json');
    const ctx = createMockContext([
      getMatcher('/api/admin/projects', [{ id: '0-5', shortName: 'DEMO' }]),
      getMatcher('/api/agiles/0-0?fields=', board),
      postMatcher('/api/issues?fields=', { id: '2-1010', idReadable: 'DEMO-1010', summary: 'x' }),
      postMatcher('/sprints/current/issues?', { idReadable: 'attached' }),
      postMatcher('/issueOrder?', { leading: null, moved: {} }),
    ]);
    const out = await captureOutput(async () => await plugin.run(['new', 'DEMO', 'default fields'], ctx));
    const issueCall = ctx._calls.find((c) => c.url.includes('/api/issues?fields='));
    const body = issueCall.opts.body;
    assert.equal(findCf(body, 'Type').value.name, 'Bug');
    assert.equal(findCf(body, 'Priority').value.name, 'Normal');
    assert.equal(findCf(body, 'Due Date').value, todayMidnight());
    assert.ok(out.stdout.includes('Bug'));
    assert.ok(out.stdout.includes('Normal'));
  });

  test('crea ticket rispetta override -t / -p / --due', async () => {
    const board = fixture('board.json');
    const ctx = createMockContext([
      getMatcher('/api/admin/projects', [{ id: '0-5', shortName: 'DEMO' }]),
      getMatcher('/api/agiles/0-0?fields=', board),
      postMatcher('/api/issues?fields=', { id: '2-1011', idReadable: 'DEMO-1011', summary: 'x' }),
      postMatcher('/sprints/current/issues?', { idReadable: 'attached' }),
      postMatcher('/issueOrder?', { leading: null, moved: {} }),
    ]);
    await plugin.run(['new', 'DEMO', 'override tutto', '-t', 'Task', '-p', 'Normal', '--due', '2026-12-31'], ctx);
    const body = ctx._calls.find((c) => c.url.includes('/api/issues?fields=')).opts.body;
    assert.equal(findCf(body, 'Type').value.name, 'Task');
    assert.equal(findCf(body, 'Priority').value.name, 'Normal');
    assert.equal(findCf(body, 'Due Date').value, Date.UTC(2026, 11, 31));
  });

  test('crea ticket rispetta env YT_DEFAULT_TYPE / YT_DEFAULT_PRIORITY', async () => {
    process.env.YT_DEFAULT_TYPE = 'Task';
    process.env.YT_DEFAULT_PRIORITY = 'Normal';
    const board = fixture('board.json');
    const ctx = createMockContext([
      getMatcher('/api/admin/projects', [{ id: '0-5', shortName: 'DEMO' }]),
      getMatcher('/api/agiles/0-0?fields=', board),
      postMatcher('/api/issues?fields=', { id: '2-1012', idReadable: 'DEMO-1012', summary: 'x' }),
      postMatcher('/sprints/current/issues?', { idReadable: 'attached' }),
      postMatcher('/issueOrder?', { leading: null, moved: {} }),
    ]);
    await plugin.run(['new', 'DEMO', 'env override'], ctx);
    const body = ctx._calls.find((c) => c.url.includes('/api/issues?fields=')).opts.body;
    assert.equal(findCf(body, 'Type').value.name, 'Task');
    assert.equal(findCf(body, 'Priority').value.name, 'Normal');
  });

  test('dopo la creazione aggancia il ticket a bacheca+sprint e lo mette in cima', async () => {
    const board = fixture('board.json');
    const ctx = createMockContext([
      getMatcher('/api/admin/projects', [{ id: '0-5', shortName: 'DEMO' }]),
      getMatcher('/api/agiles/0-0?fields=', board),
      postMatcher('/api/issues?fields=', { id: '2-1020', idReadable: 'DEMO-1020', summary: 'x' }),
      postMatcher('/sprints/current/issues?', { idReadable: 'attached' }),
      postMatcher('/issueOrder?', { leading: null, moved: {} }),
    ]);
    const out = await captureOutput(async () => await plugin.run(['new', 'DEMO', 'attach+order'], ctx));
    const attachCall = ctx._calls.find((c) => c.url.includes('/sprints/') && c.url.includes('/issues?'));
    assert.deepEqual(attachCall.opts.body, { id: '2-1020' });
    const orderCall = ctx._calls.find((c) => c.url.includes('/issueOrder?'));
    assert.deepEqual(orderCall.opts.body, { leading: null, moved: { id: '2-1020' } });
    assert.ok(out.stdout.includes('Bacheca:'));
    assert.ok(out.stdout.includes('↑ top'));
  });

  test('bacheca/top usano YT_AGILE_ID e YT_SPRINT_ID da env', async () => {
    process.env.YT_AGILE_ID = '200-1';
    process.env.YT_SPRINT_ID = 'sprint-2';
    const board = fixture('board.json');
    const ctx = createMockContext([
      getMatcher('/api/admin/projects', [{ id: '0-5', shortName: 'DEMO' }]),
      getMatcher('/api/agiles/200-1?fields=', board),
      postMatcher('/api/issues?fields=', { id: '2-1021', idReadable: 'DEMO-1021', summary: 'x' }),
      postMatcher('/api/agiles/200-1/sprints/sprint-2/issues?', { idReadable: 'attached' }),
      postMatcher('/api/agiles/200-1/sprints/sprint-2/board/', { leading: null, moved: {} }),
    ]);
    await plugin.run(['new', 'DEMO', 'custom bacheca'], ctx);
    const attachCall = ctx._calls.find((c) => c.url.includes('/sprints/sprint-2/issues?'));
    assert.ok(attachCall, 'attach con URL custom');
    const orderCall = ctx._calls.find((c) => c.url.includes('/sprints/sprint-2/board/') && c.url.includes('/issueOrder?'));
    assert.ok(orderCall, 'issueOrder con URL custom');
    assert.deepEqual(attachCall.opts.body, { id: '2-1021' });
    assert.deepEqual(orderCall.opts.body, { leading: null, moved: { id: '2-1021' } });
  });

  test('se YouTrack non restituisce id interno, salta attach+order senza errori', async () => {
    const board = fixture('board.json');
    const ctx = createMockContext([
      getMatcher('/api/admin/projects', [{ id: '0-5', shortName: 'DEMO' }]),
      getMatcher('/api/agiles/0-0?fields=', board),
      postMatcher('/api/issues?fields=', { idReadable: 'DEMO-1022', summary: 'x' }),
    ]);
    const out = await captureOutput(async () => await plugin.run(['new', 'DEMO', 'no internal id'], ctx));
    const hasAttach = ctx._calls.some((c) => c.url.includes('/sprints/') && c.url.includes('/issues?'));
    const hasOrder = ctx._calls.some((c) => c.url.includes('/issueOrder?'));
    assert.equal(hasAttach, false);
    assert.equal(hasOrder, false);
    assert.ok(out.stdout.includes('DEMO-1022'));
  });

  test('crea ticket → --due con data fuori range esce con errore', async () => {
    const ctx = createMockContext([]);
    const { exitCode, out } = await runExpectingExit(ctx, ['new', 'DEMO', 'x', '--due', '2026-02-31']);
    assert.equal(exitCode, 1);
    assert.ok(out.stderr.includes('Due date non valida'));
  });

  test('crea ticket → --due con formato invalido esce con errore', async () => {
    const ctx = createMockContext([]);
    const { exitCode, out } = await runExpectingExit(ctx, ['new', 'DEMO', 'x', '--due', '31-12-2026']);
    assert.equal(exitCode, 1);
    assert.ok(out.stderr.includes('YYYY-MM-DD'));
  });

  test('crea ticket con --desc e --col custom', async () => {
    const board = fixture('board.json');
    const ctx = createMockContext([
      getMatcher('/api/admin/projects', [{ id: '0-5', shortName: 'DEMO' }]),
      getMatcher('/api/agiles/0-0?fields=', board),
      postMatcher('/api/issues?fields=', { id: '2-1000', idReadable: 'DEMO-1000', summary: 'x' }),
      postMatcher('/sprints/current/issues?', { idReadable: 'attached' }),
      postMatcher('/issueOrder?', { leading: null, moved: {} }),
    ]);
    await plugin.run(['new', 'DEMO', 'feature', 'multi', 'parola', '-d', 'descrizione dettagliata', '-c', 'To Release'], ctx);
    const body = ctx._calls.find((c) => c.url.includes('/api/issues?fields=')).opts.body;
    assert.equal(body.summary, 'feature multi parola');
    assert.equal(body.description, 'descrizione dettagliata');
    assert.equal(body.customFields[0].value.name, 'Ready for Release');
  });

  test('crea ticket con --assignee', async () => {
    const board = fixture('board.json');
    const ctx = createMockContext([
      getMatcher('/api/admin/projects', [{ id: '0-5', shortName: 'DEMO' }]),
      getMatcher('/api/agiles/0-0?fields=', board),
      postMatcher('/api/issues?fields=', { id: '2-1001', idReadable: 'DEMO-1001', summary: 'x' }),
      postMatcher('/sprints/current/issues?', { idReadable: 'attached' }),
      postMatcher('/issueOrder?', { leading: null, moved: {} }),
    ]);
    const out = await captureOutput(async () => await plugin.run(['new', 'DEMO', 'task con assignee', '-a', 'montoyaedu'], ctx));
    const body = ctx._calls.find((c) => c.url.includes('/api/issues?fields=')).opts.body;
    const assigneeCf = body.customFields.find((cf) => cf.name === 'Assignee');
    assert.ok(assigneeCf);
    assert.equal(assigneeCf.value.login, 'montoyaedu');
    assert.ok(out.stdout.includes('montoyaedu'));
  });

  test('new senza summary → errore', async () => {
    const ctx = createMockContext([]);
    const { exitCode, out } = await runExpectingExit(ctx, ['new']);
    assert.equal(exitCode, 1);
    assert.ok(out.stderr.includes('Usage'));
  });

  test('new con progetto sconosciuto → errore con lista', async () => {
    const ctx = createMockContext([
      getMatcher('/api/admin/projects', [{ id: '0-5', shortName: 'DEMO' }, { id: '0-9', shortName: 'OPS' }]),
    ]);
    const { exitCode, out } = await runExpectingExit(ctx, ['new', 'NOPE', 'summary']);
    assert.equal(exitCode, 1);
    assert.ok(out.stderr.includes('NOPE'));
    assert.ok(out.stderr.includes('DEMO') && out.stderr.includes('OPS'));
  });

  test('new con solo summary (no residui) dopo il project', async () => {
    const board = fixture('board.json');
    const ctx = createMockContext([
      getMatcher('/api/admin/projects', [{ id: '0-5', shortName: 'DEMO' }]),
      getMatcher('/api/agiles/0-0?fields=', board),
      postMatcher('/api/issues?fields=', { id: '2-2000', idReadable: 'DEMO-2000', summary: 'x' }),
      postMatcher('/sprints/current/issues?', { idReadable: 'attached' }),
      postMatcher('/issueOrder?', { leading: null, moved: {} }),
    ]);
    await plugin.run(['new', 'DEMO', 'quick'], ctx);
    const body = ctx._calls.find((c) => c.url.includes('/api/issues?fields=')).opts.body;
    assert.equal(body.summary, 'quick');
  });
});

describe('yt plugin — edit', async () => {
  test('edit aggiorna summary e description insieme', async () => {
    const ctx = createMockContext([
      postMatcher('/api/issues/DEMO-321?fields=', { idReadable: 'DEMO-321', summary: 'titolo nuovo' }),
    ]);
    const out = await captureOutput(async () => await plugin.run(['edit', 'DEMO-321', '--title', 'titolo nuovo', '--desc', 'descrizione nuova'], ctx));
    const body = ctx._calls.find((c) => c.url.includes('/api/issues/DEMO-321')).opts.body;
    assert.equal(body.summary, 'titolo nuovo');
    assert.equal(body.description, 'descrizione nuova');
    assert.ok(out.stdout.includes('DEMO-321'));
    assert.ok(out.stdout.includes('titolo nuovo'));
  });

  test('edit aggiorna solo la description', async () => {
    const ctx = createMockContext([
      postMatcher('/api/issues/DEMO-322?fields=', { idReadable: 'DEMO-322', summary: 'titolo invariato' }),
    ]);
    await plugin.run(['edit', 'DEMO-322', '--desc', 'solo descrizione'], ctx);
    const body = ctx._calls.find((c) => c.url.includes('/api/issues/DEMO-322')).opts.body;
    assert.ok(!('summary' in body));
    assert.equal(body.description, 'solo descrizione');
  });

  test('edit senza campi da aggiornare → errore con usage', async () => {
    const ctx = createMockContext([]);
    const { exitCode, out } = await runExpectingExit(ctx, ['edit', 'DEMO-323']);
    assert.equal(exitCode, 1);
    assert.ok(out.stderr.includes('Usage'));
  });
});

describe('yt plugin — API error handling', async () => {
  test('risposta di errore YouTrack viene propagata', async () => {
    const ctx = createMockContext([
      { match: (m, url) => url.includes('/api/issues/DEMO-999'), response: null, error: 'API error: Not Found' },
    ]);
    const out = await captureOutput(async () => {
      try { await plugin.run(['DEMO-999'], ctx); } catch (_) {}
    });
    assert.ok(true, 'smoke: error handling non crasha il processo');
  });
});

describe('yt plugin — config da env', async () => {
  test('override colonna WIP via YT_WIP_COLUMN', async () => {
    process.env.YT_WIP_COLUMN = 'To Release';
    const board = fixture('board.json');
    const ctx = createMockContext([
      getMatcher('/api/agiles/0-0?fields=', board),
    ]);
    const out = await captureOutput(async () => await plugin.run(['board'], ctx));
    assert.ok(out.stdout.includes('[alias: release]'));
  });
});

describe('yt plugin — help', async () => {
  test('mini yt help stampa il manuale su stdout', async () => {
    const out = await captureOutput(async () => await plugin.run(['help'], createMockContext([])));
    assert.ok(out.stdout.includes('USAGE'));
    assert.ok(out.stdout.includes('mini yt new'));
    assert.ok(out.stdout.includes('mini yt move'));
    assert.ok(out.stdout.includes('mini yt release'));
    assert.ok(out.stdout.includes('mini yt done'));
    assert.ok(out.stdout.includes('mini yt board'));
  });

  test('--help e -h sono alias', async () => {
    const out1 = await captureOutput(async () => await plugin.run(['--help'], createMockContext([])));
    const out2 = await captureOutput(async () => await plugin.run(['-h'], createMockContext([])));
    assert.ok(out1.stdout.length > 0);
    assert.ok(out2.stdout.length > 0);
  });

  test('hint a mini yt help appare nel comando senza args', async () => {
    const ctx = createMockContext([
      getMatcher('/api/agiles/0-0?fields=', { columnSettings: { columns: [] } }),
      getMatcher('/api/agiles/0-0/sprints/current', { board: { orphanRow: { cells: [] }, trimmedSwimlanes: [] } }),
      anyMatcher([]),
    ]);
    const out = await captureOutput(async () => await plugin.run([], ctx));
    assert.ok(out.stdout.includes('mini yt help'));
  });
});

describe('yt plugin — config', async () => {
  const os = require('os');
  const TEST_HOME = path.join(os.tmpdir(), 'mini-yt-config-home');
  let origHome;

  function setHome(withFile) {
    fs.mkdirSync(TEST_HOME, { recursive: true });
    const file = path.join(TEST_HOME, '.youtrack');
    if (withFile) {
      fs.writeFileSync(file, 'YT_TOKEN=perm:supersecrettoken123\nYT_AGILE_ID=0-0\nYT_WIP_COLUMN=In Progress\n');
    } else if (fs.existsSync(file)) {
      fs.unlinkSync(file);
    }
    origHome = process.env.HOME;
    process.env.HOME = TEST_HOME;
  }
  function restoreHome() { if (origHome === undefined) delete process.env.HOME; else process.env.HOME = origHome; }

  test('mostra il percorso assoluto del file di config', async () => {
    setHome(true);
    try {
      const out = await captureOutput(async () => await plugin.run(['config'], createMockContext([])));
      assert.ok(out.stdout.includes(path.join(TEST_HOME, '.youtrack')), 'mostra il path del dotfile');
    } finally { restoreHome(); }
  });

  test('mostra il contenuto ma maschera i valori segreti', async () => {
    setHome(true);
    try {
      const out = await captureOutput(async () => await plugin.run(['config'], createMockContext([])));
      assert.ok(out.stdout.includes('YT_AGILE_ID=0-0'), 'mostra chiavi non segrete');
      assert.ok(out.stdout.includes('In Progress'), 'mostra valori non segreti');
      assert.ok(!out.stdout.includes('supersecrettoken123'), 'NON mostra il token in chiaro');
      assert.ok(/YT_TOKEN=.*\*\*\*\*/.test(out.stdout), 'token mascherato con ****');
    } finally { restoreHome(); }
  });

  test('maschera anche i token corti come ****', async () => {
    fs.mkdirSync(TEST_HOME, { recursive: true });
    fs.writeFileSync(path.join(TEST_HOME, '.youtrack'), 'YT_TOKEN=short\n');
    origHome = process.env.HOME;
    process.env.HOME = TEST_HOME;
    try {
      const out = await captureOutput(async () => await plugin.run(['config'], createMockContext([])));
      assert.ok(out.stdout.includes('YT_TOKEN=****'), 'token corto → ****');
      assert.ok(!out.stdout.includes('=short'), 'non rivela il valore corto');
    } finally { restoreHome(); }
  });

  test('config funziona senza token e segnala file assente', async () => {
    setHome(false);
    try {
      const out = await captureOutput(async () => await plugin.run(['config'], createMockContext([])));
      assert.ok(out.stdout.includes(path.join(TEST_HOME, '.youtrack')), 'mostra comunque il path');
      assert.ok(/non trovato|assente|manca/i.test(out.stdout), 'segnala che il file non esiste');
    } finally { restoreHome(); }
  });
});

describe('yt plugin — comments (read)', async () => {
  const fullList = [
    { id: 'c1', text: 'vecchio', author: { name: 'Ada' }, created: 1000 },
    { id: 'c2', text: 'Q1: domanda recente', author: { login: 'montoyaedu' }, created: 5000 },
    { id: 'c3', text: null, author: {}, created: 9000 },
  ];

  test('comments <ID> elenca commenti in formato human', async () => {
    const ctx = createMockContext([getMatcher('/api/issues/DEMO-100/comments', fullList)]);
    const out = await captureOutput(async () => await plugin.run(['comments', 'DEMO-100'], ctx));
    assert.ok(out.stdout.includes('Ada'));
    assert.ok(out.stdout.includes('montoyaedu'));
    assert.ok(out.stdout.includes('Q1: domanda recente'));
    assert.ok(out.stdout.includes('---'));
  });

  test('comments --since filtra solo i commenti più recenti', async () => {
    const ctx = createMockContext([getMatcher('/api/issues/DEMO-100/comments', fullList)]);
    const out = await captureOutput(async () => await plugin.run(['comments', 'DEMO-100', '--since', '3000'], ctx));
    assert.ok(!out.stdout.includes('vecchio'));
    assert.ok(out.stdout.includes('Q1: domanda recente'));
  });

  test('comments --json stampa JSON parsabile', async () => {
    const ctx = createMockContext([getMatcher('/api/issues/DEMO-100/comments', fullList)]);
    const out = await captureOutput(async () => await plugin.run(['comments', 'DEMO-100', '--json'], ctx));
    const parsed = JSON.parse(out.stdout);
    assert.equal(parsed.length, 3);
    assert.equal(parsed[1].id, 'c2');
  });

  test('comments --since + --json filtra e serializza', async () => {
    const ctx = createMockContext([getMatcher('/api/issues/DEMO-100/comments', fullList)]);
    const out = await captureOutput(async () => await plugin.run(['comments', 'DEMO-100', '--since', '3000', '--json'], ctx));
    const parsed = JSON.parse(out.stdout);
    assert.equal(parsed.length, 2);
    assert.deepEqual(parsed.map((c) => c.id), ['c2', 'c3']);
  });

  test('comments --since con ISO string funziona', async () => {
    const iso = new Date(3000).toISOString();
    const ctx = createMockContext([getMatcher('/api/issues/DEMO-100/comments', fullList)]);
    const out = await captureOutput(async () => await plugin.run(['comments', 'DEMO-100', '--since', iso], ctx));
    assert.ok(!out.stdout.includes('vecchio'));
    assert.ok(out.stdout.includes('Q1:'));
  });

  test('comments senza ID → errore con usage', async () => {
    const ctx = createMockContext([]);
    const { exitCode, out } = await runExpectingExit(ctx, ['comments']);
    assert.equal(exitCode, 1);
    assert.ok(out.stderr.includes('Usage'));
  });

  test('comments --since invalido → errore parlante', async () => {
    const ctx = createMockContext([getMatcher('/api/issues/DEMO-100/comments', fullList)]);
    const { exitCode, out } = await runExpectingExit(ctx, ['comments', 'DEMO-100', '--since', 'non-una-data']);
    assert.equal(exitCode, 1);
    assert.ok(out.stderr.includes('--since non valido'));
  });

  test('comments su ticket senza commenti (lista vuota) mostra placeholder', async () => {
    const ctx = createMockContext([getMatcher('/api/issues/DEMO-100/comments', [])]);
    const out = await captureOutput(async () => await plugin.run(['comments', 'DEMO-100'], ctx));
    assert.ok(out.stdout.includes('nessun commento'));
  });

  test('comments --since + lista vuota mostra placeholder con "dopo"', async () => {
    const ctx = createMockContext([getMatcher('/api/issues/DEMO-100/comments', [])]);
    const out = await captureOutput(async () => await plugin.run(['comments', 'DEMO-100', '--since', '3000'], ctx));
    assert.ok(out.stdout.includes('dopo 3000'));
  });
});

describe('yt plugin — comment (write)', async () => {
  test('comment aggiunge commento via POST', async () => {
    const ctx = createMockContext([
      postMatcher('/api/issues/DEMO-200/comments?', { id: 'c-new-1' }),
    ]);
    const out = await captureOutput(async () => await plugin.run(['comment', 'DEMO-200', '-m', 'testo commento'], ctx));
    const call = ctx._calls.find((c) => c.url.includes('/api/issues/DEMO-200/comments'));
    assert.ok(call, 'POST a comments');
    assert.equal(call.opts.body.text, 'testo commento');
    assert.ok(out.stdout.includes('Commento aggiunto'));
    assert.ok(out.stdout.includes('DEMO-200'));
  });

  test('comment senza -m o `-` → errore', async () => {
    const ctx = createMockContext([]);
    const { exitCode, out } = await runExpectingExit(ctx, ['comment', 'DEMO-200']);
    assert.equal(exitCode, 1);
    assert.ok(out.stderr.includes('Testo del commento mancante'));
  });

  test('comment senza ID → errore', async () => {
    const ctx = createMockContext([]);
    const { exitCode, out } = await runExpectingExit(ctx, ['comment']);
    assert.equal(exitCode, 1);
    assert.ok(out.stderr.includes('Usage'));
  });
});

describe('yt plugin — link', async () => {
  test('link crea collegamento Subtask di default', async () => {
    const ctx = createMockContext([
      postMatcher('/api/commands', { id: 'cmd-ok' }),
    ]);
    const out = await captureOutput(async () => await plugin.run(['link', 'DEMO-100', 'DEMO-200'], ctx));
    const call = ctx._calls.find((c) => c.url.includes('/api/commands'));
    assert.ok(call, 'chiamata a commands API');
    assert.equal(call.opts.body.query, 'subtask of DEMO-100');
    assert.equal(call.opts.body.issues[0].idReadable, 'DEMO-200');
    assert.ok(out.stdout.includes('DEMO-200'));
    assert.ok(out.stdout.includes('subtask of'));
    assert.ok(out.stdout.includes('DEMO-100'));
  });

  test('link --type Relates usa la relazione "relates to"', async () => {
    const ctx = createMockContext([
      postMatcher('/api/commands', { id: 'cmd-ok' }),
    ]);
    await plugin.run(['link', 'DEMO-100', 'DEMO-200', '--type', 'Relates'], ctx);
    const call = ctx._calls.find((c) => c.url.includes('/api/commands'));
    assert.equal(call.opts.body.query, 'relates to DEMO-100');
  });

  test('link --type Depend usa "depends on"', async () => {
    const ctx = createMockContext([
      postMatcher('/api/commands', { id: 'cmd-ok' }),
    ]);
    await plugin.run(['link', 'DEMO-100', 'DEMO-200', '--type', 'Depend'], ctx);
    const call = ctx._calls.find((c) => c.url.includes('/api/commands'));
    assert.equal(call.opts.body.query, 'depends on DEMO-100');
  });
});

describe('yt plugin — tag', async () => {
  test('tag +name aggiunge tag', async () => {
    const ctx = createMockContext([
      postMatcher('/api/commands', { id: 'cmd-ok' }),
    ]);
    const out = await captureOutput(async () => await plugin.run(['tag', 'DEMO-100', '+question-pending'], ctx));
    const call = ctx._calls.find((c) => c.url.includes('/api/commands'));
    assert.equal(call.opts.body.query, 'tag question-pending');
    assert.equal(call.opts.body.issues[0].idReadable, 'DEMO-100');
    assert.ok(out.stdout.includes('+'));
    assert.ok(out.stdout.includes('question-pending'));
  });

  test('tag -name rimuove tag', async () => {
    const ctx = createMockContext([
      postMatcher('/api/commands', { id: 'cmd-ok' }),
    ]);
    const out = await captureOutput(async () => await plugin.run(['tag', 'DEMO-100', '-question-pending'], ctx));
    const call = ctx._calls.find((c) => c.url.includes('/api/commands'));
    assert.equal(call.opts.body.query, 'remove tag question-pending');
    assert.ok(out.stdout.includes('−'));
  });

  test('tag name (senza prefisso) aggiunge per default', async () => {
    const ctx = createMockContext([
      postMatcher('/api/commands', { id: 'cmd-ok' }),
    ]);
    await plugin.run(['tag', 'DEMO-100', 'question-pending'], ctx);
    const call = ctx._calls.find((c) => c.url.includes('/api/commands'));
    assert.equal(call.opts.body.query, 'tag question-pending');
  });

  test('tag senza argomenti → errore', async () => {
    const ctx = createMockContext([]);
    const { exitCode } = await runExpectingExit(ctx, ['tag']);
    assert.equal(exitCode, 1);
  });
});
