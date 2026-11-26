'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const {createHash} = require('node:crypto');
const {parseArgs, declaredFunctionSecrets, inspectDeployedFunction, cloudReader, readObject, validPin, identityPolicyQualifies, inspect, sharedDependencyNames} = require('./commerce-setup.cjs');
const manifest = require('../functions/dev-deploy.json');
const commerce = manifest.packages.find(p => p.name === 'commerce_complete_servicing');
const contracts = declaredFunctionSecrets();
const sha = b => createHash('sha256').update(b).digest('hex');
const env = () => ({SECONDE_ENV: 'development', SECONDE_PROJECT_ID: 'seconde-dev', PAYMENTS_ENABLED: 'true', SHIPPING_ENABLED: 'true',
  FINANCIAL_RECOVERY_BUCKET: 'seconde-dev-controls', FINANCIAL_RECOVERY_PREFIX: 'installations/seconde-dev',
  FINANCIAL_RECOVERY_CONTROL_OBJECT: 'control/current.json', FINANCIAL_RECOVERY_INSTALLATION_ID: 'test-installation',
  FINANCIAL_RECOVERY_FIRESTORE_PROJECT_ID: 'seconde-dev', FINANCIAL_RECOVERY_FIRESTORE_DATABASE_ID: '(default)',
  FINANCIAL_RECOVERY_ENVIRONMENT: 'test', FINANCIAL_RECOVERY_STRIPE_ACCOUNT_ID: 'acct_test0001',
  SHIPENGINE_ACCOUNT_ENVIRONMENT: 'sandbox', SHIPENGINE_SANDBOX_ENABLED: 'true', OPERATOR_SERVICE_TAX_POLICY_JSON: '{}'});
