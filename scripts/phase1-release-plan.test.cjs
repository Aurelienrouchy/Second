'use strict';
const assert = require('node:assert/strict');
const { test } = require('node:test');
const fs = require('node:fs');
const path = require('node:path');
const ts = require('../functions/node_modules/typescript');
const { parseArgs, buildPlan } = require('./phase1-release-plan.cjs');
const manifest = require('../functions/phase1-release.json');

test('requires one explicit known project and rejects mutation flags', () => {
  assert.equal(parseArgs(['--project', 'prod']), 'prod');
  for (const args of [[], ['--project', 'default'], ['--project', 'prod', '--deploy'], ['--project', 'prod', '--force']]) {
    assert.throws(() => parseArgs(args));
  }
});
test('plans additive contracts without replacing legacy or deploying shared dependencies implicitly', () => {
  const plan = buildPlan('prod');
  assert.equal(plan.projectId, 'seconde-b47a6');
  assert.equal(plan.productionReady, false);
  assert.equal(plan.preparedFunctions.length, 36);
  for(const name of ['recordSignupConsentV2','createArticleV2','updateArticleV2','reportMeetupNoShowV2','closeMeetupNoShowV2','cancelPendingTransactionV2','confirmSwapReceptionV2','setSwapExchangeModeV2','uploadSwapPhotosV2','confirmSwapShippingV2'])assert.ok(plan.preparedFunctions.includes(name));
  const command=plan.additiveDeployCommandAfterQualification;
  assert.deepEqual(command.slice(0,5),['firebase','deploy','--project','prod','--only']);
  assert.ok(command[5].split(',').every(name=>/^functions:[A-Za-z]+V2$/.test(name)));
  assert.equal(command.at(-1),'--non-interactive');
  assert.ok(plan.sharedDependenciesToVerify.includes('getMyEligibility'));
  assert.equal(plan.scope, 'phase1_local_agreements_and_catalogue');
});
test('never reports complete phase1 ready or displays environment values', () => {
  const plan = buildPlan('prod', {PAYMENTS_ENABLED: 'true', FINANCIAL_RECOVERY_STRIPE_ACCOUNT_ID: 'sensitive-value',
    STRIPE_SECRET_KEY: 'misplaced-secret'});
  assert.ok(plan.environmentMismatches.includes('PAYMENTS_ENABLED'));
  assert.ok(plan.missingControlKeys.includes('FINANCIAL_RECOVERY_BUCKET'));
  assert.ok(plan.blockers.some(value => value.includes('Stripe account')));
  assert.ok(!JSON.stringify(plan).includes('sensitive-value'));
  assert.ok(!JSON.stringify(plan).includes('misplaced-secret'));
  assert.equal(plan.productionReady, false);
});
test('each additive export resolves exactly to its existing guarded handler', () => {
  const file = ts.createSourceFile('index.ts', fs.readFileSync(path.join(__dirname, '../functions/src/index.ts'), 'utf8'), ts.ScriptTarget.Latest, true);
  for (const entry of manifest.versionedFunctions) {
    const exports = file.statements.filter(statement => ts.isExportDeclaration(statement) &&
      statement.moduleSpecifier?.text === entry.module && statement.exportClause && ts.isNamedExports(statement.exportClause));
    const alias = exports.flatMap(statement => [...statement.exportClause.elements]).find(element => element.name.text === entry.name);
    assert.equal(alias?.propertyName?.text, entry.original, entry.name);
    assert.ok(exports.some(statement => statement.exportClause.elements.some(element => !element.propertyName && element.name.text === entry.original)),
      `${entry.original} must remain exported for existing deployments`);
  }
});
test('installed Firebase discovery preserves separate entry points for a shared callable handler', () => {
  const { extractStack } = require('../functions/node_modules/firebase-functions/lib/runtime/loader.js');
  const { onCall } = require('../functions/node_modules/firebase-functions/lib/v2/providers/https.js');
  const handler = onCall({region: 'northamerica-northeast1', memory: '512MiB'}, async () => ({ok: true}));
  const endpoints = {};
  extractStack({createArticle: handler, createArticleV2: handler}, endpoints, [], {});
  assert.equal(endpoints.createArticle.entryPoint, 'createArticle');
  assert.equal(endpoints.createArticleV2.entryPoint, 'createArticleV2');
  assert.notEqual(endpoints.createArticle, endpoints.createArticleV2);
  assert.equal(handler.__endpoint.entryPoint, undefined);
  assert.deepEqual(endpoints.createArticleV2.region, ['northamerica-northeast1']);
  assert.equal(endpoints.createArticleV2.availableMemoryMb, 512);
});
