'use strict';
/** Read-only commerce plan/preflight. Never reads secret payloads, changes an
 * environment, writes a control, supplies attestations, or deploys functions.
 * node scripts/commerce-setup.cjs --project dev [--preflight] [--offline]
 * Optional known provider observation: --shipengine-credential-sha256 <hash>.
 * Existing controls must be qualified by their actual independent operator;
 * an existing unconfigured installation is never silently bootstrapped again. */
const fs = require('node:fs');
const path = require('node:path');
const {createHash} = require('node:crypto');
const {spawnSync} = require('node:child_process');
const root = path.resolve(__dirname, '..');
const manifest = require('../functions/dev-deploy.json');
const commerce = manifest.packages.find(p => p.name === 'commerce_complete_servicing');
const targets = {dev: {projectId: 'seconde-dev', environment: 'test', appEnvironment: 'development'},
  prod: {projectId: 'seconde-b47a6', environment: 'live', appEnvironment: 'production'}};
const developmentOnlyFunctions = new Set(['devAdvanceShipping', 'registerDevPushDestination']);
const commerceNames = project => commerce.names.filter(name => project !== 'prod' || !developmentOnlyFunctions.has(name));
// Required before a member can complete signup or start buying/selling. These
// are audited separately, never silently appended to the commerce deploy.
const sharedDependencyNames = ['getMyEligibility', 'recordSignupConsent', 'checkUsernameAvailability'];
const publicEnvironmentKeys = new Set(['SECONDE_ENV', 'SECONDE_PROJECT_ID', 'SECONDE_COMMERCE_TEST_MODE',
  'PAYMENTS_ENABLED', 'SHIPPING_ENABLED', 'SHIPENGINE_SANDBOX_ENABLED', 'SHIPENGINE_ACCOUNT_ENVIRONMENT',
  'SHIPENGINE_BASE_URL', 'SHIPENGINE_TRANSPORT_POLICY_JSON', 'OPERATOR_SERVICE_TAX_POLICY_JSON',
  'TAX_ENABLED', 'GST_RATE', 'QST_RATE', 'BUYER_FEE_PERCENT', 'BUYER_FEE_FIXED', 'BUYER_FEE_MIN']);
const publicEnvironmentKey = key => key.startsWith('FINANCIAL_RECOVERY_') || publicEnvironmentKeys.has(key);
const sha = bytes => createHash('sha256').update(bytes).digest('hex');
const hex = value => typeof value === 'string' && /^[a-f0-9]{64}$/.test(value);
const token = value => typeof value === 'string' && /^[A-Za-z0-9_.:-]{1,180}$/.test(value);
const objectName = value => typeof value === 'string' && /^[A-Za-z0-9_./-]{1,700}$/.test(value) &&
  !value.startsWith('/') && value.split('/').every(p => p && p !== '.' && p !== '..');
const sameKeys = (value, keys) => value && typeof value === 'object' && !Array.isArray(value) &&
  Object.keys(value).sort().join(',') === [...keys].sort().join(',');
function parseArgs(argv) {
  const options = {preflight: false, offline: false};
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === '--preflight' || arg === '--offline') options[arg.slice(2)] = true;
    else if (['--project', '--runtime-service-account', '--shipengine-credential-sha256'].includes(arg) && argv[i + 1] && !argv[i + 1].startsWith('--')) {
      if (options[arg.slice(2)] !== undefined) throw Error('Option répétée.');
      options[arg.slice(2)] = argv[++i];
    } else throw Error('Usage : --project dev|prod [--preflight] [--offline] [--runtime-service-account email] [--shipengine-credential-sha256 hash]');
  }
  if (!Object.hasOwn(targets, options.project || '')) throw Error('Cible obligatoire et explicite : --project dev ou --project prod.');
  if (options['runtime-service-account'] && !/^[A-Za-z0-9-]+@[a-z0-9-]+\.iam\.gserviceaccount\.com$/.test(options['runtime-service-account'])) throw Error('Compte de service invalide.');
  if (options['shipengine-credential-sha256'] && !hex(options['shipengine-credential-sha256'])) throw Error('Empreinte publique ShipEngine invalide.');
  return options;
}
function readDeploymentEnvironment(projectId) {
  const filename = path.join(root, 'functions', `.env.${projectId}`);
  if (!fs.existsSync(filename)) return {};
  // Allowlist: a secret accidentally placed in an env file cannot reach output.
  const parsed = require('dotenv').parse(fs.readFileSync(filename));
  return Object.fromEntries(Object.entries(parsed).filter(([key]) => publicEnvironmentKey(key)));
}
/** Read deployment options as syntax only: importing index.js would initialize
 * runtime clients. Follow the public re-exports and local constant/spread
 * options, failing closed when a declaration cannot be inspected statically. */
