'use strict';
// SDK metadata only: requiring a callable never invokes its business handler.
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const stage = path.resolve(__dirname, '..');
const selection = JSON.parse(fs.readFileSync(path.join(stage, 'phase1-selected.json'), 'utf8'));
if (selection.project !== (process.argv[2] === 'dev' ? 'seconde-dev' : 'seconde-b47a6')) throw Error('Wrong staging project');
const frozen = JSON.parse(fs.readFileSync(path.join(stage, 'phase1-source-freeze.json'), 'utf8'));
if (crypto.createHash('sha256').update(fs.readFileSync(path.join(stage, 'functions/main-phase1.js'))).digest('hex') !== frozen.entry) throw Error('Staging export wrapper changed');
for (const tree of ['src', 'lib']) for (const entry of frozen[tree]) {
  const bytes = fs.readFileSync(path.join(stage, 'functions', tree, entry.path));
  if (crypto.createHash('sha256').update(bytes).digest('hex') !== entry.sha256) throw Error('Staging source/build changed: ' + tree + '/' + entry.path);
}
const {parseEnv} = require('node:util');
const profile = parseEnv(fs.readFileSync(path.join(stage, 'functions', `.env.${selection.project}`), 'utf8'));
Object.assign(process.env, profile);
process.env.GCLOUD_PROJECT = selection.project;
const posthogErasure = profile.POSTHOG_ERASURE_ENABLED === 'true';
if (posthogErasure && selection.project !== 'seconde-b47a6') throw Error('Production PostHog erasure credential cannot be bound in Dev');
const posthogConsumers = new Set(['deleteUserAccountV2', 'continueAccountErasure', 'resumeAccountErasures']);
const exportsMap = require(path.join(stage, 'functions/main-phase1.js'));
if (Object.keys(exportsMap).sort().join() !== [...selection.names].sort().join()) throw Error('Selected exports changed');
const providers = [];
for (const [name, value] of Object.entries(exportsMap)) {
  const e = value.__endpoint;
  if (e?.serviceAccountEmail !== `seconde-phase1-runtime@${selection.project}.iam.gserviceaccount.com`) throw Error('Wrong runtime service account: ' + name);
  if (!e || e.platform !== 'gcfv2' || e.availableMemoryMb < 512 || !e.region?.includes('northamerica-northeast1')) throw Error('Invalid function metadata: ' + name);
  const secrets = (e.secretEnvironmentVariables ?? []).map(v => typeof v === 'string' ? v : v.key);
  const expected = ['analyzeProductImage', 'generateStyleProfile'].includes(name) ? ['GEMINI_API_KEY'] :
    name==='completeAccountErasureAppleWeb' ? ['APPLE_ERASURE_SIGNING_KEY'] :
    posthogErasure && posthogConsumers.has(name) ? ['POSTHOG_ERASURE_API_KEY'] : [];
  if (JSON.stringify(secrets.sort()) !== JSON.stringify(expected)) throw Error('Unexpected secret binding: ' + name);
  if (secrets.length) providers.push({name, secrets});
}
console.log(JSON.stringify({project: selection.project, selectedFunctions: selection.names.length,
  sdkMetadataQualified: true, financialSecretsBound: false, namedProviderBindings: providers}));
