'use strict';

const path = require('path');
const fs = require('fs');
const os = require('os');

const CDK_DIR = process.env.STATIC_WEB_CDK_DIR
  || path.join(os.homedir(), 'ethiclab', 'static-web-cdk');
const MANIFEST_DIR = path.join(__dirname, '..', 'config', 'webapps');
const CONFIG_DIR = path.join(__dirname, '..', 'config');

function loadCdkConfig() {
  const primary = process.env.MINI_CDK_CONFIG || path.join(CONFIG_DIR, 'cdk.json');
  const file = fs.existsSync(primary) ? primary : path.join(CONFIG_DIR, 'cdk.example.json');
  try {
    const cfg = JSON.parse(fs.readFileSync(file, 'utf8'));
    return { profiles: cfg.profiles || {}, bundles: cfg.bundles || {} };
  } catch (_) {
    return { profiles: {}, bundles: {} };
  }
}

function saveCdkConfig(config) {
  const file = process.env.MINI_CDK_CONFIG || path.join(CONFIG_DIR, 'cdk.json');
  fs.writeFileSync(file, JSON.stringify(config, null, 2) + '\n', 'utf8');
  return file;
}

function discoverAwsProfiles(ctx) {
  const ssoDir = path.join(os.homedir(), '.config', 'devbox', 'clients');
  const ssoCandidates = [];
  if (fs.existsSync(ssoDir)) {
    try {
      const files = fs.readdirSync(ssoDir).filter(f => f.endsWith('.env'));
      for (const file of files) {
        const content = fs.readFileSync(path.join(ssoDir, file), 'utf8');
        const match = content.match(/^PROFILE_PREFIX\s*=\s*(.+)$/m);
        if (match) {
          const prefix = match[1].trim();
          for (const suffix of ['test', 'prod', 'devops']) {
            ssoCandidates.push(`${prefix}-${suffix}`);
          }
        }
      }
    } catch (_) {}
  }

  const cliResult = ctx.shell.capture('aws', ['configure', 'list-profiles']);
  const cliProfiles = cliResult.ok
    ? cliResult.stdout.trim().split('\n').filter(Boolean).map(s => s.trim())
    : [];

  const existingSso = ssoCandidates.filter(p => cliProfiles.includes(p));
  const existingCli = cliProfiles.filter(p => !existingSso.includes(p));

  return { sso: existingSso, cli: existingCli };
}

function verifyProfile(profileName, ctx) {
  const result = ctx.shell.capture('aws', ['--profile', profileName, 'sts', 'get-caller-identity', '--output', 'json']);
  if (!result.ok) return { ok: false, error: (result.stderr || result.stdout || 'STS failed').trim() };
  try {
    const parsed = JSON.parse(result.stdout);
    return { ok: true, account: parsed.Account || '', arn: parsed.Arn || '', userId: parsed.UserId || '' };
  } catch (_) {
    return { ok: false, error: 'STS returned invalid JSON' };
  }
}

function guessDomain(profileName) {
  const m = profileName.match(/^(.+?)-(test|prod|devops)$/);
  if (!m) return null;
  const prefix = m[1];
  const env = m[2];
  if (env === 'test') return { rootDomain: `${prefix}.test.ethiclab.cloud`, zoneName: `${prefix}.test.ethiclab.cloud` };
  if (env === 'prod') return { rootDomain: `${prefix}.ethiclab.cloud`, zoneName: `${prefix}.ethiclab.cloud` };
  return null;
}

function getAwsRegion(profileName, ctx) {
  const result = ctx.shell.capture('aws', ['--profile', profileName, 'configure', 'get', 'region']);
  if (result.ok && result.stdout.trim()) return result.stdout.trim();
  return 'eu-west-1';
}

function resolveBundlePaths(id, ctx) {
  const b = loadCdkConfig().bundles[id];
  if (!b) return null;
  const repoDir = path.join(ctx.develRoot, '..', b.repo);
  return {
    repoDir,
    buildScript: path.join(ctx.develRoot, b.buildScript),
    distDir: path.join(repoDir, 'dist'),
    versionFile: path.join(repoDir, 'package.json'),
  };
}

function ensureDir(dir) {
  fs.mkdirSync(dir, { recursive: true });
}

function sanitizeToken(value) {
  return String(value || '').trim().toLowerCase().replace(/[^a-z0-9.-]+/g, '-').replace(/^-+|-+$/g, '');
}

