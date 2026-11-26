'use strict';
/** Explicit isolated-staging deployment. The CLI discovers source before it
 * loads dotenv files, so the same reviewed profile must reach discovery too. */
const fs = require('node:fs');
const path = require('node:path');
const {parseEnv} = require('node:util');
const {spawnSync} = require('node:child_process');
const target = process.argv[2];
const flags=process.argv.slice(3),dryRun=flags.includes('--dry-run'),interactive=flags.includes('--interactive');
if (!['dev', 'prod'].includes(target)||new Set(flags).size!==flags.length||flags.some(v=>!['--dry-run','--interactive'].includes(v)))
  throw Error('Usage: node scripts/deploy-phase1-stage.cjs dev|prod [--dry-run] [--interactive]');
const stage = `/tmp/seconde-phase1-local-release-${target}`;
const selection = JSON.parse(fs.readFileSync(path.join(stage, 'phase1-selected.json'), 'utf8'));
const project = target === 'dev' ? 'seconde-dev' : 'seconde-b47a6';
if (selection.project !== project || !selection.names.length || selection.names.some(n => !/^[A-Za-z][A-Za-z0-9]+$/.test(n))) throw Error('Wrong staged function target');
const profile = parseEnv(fs.readFileSync(path.join(stage, 'functions', `.env.${project}`), 'utf8'));
if (profile.SECONDE_PHASE1_RUNTIME_SERVICE_ACCOUNT !== `seconde-phase1-runtime@${project}.iam.gserviceaccount.com` ||
    profile.FINANCIAL_RECOVERY_FIRESTORE_PROJECT_ID !== project || profile.FINANCIAL_RECOVERY_ENVIRONMENT !== 'unconfigured' ||
    profile.PAYMENTS_ENABLED !== 'false' || profile.SHIPPING_ENABLED !== 'false') throw Error('Wrong staged runtime profile');
const result = spawnSync('firebase', ['deploy', '--project', target, '--only', selection.names.map(n => `functions:${n}`).join(','),
  ...(interactive?[]:['--non-interactive']), ...(dryRun ? ['--dry-run'] : [])], {cwd: stage, stdio: 'inherit',
  env: {...process.env, ...profile, GCLOUD_PROJECT: project}});
process.exit(result.status ?? 1);
