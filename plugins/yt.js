'use strict';

// L'istanza YouTrack (host) NON è nel repo: impostala in ~/.youtrack come
// YT_BASE=https://tua-istanza.youtrack.cloud (o via env YT_BASE). Il valore
// risolto a runtime vive su ctx.ytBase (per-invocazione), non in un global mutabile.
const YT_BASE_DEFAULT = 'https://your-instance.youtrack.cloud';

// Default GENERICI (placeholder). I valori reali della tua istanza/board vanno
// in ~/.youtrack (o via env): YT_AGILE_ID, le colonne, progetto, priorità, ecc.
const CONFIG_DEFAULTS = {
  YT_BASE: YT_BASE_DEFAULT,
  YT_AGILE_ID: '0-0',
  YT_SPRINT_ID: 'current',
  YT_WIP_COLUMN: 'In Progress',
  YT_RELEASE_COLUMN: 'To Release',
  YT_DONE_COLUMN: 'Done',
  YT_DEFAULT_TYPE: 'Bug',
  YT_DEFAULT_PRIORITY: 'Normal',
  YT_DEFAULT_PROJECT: 'DEMO',
  YT_QUESTION_TAG: 'question-pending',
  YT_DEFAULT_LINK_TYPE: 'Subtask',
};

const CONFIG_KEYS = ['YT_TOKEN', ...Object.keys(CONFIG_DEFAULTS)];

function ytBase(ctx) {
  return ctx.ytBase || YT_BASE_DEFAULT;
}

function ytGet(endpoint, token, ctx) {
  return ctx.http.request('GET', `${ytBase(ctx)}${endpoint}`, { token });
}

function ytPost(endpoint, token, body, ctx) {
  return ctx.http.request('POST', `${ytBase(ctx)}${endpoint}`, { token, body });
}

function buildStateField(stateName) {
  return { name: 'State', $type: 'StateIssueCustomField', value: { name: stateName, $type: 'StateBundleElement' } };
}

function buildAssigneeField(login) {
  return { name: 'Assignee', $type: 'SingleUserIssueCustomField', value: { login } };
}

function buildTypeField(name) {
  return { name: 'Type', $type: 'SingleEnumIssueCustomField', value: { name } };
}

function buildPriorityField(name) {
  return { name: 'Priority', $type: 'SingleEnumIssueCustomField', value: { name } };
}

function buildDueDateField(epochMs) {
  return { name: 'Due Date', $type: 'DateIssueCustomField', value: epochMs };
}

function todayMidnightEpochMs() {
  const now = new Date();
  return Date.UTC(now.getFullYear(), now.getMonth(), now.getDate());
}

function parseDueDate(raw) {
  if (!raw) return todayMidnightEpochMs();
  const m = String(raw).match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!m) throw new Error(`Due date non valida: "${raw}" — usa formato YYYY-MM-DD`);
  const year = Number(m[1]);
  const month = Number(m[2]);
  const day = Number(m[3]);
  const check = new Date(Date.UTC(year, month - 1, day));
  if (check.getUTCFullYear() !== year || check.getUTCMonth() !== month - 1 || check.getUTCDate() !== day) {
    throw new Error(`Due date non valida: "${raw}"`);
  }
  return Date.UTC(year, month - 1, day);
}

function readStdin() {
  try { return require('fs').readFileSync(0, 'utf8'); } catch (_) { return ''; }
}

function parseNewArgs(args) {
  const out = { project: null, summary: null, desc: null, col: null, assignee: null, type: null, priority: null, due: null };
  const rest = [];
  for (let i = 0; i < args.length; i += 1) {
    const a = args[i];
    if (a === '-d' || a === '--desc') { out.desc = args[i + 1]; i += 1; continue; }
    if (a === '-c' || a === '--col') { out.col = args[i + 1]; i += 1; continue; }
    if (a === '-a' || a === '--assignee') { out.assignee = args[i + 1]; i += 1; continue; }
    if (a === '-t' || a === '--type') { out.type = args[i + 1]; i += 1; continue; }
    if (a === '-p' || a === '--priority') { out.priority = args[i + 1]; i += 1; continue; }
    if (a === '--due') { out.due = args[i + 1]; i += 1; continue; }
    rest.push(a);
  }
  if (!rest.length) throw new Error('Usage: mini yt new <project> "<summary>" [-d desc] [-c colonna] [-a login] [-t type] [-p priority] [--due YYYY-MM-DD]');
  out.project = rest.shift();
  out.summary = rest.join(' ').trim();
  if (!out.summary) throw new Error('Summary mancante');
  return out;
}

