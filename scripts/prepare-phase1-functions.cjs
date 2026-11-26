'use strict';
/** Prepares LOCAL code only. No cloud mutation, secret lookup, production
 * archive or repository .env is read. Runtime profiles stay in private /tmp. */
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const {execFileSync} = require('node:child_process');
const root = path.resolve(__dirname, '..');
const target = process.argv[2];
const scope = process.argv[3] ?? 'complete';
if (!['core', 'complete'].includes(scope)) throw Error('Invalid stage scope');
if (!['dev', 'prod'].includes(target)) throw Error('Usage: node scripts/prepare-phase1-functions.cjs dev|prod');
const manifest = JSON.parse(fs.readFileSync(path.join(root, 'functions/phase1-release.json'), 'utf8'));
const project = manifest.projects[target];
const stage = process.argv[4] ?? `/tmp/seconde-phase1-local-release-${target}`;
if (!/^\/tmp\/seconde-phase1-[a-z0-9-]+$/.test(stage)) throw Error('Invalid isolated staging directory');
const profilePath = `/tmp/seconde-phase1-control-infra-20261125/${target}-phase1-environment.json`;
const profile = JSON.parse(fs.readFileSync(profilePath, 'utf8'));
if (profile.FINANCIAL_RECOVERY_FIRESTORE_PROJECT_ID !== project ||
    profile.FINANCIAL_RECOVERY_ENVIRONMENT !== 'unconfigured' ||
    profile.PAYMENTS_ENABLED !== 'false' || profile.SHIPPING_ENABLED !== 'false' ||
    profile.SECONDE_COMMERCE_TEST_MODE === 'true' ||
    profile.SECONDE_PHASE1_RUNTIME_SERVICE_ACCOUNT !== `seconde-phase1-runtime@${project}.iam.gserviceaccount.com`) {
  throw Error('The private phase-1 profile does not match the exact project/runtime.');
}
const devShared = target === 'dev' ? manifest.devIsolatedSharedFunctions ?? [] : [];
const devOriginals = new Set(devShared.map(v => v.original));
const contractNames = target==='dev'?Object.fromEntries(devShared.map(v => [v.name,v.source??v.original])):
  manifest.productionSourceOverrides??{};
const names = [...manifest.versionedFunctions.map(v => v.name),
  ...manifest.sharedDependenciesToVerify.filter(name => !devOriginals.has(name)), ...devShared.map(v => v.name),
  ...(manifest.accountErasureWebFunctions ?? []),
  ...(scope === 'complete' ? [...manifest.compatibleBackgroundFunctionsToQualify, ...manifest.partitionedBackgroundFunctions] : [])];
if (new Set(names).size !== names.length || names.some(n => !/^[A-Za-z][A-Za-z0-9]+$/.test(n))) throw Error('Invalid selected export manifest');
fs.mkdirSync(stage, {recursive: true, mode: 0o700});
fs.chmodSync(stage, 0o700);
const functions = path.join(stage, 'functions');
fs.mkdirSync(functions, {recursive: true, mode: 0o700});
for (const item of ['src', 'scripts', 'package.json', 'package-lock.json', 'tsconfig.json']) {
  fs.cpSync(path.join(root, 'functions', item), path.join(functions, item), {recursive: true,
    filter: value => !/\.(?:test|spec)\.ts$/.test(value) && !path.basename(value).startsWith('.env')});
}
// Refresh compiled code from the reviewed repository build; stale compiled
// modules must not be silently retained after a source-file removal.
if (fs.existsSync(path.join(functions, 'lib'))) fs.rmSync(path.join(functions, 'lib'), {recursive: true});
const compiledRoot = path.join(root, 'functions/lib');
fs.cpSync(compiledRoot, path.join(functions, 'lib'), {recursive: true, filter: filename => {
  if (fs.statSync(filename).isDirectory()) return true;
  const relative = path.relative(compiledRoot, filename);
  const source = relative.endsWith('.js.map') ? relative.slice(0, -7) + '.ts' :
    relative.endsWith('.js') ? relative.slice(0, -3) + '.ts' : relative;
  return fs.existsSync(path.join(root, 'functions/src', source));
}});
fs.mkdirSync(path.join(stage, 'scripts'), {recursive: true});
fs.copyFileSync(path.join(root, 'scripts/check-phase1-stage.cjs'), path.join(stage, 'scripts/check-phase1-stage.cjs'));
const pkg = JSON.parse(fs.readFileSync(path.join(functions, 'package.json'), 'utf8'));
pkg.main = 'main-phase1.js';
fs.writeFileSync(path.join(functions, 'package.json'), JSON.stringify(pkg, null, 2) + '\n');
fs.writeFileSync(path.join(functions, 'main-phase1.js'), `'use strict';\n` +
  // Firebase discovery intentionally strips the launching shell environment
  // and runs before it loads dotenv. The generated private staging profile is
  // therefore loaded here ONLY during SDK discovery; Cloud Run gets CLI envs.
  `if(process.env.FUNCTIONS_CONTROL_API==='true'){\n` +
  ` const fs=require('node:fs'),{parseEnv}=require('node:util');\n` +
  ` if(process.env.GCLOUD_PROJECT!==${JSON.stringify(project)})throw Error('Wrong discovery project');\n` +
  ` const profile=parseEnv(fs.readFileSync(__dirname+'/.env.'+process.env.GCLOUD_PROJECT,'utf8'));\n` +
  ` if(profile.FINANCIAL_RECOVERY_FIRESTORE_PROJECT_ID!==process.env.GCLOUD_PROJECT)throw Error('Wrong discovery profile');\n` +
  ` Object.assign(process.env,profile);\n}\nconst all = require('./lib/index'), contracts=${JSON.stringify(contractNames)};\n` +
  `for(const name of ${JSON.stringify(names)}) { const original=contracts[name]??name; if(!all[original]?.__endpoint) throw Error('Missing selected function '+name); exports[name]=all[original]; }\n`);
