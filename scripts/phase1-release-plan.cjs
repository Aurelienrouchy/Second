'use strict';

/** Read-only local preparation. This script never imports a Cloud Function,
 * contacts a provider, writes a control, changes environment or deploys. */
const fs = require('node:fs');
const path = require('node:path');
const manifest = require('../functions/phase1-release.json');
const root = path.resolve(__dirname, '..');

function parseArgs(args) {
  if (args.length !== 2 || args[0] !== '--project' || !Object.hasOwn(manifest.projects, args[1])) {
    throw Error('Usage : node scripts/phase1-release-plan.cjs --project dev|prod (lecture seule).');
  }
  return args[1];
}

function buildPlan(project, environment = {}) {
  if (!Object.hasOwn(manifest.projects, project)) throw Error('Projet explicite dev ou prod requis.');
  const projectId = manifest.projects[project];
  const blockers = [...manifest.remainingBlockers];
  const expected = {
    SECONDE_ENV: project === 'prod' ? 'production' : 'development',
    SECONDE_PROJECT_ID: projectId,
    PAYMENTS_ENABLED: 'false',
    SHIPPING_ENABLED: 'false',
    FINANCIAL_RECOVERY_ENVIRONMENT: 'unconfigured',
    FINANCIAL_RECOVERY_FIRESTORE_PROJECT_ID: projectId,
    FINANCIAL_RECOVERY_FIRESTORE_DATABASE_ID: '(default)',
  };
  // Report only key names. A misplaced credential cannot reach plan output.
  const environmentMismatches = Object.entries(expected)
    .filter(([key, value]) => environment[key] !== value).map(([key]) => key);
  const required = ['FINANCIAL_RECOVERY_BUCKET', 'FINANCIAL_RECOVERY_CONTROL_OBJECT',
    'FINANCIAL_RECOVERY_PREFIX', 'FINANCIAL_RECOVERY_INSTALLATION_ID'];
  const missingControlKeys = required.filter(key => typeof environment[key] !== 'string' || !environment[key].trim());
  if (environmentMismatches.length || missingControlKeys.length) blockers.push('Local deployment configuration is incomplete; this does not assert the state of the deployed environment.');
  if (environment.FINANCIAL_RECOVERY_STRIPE_ACCOUNT_ID) blockers.push('An unconfigured installation cannot claim a Stripe account.');
  const names = manifest.versionedFunctions.map(entry => entry.name);
  if (names.some(name => !/^[A-Za-z][A-Za-z0-9_]*$/.test(name) || manifest.unversionedFunctionsToPreserve.includes(name))) {
    throw Error('Manifeste additif invalide.');
  }
  return {
    protocol: manifest.protocol, projectId, scope: manifest.scope,
    productionReady: false,
    preparedFunctions: names,
    preserveDeployedFunctions: manifest.unversionedFunctionsToPreserve,
    sharedDependenciesToVerify: manifest.sharedDependenciesToVerify,
    environmentMismatches, missingControlKeys, blockers,
    // This is a reviewable command, not an executed action or a complete phase
    // 1 release. Shared dependencies are deliberately not silently appended.
    additiveDeployCommandAfterQualification: ['firebase', 'deploy', '--project', project,
      '--only', names.map(name => `functions:${name}`).join(','), '--non-interactive'],
  };
}

if (require.main === module) {
  try {
    const project = parseArgs(process.argv.slice(2));
    const filename = path.join(root, 'functions', `.env.${manifest.projects[project]}`);
    const environment = fs.existsSync(filename) ? require('dotenv').parse(fs.readFileSync(filename)) : {};
    console.log(JSON.stringify(buildPlan(project, environment), null, 2));
  } catch (error) {
    console.error(error.message); process.exitCode = 1;
  }
}
module.exports = { parseArgs, buildPlan };