function stackNameForDomain(domainName) {
  return `web-${sanitizeToken(domainName).replace(/\./g, '-')}`;
}

function manifestFile(domainName) {
  ensureDir(MANIFEST_DIR);
  return path.join(MANIFEST_DIR, `${sanitizeToken(domainName)}.json`);
}

function readManifest(domainName) {
  const file = manifestFile(domainName);
  if (!fs.existsSync(file)) return null;
  return JSON.parse(fs.readFileSync(file, 'utf8'));
}

function writeManifest(domainName, data) {
  const file = manifestFile(domainName);
  fs.writeFileSync(file, JSON.stringify(data, null, 2) + '\n', 'utf8');
  return file;
}

function removeManifest(domainName) {
  const file = manifestFile(domainName);
  if (fs.existsSync(file)) fs.unlinkSync(file);
}

function ensureCdkDependencies(ctx) {
  if (fs.existsSync(path.join(CDK_DIR, 'node_modules', 'aws-cdk-lib'))) return;
  ctx.shell.run('npm', ['install'], { cwd: CDK_DIR });
}

function lookupHostedZone(profileName, dnsName, ctx) {
  const result = ctx.shell.capture('aws', ['--profile', profileName, 'route53', 'list-hosted-zones-by-name', '--dns-name', dnsName, '--max-items', '5', '--output', 'json']);
  if (!result.ok) return { ok: false, dnsName, error: (result.stderr || result.stdout || 'Route53 lookup failed').trim() };
  try {
    const parsed = JSON.parse(result.stdout);
    const normalized = `${dnsName.replace(/\.$/, '')}.`;
    const zone = (parsed.HostedZones || []).find((entry) => String(entry.Name || '') === normalized);
    if (!zone) return { ok: false, dnsName, error: `Hosted zone non trovata: ${dnsName}` };
    return { ok: true, dnsName, id: zone.Id || '', name: zone.Name || '', privateZone: Boolean(zone.Config && zone.Config.PrivateZone) };
  } catch (_) {
    return { ok: false, dnsName, error: 'Route53 returned invalid JSON' };
  }
}

function checkCdkBootstrap(profileName, region, ctx) {
  const result = ctx.shell.capture('aws', ['--profile', profileName, 'cloudformation', 'describe-stacks', '--stack-name', 'CDKToolkit', '--region', region, '--output', 'json']);
  if (!result.ok) return { bootstrapped: false };
  try {
    const parsed = JSON.parse(result.stdout);
    const stack = (parsed.Stacks || [])[0];
    const status = stack ? stack.StackStatus : '';
    return { bootstrapped: status === 'CREATE_COMPLETE' || status === 'UPDATE_COMPLETE', status };
  } catch (_) {
    return { bootstrapped: false, error: 'CloudFormation returned invalid JSON' };
  }
}

function runCdkBootstrap(profileName, account, region, ctx) {
  ensureCdkDependencies(ctx);
  ctx.shell.run('npm', ['exec', 'cdk', '--', 'bootstrap', `aws://${account}/${region}`, '--require-approval', 'never'], {
    cwd: CDK_DIR,
    env: { AWS_PROFILE: profileName },
  });
}

function buildBundle(bundleId, releaseEnv, ctx) {
  const bundle = resolveBundlePaths(bundleId, ctx);
  if (!bundle) throw new Error(`Bundle non supportato: ${bundleId}. Supportati: ${Object.keys(loadCdkConfig().bundles).join(', ')}`);
  ctx.shell.run('/bin/bash', [bundle.buildScript, releaseEnv], { cwd: bundle.repoDir });
  const version = fs.existsSync(bundle.versionFile)
    ? (JSON.parse(fs.readFileSync(bundle.versionFile, 'utf8')).version || '')
    : '';
  return { distDir: bundle.distDir, version };
}

function cdkArgs(config) {
  return [
    'exec', 'cdk', '--', config.action, config.stackName, '--require-approval', 'never',
    '-c', `stackName=${config.stackName}`,
    '-c', `domainName=${config.domainName}`,
    '-c', `zoneName=${config.zoneName}`,
    '-c', `sitePath=${config.sitePath}`,
    '-c', `account=${config.account}`,
    '-c', `region=${config.region}`,
    '-c', `bundleId=${config.bundleId || 'custom'}`,
    '-c', `version=${config.version || 'manual'}`,
    '-c', `comment=${config.comment || `Static web ${config.domainName}`}`,
  ];
}

