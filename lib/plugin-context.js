'use strict';

const https = require('https');
const { spawnSync } = require('child_process');
const fs = require('fs');
const path = require('path');
const os = require('os');
const readline = require('readline');

function padRight(value, width) {
  return String(value).padEnd(width, ' ');
}

function renderAsciiTable(headers, rows) {
  const widths = headers.map((header, index) => {
    const cellWidths = rows.map((row) => String(row[index] ?? '').length);
    return Math.max(header.length, ...cellWidths);
  });

  const border = `+${widths.map((w) => '-'.repeat(w + 2)).join('+')}+`;
  const renderRow = (cells) => `| ${cells.map((cell, index) => padRight(cell ?? '', widths[index])).join(' | ')} |`;

  return [
    border,
    renderRow(headers),
    border,
    ...rows.map(renderRow),
    border
  ].join('\n');
}

function promptYesNo(question) {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  return new Promise((resolve) => {
    rl.question(`${question} [y/N] `, (answer) => {
      rl.close();
      const normalized = String(answer || '').trim().toLowerCase();
      resolve(normalized === 'y' || normalized === 'yes');
    });
  });
}

function promptInput(question, defaultValue = '') {
  const suffix = defaultValue ? ` [${defaultValue}] ` : ' ';
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  return new Promise((resolve) => {
    rl.question(`${question}${suffix}`, (answer) => {
      rl.close();
      const value = String(answer || '').trim();
      resolve(value || defaultValue);
    });
  });
}

async function promptChoice(question, items, defaultIndex = 0) {
  process.stdout.write(`${renderAsciiTable(
    ['#', 'value'],
    items.map((item, index) => [String(index + 1), item])
  )}\n`);
  const choice = await promptInput(question, String(defaultIndex + 1));
  if (/^\d+$/.test(choice)) {
    const item = items[Number(choice) - 1];
    if (!item) {
      console.error(`Invalid index: ${choice}`);
      process.exit(1);
    }
    return item;
  }
  return choice;
}

function httpRequest(method, url, opts = {}) {
  return new Promise((resolve, reject) => {
    const urlObj = new URL(url);
    const reqOpts = {
      method,
      hostname: urlObj.hostname,
      path: urlObj.pathname + urlObj.search,
      headers: {
        'Accept': 'application/json',
        ...(opts.token ? { 'Authorization': `Bearer ${opts.token}` } : {}),
        ...(opts.headers || {}),
      },
    };
    if (opts.body !== undefined) {
      const bodyStr = JSON.stringify(opts.body);
      reqOpts.headers['Content-Type'] = 'application/json';
      reqOpts.headers['Content-Length'] = Buffer.byteLength(bodyStr);
    }
    const req = https.request(reqOpts, (res) => {
      let data = '';
      res.on('data', (chunk) => { data += chunk; });
      res.on('end', () => {
        const trimmed = data.trim();
        if (!trimmed) return resolve(null);
        try {
          const parsed = JSON.parse(trimmed);
          if (parsed && parsed.error) {
            return reject(new Error(`API error: ${parsed.error_description || parsed.error}`));
          }
          resolve(parsed);
        } catch (e) {
          reject(new Error(`Invalid JSON response: ${trimmed.slice(0, 200)}`));
        }
      });
    });
    req.on('error', reject);
    if (opts.body !== undefined) req.write(JSON.stringify(opts.body));
    req.end();
  });
}

function shellRun(command, args, opts = {}) {
  const result = spawnSync(command, args, {
    cwd: opts.cwd,
    stdio: 'inherit',
    env: { ...process.env, ...(opts.env || {}) },
    ...(opts.spawnOpts || {}),
  });
  if (result.status !== 0) {
    throw new Error(`${command} ${args.join(' ')} failed (exit=${result.status})`);
  }
}

function shellCapture(command, args, opts = {}) {
  const result = spawnSync(command, args, {
    cwd: opts.cwd,
    encoding: 'utf8',
    env: { ...process.env, ...(opts.env || {}) },
    ...(opts.spawnOpts || {}),
  });
  return {
    ok: result.status === 0,
    status: result.status ?? 1,
    stdout: result.stdout || '',
    stderr: result.stderr || '',
  };
}

function readConfig(keys, dotfile, defaults) {
  const cfg = { ...defaults };
  const dotfilePath = dotfile.startsWith('~/')
    ? path.join(os.homedir(), dotfile.slice(2))
    : dotfile;
  if (fs.existsSync(dotfilePath)) {
    const content = fs.readFileSync(dotfilePath, 'utf8');
    for (const line of content.split('\n')) {
      const m = line.match(/^\s*([A-Z_]+)\s*=\s*(.+?)\s*$/);
      if (m && keys.includes(m[1])) cfg[m[1]] = m[2];
    }
  }
  for (const k of keys) {
    if (process.env[k]) cfg[k] = process.env[k];
  }
  return cfg;
}

function createContext(develRoot) {
  return {
    config: {
      read: (keys, dotfile, defaults) => readConfig(keys, dotfile, defaults),
    },
    format: {
      table: (headers, rows) => renderAsciiTable(headers, rows),
    },
    prompt: {
      yesNo: promptYesNo,
      input: promptInput,
      choice: promptChoice,
    },
    http: {
      request: httpRequest,
    },
    shell: {
      run: shellRun,
      capture: shellCapture,
    },
    fs,
    path,
    develRoot,
  };
}

module.exports = { createContext };