function parseEditArgs(args) {
  const out = { id: '', summary: null, description: null, hasSummary: false, hasDescription: false };
  const rest = [];
  for (let i = 0; i < args.length; i += 1) {
    const a = args[i];
    if (a === '--title' || a === '--summary') { out.summary = args[i + 1]; out.hasSummary = true; i += 1; continue; }
    if (a === '-d' || a === '--desc' || a === '--description') { out.description = args[i + 1]; out.hasDescription = true; i += 1; continue; }
    rest.push(a);
  }
  out.id = (rest[0] || '').toUpperCase();
  if (!out.id) throw new Error('Usage: mini yt edit <ID> [--title "<summary>"] [--desc "<descrizione>"]');
  if (!out.hasSummary && !out.hasDescription) throw new Error('Usage: mini yt edit <ID> [--title "<summary>"] [--desc "<descrizione>"]');
  if (out.hasSummary && !String(out.summary || '').trim()) throw new Error('Titolo vuoto');
  if (out.hasDescription && typeof out.description !== 'string') throw new Error('Descrizione mancante dopo --desc');
  return out;
}

function parseCommentsArgs(args) {
  const out = { id: null, since: null, json: false };
  const rest = [];
  for (let i = 0; i < args.length; i += 1) {
    const a = args[i];
    if (a === '--since') { out.since = args[i + 1]; i += 1; continue; }
    if (a === '--json') { out.json = true; continue; }
    rest.push(a);
  }
  out.id = (rest[0] || '').toUpperCase();
  if (!out.id) throw new Error('Usage: mini yt comments <ID> [--since <ISO|epochMs>] [--json]');
  return out;
}

function parseSinceToMs(raw) {
  if (raw == null || raw === '') return null;
  if (/^\d+$/.test(String(raw))) return Number(raw);
  const t = Date.parse(raw);
  if (Number.isNaN(t)) throw new Error(`--since non valido: "${raw}" — usa ISO (YYYY-MM-DDTHH:MM:SSZ) o epoch ms`);
  return t;
}

function parseCommentArgs(args) {
  const out = { id: null, text: null, useStdin: false };
  const rest = [];
  for (let i = 0; i < args.length; i += 1) {
    const a = args[i];
    if (a === '-m' || a === '--message') { out.text = args[i + 1]; i += 1; continue; }
    if (a === '-') { out.useStdin = true; continue; }
    rest.push(a);
  }
  out.id = (rest[0] || '').toUpperCase();
  if (!out.id) throw new Error('Usage: mini yt comment <ID> -m "<text>"   (oppure `-` per leggere da stdin)');
  if (!out.text && !out.useStdin) throw new Error('Testo del commento mancante: usa -m "<testo>" oppure `-` per leggere da stdin');
  return out;
}

const LINK_TYPE_COMMANDS = { subtask: 'subtask of', relates: 'relates to', depend: 'depends on' };

function parseLinkArgs(args, defaultType) {
  const out = { parent: null, child: null, type: defaultType };
  const rest = [];
  for (let i = 0; i < args.length; i += 1) {
    const a = args[i];
    if (a === '--type') { out.type = args[i + 1]; i += 1; continue; }
    rest.push(a);
  }
  out.parent = (rest[0] || '').toUpperCase();
  out.child = (rest[1] || '').toUpperCase();
  if (!out.parent || !out.child) throw new Error('Usage: mini yt link <parent> <child> [--type Subtask|Relates|Depend]');
  const key = String(out.type || 'Subtask').toLowerCase();
  if (!LINK_TYPE_COMMANDS[key]) throw new Error(`--type "${out.type}" non valido. Supportati: Subtask, Relates, Depend`);
  out.typeKey = key;
  return out;
}