// Public Apple identifiers are environment-bound; the signing key stays in
// Secret Manager and is bound only to the dedicated completion callable.
const apple = {dev:{clientId:'com.seconde.app.dev.auth',keyId:'4QU6688YNR'},prod:{clientId:'com.seconde.app.auth',keyId:'JSAN734TGM'}}[target];
const nativePath = path.join(root,target==='dev'?'config/firebase/development/GoogleService-Info.plist':'GoogleService-Info.plist');
const native = JSON.parse(execFileSync('python3',['-c','import plistlib,json,sys; print(json.dumps(plistlib.load(open(sys.argv[1],"rb"))))',nativePath],{encoding:'utf8'}));
const bundle = target==='dev'?'com.seconde.app.dev':'com.seconde.app';
if(native.PROJECT_ID!==project||native.BUNDLE_ID!==bundle||typeof native.API_KEY!=='string'||!native.API_KEY||
    typeof native.GOOGLE_APP_ID!=='string'||!/^1:\d+:ios:[a-f0-9]+$/.test(native.GOOGLE_APP_ID))throw Error('Wrong native Apple/Firebase project configuration');
const digest = filename => crypto.createHash('sha256').update(fs.readFileSync(filename)).digest('hex');
const tree = (directory, relative = '') => fs.readdirSync(path.join(directory, relative)).sort().flatMap(name => {
  const file = path.join(relative, name);
  return fs.statSync(path.join(directory, file)).isDirectory() ? tree(directory, file) : [{path: file, sha256: digest(path.join(directory, file))}];
});
const serverSourceSha256=crypto.createHash('sha256').update(JSON.stringify(tree(path.join(functions,'src')))).digest('hex');
const cutoff=manifest.runtimeAdmissionCutoffs?.[target];
if(cutoff!==null&&cutoff!==undefined&&(typeof cutoff!=='string'||!Number.isFinite(Date.parse(cutoff))||
  new Date(cutoff).toISOString()!==cutoff||Date.parse(cutoff)>Date.now()))throw Error('A release cutoff must be a real, canonical past observation');
const entries = Object.entries({...profile,SECONDE_ANALYTICS_DISABLED:'true',APPLE_ERASURE_WEB_CLIENT_ID:apple.clientId,
  APPLE_ERASURE_WEB_KEY_ID:apple.keyId,APPLE_ERASURE_WEB_TEAM_ID:'B6D5JY9LKV',POSTHOG_ERASURE_ENABLED:'false',
  ACCOUNT_ERASURE_APPLE_API_KEY:native.API_KEY,ACCOUNT_ERASURE_APPLE_IOS_BUNDLE_ID:native.BUNDLE_ID,ACCOUNT_ERASURE_APPLE_IOS_APP_ID:native.GOOGLE_APP_ID,
  ACCOUNT_ERASURE_SERVER_SOURCE_SHA256:serverSourceSha256,ACCOUNT_ERASURE_FIRESTORE_RULES_SHA256:digest(path.join(root,'firestore.rules')),
  ACCOUNT_ERASURE_STORAGE_RULES_SHA256:digest(path.join(root,'storage.rules')),
  ...(cutoff?{SECONDE_PHASE1_NEW_ACCOUNT_CUTOFF:cutoff}:{})});
if (entries.some(([k, v]) => !/^[A-Z][A-Z0-9_]+$/.test(k) || typeof v !== 'string' || /[\r\n\0]/.test(v))) throw Error('Invalid runtime profile format');
fs.writeFileSync(path.join(functions, `.env.${project}`), entries.map(([k, v]) => `${k}=${JSON.stringify(v)}`).join('\n') + '\n', {mode: 0o600});
fs.writeFileSync(path.join(stage, 'firebase.json'), JSON.stringify({functions: {source: 'functions', runtime: 'nodejs22',
  predeploy: ['npm --prefix "$RESOURCE_DIR" run build', `node scripts/check-phase1-stage.cjs ${target}`]}}, null, 2) + '\n');
fs.writeFileSync(path.join(stage, '.firebaserc'), JSON.stringify({projects: {dev: manifest.projects.dev, prod: manifest.projects.prod}}) + '\n');
fs.writeFileSync(path.join(stage, 'phase1-selected.json'), JSON.stringify({project, scope, names}, null, 2) + '\n');
fs.writeFileSync(path.join(stage, 'phase1-source-freeze.json'), JSON.stringify({src: tree(path.join(functions, 'src')),
  lib: tree(path.join(functions, 'lib')), entry: digest(path.join(functions, 'main-phase1.js'))}, null, 2) + '\n');
if (!fs.existsSync(path.join(functions, 'node_modules'))) fs.symlinkSync(path.join(root, 'functions/node_modules'), path.join(functions, 'node_modules'));
fs.writeFileSync(path.join(functions, '.firebaseignore'), 'node_modules\n.git\n**/*.test.*\n**/*.spec.*\n');
const sourceHash = crypto.createHash('sha256').update(fs.readFileSync(path.join(functions, 'lib/index.js'))).digest('hex');
console.log(JSON.stringify({preparedOnly: true, project, scope, selectedFunctions: names.length, stage, compiledEntrySha256: sourceHash,
  serverSourceSha256,repositoryEnvironmentRead: false, productionArchiveRead: false, deployed: false}));