function deployWebapp(config, ctx) {
  ensureCdkDependencies(ctx);
  ctx.shell.run('npm', cdkArgs({ ...config, action: 'deploy' }), {
    cwd: CDK_DIR,
    env: { AWS_PROFILE: config.profile },
  });
  return writeManifest(config.domainName, {
    profile: config.profile,
    region: config.region,
    account: config.account,
    zoneName: config.zoneName,
    domainName: config.domainName,
    stackName: config.stackName,
    bundleId: config.bundleId,
    version: config.version,
    sitePath: config.sitePath,
  });
}

function destroyWebapp(config, ctx) {
  ensureCdkDependencies(ctx);
  ctx.shell.run('npm', cdkArgs({ ...config, action: 'destroy' }).concat(['--force']), {
    cwd: CDK_DIR,
    env: { AWS_PROFILE: config.profile },
  });
  removeManifest(config.domainName);
}

function listManifests() {
  ensureDir(MANIFEST_DIR);
  const files = fs.readdirSync(MANIFEST_DIR).filter(f => f.endsWith('.json'));
  return files.map(f => {
    try {
      return JSON.parse(fs.readFileSync(path.join(MANIFEST_DIR, f), 'utf8'));
    } catch (_) { return null; }
  }).filter(Boolean);
}

function showCdkHelp() {
  console.log(`
mini cdk — Deploy webapp statiche su AWS (CDK + CloudFront + S3)

USAGE
  mini cdk deploy                     # wizard interattivo deploy
  mini cdk destroy                    # wizard interattivo destroy
  mini cdk profiles                   # scopre e mostra profili AWS
  mini cdk bundles                    # elenca bundle web conosciuti
  mini cdk status <domain>            # mostra stato deploy da manifest
  mini cdk help                       # questo manuale

DESCRIZIONE
  Usa AWS CDK per creare/distruggere stack di webapp statiche
  (S3 + CloudFront + Route53 + ACM Certificato).

  Profili AWS scoperti dinamicamente da SSO (devbox clients) e CLI.
  Bundle web definiti in config/cdk.json (gitignored) — copia
  config/cdk.example.json per iniziare.

  Lo stack CDK è in ~/ethiclab/static-web-cdk/app.js.
`.trimStart() + '\n');
}

async function runWizard(args, ctx) {
  const action = args[0] || 'help';
  if (action === 'help' || action === '--help' || action === '-h') return showCdkHelp();

  if (action === 'profiles') {
    const discovered = discoverAwsProfiles(ctx);
    const allProfiles = [...discovered.sso, ...discovered.cli];
    if (allProfiles.length === 0) {
      console.log('\nNessun profilo AWS trovato. Configura AWS CLI prima.\n');
      return;
    }
    console.log('\nProfili AWS scoperti:\n');
    for (const name of allProfiles) {
      const identity = verifyProfile(name, ctx);
      const source = discovered.sso.includes(name) ? 'sso' : 'cli';
      const status = identity.ok ? `✅ ${identity.account}` : '❌ login required';
      console.log(`  ${name.padEnd(25)} [${source.padEnd(4)}] ${status}`);
    }
    console.log('');
    return;
  }

  if (action === 'bundles') {
    const ids = Object.keys(loadCdkConfig().bundles);
    console.log(`\nBundle web conosciuti:\n`);
    for (const id of ids) {
      console.log(`  • ${id}`);
    }
    if (ids.length === 0) console.log('  (nessun bundle configurato — vedi config/cdk.json)');
    console.log('');
    return;
  }

  if (action === 'status') {
    const domain = args[1];
    if (!domain) { console.error('Usage: mini cdk status <domain>'); process.exit(1); }
    const manifest = readManifest(domain);
    if (!manifest) { console.log(`Nessun manifest trovato per ${domain}`); return; }
    console.log(`\n${domain}:\n`);
    const rows = Object.entries(manifest).map(([k, v]) => [k, String(v)]);
    console.log(ctx.format.table(['key', 'value'], rows));
    return;
  }

  if (action !== 'deploy' && action !== 'destroy') {
    showCdkHelp();
    process.exit(1);
  }

  const config = loadCdkConfig();

  if (action === 'deploy') return runDeployWizard(config, ctx);
  return runDestroyWizard(config, ctx);
}