function control() {
  return {protocol: 'financial_recovery_control_v1', installationId: 'test-installation', firestoreProjectId: 'seconde-dev',
    firestoreDatabaseId: '(default)', financialEnvironment: 'test', stripePlatformAccountId: 'acct_test0001', epoch: 'epoch-test',
    mode: 'normal', previousEpoch: null, reconciliationManifest: null,
    businessAdmission: {protocol: 'business_admission_control_v1', state: 'open', planId: null}};
}
function policy() {
  return {protocol: 'financial_recovery_connect_identity_policy_v2', installationId: 'test-installation', firestoreProjectId: 'seconde-dev',
    firestoreDatabaseId: '(default)', financialEnvironment: 'test', stripePlatformAccountId: 'acct_test0001', epoch: 'epoch-test',
    legacyWritersDrained: true, allConnectCreatesUseLifetimeClaims: true, authUidReuseForbidden: true, authImportsAfterBoundaryForbidden: true,
    claimNamespace: 'lifetime_installation', newAuthCreatedAfterMs: 1000, lifetimeStore: {bucket: 'seconde-dev-controls',
      prefix: 'installations/seconde-dev/permits/connect-identities', claimProtection: 'temporary_hold',
      runtimeObjectPermissions: 'create_get_only_no_update_delete', holdReleaseAuthority: 'independent_iam_only',
      namespaceMigration: 'independently_qualified_only', historicalClaimsComplete: true, lifecycleDeletion: 'prevented_by_held_objects',
      continuityId: 'synthetic-test-only', protectedSinceMs: 1000, qualifiedThroughMs: 1000}};
}
function deployed(name, environment, {version = 'latest', project = 'seconde-dev'} = {}) {
  return {name: `projects/seconde-dev/locations/northamerica-northeast1/functions/${name}`, state: 'ACTIVE',
    serviceConfig: {serviceAccountEmail: 'runtime@seconde-dev.iam.gserviceaccount.com', environmentVariables: {...environment},
      secretEnvironmentVariables: contracts[name].map(key => ({key, secret: key, projectId: project, version}))}};
}
test('cible explicite, aucun argument de clé ni mutation/deploy accepté', () => {
  for (const argv of [[], ['--project', 'seconde-dev'], ['--project', 'dev', '--apply'], ['--project', 'dev', '--stripe-key', 'sk_test_secret']]) {
    assert.throws(() => parseArgs(argv));
  }
  assert.equal(parseArgs(['--project', 'prod', '--preflight']).project, 'prod');
});
test('ADC utilisateur envoie le projet de quota exact pour Dev et prod, sans changer sa configuration', async () => {
  for (const projectId of ['seconde-dev', 'seconde-b47a6']) {
    const commands = [], requests = [];
    const read = cloudReader(projectId, {
      run: (command, args) => {commands.push([command, args]); return {status: 0, stdout: 'opaque-test-token'};},
      request: async (url, options) => {requests.push({url, options}); return new Response('{}');},
    });
    await read('https://policytroubleshooter.googleapis.com/v3/iam:troubleshoot', {accessTuple: {}});
    assert.deepEqual(commands, [['gcloud', ['auth', 'print-access-token']]]);
    assert.equal(requests[0].options.headers['x-goog-user-project'], projectId);
    assert.equal(requests[0].options.method, 'POST');
  }
  assert.throws(() => cloudReader('another-project', {run: () => {throw Error('Ne doit pas s’authentifier.');}}), /Projet de quota/);
});
test('génération exacte et hash du contenu GCS obligatoires, aucun accès latest implicite au média', async () => {
  const bytes = Buffer.from('{"protocol":"synthetic"}'), calls = [];
  const read = async (url, body) => {calls.push({url, body}); return new Response(url.includes('alt=media') ? bytes : JSON.stringify({generation: '123', size: bytes.length}));};
  const pin = {object: 'installations/dev/manifests/policy.json', generation: '123', sha256: sha(bytes)};
  const value = await readObject(read, 'controls-test', pin.object, pin);
  assert.equal(value.sha256, pin.sha256);
  assert.ok(calls.every(c => c.url.includes('generation=123') && c.body === undefined));
  await assert.rejects(readObject(read, 'controls-test', pin.object, {...pin, sha256: 'a'.repeat(64)}));
});
test('pin hors namespace, chemin relatif ou génération non numérique refusés', () => {
  const pin = {object: 'installations/dev/manifests/policy.json', generation: '12', sha256: 'a'.repeat(64)};
  assert.equal(validPin(pin, 'installations/dev'), true);
  assert.equal(validPin({...pin, object: 'installations/prod/manifests/policy.json'}, 'installations/dev'), false);
  assert.equal(validPin({...pin, object: 'installations/dev/manifests/../policy.json'}, 'installations/dev'), false);
  assert.equal(validPin({...pin, generation: 'latest'}, 'installations/dev'), false);
});
test('qualification Connect v2 respecte contexte exact, continuité et frontière Auth', () => {
  assert.equal(identityPolicyQualifies(policy(), control(), env(), 2000), true);
  assert.equal(identityPolicyQualifies({...policy(), financialEnvironment: 'live'}, control(), env(), 2000), false);
  assert.equal(identityPolicyQualifies({...policy(), newAuthCreatedAfterMs: 3000}, control(), env(), 2000), false);
  const p = policy(); p.lifetimeStore.historicalClaimsComplete = false;
  assert.equal(identityPolicyQualifies(p, control(), env(), 2000), false);
});
test('plan local ne lit aucun secret et ne certifie jamais le lancement', async () => {
  const e = {...env(), STRIPE_SECRET_KEY: 'sk_test_do_not_print', SHIPENGINE_API_KEY: 'TEST_do_not_print'};
  const report = await inspect({options: {project: 'dev'}, env: e, read: null, validateTax: async () => {}});
  assert.ok(report.blockers.some(b => b.code === 'cloud_not_inspected'));
  assert.equal(report.productionReady, false);
  assert.equal(JSON.stringify(report).includes('do_not_print'), false);
  assert.ok(report.commands[1].includes('--project dev --only functions:'));
  assert.ok(!report.commands[1].includes('--force'));
});
test('prod refuse la configuration test/unconfigured sans la convertir', async () => {
  const e = env(); e.FINANCIAL_RECOVERY_ENVIRONMENT = 'unconfigured';
  const before = JSON.stringify(e);
  const report = await inspect({options: {project: 'prod'}, env: e, read: null, validateTax: async () => {}});
  assert.ok(report.blockers.some(b => b.input === 'FINANCIAL_RECOVERY_ENVIRONMENT=live'));
  assert.equal(JSON.stringify(e), before);
  assert.equal(report.productionReady, false);
  assert.equal(report.functionCount, commerce.names.length - 2);
  assert.ok(!report.commands[1].includes('functions:devAdvanceShipping'));
  assert.ok(!report.commands[1].includes('functions:registerDevPushDestination'));
});
test('outils Dev absents de production ne bloquent pas son inventaire ; ressources étrangères non admises', async () => {
  const e = env(), prodNames = commerce.names.filter(name => !['devAdvanceShipping', 'registerDevPushDestination'].includes(name));
  const read = async url => {
    if (url.includes('secretmanager')) return new Response(JSON.stringify({state: 'ENABLED'}));
    if (url.includes('cloudfunctions')) return new Response(JSON.stringify({functions: prodNames.map(name => ({
      ...deployed(name, e), name: `projects/seconde-b47a6/locations/northamerica-northeast1/functions/${name}`,
    }))}));
    return null;
  };
  const report = await inspect({options: {project: 'prod'}, env: e, read, validateTax: async () => {}});
  assert.deepEqual(report.missingFunctions, []);
  assert.equal(report.functionCount, 58);
  const foreignRead = async url => url.includes('cloudfunctions')
    ? new Response(JSON.stringify({functions: commerce.names.map(name => deployed(name, e))})) : read(url);
  const foreign = await inspect({options: {project: 'prod'}, env: e, read: foreignRead, validateTax: async () => {}});
  assert.equal(foreign.missingFunctions.length, prodNames.length);
});
test('contrôle absent et IAM inconnu restent bloqués ; toutes les requêtes sont en lecture ou diagnostic IAM', async () => {
  const calls = [];
  const read = async (url, body) => {
    calls.push({url, body});
    if (url.includes('secretmanager')) return new Response(JSON.stringify({state: 'ENABLED'}));
    if (url.includes('cloudfunctions')) return new Response(JSON.stringify({functions: []}));
    return null;
  };
  const report = await inspect({options: {project: 'dev'}, env: env(), read, validateTax: async () => {}});
  assert.ok(report.blockers.some(b => b.code === 'control_missing_or_unread'));
  assert.ok(calls.every(c => c.body === undefined));
  assert.ok(calls.every(c => !c.url.includes(':access')));
});
test('IAM hérité utilise le contexte objet v3 ; un résultat inconnu ne devient jamais une permission', async () => {
  const e = env(), p = policy(), policyBytes = Buffer.from(JSON.stringify(p));
  e.FINANCIAL_RECOVERY_IDENTITY_POLICY_OBJECT = 'installations/seconde-dev/manifests/identity.json';
  e.FINANCIAL_RECOVERY_IDENTITY_POLICY_GENERATION = '123';
  e.FINANCIAL_RECOVERY_IDENTITY_POLICY_SHA256 = sha(policyBytes);
  const fingerprint = 'c'.repeat(64);
  e.SHIPENGINE_TRANSPORT_POLICY_JSON = JSON.stringify({protocol: 'shipping_transport_policy_v1',
    effectiveFrom: '2020-01-01T00:00:00.000Z', effectiveUntil: '2099-01-01T00:00:00.000Z',
    account: {environment: 'sandbox', apiBaseUrl: 'https://api.shipengine.com', credentialSha256: fingerprint},
    coverage: {effectiveCoverageSha256: 'd'.repeat(64)}, services: [{}], forward: {handoff: {}}, return: {handoff: {}}});
  const requests = [], values = {'control/current.json': Buffer.from(JSON.stringify(control())), [e.FINANCIAL_RECOVERY_IDENTITY_POLICY_OBJECT]: policyBytes};
  const read = async (url, body) => {
    requests.push({url, body});
    if (url.includes('secretmanager')) return new Response(JSON.stringify({state: 'ENABLED'}));
    if (url.includes('cloudfunctions')) return new Response(JSON.stringify({functions: [...new Set([...commerce.names, ...sharedDependencyNames])].map(name => deployed(name, e))}));
    if (url.includes('storage.googleapis.com')) {
      const name = decodeURIComponent(new URL(url).pathname.split('/o/')[1]), bytes = values[name];
      if (!bytes) return null;
      return new Response(url.includes('alt=media') ? bytes : JSON.stringify({generation: '123', size: bytes.length}));
    }
    assert.equal(url, 'https://policytroubleshooter.googleapis.com/v3/iam:troubleshoot');
    assert.equal(body.accessTuple.fullResourceName, '//storage.googleapis.com/projects/_/buckets/seconde-dev-controls');
    const {name} = body.accessTuple.conditionContext.resource, permission = body.accessTuple.permission;
    const controlObject = name.endsWith('/control/current.json');
    const allowed = permission === 'storage.objects.get' || permission === 'storage.objects.create' && !controlObject && !name.includes('/manifests/');
    return new Response(JSON.stringify({overallAccessState: controlObject && permission === 'storage.objects.delete' ? 'UNKNOWN_INFO' : allowed ? 'CAN_ACCESS' : 'CANNOT_ACCESS'}));
  };
  const report = await inspect({options: {project: 'dev', 'shipengine-credential-sha256': fingerprint}, env: e, read, validateTax: async () => {}});
  assert.deepEqual(report.blockers.map(b => b.code), ['runtime_iam_unverified']);
  assert.equal(report.productionReady, false);
  assert.ok(requests.every(r => r.body === undefined || r.url.endsWith('/v3/iam:troubleshoot')));
});
test('contrats de secrets lus sans importer le runtime, y compris façades et options partagées', () => {
  assert.equal(Object.keys(contracts).length, new Set([...commerce.names, ...sharedDependencyNames]).size);
  assert.ok(Object.values(contracts).every(value => Array.isArray(value)));
  assert.deepEqual(contracts.walletWithdraw, ['STRIPE_SECRET_KEY']);
  assert.deepEqual(contracts.getArticleShippingParcel, []);
  assert.deepEqual(contracts.quoteShippingPurchase, ['STRIPE_SECRET_KEY', 'SHIPENGINE_API_KEY']);
  assert.ok(contracts.stripeWebhook.includes('STRIPE_CONNECT_WEBHOOK_SECRET'));
  assert.deepEqual(contracts.administerSupportRequest, ['STRIPE_SECRET_KEY']);
  assert.equal(declaredFunctionSecrets(['notAnExport']).notAnExport, null);
});
test('dépendance inscription absente détectée séparément sans élargir le déploiement commerce', async () => {
  const e = env(), calls = [];
  const read = async url => {
    calls.push(url);
    if (url.includes('secretmanager')) return new Response(JSON.stringify({state: 'ENABLED'}));
    if (url.includes('cloudfunctions')) return new Response(JSON.stringify({functions: [...commerce.names,
      'recordSignupConsent', 'checkUsernameAvailability'].map(name => deployed(name, e))}));
    return null;
  };
  const report = await inspect({options: {project: 'dev'}, env: e, read, validateTax: async () => {}});
  assert.deepEqual(report.missingFunctions, []);
  assert.deepEqual(report.sharedDependencyNames, sharedDependencyNames);
  assert.deepEqual(report.missingSharedDependencies, ['getMyEligibility']);
  assert.ok(report.blockers.some(value => value.code === 'shared_dependencies_not_active' && value.input === 'getMyEligibility'));
  assert.ok(!report.commands[1].includes('functions:getMyEligibility'));
  assert.ok(!report.commands[1].includes('functions:recordSignupConsent'));
  assert.ok(!report.commands[1].includes('functions:checkUsernameAvailability'));
  assert.match(report.deploymentCommandScope, /commerce_package_only/);
  assert.ok(calls.every(url => !url.includes(':access')));
});
test('ACTIVE avec environnement ancien et secrets mal raccordés reste bloqué sans afficher leur contenu', () => {
  const e = env(), fn = deployed('walletWithdraw', e);
  fn.serviceConfig.environmentVariables.PAYMENTS_ENABLED = 'false';
  fn.serviceConfig.environmentVariables.BUYER_FEE_PERCENT = 'unexpected-private-value';
  fn.serviceConfig.environmentVariables.STRIPE_SECRET_KEY = 'sk_test_never_print';
  fn.serviceConfig.secretEnvironmentVariables[0].projectId = 'seconde-b47a6';
  const issues = inspectDeployedFunction(fn, 'walletWithdraw', e, contracts.walletWithdraw, 'seconde-dev');
  assert.deepEqual(issues.map(value => value.code), ['function_environment_mismatch', 'function_environment_mismatch', 'function_secret_mount_project_unverified']);
  assert.ok(!JSON.stringify(issues).includes('sk_test_never_print'));
  assert.ok(!JSON.stringify(issues).includes('unexpected-private-value'));
  fn.serviceConfig.secretEnvironmentVariables = [];
  assert.ok(inspectDeployedFunction(fn, 'walletWithdraw', e, contracts.walletWithdraw, 'seconde-dev')
    .some(value => value.code === 'function_secret_mount_missing_or_duplicate'));
});
test('contrat ou métadonnées inconnus ne deviennent jamais une absence de secrets certifiée', () => {
  assert.ok(inspectDeployedFunction({state: 'ACTIVE'}, 'walletWithdraw', env(), contracts.walletWithdraw, 'seconde-dev')
    .some(value => value.code === 'function_runtime_metadata_missing'));
  const fn = deployed('walletWithdraw', env());
  delete fn.serviceConfig.environmentVariables;
  const issues = inspectDeployedFunction(fn, 'walletWithdraw', env(), null, 'seconde-dev');
  assert.ok(issues.some(value => value.code === 'function_environment_unknown'));
  assert.ok(issues.some(value => value.code === 'function_secret_contract_unknown'));
});
test('numéro de projet vérifié et version réellement montée inspectés sans accéder au secret', async () => {
  const e = env(), calls = [];
  const read = async url => {
    calls.push(url);
    if (url.includes('secretmanager')) return new Response(JSON.stringify({state: url.endsWith('/versions/2') ? 'DISABLED' : 'ENABLED'}));
    if (url.includes('cloudfunctions')) return new Response(JSON.stringify({functions: [deployed('walletWithdraw', e, {version: '2', project: '12345'})]}));
    if (url.includes('cloudresourcemanager')) return new Response(JSON.stringify({projectId: 'seconde-dev', projectNumber: '12345'}));
    return null;
  };
  const report = await inspect({options: {project: 'dev'}, env: e, read, validateTax: async () => {}});
  assert.ok(!report.blockers.some(value => value.code === 'function_secret_mount_project_unverified'));
  assert.ok(report.blockers.some(value => value.code === 'mounted_secret_version_unavailable' && value.input === 'STRIPE_SECRET_KEY/versions/2'));
  assert.ok(calls.some(url => url.includes('cloudresourcemanager')));
  assert.ok(calls.every(url => !url.includes(':access')));
});
test('exports du paquet existants, sans duplication et reprises réellement incluses', () => {
  const fs = require('node:fs'), ts = require('../functions/node_modules/typescript');
  const file = ts.createSourceFile('index.ts', fs.readFileSync(require('node:path').join(__dirname, '../functions/src/index.ts'), 'utf8'), ts.ScriptTarget.Latest, true);
  const exports = new Set(file.statements.filter(ts.isExportDeclaration).flatMap(n => n.exportClause?.elements?.map(e => e.name.text) || []));
  for (const p of manifest.packages) {
    assert.equal(new Set(p.names).size, p.names.length);
    for (const name of p.names) assert.ok(exports.has(name), `Export inconnu : ${name}`);
  }
  for (const name of ['requestReturn', 'retryPurchaseRefund', 'retireLegacyStripeCheckout', 'readSupportRequests', 'administerSupportRequest', 'stripeWebhook', 'shipEngineWebhook', 'reconcileFinances', 'sweepPendingLabels', 'deliverOperationalNotices']) assert.ok(commerce.names.includes(name));
  for (const p of manifest.packages.filter(p => p.activationPreflightCommand)) {
    assert.equal(Object.hasOwn(p, 'requiresPreflight'), false);
    assert.equal(p.activationPreflightCommand, 'node scripts/commerce-setup.cjs --project dev --preflight');
  }
  assert.ok(!commerce.names.includes('getShippingEstimate') && !commerce.names.includes('findPickupPoints'));
});