function parseTagArgs(args) {
  const out = { id: null, op: 'add', tag: null };
  out.id = (args[0] || '').toUpperCase();
  const raw = args[1];
  if (!out.id || raw == null || raw === '') throw new Error('Usage: mini yt tag <ID> +<name> | -<name> | <name>');
  if (raw.startsWith('+')) { out.op = 'add'; out.tag = raw.slice(1); }
  else if (raw.startsWith('-')) { out.op = 'remove'; out.tag = raw.slice(1); }
  else { out.op = 'add'; out.tag = raw; }
  if (!out.tag) throw new Error('Nome tag mancante');
  return out;
}

function showHelp() {
  console.log('\n' +
    'mini yt \u2014 YouTrack CLI (read + write + dialogue)\n' +
    '\n' +
    'USAGE\n' +
    '  mini yt                              # top 2 ticket colonna WIP utente\n' +
    '  mini yt <ID>                         # dettaglio ticket (es: ABC-528)\n' +
    '  mini yt <PROJ> [state]               # lista ticket progetto\n' +
    '                                         state: open | wip | active | in-progress\n' +
    '                                                done | fixed | closed | all | <custom>\n' +
    '  mini yt board                        # elenca colonne board + state values + alias\n' +
    '  mini yt search "<query>"             # ricerca full-text/YouTrack query (alias: query, q)\n' +
    '         [--top N] [--json]              # es: mini yt search perdita  |  "project: ABC perdita #Unresolved"\n' +
    '  mini yt new <PROJ> "<summary>"       # crea ticket\n' +
    '         [-d "<descrizione>"] [-c "<colonna>"] [-a <login>]\n' +
    '         [-t "<type>"] [-p "<priority>"] [--due YYYY-MM-DD]\n' +
    '  mini yt edit <ID>                    # aggiorna titolo e/o descrizione\n' +
    '         [--title "<summary>"] [--desc "<descrizione>"]\n' +
    '  mini yt move <ID> "<colonna>"        # sposta su colonna\n' +
    '  mini yt wip     <ID>                 # alias \u2192 YT_WIP_COLUMN\n' +
    '  mini yt release <ID>                 # alias \u2192 YT_RELEASE_COLUMN\n' +
    '  mini yt done    <ID>                 # alias \u2192 YT_DONE_COLUMN\n' +
    '  mini yt comments <ID>                # legge commenti [--since <ISO|epochMs>] [--json]\n' +
    '  mini yt comment <ID> -m "<testo>"    # posta commento (usa `-` per stdin)\n' +
    '  mini yt link <parent> <child>        # crea link [--type Subtask|Relates|Depend]\n' +
    '  mini yt tag <ID> +<name>| -<name>    # aggiunge/rimuove tag\n' +
    '  mini yt config                       # mostra percorso + contenuto ~/.youtrack (token mascherato)\n' +
    '  mini yt help                         # questo manuale\n' +
    '\n' +
    'CONFIG (~/.youtrack)\n' +
    '  YT_TOKEN, YT_AGILE_ID, YT_SPRINT_ID, YT_WIP_COLUMN, YT_RELEASE_COLUMN,\n' +
    '  YT_DONE_COLUMN, YT_DEFAULT_TYPE, YT_DEFAULT_PRIORITY, YT_DEFAULT_PROJECT,\n' +
    '  YT_QUESTION_TAG, YT_DEFAULT_LINK_TYPE\n');
}

function configPath() {
  return require('path').join(require('os').homedir(), '.youtrack');
}

function maskSecret(value) {
  const v = String(value || '');
  if (v.length <= 8) return '****';
  return `${v.slice(0, 5)}…**** (${v.length} char)`;
}

function showConfig() {
  const fs = require('fs');
  const file = configPath();
  console.log(`\nConfig utente YouTrack:\n  ${file}\n`);
  if (!fs.existsSync(file)) {
    console.log('  ⚠️  file non trovato — crealo con almeno:\n      YT_TOKEN=perm:...\n');
    return;
  }
  console.log('Contenuto (valori segreti mascherati):\n');
  for (const line of fs.readFileSync(file, 'utf8').split('\n')) {
    const m = line.match(/^\s*([A-Z_]+)\s*=\s*(.*)$/);
    if (m && /TOKEN|PASSWORD|SECRET/.test(m[1])) {
      console.log(`  ${m[1]}=${maskSecret(m[2])}`);
    } else if (line.trim()) {
      console.log(`  ${line.trim()}`);
    }
  }
  console.log('');
}