async function pickProfile(ctx) {
  const discovered = discoverAwsProfiles(ctx);
  const hasSso = discovered.sso.length > 0;
  const hasCli = discovered.cli.length > 0;

  if (!hasSso && !hasCli) {
    console.error('Nessun profilo AWS trovato. Configura AWS CLI con `aws configure`.\n');
    process.exit(1);
  }

  if (hasSso && hasCli) {
    const choice = await ctx.prompt.choice('Scoperta profili', [
      `SSO (${discovered.sso.join(', ')})`,
      `CLI profili (${discovered.cli.length} trovati)`,
    ], 0);
    if (choice.startsWith('SSO')) return discovered.sso;
    return discovered.cli;
  }

  if (hasSso) return discovered.sso;
  return discovered.cli;
}

async function runDeployWizard(config, ctx) {
  const profiles = await pickProfile(ctx);
  const chosenProfileName = await ctx.prompt.choice('Profilo AWS (numero o nome)', profiles, 0);
  if (!chosenProfileName) { console.error('Nessun profilo selezionato'); process.exit(1); }

  const identity = verifyProfile(chosenProfileName, ctx);
  if (!identity.ok) {
    console.log(`\nProfilo AWS non autenticato: ${chosenProfileName}`);
    console.log(`Comando: aws --profile ${chosenProfileName} sso login\n`);
    const loginChoice = await ctx.prompt.choice('Come procedere?', ['Login SSO ora', 'Esci (farlo manualmente)'], 0);
    if (loginChoice === 'Login SSO ora') {
      ctx.shell.run('aws', ['--profile', chosenProfileName, 'sso', 'login']);
      const retry = verifyProfile(chosenProfileName, ctx);
      if (!retry.ok) { console.error('Login fallito'); process.exit(1); }
      Object.assign(identity, retry);
    } else {
      process.exit(1);
    }
  }

  const region = getAwsRegion(chosenProfileName, ctx);

  const savedProfile = config.profiles[chosenProfileName];
  let rootDomain, zoneName;

  if (savedProfile) {
    console.log(`\nProfilo ${chosenProfileName} già configurato:`);
    console.log(`  rootDomain: ${savedProfile.rootDomain}`);
    console.log(`  zoneName:   ${savedProfile.zoneName}\n`);
    const useSaved = await ctx.prompt.yesNo('Usare questi valori?');
    if (useSaved) {
      rootDomain = savedProfile.rootDomain;
      zoneName = savedProfile.zoneName;
    }
  }

  if (!rootDomain) {
    const guessed = guessDomain(chosenProfileName);
    if (guessed) {
      console.log(`\nDominio suggerito per ${chosenProfileName}:`);
      console.log(`  rootDomain: ${guessed.rootDomain}`);
      console.log(`  zoneName:   ${guessed.zoneName}\n`);
      const useGuessed = await ctx.prompt.yesNo('Usare questo dominio?');
      if (useGuessed) {
        rootDomain = guessed.rootDomain;
        zoneName = guessed.zoneName;
      }
    }
  }

  if (!rootDomain) {
    rootDomain = await ctx.prompt.input('Root domain (es. example.com)', '');
  }
  if (!zoneName) {
    zoneName = await ctx.prompt.input('Zona Route53 (es. example.com.)', rootDomain);
  }

  const bundleNames = [...Object.keys(config.bundles), 'custom'];
  const chosenBundle = await ctx.prompt.choice('Bundle web (numero o nome)', bundleNames, 0);
  const defaultSubdomain = chosenBundle === 'custom' ? 'app' : chosenBundle;
  const subdomain = await ctx.prompt.input('Sottodominio', defaultSubdomain);
  const domainName = `${subdomain}.${rootDomain}`;
  const stackName = stackNameForDomain(domainName);
  const releaseEnv = rootDomain.startsWith('test.') ? 'test' : 'prod';

  const zone = lookupHostedZone(chosenProfileName, zoneName, ctx);
  if (!zone.ok) { console.error(`Hosted zone non disponibile: ${zoneName} — ${zone.error}`); process.exit(1); }

  const bootstrapCheck = checkCdkBootstrap(chosenProfileName, region, ctx);
  if (!bootstrapCheck.bootstrapped) {
    console.log(`\nCDK bootstrap non trovato per ${chosenProfileName}`);
    const bootstrapChoice = await ctx.prompt.choice('Come procedere?', ['Bootstrap automatico', 'Esci (farlo manualmente)'], 0);
    if (bootstrapChoice === 'Bootstrap automatico') {
      runCdkBootstrap(chosenProfileName, identity.account, region, ctx);
    } else {
      process.exit(1);
    }
  }

  let sitePath = '';
  let version = '';

  const buildLocal = chosenBundle !== 'custom'
    ? await ctx.prompt.yesNo(`Build locale di ${chosenBundle} per ${releaseEnv}?`)
    : false;
  if (chosenBundle !== 'custom' && buildLocal) {
    const buildResult = buildBundle(chosenBundle, releaseEnv, ctx);
    sitePath = buildResult.distDir;
    version = buildResult.version;
  } else if (chosenBundle !== 'custom') {
    const b = resolveBundlePaths(chosenBundle, ctx);
    sitePath = b.distDir;
    version = fs.existsSync(b.versionFile) ? (JSON.parse(fs.readFileSync(b.versionFile, 'utf8')).version || '') : '';
  } else {
    sitePath = await ctx.prompt.input('Directory dist locale', process.cwd());
    version = await ctx.prompt.input('Versione webapp', 'manual');
  }

  const summary = [
    ['action', 'deploy'],
    ['profile', chosenProfileName],
    ['account', identity.account || '-'],
    ['domain', domainName],
    ['zone', zoneName],
    ['zoneId', zone.id || '-'],
    ['stack', stackName],
    ['bundle', chosenBundle],
    ['sitePath', sitePath],
    ['version', version || '-'],
  ];
  console.log(`\n${ctx.format.table(['key', 'value'], summary)}\n`);

  const confirm = await ctx.prompt.yesNo(`Deploy webapp ${domainName}?`);
  if (!confirm) { console.error('Operazione annullata.'); process.exit(1); }

  const payload = {
    profile: chosenProfileName,
    account: identity.account,
    region,
    zoneName,
    domainName,
    stackName,
    bundleId: chosenBundle,
    sitePath,
    version,
    comment: `deploy ${domainName}`,
  };

  const resultFile = deployWebapp(payload, ctx);
  console.log(`manifest=${resultFile}`);

  config.profiles[chosenProfileName] = { rootDomain, zoneName };
  saveCdkConfig(config);
}

