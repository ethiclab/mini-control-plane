'use strict';

const https = require('https');
const fs = require('fs');
const os = require('os');
const path = require('path');

const DOTFILE = path.join(os.homedir(), '.bitbucket');

function readConfig() {
  try {
    const lines = fs.readFileSync(DOTFILE, 'utf8').split('\n');
    const cfg = {};
    for (const l of lines) {
      const m = l.match(/^([A-Z_]+)=(.+)$/);
      if (m) cfg[m[1]] = m[2].trim();
    }
    return cfg;
  } catch (_) { return {}; }
}

function authHeader(cfg) {
  if (cfg.BITBUCKET_USERNAME && cfg.BITBUCKET_APP_PASSWORD) {
    const b64 = Buffer.from(`${cfg.BITBUCKET_USERNAME}:${cfg.BITBUCKET_APP_PASSWORD}`).toString('base64');
    return `Basic ${b64}`;
  }
  if (cfg.BITBUCKET_TOKEN) return `Bearer ${cfg.BITBUCKET_TOKEN}`;
  return null;
}

function apiGet(urlPath, auth) {
  return new Promise((resolve, reject) => {
    const opts = {
      hostname: 'api.bitbucket.org',
      path: urlPath,
      headers: { Authorization: auth, Accept: 'application/json' },
    };
    https.get(opts, (res) => {
      let data = '';
      res.on('data', c => data += c);
      res.on('end', () => {
        try { resolve(JSON.parse(data)); }
        catch (e) { reject(new Error('Invalid JSON')); }
      });
    }).on('error', reject);
  });
}

async function allPages(firstPath, auth) {
  let results = [], next = firstPath;
  while (next) {
    const url = next.startsWith('http') ? new URL(next).pathname + new URL(next).search : next;
    const page = await apiGet(url, auth);
    if (page.error) throw new Error(page.error.message);
    results = results.concat(page.values || []);
    next = page.next ? page.next : null;
  }
  return results;
}