function tokenError() {
  console.error('\n❌  Nessun token YouTrack trovato.\n\nAggiungi il token in ~/.youtrack:\n  YT_TOKEN=perm:...\n\nOppure esporta:\n  export YT_TOKEN=perm:...\n');
  process.exit(1);
}

async function resolveBoardColumns(token, agileId, ctx, force = false) {
  const board = await ytGet(
    `/api/agiles/${agileId}?fields=name,columnSettings(columns(id,presentation,fieldValues(name)))`,
    token, ctx
  );
  const columns = (board?.columnSettings?.columns || []).map((c) => ({
    id: c.id, presentation: c.presentation, stateValues: (c.fieldValues || []).map((fv) => fv.name),
  }));
  return { name: board?.name || '', columns };
}

async function resolveColumn(name, token, agileId, ctx) {
  if (!name) throw new Error('Nome colonna mancante');
  const { columns } = await resolveBoardColumns(token, agileId, ctx);
  const needle = name.toLowerCase();
  const col = columns.find((c) => (c.presentation || '').toLowerCase() === needle);
  if (!col) {
    throw new Error(`Colonna "${name}" non trovata. Disponibili: ${columns.map((c) => `"${c.presentation}"`).join(', ')}`);
  }
  if (!col.stateValues.length) throw new Error(`Colonna "${col.presentation}" non ha state values associati`);
  return col;
}

async function resolveProjectId(shortName, token, ctx) {
  const key = shortName.toUpperCase();
  const projects = (await ytGet(`/api/admin/projects?fields=id,shortName&%24top=100`, token, ctx)) || [];
  const match = projects.find((p) => (p.shortName || '').toUpperCase() === key);
  if (!match) {
    throw new Error(`Progetto "${shortName}" non trovato. Disponibili: ${projects.map((p) => p.shortName).filter(Boolean).join(', ')}`);
  }
  return match.id;
}

async function attachIssueToBoard(internalId, cfg, token, ctx) {
  return ytPost(
    `/api/agiles/${cfg.YT_AGILE_ID}/sprints/${encodeURIComponent(cfg.YT_SPRINT_ID)}/issues?fields=idReadable`,
    token, { id: internalId }, ctx
  );
}

async function moveIssueToTopOfColumn(internalId, columnId, cfg, token, ctx) {
  const colPath = encodeURIComponent(columnId);
  return ytPost(
    `/api/agiles/${cfg.YT_AGILE_ID}/sprints/${encodeURIComponent(cfg.YT_SPRINT_ID)}/board/columns/${colPath}/cells/orphans.${colPath}/issueOrder?fields=moved(id)`,
    token, { leading: null, moved: { id: internalId } }, ctx
  );
}

async function showQueue(token, cfg, ctx) {
  const agileId = cfg.YT_AGILE_ID;
  const columnName = cfg.YT_WIP_COLUMN;
  let col = null;
  try { col = await resolveColumn(columnName, token, agileId, ctx); } catch (_) {}
  const stateValues = col?.stateValues || [];
  const targetColumnId = col?.id || null;

  let issues = [];
  try {
    const sprint = await ytGet(
      `/api/agiles/${agileId}/sprints/current?issuesQuery=&%24top=-1&%24topLinks=3&%24topSwimlanes=50&fields=board(orphanRow(cells(column(id),issues(idReadable,summary))),trimmedSwimlanes(cells(column(id),issues(idReadable,summary))))`,
      token, ctx
    );
    const boardCells = [
      ...(sprint?.board?.orphanRow?.cells || []),
      ...((sprint?.board?.trimmedSwimlanes || []).flatMap((swimlane) => swimlane?.cells || [])),
    ];
    const targetCell = targetColumnId ? boardCells.find((cell) => (cell?.column?.id || '') === targetColumnId) : null;
    issues = (targetCell?.issues || []).slice(0, 2);
  } catch (_) {}

  if (!issues.length) {
    let query = `project: ${cfg.YT_DEFAULT_PROJECT} #Unresolved`;
    if (stateValues.length > 0) query += ' State: ' + stateValues.map((v) => `{${v}}`).join(', ');
    const allIssues = await ytGet(
      `/api/issues?fields=idReadable,summary,customFields(name,value(name))&query=${encodeURIComponent(query)}&top=2`,
      token, ctx
    );
    issues = (allIssues || []).slice(0, 2);
  }

  const colLabel = stateValues.length > 0 ? columnName : `${cfg.YT_DEFAULT_PROJECT} #Unresolved`;
  console.log(`\n[${colLabel}]\n`);
  if (!issues.length) {
    console.log('  Nessun ticket trovato.');
  } else {
    issues.forEach((issue, i) => {
      console.log(`  ${i === 0 ? '▶ ora: ' : '  poi: '}  ${(issue.idReadable || '?').padEnd(12)} ${(issue.summary || '').substring(0, 65)}`);
    });
    console.log(`\n  → mini yt ${issues[0].idReadable}   per dettaglio`);
  }
}