function declaredFunctionSecrets(names = [...new Set([...commerce.names, ...sharedDependencyNames])]) {
  const ts = require('../functions/node_modules/typescript'), files = new Map();
  function source(filename) {
    if (!files.has(filename)) files.set(filename, ts.createSourceFile(filename, fs.readFileSync(filename, 'utf8'), ts.ScriptTarget.Latest, true));
    return files.get(filename);
  }
  function unwrap(node) {
    while (node && (ts.isAsExpression(node) || ts.isParenthesizedExpression(node) || ts.isSatisfiesExpression(node))) node = node.expression;
    return node;
  }
  function local(file, name) {
    for (const statement of file.statements) if (ts.isVariableStatement(statement)) {
      for (const declaration of statement.declarationList.declarations) if (ts.isIdentifier(declaration.name) && declaration.name.text === name) return declaration.initializer;
    }
    return null;
  }
  function options(file, node, seen = new Set()) {
    node = unwrap(node);
    if (!node) return null;
    if (ts.isIdentifier(node)) {
      const id = `${file.fileName}:${node.text}`; if (seen.has(id)) return null;
      seen = new Set([...seen, id]); const value = local(file, node.text);
      if (value) return options(file, value, seen);
      for (const statement of file.statements) if (ts.isImportDeclaration(statement) &&
          ts.isStringLiteral(statement.moduleSpecifier) && statement.moduleSpecifier.text.startsWith('.') &&
          statement.importClause?.namedBindings && ts.isNamedImports(statement.importClause.namedBindings)) {
        const imported = statement.importClause.namedBindings.elements.find(element => element.name.text === node.text);
        if (imported) {
          const next = source(path.resolve(path.dirname(file.fileName), `${statement.moduleSpecifier.text}.ts`));
          return options(next, local(next, (imported.propertyName || imported.name).text), seen);
        }
      }
      return null;
    }
    if (!ts.isObjectLiteralExpression(node)) return null;
    let secrets;
    for (const property of node.properties) {
      if (ts.isSpreadAssignment(property)) {
        const spread = options(file, property.expression, seen); if (spread === null) return null;
        if (spread.secrets !== undefined) secrets = spread.secrets;
      } else if (property.name && ts.isComputedPropertyName(property.name)) return null;
      else if (ts.isPropertyAssignment(property) && property.name.getText(file).replace(/^['"]|['"]$/g, '') === 'secrets') {
        const value = unwrap(property.initializer);
        if (!ts.isArrayLiteralExpression(value) || value.elements.some(element => !ts.isStringLiteral(element))) return null;
        secrets = value.elements.map(element => element.text);
      }
    }
    return {secrets};
  }
  function resolve(filename, name, seen = new Set()) {
    const id = `${filename}:${name}`; if (seen.has(id)) return null;
    seen = new Set([...seen, id]); const file = source(filename), node = unwrap(local(file, name));
    if (node) {
      if (!ts.isCallExpression(node) || !ts.isIdentifier(node.expression) ||
          !/^(?:onCall|onRequest|onSchedule|onDocumentCreated|onDocumentUpdated|onDocumentDeleted|onDocumentWritten)$/.test(node.expression.text)) return null;
      const value = options(file, node.arguments[0]); return value === null ? null : value.secrets || [];
    }
    for (const statement of file.statements) if (ts.isExportDeclaration(statement) && statement.moduleSpecifier &&
        ts.isStringLiteral(statement.moduleSpecifier) && statement.exportClause && ts.isNamedExports(statement.exportClause)) {
      const exported = statement.exportClause.elements.find(element => element.name.text === name);
      if (exported && statement.moduleSpecifier.text.startsWith('.')) {
        const next = path.resolve(path.dirname(filename), `${statement.moduleSpecifier.text}.ts`);
        return resolve(next, (exported.propertyName || exported.name).text, seen);
      }
    }
    return null;
  }
  return Object.fromEntries(names.map(name => {try {return [name, resolve(path.join(root, 'functions/src/index.ts'), name)];} catch {return [name, null];}}));
}
/** Never include deployed values in diagnostics: env metadata can contain a
 * misplaced credential. Report only allowlisted key names and mount status. */
function inspectDeployedFunction(fn, name, env, expectedSecrets, projectId, projectNumber) {
  const issues = [], config = fn.serviceConfig;
  const issue = (code, input) => issues.push({code, input: `${name}:${input}`});
  if (!config || typeof config !== 'object') {issue('function_runtime_metadata_missing', 'serviceConfig'); return issues;}
  const deployed = config.environmentVariables;
  if (!deployed || typeof deployed !== 'object' || Array.isArray(deployed)) issue('function_environment_unknown', 'environmentVariables');
  else for (const key of new Set([...Object.keys(env), ...Object.keys(deployed)].filter(publicEnvironmentKey))) {
    if (deployed[key] !== env[key]) issue('function_environment_mismatch', key);
  }
  if (expectedSecrets === null) {issue('function_secret_contract_unknown', 'source options'); return issues;}
  const mounts = config.secretEnvironmentVariables;
  if (mounts !== undefined && !Array.isArray(mounts)) {issue('function_secret_mounts_unknown', 'secretEnvironmentVariables'); return issues;}
  const actual = mounts || [];
  for (const key of expectedSecrets) {
    const matched = actual.filter(mount => mount?.key === key);
    if (matched.length !== 1) {issue('function_secret_mount_missing_or_duplicate', key); continue;}
    const mount = matched[0];
    if (mount.secret !== key) issue('function_secret_mount_name_mismatch', key);
    if (mount.projectId !== projectId && (!projectNumber || mount.projectId !== projectNumber)) issue('function_secret_mount_project_unverified', key);
    if (typeof mount.version !== 'string' || !/^(?:latest|[1-9]\d*)$/.test(mount.version)) issue('function_secret_mount_version_unknown', key);
  }
  for (const mount of actual) if (!expectedSecrets.includes(mount?.key)) issue('function_unexpected_secret_mount', 'unexpected key (value withheld)');
  return issues;
}
function cloudReader(projectId, {run = spawnSync, request = fetch} = {}) {
  if (!Object.values(targets).some(target => target.projectId === projectId)) throw Error('Projet de quota explicite dev ou prod obligatoire.');
  const result = run('gcloud', ['auth', 'print-access-token'], {encoding: 'utf8', timeout: 20000, maxBuffer: 1024 * 1024});
  if (result.status !== 0 || !result.stdout?.trim()) throw Error('Authentification Google Cloud indisponible ; aucune valeur de credential affichée.');
  const bearer = result.stdout.trim();
  return async (url, body) => {
    const response = await request(url, {method: body === undefined ? 'GET' : 'POST',
      // User ADC/OAuth credentials otherwise charge quota to their default
      // client project, even when this API is enabled on the selected target.
      headers: {Authorization: `Bearer ${bearer}`, 'x-goog-user-project': projectId,
        ...(body === undefined ? {} : {'Content-Type': 'application/json'})},
      ...(body === undefined ? {} : {body: JSON.stringify(body)}), signal: AbortSignal.timeout(15000)});
    if (response.status === 404) return null;
    if (!response.ok) throw Error(`Lecture cloud HTTP ${response.status}.`);
    return response;
  };
}
async function readObject(read, bucket, name, pin, maxBytes = 32768) {
  const base = `https://storage.googleapis.com/storage/v1/b/${encodeURIComponent(bucket)}/o/${encodeURIComponent(name)}`;
  const metadataResponse = await read(`${base}${pin ? `?generation=${encodeURIComponent(pin.generation)}` : ''}`);
  if (!metadataResponse) return null;
  const metadata = await metadataResponse.json();
  if (!/^[1-9]\d{0,24}$/.test(String(metadata.generation)) || !/^\d+$/.test(String(metadata.size)) || Number(metadata.size) > maxBytes ||
      pin && String(metadata.generation) !== pin.generation) throw Error('Génération ou taille GCS non qualifiée.');
  const response = await read(`${base}?alt=media&generation=${encodeURIComponent(metadata.generation)}`);
  if (!response) throw Error('Génération GCS disparue.');
  const bytes = Buffer.from(await response.arrayBuffer());
  if (bytes.length !== Number(metadata.size) || bytes.length > maxBytes || pin && sha(bytes) !== pin.sha256) throw Error('Empreinte ou taille GCS divergente.');
  return {value: JSON.parse(bytes.toString('utf8')), generation: String(metadata.generation), sha256: sha(bytes), temporaryHold: metadata.temporaryHold === true};
}
function validPin(pin, prefix) {
  return sameKeys(pin, ['object', 'generation', 'sha256']) && objectName(pin.object) && pin.object.startsWith(`${prefix}/manifests/`) &&
    /^[1-9]\d{0,24}$/.test(pin.generation) && hex(pin.sha256);
}
function identityPolicyQualifies(value, control, env, now = Date.now()) {
  const expected = {protocol: 'financial_recovery_connect_identity_policy_v2', installationId: control.installationId,
    firestoreProjectId: control.firestoreProjectId, firestoreDatabaseId: control.firestoreDatabaseId,
    financialEnvironment: control.financialEnvironment, stripePlatformAccountId: control.stripePlatformAccountId, epoch: control.epoch,
    legacyWritersDrained: true, allConnectCreatesUseLifetimeClaims: true, authUidReuseForbidden: true,
    authImportsAfterBoundaryForbidden: true, claimNamespace: 'lifetime_installation'};
  if (!sameKeys(value, [...Object.keys(expected), 'newAuthCreatedAfterMs', 'lifetimeStore']) ||
      Object.entries(expected).some(([k, v]) => value[k] !== v) || !Number.isSafeInteger(value.newAuthCreatedAfterMs) ||
      value.newAuthCreatedAfterMs < 1 || value.newAuthCreatedAfterMs > now) return false;
  const store = value.lifetimeStore, expectedStore = {bucket: env.FINANCIAL_RECOVERY_BUCKET,
    prefix: `${env.FINANCIAL_RECOVERY_PREFIX}/permits/connect-identities`, claimProtection: 'temporary_hold',
    runtimeObjectPermissions: 'create_get_only_no_update_delete', holdReleaseAuthority: 'independent_iam_only',
    namespaceMigration: 'independently_qualified_only', historicalClaimsComplete: true, lifecycleDeletion: 'prevented_by_held_objects'};
  return sameKeys(store, [...Object.keys(expectedStore), 'continuityId', 'protectedSinceMs', 'qualifiedThroughMs']) &&
    Object.entries(expectedStore).every(([k, v]) => store[k] === v) && token(store.continuityId) &&
    Number.isSafeInteger(store.protectedSinceMs) && store.protectedSinceMs > 0 && store.protectedSinceMs <= value.newAuthCreatedAfterMs &&
    Number.isSafeInteger(store.qualifiedThroughMs) && store.qualifiedThroughMs >= value.newAuthCreatedAfterMs && store.qualifiedThroughMs <= now;
}
async function inspect({options, env, read, validateTax, secretContracts = declaredFunctionSecrets()}) {
  const target = targets[options.project], names = commerceNames(options.project);
  const dependencies = sharedDependencyNames.filter(name => !names.includes(name));
  const report = {projectId: target.projectId, financialEnvironment: target.environment,
    scope: 'configuration_preflight_only', productionReady: false, blockers: [], observations: [],
    environmentBaseline: 'local_deployment_file', cloudRuntimeCompared: false,
    functionCount: names.length, missingFunctions: [], runtimePrincipals: [],
    sharedDependencyNames: dependencies, missingSharedDependencies: [],
    deploymentCommandScope: 'commerce_package_only; shared dependencies require their own explicit deployment scope',
    commands: [
      `node scripts/commerce-setup.cjs --project ${options.project} --preflight`,
      `firebase deploy --config ${options.project === 'dev' ? 'firebase.dev.json' : 'firebase.json'} --project ${options.project} --only ${names.map(n => `functions:${n}`).join(',')}`,
    ]};
  const block = (code, input) => report.blockers.push({code, input});
  for (const [key, value] of [['SECONDE_ENV', target.appEnvironment], ['SECONDE_PROJECT_ID', target.projectId],
    ['FINANCIAL_RECOVERY_FIRESTORE_PROJECT_ID', target.projectId], ['FINANCIAL_RECOVERY_FIRESTORE_DATABASE_ID', '(default)'],
    ['FINANCIAL_RECOVERY_ENVIRONMENT', target.environment]]) if (env[key] !== value) block('deployment_environment_mismatch', `${key}=${value}`);
  for (const name of ['PAYMENTS_ENABLED', 'SHIPPING_ENABLED']) if (env[name]?.toLowerCase().trim() !== 'true') block('new_commerce_disabled', name);
  if (!/^acct_[A-Za-z0-9]{5,100}$/.test(env.FINANCIAL_RECOVERY_STRIPE_ACCOUNT_ID || '')) block('provider_binding_missing', 'FINANCIAL_RECOVERY_STRIPE_ACCOUNT_ID (compte vérifié, test Dev / live prod)');
  if (env.SHIPENGINE_ACCOUNT_ENVIRONMENT !== (options.project === 'dev' ? 'sandbox' : 'production')) block('shipping_environment_mismatch', 'SHIPENGINE_ACCOUNT_ENVIRONMENT');
  if (options.project === 'dev' && env.SHIPENGINE_SANDBOX_ENABLED !== 'true') block('shipping_sandbox_required', 'SHIPENGINE_SANDBOX_ENABLED=true');
  const bucket = env.FINANCIAL_RECOVERY_BUCKET, controlObject = env.FINANCIAL_RECOVERY_CONTROL_OBJECT, prefix = env.FINANCIAL_RECOVERY_PREFIX;
  const locationValid = /^[a-z0-9][a-z0-9._-]{2,220}$/.test(bucket || '') && !/(?:\.appspot\.com|\.firebasestorage\.app)$/.test(bucket || '') &&
    objectName(controlObject) && objectName(prefix) && token(env.FINANCIAL_RECOVERY_INSTALLATION_ID) &&
    !['permits', 'observations'].some(p => controlObject.startsWith(`${prefix}/${p}/`));
  if (!locationValid) block('control_location_missing', 'FINANCIAL_RECOVERY_BUCKET/CONTROL_OBJECT/PREFIX/INSTALLATION_ID');
  if (!env.OPERATOR_SERVICE_TAX_POLICY_JSON) block('tax_documentation_missing', 'OPERATOR_SERVICE_TAX_POLICY_JSON (v2, source fiscale réelle même TAX_ENABLED=false)');
  else {
    try { await validateTax(env); report.observations.push('tax_policy_runtime_structure_valid; contenu documentaire non certifié'); }
    catch { block('tax_policy_runtime_validation_failed', 'OPERATOR_SERVICE_TAX_POLICY_JSON ou build functions préalable'); }
  }
  if (!env.SHIPENGINE_TRANSPORT_POLICY_JSON) block('transport_documentation_missing', 'SHIPENGINE_TRANSPORT_POLICY_JSON (couverture, compte, services, aller et retour réellement documentés)');
  else {
    try {
      const p = JSON.parse(env.SHIPENGINE_TRANSPORT_POLICY_JSON), now = Date.now();
      if (p.protocol !== 'shipping_transport_policy_v1' || !(Date.parse(p.effectiveFrom) <= now && now < Date.parse(p.effectiveUntil)) ||
          p.account?.environment !== env.SHIPENGINE_ACCOUNT_ENVIRONMENT || p.account?.apiBaseUrl !== (env.SHIPENGINE_BASE_URL || 'https://api.shipengine.com') ||
          !hex(p.account?.credentialSha256) || p.account.credentialSha256 !== options['shipengine-credential-sha256'] ||
          !hex(p.coverage?.effectiveCoverageSha256) || !p.services?.length || !p.forward?.handoff || !p.return?.handoff) throw Error();
      report.observations.push('transport_binding_and_documentary_envelope_present; qualification complète conservée par le garde serveur');
    } catch { block('transport_policy_or_binding_unverified', 'Politique effective + --shipengine-credential-sha256 calculé depuis la vraie clé, sans communiquer la clé'); }
  }
  if (!read) {block('cloud_not_inspected', 'Relancer sans --offline avec accès de lecture Google Cloud.'); return report;}
  const safe = async (code, input, fn) => {try {return await fn();} catch {block(code, input); return null;}};
  await Promise.all(commerce.secrets.map(secret => safe('secret_metadata_unavailable', secret, async () => {
    const r = await read(`https://secretmanager.googleapis.com/v1/projects/${target.projectId}/secrets/${secret}/versions/latest`);
    if (!r || (await r.json()).state !== 'ENABLED') throw Error();
    report.observations.push(`secret_enabled:${secret} (valeur non lue, validité prestataire non déduite)`);
  })));
  const functions = await safe('functions_inventory_unavailable', target.projectId, async () => {
    const all = []; let page = '';
    for (let i = 0; i < 5; i++) {
      const r = await read(`https://cloudfunctions.googleapis.com/v2/projects/${target.projectId}/locations/${manifest.region}/functions?pageSize=100${page ? `&pageToken=${encodeURIComponent(page)}` : ''}`);
      if (!r) throw Error(); const value = await r.json(); all.push(...(value.functions || []));
      if (!value.nextPageToken) return all; page = value.nextPageToken;
    } throw Error();
  });
  if (functions) {
    const resourceNames = new Set([...names, ...dependencies].map(name => `projects/${target.projectId}/locations/${manifest.region}/functions/${name}`));
    for (const name of names) if (!functions.some(fn => fn.name === `projects/${target.projectId}/locations/${manifest.region}/functions/${name}` && fn.state === 'ACTIVE')) report.missingFunctions.push(name);
    if (report.missingFunctions.length) block('functions_not_active', report.missingFunctions.join(','));
    for (const name of dependencies) if (!functions.some(fn => fn.name === `projects/${target.projectId}/locations/${manifest.region}/functions/${name}` && fn.state === 'ACTIVE')) report.missingSharedDependencies.push(name);
    if (report.missingSharedDependencies.length) block('shared_dependencies_not_active', report.missingSharedDependencies.join(','));
    const selected = functions.filter(fn => resourceNames.has(fn.name));
    let projectNumber;
    if (selected.some(fn => Array.isArray(fn.serviceConfig?.secretEnvironmentVariables) &&
        fn.serviceConfig.secretEnvironmentVariables.some(mount => /^\d+$/.test(mount?.projectId || '')))) {
      const project = await safe('project_metadata_unavailable', target.projectId, async () => {
        const r = await read(`https://cloudresourcemanager.googleapis.com/v1/projects/${target.projectId}`);
        const value = r && await r.json();
        if (value?.projectId !== target.projectId || !/^[1-9]\d+$/.test(value.projectNumber || '')) throw Error();
        return value;
      });
      projectNumber = project?.projectNumber;
    }
    for (const fn of selected) {
      const name = fn.name.split('/').at(-1);
      report.blockers.push(...inspectDeployedFunction(fn, name, env, secretContracts[name] ?? null, target.projectId, projectNumber));
    }
    // A mounted numeric version may be disabled while "latest" is enabled.
    // Inspect that exact version's metadata, never its secret payload.
    const mountedVersions = new Set(selected.flatMap(fn => Array.isArray(fn.serviceConfig?.secretEnvironmentVariables)
      ? fn.serviceConfig.secretEnvironmentVariables.filter(mount => commerce.secrets.includes(mount?.secret) &&
        (mount.projectId === target.projectId || projectNumber && mount.projectId === projectNumber) &&
        typeof mount.version === 'string' && /^[1-9]\d*$/.test(mount.version)).map(mount => `${mount.secret}/versions/${mount.version}`) : []));
    await Promise.all([...mountedVersions].map(version => safe('mounted_secret_version_unavailable', version, async () => {
      const r = await read(`https://secretmanager.googleapis.com/v1/projects/${target.projectId}/secrets/${version}`);
      if (!r || (await r.json()).state !== 'ENABLED') throw Error();
    })));
    report.observations.push('deployed_runtime_configuration_compared; ACTIVE ne certifie ni la version du code ni la recette métier');
    report.cloudRuntimeCompared = selected.length > 0;
    report.runtimePrincipals = [...new Set(selected
      .map(fn => fn.serviceConfig?.serviceAccountEmail).filter(Boolean))];
    if (options['runtime-service-account'] && !report.runtimePrincipals.includes(options['runtime-service-account'])) report.runtimePrincipals.push(options['runtime-service-account']);
    if (!report.runtimePrincipals.length && options.project === 'dev') report.runtimePrincipals.push(`seconde-dev-runtime@${target.projectId}.iam.gserviceaccount.com`);
    if (!report.runtimePrincipals.length) block('runtime_principal_unknown', '--runtime-service-account : identité réelle du déploiement');
  }
  if (!locationValid) return report;
  const controlRead = await safe('control_unavailable', `gs://${bucket}/${controlObject} (ne pas remplacer un contrôle existant)`, () => readObject(read, bucket, controlObject));
  if (!controlRead) {block('control_missing_or_unread', 'Qualification indépendante du contrôle ; aucune initialisation/écriture automatique.'); return report;}
  const c = controlRead.value;
  if (!c || typeof c !== 'object' || Array.isArray(c)) {block('control_context_unqualified', 'Contrôle JSON objet attendu ; aucune écriture automatique.'); return report;}
  const expectedControl = {protocol: 'financial_recovery_control_v1', installationId: env.FINANCIAL_RECOVERY_INSTALLATION_ID,
    firestoreProjectId: target.projectId, firestoreDatabaseId: '(default)', financialEnvironment: target.environment,
    stripePlatformAccountId: env.FINANCIAL_RECOVERY_STRIPE_ACCOUNT_ID};
  if (!sameKeys(c, [...Object.keys(expectedControl), 'epoch', 'mode', 'previousEpoch', 'reconciliationManifest', 'businessAdmission']) ||
      Object.entries(expectedControl).some(([k, v]) => c[k] !== v) || !token(c.epoch) || c.mode !== 'normal' ||
      c.previousEpoch !== null && (!token(c.previousEpoch) || c.previousEpoch === c.epoch)) block('control_context_unqualified', 'Contrôle réel lié à cette installation, compte Stripe et epoch normal');
  report.observations.push(`control_generation:${controlRead.generation};environment:${['test', 'live', 'unconfigured'].includes(c.financialEnvironment) ? c.financialEnvironment : 'unknown'}`);
  if (!sameKeys(c.businessAdmission, ['protocol', 'state', 'planId']) || c.businessAdmission.protocol !== 'business_admission_control_v1' ||
      c.businessAdmission.state !== 'open' || c.businessAdmission.planId !== null) block('business_admission_closed_or_unknown', 'Contrôle businessAdmission administré indépendamment');
  const pin = {object: env.FINANCIAL_RECOVERY_IDENTITY_POLICY_OBJECT, generation: env.FINANCIAL_RECOVERY_IDENTITY_POLICY_GENERATION,
    sha256: env.FINANCIAL_RECOVERY_IDENTITY_POLICY_SHA256};
  if (!validPin(pin, prefix)) block('identity_policy_pin_missing', 'FINANCIAL_RECOVERY_IDENTITY_POLICY_OBJECT/GENERATION/SHA256 : qualification v2 réelle, drainage et continuité');
  else {
    const policy = await safe('identity_policy_unavailable', pin.object, () => readObject(read, bucket, pin.object, pin));
    if (!policy || !identityPolicyQualifies(policy.value, c, env)) block('identity_policy_unqualified', 'Attestation indépendante v2 réelle et bornes Auth/continuité, sans générer de true.');
    else report.observations.push(`connect_boundary_ms:${policy.value.newAuthCreatedAfterMs};les identités antérieures nécessitent leur manifeste parent exact`);
  }
  if (c.reconciliationManifest !== null) {
    if (!validPin(c.reconciliationManifest, prefix)) block('recovery_manifest_pin_invalid', 'Manifeste natif génération/hash exacts');
    else await safe('recovery_manifest_unavailable', c.reconciliationManifest.object, async () => {
      const m = await readObject(read, bucket, c.reconciliationManifest.object, c.reconciliationManifest, 1024 * 1024);
      if (!m || !['financial_recovery_manifest_v1', 'financial_recovery_manifest_v2'].includes(m.value.protocol) ||
          Object.keys(expectedControl).filter(k => k !== 'protocol').some(k => m.value[k] !== c[k]) ||
          m.value.epoch !== c.epoch || m.value.previousEpoch !== c.previousEpoch) throw Error();
    });
  } else if (c.previousEpoch !== null) block('recovery_manifest_required', 'Restauration : manifeste indépendant existant ; jamais en fabriquer un vide.');
  // Policy Troubleshooter evaluates inherited IAM; a bucket policy alone does
  // not prove absence of project-level storage.admin. Unknown stays blocked.
  await Promise.all(report.runtimePrincipals.map(async principal => {
    const checks = [[controlObject, 'get', 'CAN_ACCESS'], [controlObject, 'create', 'CANNOT_ACCESS'],
      [controlObject, 'update', 'CANNOT_ACCESS'], [controlObject, 'delete', 'CANNOT_ACCESS'],
      [`${prefix}/manifests/preflight.json`, 'update', 'CANNOT_ACCESS'], [`${prefix}/manifests/preflight.json`, 'delete', 'CANNOT_ACCESS'],
      ...['permits/connect-identities/preflight/create.json', 'observations/preflight.json'].flatMap(suffix =>
        ['get', 'create', 'update', 'delete'].map(permission => [`${prefix}/${suffix}`, permission, ['get', 'create'].includes(permission) ? 'CAN_ACCESS' : 'CANNOT_ACCESS']))];
    await Promise.all(checks.map(([name, permission, expected]) => safe('runtime_iam_unverified', `${principal} storage.objects.${permission} ${name} attendu ${expected}`, async () => {
      // IAM v3 supplies the object context for resource.name conditions and
      // evaluates deny policies too. The bucket is the IAM policy resource.
      const r = await read('https://policytroubleshooter.googleapis.com/v3/iam:troubleshoot', {accessTuple: {principal,
        fullResourceName: `//storage.googleapis.com/projects/_/buckets/${bucket}`, permission: `storage.objects.${permission}`,
        conditionContext: {request: {receiveTime: new Date().toISOString()}, resource: {name: `projects/_/buckets/${bucket}/objects/${name}`,
          service: 'storage.googleapis.com', type: 'storage.googleapis.com/Object'}}}});
      const result = r && await r.json(); if (result?.overallAccessState !== expected) throw Error();
    })));
  }));
  report.observations.push('Préflight technique seulement : clés, comptes, webhooks, transporteurs, contrats de couverture et mentions fiscales doivent aussi être vérifiés réellement ; aucun paiement/achat d’étiquette exécuté.');
  return report;
}
async function runtimeTaxValidation(env) {
  // Existing pure production validator, after the normal functions build.
  const {qualifyDocumentedOperatorTax} = require('../functions/lib/config/operatorServiceTax');
  qualifyDocumentedOperatorTax(env.OPERATOR_SERVICE_TAX_POLICY_JSON, 'service_fee_only', Number(env.GST_RATE || '0.05'),
    Number(env.QST_RATE || '0.09975'), (env.TAX_ENABLED || 'false').toLowerCase() === 'true', {
      recipientUid: 'preflight-structure-only', source: 'shipping_destination', nativeSourceReference: 'preflight-structure-only',
      transport: 'native_carrier_total', address: {street: '1 Rue Exemple', city: 'Montréal', province: 'QC', postalCode: 'H2X 1Y4', country: 'CA'},
    });
}
if (require.main === module) {
  (async () => {
    const options = parseArgs(process.argv.slice(2)), env = readDeploymentEnvironment(targets[options.project].projectId);
    const report = await inspect({options, env, read: options.offline ? null : cloudReader(targets[options.project].projectId), validateTax: runtimeTaxValidation});
    process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
    if (options.preflight && report.blockers.length) process.exitCode = 1;
  })().catch(() => {console.error('Préflight interrompu : cible/options, authentification ou lecture non qualifiée. Aucun secret affiché ni changement effectué.'); process.exitCode = 1;});
}
module.exports = {parseArgs, readDeploymentEnvironment, declaredFunctionSecrets, inspectDeployedFunction, cloudReader, readObject, validPin, identityPolicyQualifies, inspect, targets, sharedDependencyNames};