async function runDestroyWizard(config, ctx) {
  const manifests = listManifests();
  if (manifests.length === 0) {
    console.error('Nessun deploy trovato. Fai un deploy prima.\n');
    process.exit(1);
  }

  const domainOptions = manifests.map(m => `${m.domainName} (${m.profile} @ ${m.region})`);
  const chosenLabel = await ctx.prompt.choice('Dominio da destruire', domainOptions, 0);
  const idx = domainOptions.indexOf(chosenLabel);
  if (idx === -1) { console.error('Scelta non valida'); process.exit(1); }

  const manifest = manifests[idx];

  const identity = verifyProfile(manifest.profile, ctx);
  if (!identity.ok) {
    console.log(`Profilo non autenticato: ${manifest.profile}. Login prima.\n`);
    process.exit(1);
  }

  const summary = [
    ['action', 'destroy'],
    ['profile', manifest.profile],
    ['domain', manifest.domainName],
    ['stack', manifest.stackName],
  ];
  console.log(`\n${ctx.format.table(['key', 'value'], summary)}\n`);

  const confirm = await ctx.prompt.yesNo(`Distruggere ${manifest.domainName}?`);
  if (!confirm) { console.error('Operazione annullata.'); process.exit(1); }

  destroyWebapp({
    profile: manifest.profile,
    account: manifest.account,
    region: manifest.region,
    zoneName: manifest.zoneName,
    domainName: manifest.domainName,
    stackName: manifest.stackName,
    bundleId: manifest.bundleId || 'custom',
    sitePath: manifest.sitePath,
    version: manifest.version,
    comment: `destroy ${manifest.domainName}`,
  }, ctx);
}

module.exports = {
  name: 'cdk',
  commands: ['cdk', 'webapp'],
  describe: 'Deploy webapp statiche su AWS (CDK + CloudFront + S3)',
  run: runWizard,
};