async function showIssue(issueId, token, ctx) {
  const issue = await ytGet(
    `/api/issues/${issueId}?fields=idReadable,summary,description,reporter(login),created,updated,customFields(name,value(name,localizedName)),attachments(name,url,size,mimeType,created,author(login))`,
    token, ctx
  );
  console.log(`\n${issue.idReadable}: ${issue.summary}\n`);
  if (issue.reporter) console.log(`Reporter:  ${issue.reporter.login}`);
  console.log(`Creato:    ${issue.created ? new Date(issue.created).toLocaleDateString('it-IT') : '?'}   Aggiornato: ${issue.updated ? new Date(issue.updated).toLocaleDateString('it-IT') : '?'}`);
  if (issue.customFields) {
    for (const cf of issue.customFields) {
      const val = cf.value?.name || cf.value?.localizedName;
      if (val) console.log(`${cf.name.padEnd(14)} ${val}`);
    }
  }
  if (issue.description) {
    console.log(`\n${'─'.repeat(60)}\nDescrizione:\n${'─'.repeat(60)}`);
    console.log(issue.description.replace(/<[^>]+>/g, '').replace(/\*\*(.+?)\*\*/g, '$1'));
  }
  if (issue.attachments && issue.attachments.length > 0) {
    console.log(`\n${'─'.repeat(60)}\nAllegati (${issue.attachments.length}):\n${'─'.repeat(60)}`);
    for (const att of issue.attachments) {
      const size = att.size ? ` (${(att.size / 1024).toFixed(1)} KB)` : '';
      console.log(`  📎 ${att.name}${size}${att.mimeType ? ` [${att.mimeType}]` : ''}${att.author?.login ? `  by ${att.author.login}` : ''}${att.created ? `  ${new Date(att.created).toLocaleDateString('it-IT')}` : ''}`);
      if (att.url) console.log(`     ${ytBase(ctx)}${att.url}`);
    }
  }
  try {
    const comments = await ytGet(`/api/issues/${issueId}/comments?fields=id,text,author(login,name),created,updated&%24top=100`, token, ctx);
    if (comments && comments.length > 0) {
      console.log(`\n${'─'.repeat(60)}\nCommenti (${comments.length}):\n${'─'.repeat(60)}`);
      for (const comment of comments) {
        const author = comment.author?.name || comment.author?.login || 'anonimo';
        const date = comment.created ? new Date(comment.created).toLocaleDateString('it-IT') : '?';
        console.log(`\n  💬 ${author}  —  ${date}`);
        if (comment.text) {
          console.log(comment.text.replace(/<[^>]+>/g, '').replace(/\*\*(.+?)\*\*/g, '$1').split('\n').map((l) => `     ${l}`).join('\n'));
        }
      }
    }
  } catch (_) {}
  console.log('');
}