module.exports = {
  name: 'bitbucket',
  commands: ['bitbucket', 'bb'],
  describe: 'Bitbucket repo management (local | list | compare | update-token)',

  async run(args, { DEVEL_ROOT }) {
    const { execSync } = require('child_process');
    const subcommand = args[0] || 'help';

    if (subcommand === 'local') {
      const clusterRoot = path.join(DEVEL_ROOT, '..');
      console.log('\nRepo locali con remote Bitbucket:\n');
      let found = 0;
      try {
        const gitDirs = execSync(
          `find "${clusterRoot}" -maxdepth 4 -name "config" -path "*/.git/config"`,
          { encoding: 'utf8' }
        ).trim().split('\n').filter(Boolean);
        for (const cfg of gitDirs) {
          const repoDir = path.dirname(path.dirname(cfg));
          try {
            const remotes = execSync(`git -C "${repoDir}" remote -v`, { encoding: 'utf8' });
            if (!remotes.includes('bitbucket.org')) continue;
            const rel = path.relative(clusterRoot, repoDir);
            const slug = remotes.match(/bitbucket\.org[:/]([\w./-]+?)(?:\.git)?\s/)?.[1] || '?';
            const branch = execSync(`git -C "${repoDir}" branch --show-current`, { encoding: 'utf8' }).trim();
            console.log(`  ${rel.padEnd(50)}  ${slug}  [${branch}]`);
            found++;
          } catch (_) {}
        }
      } catch (_) {}
      if (found === 0) console.log('  (nessuno trovato)');
      return;
    }

    if (subcommand === 'update-token') {
      const newToken = args[1];
      if (!newToken) { console.error('Usage: mini bitbucket update-token <TOKEN>'); process.exit(1); }
      try {
        let content = fs.existsSync(DOTFILE) ? fs.readFileSync(DOTFILE, 'utf8') : '';
        if (content.includes('BITBUCKET_TOKEN=')) {
          content = content.replace(/^BITBUCKET_TOKEN=.*/m, `BITBUCKET_TOKEN=${newToken}`);
        } else {
          content += `\nBITBUCKET_TOKEN=${newToken}\n`;
        }
        const expiry = new Date(Date.now() + 90 * 24 * 3600 * 1000).toISOString().slice(0, 10);
        content = content.replace(/^BITBUCKET_EXPIRY=.*/m, `BITBUCKET_EXPIRY=${expiry}`);
        fs.writeFileSync(DOTFILE, content, { mode: 0o600 });
        console.log(`✅ Token aggiornato in ${DOTFILE} (scadenza: ${expiry})`);
      } catch (e) { console.error('Errore:', e.message); process.exit(1); }
      return;
    }

    const cfg = readConfig();
    // Lo workspace NON è hardcoded: impostalo in ~/.bitbucket come BITBUCKET_WORKSPACE=<tuo-workspace>.
    const workspace = cfg.BITBUCKET_WORKSPACE || '';
    const auth = authHeader(cfg);

    if (!auth && subcommand !== 'help') {
      console.error(`
❌  Nessuna credenziale trovata in ${DOTFILE}

Aggiungi un App Password (consigliato):
  1. Bitbucket → avatar → Personal settings → App passwords
  2. Create → nome: mini-cli → spunta: Repositories (Read)
  3. Copia la password e aggiorna ~/.bitbucket:
       BITBUCKET_USERNAME=<tuo-username>
       BITBUCKET_APP_PASSWORD=<password-copiata>
`);
      process.exit(1);
    }

    if (subcommand === 'list') {
      const repos = await allPages(`/2.0/repositories/${workspace}?pagelen=50&sort=-updated_on`, auth)
        .catch(e => {
          console.error(`\n❌ API error: ${e.message}`);
          process.exit(1);
        });
      console.log(`\nRepo su Bitbucket workspace '${workspace}' (${repos.length}):\n`);
      for (const r of repos) {
        const lang = r.language ? `  [${r.language}]` : '';
        const updated = (r.updated_on || '').slice(0, 10);
        const priv = r.is_private ? '🔒' : '🌍';
        console.log(`  ${priv} ${r.slug.padEnd(45)}${lang.padEnd(16)} ${updated}`);
      }
      return;
    }

    if (subcommand === 'compare') {
      const clusterRoot = path.join(DEVEL_ROOT, '..');
      const localMap = {};
      try {
        const gitDirs = execSync(
          `find "${clusterRoot}" -maxdepth 4 -name "config" -path "*/.git/config"`,
          { encoding: 'utf8' }
        ).trim().split('\n').filter(Boolean);
        for (const cfg2 of gitDirs) {
          const repoDir = path.dirname(path.dirname(cfg2));
          const remotes = execSync(`git -C "${repoDir}" remote -v`, { encoding: 'utf8' });
          if (!remotes.includes('bitbucket.org')) continue;
          const slug = remotes.match(/bitbucket\.org[:/][\w.-]+\/([\w./-]+?)(?:\.git)?\s/)?.[1] || '?';
          localMap[slug] = path.relative(clusterRoot, repoDir);
        }
      } catch (_) {}

      const repos = await allPages(`/2.0/repositories/${workspace}?pagelen=50&sort=-updated_on`, auth)
        .catch(e => { console.error(`❌ API error: ${e.message}`); process.exit(1); });
      console.log(`\nConfronto Bitbucket '${workspace}'  ↔  locale\n`);
      for (const r of repos) {
        const local = localMap[r.slug];
        const status = local ? `✅  locale: ${local}` : `⚠️  NON in locale`;
        console.log(`  ${r.slug.padEnd(45)}  ${status}`);
        if (local) delete localMap[r.slug];
      }
      const orphans = Object.entries(localMap);
      if (orphans.length > 0) {
        console.log('\n🔴 Repo locali con remote Bitbucket ma NON sul server:');
        orphans.forEach(([slug, p]) => console.log(`    ${p}  →  ${workspace}/${slug}`));
      }
      return;
    }

    console.log(`
mini bitbucket <subcommand>

  local           elenca repo locali con remote Bitbucket (no token)
  list            elenca tutti i repo su Bitbucket (richiede credenziali)
  compare         confronta Bitbucket remoto vs locale
  update-token T  aggiorna BITBUCKET_TOKEN in ~/.bitbucket

Config: ${DOTFILE}
Workspace: ${workspace}
`);
  },
};
