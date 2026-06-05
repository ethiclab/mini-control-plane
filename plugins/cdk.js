'use strict';

const path = require('path');
const fs = require('fs');

const CDK_DIR = path.join(__dirname, '..', 'apps', 'static-web-cdk');
const MANIFEST_DIR = path.join(__dirname, '..', 'config', 'webapps');
const CONFIG_DIR = path.join(__dirname, '..', 'config');

// Account ID, domini cliente e bundle interni NON sono nel repo: stanno in
// config/cdk.json (gitignored). Copia config/cdk.example.json → config/cdk.json
// e compila i tuoi valori. MINI_CDK_CONFIG può puntare a un file alternativo (test).
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

function webProfiles() {
  return loadCdkConfig().profiles;
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

function awsWhoami(profileName, ctx) {
  const result = ctx.shell.capture('aws', ['--profile', profileName, 'sts', 'get-caller-identity', '--output', 'json']);
  if (!result.ok) return { ok: false, profile: profileName, error: (result.stderr || result.stdout || 'STS failed').trim() };
  try {
    const parsed = JSON.parse(result.stdout);
    return { ok: true, profile: profileName, account: parsed.Account || '', arn: parsed.Arn || '', userId: parsed.UserId || '' };
  } catch (_) {
    return { ok: false, profile: profileName, error: 'STS returned invalid JSON' };
  }
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

function showCdkHelp() {
  console.log(`
mini cdk — Deploy webapp statiche su AWS (CDK + CloudFront + S3)

USAGE
  mini cdk deploy                     # wizard interattivo deploy
  mini cdk destroy                    # wizard interattivo destroy
  mini cdk profiles                   # elenca profili AWS configurati
  mini cdk bundles                    # elenca bundle web conosciuti
  mini cdk status <domain>            # mostra stato deploy da manifest
  mini cdk help                       # questo manuale

DESCRIZIONE
  Usa AWS CDK per creare/distruggere stack di webapp statiche
  (S3 + CloudFront + Route53 + ACM Certificato).

  Profili AWS (account, regione, domini) e bundle web sono definiti in
  config/cdk.json (gitignored). Copia config/cdk.example.json per iniziare.

  Il vero stack CDK è in apps/static-web-cdk/app.js.
`.trimStart() + '\n');
}

async function runWizard(args, ctx) {
  const action = args[0] || 'help';
  if (action === 'help' || action === '--help' || action === '-h') return showCdkHelp();

  if (action === 'profiles') {
    console.log('\nProfili AWS configurati:\n');
    for (const [name, profile] of Object.entries(webProfiles())) {
      const identity = awsWhoami(profile.profile, ctx);
      const status = identity.ok ? `✅ ${identity.account}` : '❌ login required';
      console.log(`  ${name.padEnd(20)} ${profile.profile.padEnd(20)} ${status}`);
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

  const profileEntries = Object.entries(webProfiles()).map(([name, p]) => ({ name, ...p }));
  const profileNames = profileEntries.map((p) => p.name);
  const chosenProfileName = await ctx.prompt.choice('Profilo AWS (numero o nome)', profileNames, 0);
  const profile = profileEntries.find((p) => p.name === chosenProfileName);
  if (!profile) { console.error(`Profilo non trovato: ${chosenProfileName}`); process.exit(1); }

  let identity = awsWhoami(profile.profile, ctx);
  if (!identity.ok) {
    console.log(`\nProfilo AWS non autenticato: ${profile.profile}`);
    console.log(`Comando: aws --profile ${profile.profile} sso login\n`);
    const loginChoice = await ctx.prompt.choice('Come procedere?', ['Login SSO ora', 'Esci (farlo manualmente)'], 0);
    if (loginChoice === 'Login SSO ora') {
      ctx.shell.run('aws', ['--profile', profile.profile, 'sso', 'login']);
      identity = awsWhoami(profile.profile, ctx);
      if (!identity.ok) { console.error('Login fallito'); process.exit(1); }
    } else {
      process.exit(1);
    }
  }

  const bundleNames = [...Object.keys(loadCdkConfig().bundles), 'custom'];
  const chosenBundle = await ctx.prompt.choice('Bundle web (numero o nome)', bundleNames, 0);
  const defaultSubdomain = chosenBundle === 'custom' ? 'app' : chosenBundle;
  const subdomain = await ctx.prompt.input('Sottodominio', defaultSubdomain);
  const domainName = `${subdomain}.${profile.rootDomain}`;
  const zoneName = profile.defaultZoneName;
  const stackName = stackNameForDomain(domainName);
  const releaseEnv = profile.rootDomain.startsWith('test.') ? 'test' : 'prod';

  const zone = lookupHostedZone(profile.profile, zoneName, ctx);
  if (!zone.ok) { console.error(`Hosted zone non disponibile: ${zoneName} — ${zone.error}`); process.exit(1); }

  const bootstrapCheck = checkCdkBootstrap(profile.profile, profile.region, ctx);
  if (!bootstrapCheck.bootstrapped) {
    const bootstrapCmd = `cd ${CDK_DIR} && AWS_PROFILE=${profile.profile} npx cdk bootstrap aws://${profile.account}/${profile.region}`;
    console.log(`\nCDK bootstrap non trovato per ${profile.profile}`);
    console.log(`Comando: ${bootstrapCmd}\n`);
    const bootstrapChoice = await ctx.prompt.choice('Come procedere?', ['Bootstrap automatico', 'Esci (farlo manualmente)'], 0);
    if (bootstrapChoice === 'Bootstrap automatico') {
      runCdkBootstrap(profile.profile, profile.account, profile.region, ctx);
    } else {
      process.exit(1);
    }
  }

  let sitePath = '';
  let version = '';

  if (action === 'deploy') {
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
  } else {
    const manifest = readManifest(domainName);
    sitePath = manifest?.sitePath || path.join(CDK_DIR, 'empty-site');
    version = manifest?.version || 'destroy';
  }

  const summary = [
    ['action', action],
    ['profile', profile.profile],
    ['account', profile.account],
    ['awsAccount', identity.account || '-'],
    ['domain', domainName],
    ['zone', zoneName],
    ['zoneId', zone.id || '-'],
    ['stack', stackName],
    ['bundle', chosenBundle],
    ['sitePath', sitePath],
    ['version', version || '-'],
  ];
  console.log(`\n${ctx.format.table(['key', 'value'], summary)}\n`);

  const confirm = await ctx.prompt.yesNo(`${action} webapp ${domainName}?`);
  if (!confirm) { console.error('Operazione annullata.'); process.exit(1); }

  const payload = {
    profile: profile.profile,
    account: profile.account,
    region: profile.region,
    zoneName,
    domainName,
    stackName,
    bundleId: chosenBundle,
    sitePath,
    version,
    comment: `${action} ${domainName}`,
  };

  if (action === 'deploy') {
    const manifestFile = deployWebapp(payload, ctx);
    console.log(`manifest=${manifestFile}`);
  } else {
    destroyWebapp(payload, ctx);
  }
}

module.exports = {
  name: 'cdk',
  commands: ['cdk', 'webapp'],
  describe: 'Deploy webapp statiche su AWS (CDK + CloudFront + S3)',
  run: runWizard,
};