async function listIssues(project, stateFilter, token, ctx) {
  let query = `project: ${project}`;
  const filter = (stateFilter || '').toLowerCase();
  if (filter === 'open' || filter === 'wip' || filter === 'active') query += ' #Unresolved';
  else if (filter === 'in-progress') query += ' State: {In Progress}';
  else if (filter === 'done' || filter === 'fixed' || filter === 'closed') query += ' State: Done';
  else if (filter && filter !== 'all') query += ` State: {${stateFilter}}`;

  const issues = (await ytGet(
    `/api/issues?fields=idReadable,summary,customFields(name,value(name))&query=${encodeURIComponent(query + ' sort by: updated')}&top=30`,
    token, ctx
  )) || [];

  console.log(`\n${project} — ${filter || 'ultimi 30'} (${issues.length} mostrati):\n`);
  for (const issue of issues) {
    const stateCf = (issue.customFields || []).find((cf) => cf.name === 'State');
    const stateTag = stateCf?.value?.name ? ` [${stateCf.value.name}]` : '';
    console.log(`  ${(issue.idReadable || '?').padEnd(12)} ${(issue.summary || '').substring(0, 75)}${stateTag}`);
  }
}

function parseSearchArgs(args) {
  const out = { query: '', top: 30, json: false };
  const rest = [];
  for (let i = 0; i < args.length; i += 1) {
    const a = args[i];
    if (a === '--top' || a === '-n') {
      const n = parseInt(args[i + 1], 10);
      if (!Number.isFinite(n) || n <= 0) throw new Error(`--top richiede un intero positivo (ricevuto "${args[i + 1]}")`);
      out.top = n; i += 1; continue;
    }
    if (a === '--json') { out.json = true; continue; }
    rest.push(a);
  }
  out.query = rest.join(' ').trim();
  if (!out.query) throw new Error('Usage: mini yt search "<query YouTrack>" [--top N] [--json]');
  return out;
}

async function searchIssues({ query, top, json }, token, ctx) {
  const issues = (await ytGet(
    `/api/issues?fields=idReadable,summary,customFields(name,value(name))&query=${encodeURIComponent(query)}&top=${top}`,
    token, ctx
  )) || [];

  if (json) {
    const rows = issues.map((issue) => {
      const stateCf = (issue.customFields || []).find((cf) => cf.name === 'State');
      return { id: issue.idReadable, summary: issue.summary, state: stateCf?.value?.name || null };
    });
    console.log(JSON.stringify({ query, count: rows.length, issues: rows }, null, 2));
    return;
  }

  console.log(`\nsearch: "${query}" (${issues.length} mostrati, top ${top}):\n`);
  if (!issues.length) { console.log('  (nessun risultato)\n'); return; }
  for (const issue of issues) {
    const stateCf = (issue.customFields || []).find((cf) => cf.name === 'State');
    const stateTag = stateCf?.value?.name ? ` [${stateCf.value.name}]` : '';
    console.log(`  ${(issue.idReadable || '?').padEnd(12)} ${(issue.summary || '').substring(0, 75)}${stateTag}`);
  }
  console.log('');
}

async function showBoard(token, cfg, ctx) {
  const { name, columns } = await resolveBoardColumns(token, cfg.YT_AGILE_ID, ctx, true);
  const aliases = {
    [cfg.YT_WIP_COLUMN.toLowerCase()]: 'wip',
    [cfg.YT_RELEASE_COLUMN.toLowerCase()]: 'release',
    [cfg.YT_DONE_COLUMN.toLowerCase()]: 'done',
  };
  console.log(`\nBoard: ${name} (${cfg.YT_AGILE_ID})\n`);
  if (!columns.length) { console.log('  (nessuna colonna)'); return; }
  for (const col of columns) {
    const alias = aliases[(col.presentation || '').toLowerCase()];
    console.log(`  • ${col.presentation}${alias ? `  [alias: ${alias}]` : ''}${col.stateValues.length ? ` → ${col.stateValues.join(', ')}` : ''}`);
  }
  console.log('');
}

async function moveIssue(issueId, columnName, token, cfg, ctx) {
  if (!issueId) throw new Error('ID ticket mancante (es: ABC-123)');
  const col = await resolveColumn(columnName, token, cfg.YT_AGILE_ID, ctx);
  const targetState = col.stateValues[0];
  const updated = await ytPost(
    `/api/issues/${issueId}?fields=id,idReadable,customFields(name,value(name))`,
    token, { customFields: [buildStateField(targetState)] }, ctx
  );
  const idOut = updated?.idReadable || issueId;
  const internalId = updated?.id;

  let attachErr = null;
  let orderErr = null;
  if (internalId) {
    try { await attachIssueToBoard(internalId, cfg, token, ctx); } catch (e) { attachErr = e.message; }
    try { await moveIssueToTopOfColumn(internalId, col.id, cfg, token, ctx); } catch (e) { orderErr = e.message; }
  }

  const topNote = internalId ? (orderErr ? ` (top FAILED: ${orderErr})` : ' ↑ top') : '';
  console.log(`✓ ${idOut} → ${col.presentation} [${targetState}]${attachErr ? ` (attach FAILED: ${attachErr})` : ''}${topNote}`);
}

async function createIssue(parsed, token, cfg, ctx) {
  const typeName = parsed.type || cfg.YT_DEFAULT_TYPE;
  const priorityName = parsed.priority || cfg.YT_DEFAULT_PRIORITY;
  const dueMs = parseDueDate(parsed.due);
  const projectId = await resolveProjectId(parsed.project, token, ctx);
  const columnName = parsed.col || cfg.YT_WIP_COLUMN;
  const col = await resolveColumn(columnName, token, cfg.YT_AGILE_ID, ctx);
  const customFields = [
    buildStateField(col.stateValues[0]), buildTypeField(typeName),
    buildPriorityField(priorityName), buildDueDateField(dueMs),
  ];
  if (parsed.assignee) customFields.push(buildAssigneeField(parsed.assignee));

  const body = { project: { id: projectId }, summary: parsed.summary, customFields };
  if (parsed.desc) body.description = parsed.desc;

  const created = await ytPost('/api/issues?fields=id,idReadable,summary', token, body, ctx);
  const id = created?.idReadable || '?';
  const internalId = created?.id;

  let attachErr = null;
  let orderErr = null;
  if (internalId) {
    try { await attachIssueToBoard(internalId, cfg, token, ctx); } catch (e) { attachErr = e.message; }
    try { await moveIssueToTopOfColumn(internalId, col.id, cfg, token, ctx); } catch (e) { orderErr = e.message; }
  }

  console.log(`✓ Creato ${id}: ${parsed.summary}`);
  console.log(`  Colonna:  ${col.presentation} [${col.stateValues[0]}]`);
  console.log(`  Type:     ${typeName}\n  Priority: ${priorityName}\n  Due Date: ${new Date(dueMs).toLocaleDateString('it-IT', { timeZone: 'UTC' })}`);
  if (parsed.assignee) console.log(`  Assignee: ${parsed.assignee}`);
  console.log(`  Bacheca:  ${cfg.YT_AGILE_ID} / sprint=${cfg.YT_SPRINT_ID}${attachErr ? ` (attach FAILED: ${attachErr})` : ''}${orderErr ? ` (top FAILED: ${orderErr})` : ' ↑ top'}`);
  console.log(`  → mini yt ${id}   per dettaglio`);
}

async function editIssue(parsed, token, ctx) {
  const body = {};
  if (parsed.hasSummary) body.summary = parsed.summary.trim();
  if (parsed.hasDescription) body.description = parsed.description;
  const updated = await ytPost(`/api/issues/${parsed.id}?fields=idReadable,summary`, token, body, ctx);
  console.log(`✓ Aggiornato ${updated?.idReadable || parsed.id}: ${updated?.summary || body.summary || '(summary invariato)'}`);
  if (parsed.hasDescription) console.log('  Descrizione aggiornata');
}

async function showComments(parsed, token, ctx) {
  const comments = (await ytGet(
    `/api/issues/${parsed.id}/comments?fields=id,text,author(login,name),created,updated&%24top=500`,
    token, ctx
  )) || [];
  const sinceMs = parseSinceToMs(parsed.since);
  const filtered = sinceMs == null ? comments : comments.filter((c) => Number(c.created) > sinceMs);
  if (parsed.json) { console.log(JSON.stringify(filtered, null, 2)); return; }
  if (!filtered.length) { console.log(`(nessun commento${parsed.since ? ` dopo ${parsed.since}` : ''})`); return; }
  for (const c of filtered) {
    console.log(`[${c.author?.name || c.author?.login || 'anonimo'}] ${c.created ? new Date(Number(c.created)).toISOString() : '?'}`);
    if (c.text) console.log(c.text);
    console.log('---');
  }
}

async function createComment(parsed, token, ctx) {
  const text = parsed.useStdin ? readStdin() : parsed.text;
  if (!text || !String(text).trim()) throw new Error('Testo commento vuoto');
  const result = await ytPost(`/api/issues/${parsed.id}/comments?fields=id,text,created`, token, { text }, ctx);
  console.log(`✓ Commento aggiunto a ${parsed.id} (id: ${result?.id || '?'})`);
}

async function linkIssues(parsed, token, ctx) {
  const phrase = LINK_TYPE_COMMANDS[parsed.typeKey];
  await ytPost('/api/commands', token, { query: `${phrase} ${parsed.parent}`, issues: [{ idReadable: parsed.child }] }, ctx);
  console.log(`✓ ${parsed.child} — ${phrase} ${parsed.parent}`);
}

async function tagIssue(parsed, token, ctx) {
  const query = parsed.op === 'remove' ? `remove tag ${parsed.tag}` : `tag ${parsed.tag}`;
  await ytPost('/api/commands', token, { query, issues: [{ idReadable: parsed.id }] }, ctx);
  console.log(`✓ ${parsed.id}  ${parsed.op === 'remove' ? '−' : '+'} tag:${parsed.tag}`);
}

module.exports = {
  name: 'yt',
  commands: ['youtrack', 'yt'],
  describe: 'YouTrack (mini yt | <ID> | <PROJ> [state] | board | search | new | edit | move | wip | release | done | comments | comment | link | tag)',

  async run(args, ctx) {
    const arg0 = args[0] || '';
    // `config` deve funzionare anche senza token (serve a diagnosticarlo).
    if (arg0 === 'config') return showConfig();

    const cfg = ctx.config.read(CONFIG_KEYS, '~/.youtrack', CONFIG_DEFAULTS);
    if (!cfg.YT_TOKEN) tokenError();
    ctx.ytBase = cfg.YT_BASE || YT_BASE_DEFAULT;
    const token = cfg.YT_TOKEN;

    if (!arg0) {
      await showQueue(token, cfg, ctx);
      console.log(`  → mini yt help   per il manuale completo`);
      return;
    }

    if (arg0 === 'help' || arg0 === '--help' || arg0 === '-h') return showHelp();

    if (arg0.toUpperCase().match(/^[A-Z]+-\d+$/)) { await showIssue(arg0.toUpperCase(), token, ctx); return; }

    const verb = arg0.toLowerCase();
    try {
      switch (verb) {
        case 'board': await showBoard(token, cfg, ctx); break;
        case 'search': case 'query': case 'q': await searchIssues(parseSearchArgs(args.slice(1)), token, ctx); break;
        case 'new': await createIssue(parseNewArgs(args.slice(1)), token, cfg, ctx); break;
        case 'edit': await editIssue(parseEditArgs(args.slice(1)), token, ctx); break;
        case 'move': await moveIssue((args[1] || '').toUpperCase(), args[2], token, cfg, ctx); break;
        case 'wip': await moveIssue((args[1] || '').toUpperCase(), cfg.YT_WIP_COLUMN, token, cfg, ctx); break;
        case 'release': await moveIssue((args[1] || '').toUpperCase(), cfg.YT_RELEASE_COLUMN, token, cfg, ctx); break;
        case 'done': await moveIssue((args[1] || '').toUpperCase(), cfg.YT_DONE_COLUMN, token, cfg, ctx); break;
        case 'comments': await showComments(parseCommentsArgs(args.slice(1)), token, ctx); break;
        case 'comment': await createComment(parseCommentArgs(args.slice(1)), token, ctx); break;
        case 'link': await linkIssues(parseLinkArgs(args.slice(1), cfg.YT_DEFAULT_LINK_TYPE), token, ctx); break;
        case 'tag': await tagIssue(parseTagArgs(args.slice(1)), token, ctx); break;
        default: await listIssues(arg0.toUpperCase(), args[1], token, ctx); break;
      }
    } catch (e) {
      console.error(`✗ ${e.message}`);
      process.exit(1);
    }
  },
};
