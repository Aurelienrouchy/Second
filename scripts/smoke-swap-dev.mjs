/** Real isolated Troc exercise, dormant unless all explicit gates are present.
 * node scripts/smoke-swap-dev.mjs --run --allow-admin-verification --deployed-ready [--check-topup]
 * Two NEW synthetic identities; normal Auth, consent, publication and callables.
 * Administrator Auth mutations ONLY verify email for identities created by THIS
 * run; optional payment preflight reads the Dev test secret into memory only.
 * No direct stock/status/ledger writes, no cleanup of evidence, no production,
 * Optional --check-topup uses only Stripe TEST and fresh synthetic Connect;
 * never a withdrawal, real payment, physical-phone or push-delivery claim.
 */
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { randomBytes, randomUUID } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { createInterface } from 'node:readline';
import { initializeApp, deleteApp } from 'firebase/app';
import { getAuth, setPersistence, inMemoryPersistence, createUserWithEmailAndPassword, updateProfile,
  getIdToken, reload, EmailAuthProvider, reauthenticateWithCredential } from 'firebase/auth';
import { getFirestore, doc, setDoc, updateDoc, serverTimestamp, getDocFromServer, getDocsFromServer, collection, query, where } from 'firebase/firestore';
import { getFunctions, httpsCallable } from 'firebase/functions';
import { getStorage, ref, uploadBytes, getDownloadURL } from 'firebase/storage';

const PROJECT = 'seconde-dev';
const config = JSON.parse(await readFile(new URL('../config/firebaseProjects.json', import.meta.url), 'utf8')).development;
assert.equal(config.projectId, PROJECT);
assert.equal(config.authDomain, `${PROJECT}.firebaseapp.com`);
assert.equal(config.storageBucket, `${PROJECT}.firebasestorage.app`);
for (const name of ['FIRESTORE_EMULATOR_HOST', 'FIREBASE_AUTH_EMULATOR_HOST', 'FIREBASE_STORAGE_EMULATOR_HOST', 'FUNCTIONS_EMULATOR']) {
  assert(!process.env[name], 'This probe targets the isolated Dev cloud only.');
}
assert(!process.env.EXPO_PUBLIC_APP_ENV || process.env.EXPO_PUBLIC_APP_ENV === 'development', 'Production is forbidden.');
const runGates = ['--run', '--allow-admin-verification', '--deployed-ready'];
const allowedArgs = new Set([...runGates, '--check-topup', '--pause-on-error']);
const checkTopUp = process.argv.includes('--check-topup');
const pauseOnError = process.argv.includes('--pause-on-error');
assert(process.argv.slice(2).every(value => allowedArgs.has(value)), 'Unknown runner option.');
if (!runGates.every(flag => process.argv.includes(flag))) {
  console.log('Prepared only. No cloud action. Run after coherent Dev deployment: node scripts/smoke-swap-dev.mjs --run --allow-admin-verification --deployed-ready [--check-topup]');
  process.exit(0);
}

const policy = JSON.parse(await readFile(new URL('../functions/src/shared/signupConsentPolicy.json', import.meta.url), 'utf8'));
const bytes = await readFile(new URL('../assets/images/favicon.png', import.meta.url));
assert(bytes.readUInt32BE(16) <= 1200 && bytes.readUInt32BE(20) <= 1200 && bytes.length > 0 && bytes.length < 10 * 1024 * 1024);
const runId = randomUUID().replaceAll('-', ''), startedAt = Date.now(), members = [], owned = new Set();
let adminToken, stripeSecret, recoveryInput, step = 'preflight';
const mark = (next, facts = {}) => { step = next; console.log(JSON.stringify({ at: new Date().toISOString(), project: PROJECT, runId, step, ...facts })); };
const time = value => value?.toMillis?.() ?? null;
const safeError = error => ({code: typeof error?.code === 'string' ? error.code.replace(/[^a-zA-Z0-9_/-]/g, '').slice(0, 80) : 'probe_failed',
  reason: typeof error?.details?.reason === 'string' && /^[a-zA-Z0-9_-]{1,100}$/.test(error.details.reason) ? error.details.reason : null,
  message: String(error?.message ?? 'Unknown error').replace(/https?:\/\/[^\s"'<>]+/gi, '[url]')
    .replace(/\b(?:sk_test_|sk_live_|rk_test_|rk_live_|ya29\.|eyJ|AIza)[A-Za-z0-9._-]+/g, '[credential]')
    .replace(/\bpi_[A-Za-z0-9]+_secret_[A-Za-z0-9]+/g, '[client_secret]').slice(0, 220)});

async function awaitRecoveryInstruction(context, choices) {
  if (!pauseOnError) return 'stop';
  recoveryInput ??= createInterface({input: process.stdin, terminal: false});
  console.log(JSON.stringify({project: PROJECT, runId, step, state: 'paused_with_sessions_in_memory', context, choices,
    instruction: 'Root must diagnose before entering an allowed instruction; no mutation is retried automatically.'}));
  return new Promise(resolve => {
    const onLine = value => {if (choices.includes(value.trim())) {clearTimeout(timer); recoveryInput.off('line', onLine); resolve(value.trim());}};
    const timer = setTimeout(() => {recoveryInput.off('line', onLine); resolve('stop');}, 15 * 60_000);
    recoveryInput.on('line', onLine);
  });
}

async function verifyOwnSyntheticEmail(member, email) {
  assert(owned.has(member.uid));
  if (!adminToken) {
    const result = spawnSync('gcloud', ['auth', 'print-access-token', '--project', PROJECT], {encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe']});
    assert.equal(result.status, 0, 'Dev email-verification credential unavailable.');
    adminToken = result.stdout.trim(); assert(adminToken);
  }
  const request = async (action, body) => {
    assert(['lookup', 'update'].includes(action));
    assert(owned.has(member.uid));
    const response = await fetch(`https://identitytoolkit.googleapis.com/v1/projects/${PROJECT}/accounts:${action}`, {
      method: 'POST', headers: {Authorization: `Bearer ${adminToken}`, 'Content-Type': 'application/json', 'x-goog-user-project': PROJECT},
      body: JSON.stringify(body), signal: AbortSignal.timeout(20_000),
    });
    assert(response.ok, `Synthetic email verification failed (${response.status}).`);
    return response.json();
  };
  const native = (await request('lookup', {localId: [member.uid]})).users?.find(value => value.localId === member.uid && value.email === email);
  assert(native && Number(native.createdAt) >= startedAt, 'Only this run’s fresh identities may be verified.');
  await request('update', {localId: member.uid, emailVerified: true});
  await reload(member.auth.currentUser); await getIdToken(member.auth.currentUser, true);
  assert.equal(member.auth.currentUser.emailVerified, true);
}

async function createMember(role) {
  mark('signup', {role});
  const app = initializeApp(config, `swap-${role}-${runId}`), auth = getAuth(app);
  const member = {app, auth, db: getFirestore(app), functions: getFunctions(app, 'northamerica-northeast1'), storage: getStorage(app), uid: null,
    name: `Test Troc ${role.toUpperCase()}`};
  members.push(member); await setPersistence(auth, inMemoryPersistence);
  const email = `swap-${role}-${runId}@seconde-smoke.test`, password = `${randomBytes(30).toString('base64url')}aA1!`;
  const {user} = await createUserWithEmailAndPassword(auth, email, password);
  member.uid = user.uid; owned.add(user.uid);
  member.reauthenticate = async () => {
    await reauthenticateWithCredential(user, EmailAuthProvider.credential(email, password)); await getIdToken(user, true);
  };
  member.call = async (name, data = {}, options = {}) => {
    for (let attempt = 0; ; attempt++) {
      try {return (await httpsCallable(member.functions, name, {timeout: 90_000})(data)).data;}
      catch (error) {
        if (options.expectedRejection === true) throw error;
        console.error(JSON.stringify({project: PROJECT, runId, step, callable: name, ...safeError(error)}));
        const financialCommand = name === 'createSwapTopUpCheckout' && data.mode === 'execute';
        const readOnly = name === 'getMyEligibility' || name === 'getStripeAccountStatus' || name === 'getWalletInfo' ||
          name === 'updateArticle' && data.mode === 'inventory_unit' || name === 'createSwapTopUpCheckout' && ['preview', 'observe'].includes(data.mode);
        // Unknown mutations are never automatically repeated. Exact financial
        // operations may recover only through their existing GET-only journal.
        const refused = ['functions/invalid-argument', 'functions/failed-precondition', 'functions/permission-denied', 'functions/aborted'].includes(error?.code);
        const connectCreation = name === 'createStripeConnectAccount';
        const choices = ['stop', ...(financialCommand ? ['observe'] : !connectCreation && (readOnly || refused) ? ['retry'] : [])];
        if (attempt >= 2) throw error;
        const instruction = await awaitRecoveryInstruction({callable: name, code: error?.code ?? 'unknown'}, choices);
        if (instruction === 'observe') return member.call(name, {...data, mode: 'observe'});
        if (instruction !== 'retry') throw error;
      }
    }
  };
  await updateProfile(user, {displayName: member.name});
  await setDoc(doc(member.db, 'users', user.uid), {id: user.uid, email, displayName: member.name, createdAt: serverTimestamp(), isActive: true, authProvider: 'email'});
  const initial = await member.call('getMyEligibility');
  const consent = await member.call('recordSignupConsent', {dateOfBirth: '1990-04-12', acceptedTerms: true, acceptedPrivacy: true,
    marketingOptIn: false, desiredUsername: `sw${role}${runId.slice(0, 13)}`, policyVersion: policy.version,
    sellerActivityDeclaration: {kind: 'personal', statementVersion: initial.statementVersion, personalDeclarationAccepted: true,
      expectedVersion: initial.version, requestId: `signup_${role}_${runId}`, expectedUid: user.uid}});
  assert.equal(consent.ok, true); await verifyOwnSyntheticEmail(member, email);
  const mine = await member.call('getMyEligibility');
  assert.equal(typeof mine.quebecResidenceStatementVersion, 'string');
  const declared = await member.call('declareSellerActivity', {kind: 'personal', statementVersion: mine.statementVersion,
    personalDeclarationAccepted: true, expectedVersion: mine.version, requestId: `qc_${role}_${runId}`, expectedUid: user.uid,
    quebecResidenceDeclaration: {version: mine.quebecResidenceStatementVersion, country: 'CA', province: 'QC', accepted: true}});
  assert.equal(declared.recorded, true);
  assert.equal((await member.call('getMyEligibility')).swapLaunch.allowed, true);
  const object = ref(member.storage, `drafts/${user.uid}/swap-${runId}/fixture.png`);
  await uploadBytes(object, new Uint8Array(bytes), {contentType: 'image/png'});
  member.imageUrl = await getDownloadURL(object);
  assert(new URL(member.imageUrl).pathname.includes(`/b/${config.storageBucket}/`));
  mark('member-ready', {role, uid: member.uid, synthetic: true});
  return member;
}

async function read(member, collectionName, id) {
  const snapshot = await getDocFromServer(doc(member.db, collectionName, id));
  assert(snapshot.exists(), `Expected ${collectionName} document missing.`); return snapshot.data();
}
async function listing(member, name) {
  mark('publish-fixture', {name, ownerUid: member.uid});
  const input = {clientRequestId: `swap_${name}_${runId}`, title: `TEST DEV TROC ${name} ${runId.slice(0, 8)}`,
    description: 'Fixture synthétique Seconde Dev. Pictogramme technique, aucun vêtement réel et aucun envoi réel.',
    price: 12, quantity: 1, stock: 1, images: [{url: member.imageUrl}], category: 'T-shirts',
    categoryIds: ['women', 'women_clothing', 'women_clothing_tops', 'women_clothing_tops_tshirts'],
    condition: 'très bon état', brand: null, size: {value: 'M', system: 'EU'}, isHandDelivery: true, isShipping: false,
    neighborhoods: [{id: 'downtown', name: 'Centre-ville', borough: 'Ville-Marie'}]};
  const publication = await member.call('createArticle', input);
  assert.equal(typeof publication.articleId, 'string');
  const article = await read(member, 'articles', publication.articleId);
  assert.equal(article.sellerId, member.uid); assert.equal(article.isActive, true); assert.notEqual(article.isSold, true);
  const depositInput = {expectedUid: member.uid, partyId: 'generalist', articleId: publication.articleId,
    title: input.title, price: input.price, imageUrl: member.imageUrl, userName: member.name};
  const deposited = await member.call('addItemToPartySecure', depositInput);
  assert.equal(deposited.success, true); assert.equal(typeof deposited.itemId, 'string');
  assert.equal((await member.call('addItemToPartySecure', depositInput)).itemId, deposited.itemId);
  const ownRows = await getDocsFromServer(query(collection(member.db, 'swapPartyItems'), where('partyId', '==', 'generalist'),
    where('articleId', '==', publication.articleId)));
  assert.equal(ownRows.size, 1, 'Repeated deposit must not duplicate the catalogue row.');
  mark('listing-deposited', {articleId: publication.articleId, itemId: deposited.itemId});
  return {member, articleId: publication.articleId, itemId: deposited.itemId, title: article.title, price: article.price};
}
async function propose(a, b, own, other, mode, suffix, cashTopUp = null) {
  const input = {operation: 'swap_proposal_preview', expectedUid: a.uid, receiverId: b.uid,
    initiatorArticleIds: [own.articleId], receiverArticleIds: [other.articleId], exchangeMode: mode,
    arrangements: mode === 'shipping' ? 'Envoi postal synthétique organisé entre les deux membres au Québec. Aucun colis réel.' : 'Rencontre synthétique à Montréal. Aucun rendez-vous réel.',
    message: 'Recette Troc Dev isolée. Aucun bien réel.', ...(cashTopUp ? {cashTopUp} : {})};
  const preview = (await a.call('getMyEligibility', input)).swapProposalPreview;
  assert.equal(preview.protocol, 'swap_exchange_agreement_v1'); assert.match(preview.sourceHash, /^[a-f0-9]{64}$/);
  assert.equal(preview.initiatorId, a.uid); assert.equal(preview.receiverId, b.uid);
  const payload = {expectedUid: a.uid, initiatorId: a.uid, initiatorName: a.name, receiverId: b.uid, receiverName: b.name,
    initiatorItems: [{articleId: own.articleId, title: own.title, price: own.price}], receiverItems: [{articleId: other.articleId, title: other.title, price: other.price}],
    partyId: 'generalist', exchangeMode: mode, arrangements: input.arrangements, message: input.message,
    ...(cashTopUp ? {cashTopUp} : {}),
    agreementProtocol: preview.protocol, expectedSourceHash: preview.sourceHash, clientRequestId: `${suffix}_${runId}`};
  const result = await a.call('proposeMultiSwap', payload); assert.equal(result.success, true);
  const again = await a.call('proposeMultiSwap', payload); assert.equal(again.swapId, result.swapId);
  const swap = await read(a, 'swaps', result.swapId);
  assert.equal(swap.status, 'proposed'); assert.equal(swap.inventoryReservationStage, 'on_acceptance_v1');
  assert(!Object.hasOwn(swap, 'inventoryUnitCommitments')); assert(!swap.acceptedAt);
  const ack = {swapId: result.swapId, expectedUid: b.uid, agreementProtocol: preview.protocol, expectedSourceHash: preview.sourceHash};
  return {id: result.swapId, a, b, own, other, payload, ack, mode};
}
const action = (member, name, swap, extra = {}, options = {}) => member.call(name, {swapId: swap.id, expectedUid: member.uid, ...extra}, options);
async function assertArticleState(item, expected) {
  const article = await read(item.member, 'articles', item.articleId);
  const native = await item.member.call('updateArticle', {mode: 'inventory_unit', articleId: item.articleId, expectedUid: item.member.uid});
  assert.equal(native.protocol, 'article_inventory_unit_view_v1'); assert.equal(native.qualification, 'native_current');
  assert.equal(native.articleId, item.articleId); assert.equal(native.availability, expected);
  assert.equal(article.isSold, expected !== 'available');
  return article;
}
async function assertPartyState(item, pending, swapped) {
  const row = await read(item.member, 'swapPartyItems', item.itemId);
  assert.equal(row.isPending, pending); assert.equal(row.isSwapped, swapped);
}
async function notice(member, swap, status, progressField, recoveryCount = 0) {
  for (let attempt = 0; attempt < 24; attempt++) {
    const snapshot = await getDocsFromServer(query(collection(member.db, 'notifications'), where('userId', '==', member.uid)));
    const found = snapshot.docs.map(row => row.data()).filter(row => row.type === 'swap_update' && row.data?.swapId === swap.id &&
      (status === undefined || row.data.status === status) && (progressField === undefined || row.data.progressField === progressField));
    if (found.length) { mark('native-notification-confirmed', {swapId: swap.id, recipientUid: member.uid, status: status ?? null,
      progressField: progressField ?? null, count: found.length, physicalPushConfirmed: false}); return; }
    if (attempt < 23) await new Promise(resolve => setTimeout(resolve, 1_000));
  }
  if (recoveryCount < 2 && await awaitRecoveryInstruction({kind: 'missing_native_notice', swapId: swap.id, recipientUid: member.uid, status: status ?? null,
    progressField: progressField ?? null}, ['retry', 'stop']) === 'retry') return notice(member, swap, status, progressField, recoveryCount + 1);
  throw Object.assign(new Error('Expected native Troc notice absent.'), {code: 'notice_missing'});
}
async function review(member, swap) {
  const payload = {score: 5, comment: 'Recette synthétique Dev, aucun échange réel.'};
  const result = await action(member, 'rateSwap', swap, payload); assert.equal(result.success, true); assert.equal(result.notificationCommitted, true);
  assert.equal((await action(member, 'rateSwap', swap, payload)).notificationCommitted, true);
  const rating = await read(member, 'avis', `${member.uid}_swap_${swap.id}`);
  assert.equal(rating.transactionId, swap.id); assert.equal(rating.note, 5); assert.equal(rating.transactionType, 'swap');
  mark('review-and-exact-replay-confirmed', {swapId: swap.id, reviewerUid: member.uid});
}
async function accept(swap) {
  const expectedStatus = swap.mode === 'shipping' ? 'photos_pending' : 'accepted';
  const result = await swap.b.call('acceptSwap', swap.ack); assert.equal(result.status, expectedStatus); assert.equal(result.replay, false);
  const first = await read(swap.a, 'swaps', swap.id), stamp = time(first.acceptedAt); assert(stamp);
  assert.equal(first.status, expectedStatus);
  const replay = await swap.b.call('acceptSwap', swap.ack); assert.equal(replay.replay, true); assert.equal(replay.status, expectedStatus);
  assert.equal(time((await read(swap.a, 'swaps', swap.id)).acceptedAt), stamp);
  await assertArticleState(swap.own, 'engaged'); await assertArticleState(swap.other, 'engaged');
  return first;
}

async function poll(readCurrent, accepts, message, attempts = 30, delay = 1500) {
  for (let attempt = 0; attempt < attempts; attempt++) {
    const value = await readCurrent(); if (accepts(value)) return value;
    if (attempt < attempts - 1) await new Promise(resolve => setTimeout(resolve, delay));
  }
  throw Object.assign(new Error(message), {code: 'probe_wait_incomplete'});
}
async function sourceVersion(path, constant) {
  const source = await readFile(new URL(path, import.meta.url), 'utf8');
  const value = source.match(new RegExp(`export const ${constant} = '([^']+)'`));
  assert(value, `Missing ${constant} contract.`); return value[1];
}
async function stripeRequest(path, fields, requestId) {
  assert(checkTopUp && /^sk_test_[A-Za-z0-9]+$/.test(stripeSecret ?? ''), 'Only optional Stripe TEST is allowed.');
  assert(path === '/account' && !fields || path === '/payment_methods' && fields || /^\/payment_intents\/pi_[A-Za-z0-9]+$/.test(path) && !fields,
    'Only platform/intent GET and official test-card tokenization are allowed; never provider confirm/refund/payout.');
  const response = await fetch(`https://api.stripe.com/v1${path}`, {method: fields ? 'POST' : 'GET',
    headers: {Authorization: `Bearer ${stripeSecret}`, 'Stripe-Version': '2026-04-22.dahlia',
      ...(fields ? {'Content-Type': 'application/x-www-form-urlencoded'} : {}), ...(requestId ? {'Idempotency-Key': requestId} : {})},
    ...(fields ? {body: new URLSearchParams(fields)} : {}), signal: AbortSignal.timeout(25_000)});
  const data = await response.json().catch(() => null);
  if (!response.ok) throw Object.assign(new Error('Stripe TEST read/tokenization failed.'), {code: `stripe_http_${response.status}`,
    details: {reason: data?.error?.code ?? data?.error?.type ?? 'provider_error'}});
  return data;
}
async function exerciseTopUp(a, b) {
  mark('topup-test-platform-preflight', {realPayment: false});
  assert(owned.has(a.uid) && owned.has(b.uid) && adminToken);
  const secretResponse = await fetch(`https://secretmanager.googleapis.com/v1/projects/${PROJECT}/secrets/STRIPE_SECRET_KEY/versions/latest:access`, {
    headers: {Authorization: `Bearer ${adminToken}`, 'x-goog-user-project': PROJECT}, signal: AbortSignal.timeout(20_000)});
  assert(secretResponse.ok, 'Dev Stripe TEST secret unavailable.');
  const secret = await secretResponse.json(); stripeSecret = Buffer.from(secret.payload.data, 'base64').toString('utf8').trim();
  const platform = await stripeRequest('/account'); assert.equal(platform.id, 'acct_1UUxsw0kghMArvqh');
  const connectConsentVersion = await sourceVersion('../functions/src/shared/connectConsent.ts', 'CONNECT_CONSENT_PRESENTATION_VERSION');
  const bankConsentVersion = await sourceVersion('../functions/src/shared/bankConsent.ts', 'BANK_OWNERSHIP_STATEMENT_VERSION');
  await b.reauthenticate();
  const connect = await b.call('createStripeConnectAccount', {expectedUid: b.uid, firstName: 'Jean', lastName: 'Test',
    dob: {year: 1990, month: 4, day: 12}, address: {line1: 'address_full_match', city: 'Montréal', province: 'QC', postalCode: 'H2X1Y4'},
    transitNumber: '11000', institutionNumber: '000', accountNumber: '000123456789', accountHolderName: 'Jean Test',
    bankOwnershipAccepted: true, bankOwnershipStatementVersion: bankConsentVersion,
    paymentAccountConsent: {accepted: true, presentationVersion: connectConsentVersion}, useTestIdentity: true});
  assert.match(connect.stripeAccountId, /^acct_[A-Za-z0-9]+$/);
  await poll(async () => {
    try {return await b.call('getStripeAccountStatus', {expectedUid: b.uid}, {expectedRejection: true});}
    catch (error) {if (error.code === 'functions/aborted' && error.details?.reason === 'connect_observation_stale') return null; throw error;}
  }, value => value?.success === true && value.hasAccount === true && value.status === 'active' && value.chargesEnabled === true &&
    value.payoutsEnabled === true && value.payoutEligible === true && !value.disabledReason && !value.bankDeclarationRequired &&
    !value.connectActionRequired && !value.connectOperationState && value.requirementsCurrentlyDue?.length === 0 &&
    value.requirementsPastDue?.length === 0 && value.verificationErrors?.length === 0 && value.requirementsPendingVerification?.length === 0,
  'Fresh synthetic Connect TEST account did not become active.', 30, 5000);
  assert.equal((await read(b, 'users', b.uid)).stripeAccountId, connect.stripeAccountId);
  await b.call('activateWallet');
  const beforeWallet = await b.call('getWalletInfo', {expectedUid: b.uid});
  assert.equal(beforeWallet.pendingBalance, 0); assert.equal(beforeWallet.heldBalance, 0); assert.equal(beforeWallet.balance, 0);
  const physical = {street: '200 Rue de Test', city: 'Montréal', province: 'QC', postalCode: 'H2X1Y5', country: 'CA'};
  const addressHash = (await import('node:crypto')).createHash('sha256').update(JSON.stringify({street: physical.street, line2: null,
    city: physical.city, province: physical.province, postalCode: physical.postalCode, country: physical.country})).digest('hex');
  await updateDoc(doc(a.db, 'users', a.uid), {addresses: [{name: a.name, ...physical, isDefault: true,
    shippingUseDeclaration: {schemaVersion: 1, policyVersion: 'ordinary_address_2026_01', kind: 'ordinary_residential', accepted: true, addressHash}}], updatedAt: serverTimestamp()});
  const swap = await propose(a, b, await listing(a, 'topupA'), await listing(b, 'topupB'), 'shipping', 'topup', {amount: 500, payerId: a.uid});
  const accepted = await b.call('acceptSwap', swap.ack); assert.equal(accepted.status, 'payment_pending'); assert.equal(accepted.requiresPayment, true);
  const call = payload => a.call('createSwapTopUpCheckout', {capability: 'swap_topup_manual_v1', expectedUid: a.uid, swapId: swap.id, ...payload});
  const preview = () => call({mode: 'preview', scope: 'own'});
  await a.reauthenticate();
  const first = await preview();
  assert.equal(first.protocol, 'swap_topup_preview_v1'); assert.equal(first.manualEnabled, true); assert.equal(first.preparation.canPrepareNow, true);
  assert.equal(first.amounts.baseCents, 500); assert.equal(first.amounts.currency, 'CAD'); assert.equal(first.payment, null);
  const prepare = {action: 'prepare', scope: 'own', sourceHash: first.sourceHash, intentId: null, intentVersion: null,
    paymentIntentId: null, paymentMethodId: null, totalCents: first.amounts.totalCents, relationshipReference: null, acknowledged: true};
  const prepareRequestId = `prepare_${runId}`;
  const prepared = await call({mode: 'execute', requestId: prepareRequestId, command: prepare});
  assert.equal(prepared.state, 'received'); assert.equal(prepared.result.financialSettlementVerified, false);
  const preparedReplay = await call({mode: 'observe', requestId: prepareRequestId, command: prepare});
  assert.equal(preparedReplay.state, 'received'); assert.equal(preparedReplay.result.paymentIntentId, prepared.result.paymentIntentId);
  const current = await preview(), payment = current.payment;
  assert.equal(payment.providerStatus, 'requires_payment_method'); assert.equal(payment.confirmationMethod, 'manual');
  assert.equal(payment.action, 'confirmOnServer'); assert.equal(payment.settlementReceiptVerified, false);
  const paymentMethod = await stripeRequest('/payment_methods', {type: 'card', 'card[token]': 'tok_visa',
    'metadata[secondeDevSmokeRun]': runId, 'metadata[swapId]': swap.id}, `swap_${runId}_method`);
  assert.equal(paymentMethod.livemode, false); assert.match(paymentMethod.id, /^pm_[A-Za-z0-9]+$/);
  const confirm = {action: 'confirm', scope: 'own', sourceHash: current.sourceHash, intentId: payment.intentId,
    intentVersion: payment.intentVersion, paymentIntentId: payment.paymentIntentId, paymentMethodId: paymentMethod.id,
    totalCents: payment.amounts.totalCents, relationshipReference: null, acknowledged: true};
  const confirmRequestId = `confirm_${runId}`;
  const confirmed = await call({mode: 'execute', requestId: confirmRequestId, command: confirm});
  assert.equal(confirmed.state, 'received'); assert.equal(confirmed.result.paymentIntentId, payment.paymentIntentId);
  assert.equal(confirmed.result.providerStatus, 'succeeded'); assert.equal(confirmed.result.financialSettlementVerified, false);
  const confirmedReplay = await call({mode: 'observe', requestId: confirmRequestId, command: confirm});
  assert.equal(confirmedReplay.result.paymentIntentId, payment.paymentIntentId);
  const settled = await poll(preview, value => value.payment?.settlementReceiptVerified === true,
    'Provider success has not yet been attributed by the native webhook.', 40, 1500);
  assert.equal(settled.payment.paymentIntentId, payment.paymentIntentId); assert.equal(settled.payment.providerStatus, 'succeeded');
  const swapAfter = await read(a, 'swaps', swap.id);
  assert.equal(swapAfter.status, 'photos_pending'); assert(time(swapAfter.topUpPaidAt));
  assert.equal(swapAfter.topUpPaymentIntentId, payment.paymentIntentId); assert.equal(swapAfter.cashTopUp.amount, 500);
  const provider = await stripeRequest(`/payment_intents/${payment.paymentIntentId}`);
  assert.equal(provider.livemode, false); assert.equal(provider.status, 'succeeded'); assert.equal(provider.amount, first.amounts.totalCents);
  assert.equal(provider.amount_received, first.amounts.totalCents); assert.equal(provider.amount_capturable, 0);
  assert.equal(provider.metadata.swapId, swap.id); assert.equal(provider.metadata.payerId, a.uid); assert.equal(provider.metadata.payeeId, b.uid);
  assert.equal(provider.confirmation_method, 'manual'); assert.equal(typeof provider.latest_charge, 'string');
  const ledger = await getDocsFromServer(query(collection(b.db, 'wallets', b.uid, 'ledger'), where('swapId', '==', swap.id)));
  const credits = ledger.docs.map(value => value.data()).filter(value => value.type === 'sale_credit');
  assert.equal(credits.length, 1); assert.equal(credits[0].amount, 500); assert.equal(credits[0].currency, 'CAD');
  assert.equal(credits[0].paymentIntentId, payment.paymentIntentId);
  const afterWallet = await b.call('getWalletInfo', {expectedUid: b.uid});
  assert.equal(afterWallet.pendingBalance, 500); assert.equal(afterWallet.balance, 0); assert.equal(afterWallet.heldBalance, 0);
  await call({mode: 'observe', requestId: prepareRequestId, command: prepare});
  await call({mode: 'observe', requestId: confirmRequestId, command: confirm});
  assert.equal((await b.call('getWalletInfo', {expectedUid: b.uid})).pendingBalance, 500);
  await notice(a, swap, 'photos_pending'); await notice(b, swap, 'photos_pending');
  mark('topup-test-payment-qualified', {swapId: swap.id, chargedCents: first.amounts.totalCents, payeePendingCents: 500,
    creditCount: credits.length, originalIntentOnly: true, realPayment: false, withdrawalExecuted: false});
  return swap.id;
}

async function finishPaidTopUp(swapId, a, b) {
  const source = await read(a, 'swaps', swapId);
  assert.equal(source.initiatorId, a.uid); assert.equal(source.receiverId, b.uid);
  assert.equal(source.status, 'photos_pending'); assert.equal(source.cashTopUp.amount, 500); assert(time(source.topUpPaidAt));
  const swap = {id: swapId};
  for (const member of [a, b]) {
    const object = ref(member.storage, `swaps/${swapId}/photos/${member.uid}/${runId}_topup.png`);
    await uploadBytes(object, new Uint8Array(bytes), {contentType: 'image/png'});
    const photoUrls = [await getDownloadURL(object)];
    await action(member, 'uploadSwapPhotos', swap, {photoUrls});
  }
  await action(a, 'confirmSwapShipping', swap); await action(b, 'confirmSwapShipping', swap);
  await action(a, 'confirmSwapReception', swap); await action(b, 'confirmSwapReception', swap);
  const completed = await read(a, 'swaps', swapId);
  assert.equal(completed.status, 'completed'); assert(time(completed.topUpFundsHeldAt));
  assert.equal(time(completed.topUpFundsReleaseAt) - time(completed.topUpFundsHeldAt), 7 * 24 * 60 * 60_000);
  assert(!completed.topUpReleasedAt);
  await action(a, 'confirmSwapReception', swap); await action(b, 'confirmSwapReception', swap);
  assert.equal(time((await read(a, 'swaps', swapId)).completedAt), time(completed.completedAt));
  const wallet = await b.call('getWalletInfo', {expectedUid: b.uid});
  assert.equal(wallet.pendingBalance, 0); assert.equal(wallet.heldBalance, 500); assert.equal(wallet.balance, 0);
  const ledger = await getDocsFromServer(query(collection(b.db, 'wallets', b.uid, 'ledger'), where('swapId', '==', swapId)));
  const entries = ledger.docs.map(value => value.data());
  assert.equal(entries.length, 2);
  for (const type of ['sale_credit', 'funds_held']) {
    const rows = entries.filter(value => value.type === type); assert.equal(rows.length, 1); assert.equal(rows[0].amount, 500);
    assert.equal(rows[0].paymentIntentId, source.topUpPaymentIntentId); assert.equal(rows[0].currency, 'CAD');
  }
  await notice(a, swap, 'completed'); await notice(b, swap, 'completed');
  mark('paid-topup-double-reception-and-hold-confirmed', {swapId, pendingCents: 0, heldCents: 500, availableCents: 0,
    saleCreditCount: 1, holdCount: 1, releaseSimulated: false, sameReceiptDates: true});
}

try {
  mark('isolated-run-start', {payments: checkTopUp ? 'Stripe_TEST_optional' : false,
    adminScope: checkTopUp ? 'verify_this_runs_synthetic_emails_and_read_dev_test_secret' : 'verify_this_runs_synthetic_emails_only'});
  const a = await createMember('a'), b = await createMember('b');
  assert.equal((await a.call('ensureGeneralistZone')).id, 'generalist');
  const shared = await listing(a, 'shared'), alternatives = [];
  for (const suffix of ['candidate1', 'candidate2', 'candidate3']) alternatives.push(await listing(b, suffix));
  const candidates = [];
  for (let i = 0; i < 3; i++) candidates.push(await propose(a, b, shared, alternatives[i], 'hand_delivery', `competition${i}`));
  await assertArticleState(shared, 'available'); await assertPartyState(shared, false, false);
  for (const item of alternatives) { await assertArticleState(item, 'available'); await assertPartyState(item, false, false); }
  mark('three-proposals-nonexclusive', {swapIds: candidates.map(value => value.id), stockReserved: false});
  await notice(b, candidates[0], 'proposed');
  const competing = await Promise.allSettled(candidates.slice(0, 2).map(swap => b.call('acceptSwap', swap.ack, {expectedRejection: true})));
  assert.equal(competing.filter(value => value.status === 'fulfilled').length, 1, 'Exactly one overlapping acceptance must win.');
  const winnerIndex = competing.findIndex(value => value.status === 'fulfilled'), loserIndex = 1 - winnerIndex;
  const winner = candidates[winnerIndex], loser = candidates[loserIndex], untouched = candidates[2];
  assert.equal(competing[winnerIndex].value.status, 'accepted');
  assert(['functions/failed-precondition', 'functions/aborted'].includes(competing[loserIndex].reason?.code));
  const before = await read(a, 'swaps', winner.id); assert.equal(before.inventoryUnitCommitments.length, 2);
  assert.equal((await b.call('acceptSwap', winner.ack)).replay, true);
  assert.equal(time((await read(a, 'swaps', winner.id)).acceptedAt), time(before.acceptedAt));
  await action(b, 'declineSwap', loser); await action(b, 'declineSwap', loser);
  await action(a, 'cancelSwap', untouched); await action(a, 'cancelSwap', untouched);
  assert.equal((await read(a, 'swaps', loser.id)).status, 'declined');
  assert.equal((await read(a, 'swaps', untouched.id)).status, 'cancelled');
  await assertArticleState(shared, 'engaged'); await assertArticleState(winner.other, 'engaged');
  await assertPartyState(shared, true, false); await assertPartyState(winner.other, true, false);
  await assertArticleState(loser.other, 'available'); await assertArticleState(untouched.other, 'available');
  mark('atomic-acceptance-and-unrelated-release-protection', {winnerSwapId: winner.id, declinedSwapId: loser.id, cancelledSwapId: untouched.id});
  await notice(a, winner, 'accepted'); await notice(b, winner, 'accepted');
  await assert.rejects(action(a, 'confirmSwapShipping', winner, {}, {expectedRejection: true}), error => error.code === 'functions/failed-precondition');
  await action(a, 'confirmSwapReception', winner);
  const partialMeetup = await read(a, 'swaps', winner.id); assert.equal(partialMeetup.status, 'accepted'); assert(time(partialMeetup.initiatorReceivedAt));
  await action(a, 'confirmSwapReception', winner);
  assert.equal(time((await read(a, 'swaps', winner.id)).initiatorReceivedAt), time(partialMeetup.initiatorReceivedAt));
  await action(b, 'confirmSwapReception', winner);
  const completedMeetup = await read(a, 'swaps', winner.id); assert.equal(completedMeetup.status, 'completed');
  await action(b, 'confirmSwapReception', winner);
  assert.equal(time((await read(a, 'swaps', winner.id)).completedAt), time(completedMeetup.completedAt));
  await assertArticleState(shared, 'consumed'); await assertArticleState(winner.other, 'consumed');
  await assertPartyState(shared, false, true); await assertPartyState(winner.other, false, true);
  assert.equal((await a.call('proposeMultiSwap', winner.payload)).swapId, winner.id, 'Exact proposal replay must recover even after completion.');
  await notice(a, winner, 'completed'); await notice(b, winner, 'completed');
  await review(a, winner); await review(b, winner);
  mark('meetup-complete-without-photo-or-postal-step', {swapId: winner.id});

  const postal = await propose(a, b, await listing(a, 'postalA'), await listing(b, 'postalB'), 'shipping', 'postal');
  await accept(postal);
  await assert.rejects(action(a, 'confirmSwapReception', postal, {}, {expectedRejection: true}), error => error.code === 'functions/failed-precondition');
  assert.equal((await read(a, 'swaps', postal.id)).status, 'photos_pending', 'Accepted postal Troc must open photo preparation directly.');
  await notice(a, postal, 'photos_pending'); await notice(b, postal, 'photos_pending');
  for (const member of [a, b]) {
    const object = ref(member.storage, `swaps/${postal.id}/photos/${member.uid}/${runId}.png`);
    await uploadBytes(object, new Uint8Array(bytes), {contentType: 'image/png'});
    const photoUrls = [await getDownloadURL(object)];
    await action(member, 'uploadSwapPhotos', postal, {photoUrls});
    const first = await read(member, 'swaps', postal.id), field = member === a ? 'initiatorPhotos' : 'receiverPhotos';
    await action(member, 'uploadSwapPhotos', postal, {photoUrls});
    assert.equal(time((await read(member, 'swaps', postal.id))[field].uploadedAt), time(first[field].uploadedAt));
  }
  assert.equal((await read(a, 'swaps', postal.id)).status, 'shipping');
  await assert.rejects(action(b, 'confirmSwapReception', postal, {}, {expectedRejection: true}), error => error.code === 'functions/failed-precondition');
  await action(a, 'confirmSwapShipping', postal);
  const firstSend = await read(a, 'swaps', postal.id); await action(a, 'confirmSwapShipping', postal);
  assert.equal(time((await read(a, 'swaps', postal.id)).initiatorShippedAt), time(firstSend.initiatorShippedAt));
  await notice(b, postal, 'shipping', 'initiatorShippedAt');
  await action(b, 'confirmSwapReception', postal);
  const asymmetric = await read(b, 'swaps', postal.id);
  assert.equal(asymmetric.status, 'shipping'); assert(time(asymmetric.receiverReceivedAt)); assert(!asymmetric.receiverShippedAt);
  await action(b, 'confirmSwapReception', postal);
  assert.equal(time((await read(b, 'swaps', postal.id)).receiverReceivedAt), time(asymmetric.receiverReceivedAt));
  await action(b, 'confirmSwapShipping', postal); await action(a, 'confirmSwapReception', postal);
  const finished = await read(a, 'swaps', postal.id); assert.equal(finished.status, 'completed');
  await action(a, 'confirmSwapReception', postal); await action(b, 'confirmSwapShipping', postal);
  assert.equal(time((await read(a, 'swaps', postal.id)).completedAt), time(finished.completedAt));
  await assertArticleState(postal.own, 'consumed'); await assertArticleState(postal.other, 'consumed');
  await notice(a, postal, 'completed'); await notice(b, postal, 'completed');
  await review(a, postal); await review(b, postal);
  mark('postal-asymmetric-reception-and-exact-replays-complete', {swapId: postal.id, carrierEvidenceInvented: false});

  const topUpSwapId = checkTopUp ? await exerciseTopUp(a, b) : null;
  if (topUpSwapId) await finishPaidTopUp(topUpSwapId, a, b);
  const problem = await propose(a, b, await listing(a, 'problemA'), await listing(b, 'problemB'), 'hand_delivery', 'problem');
  await accept(problem);
  await action(a, 'openSwapDispute', problem, {reason: 'Recette Dev : vérifier le signalement avant rencontre, aucun problème réel.'});
  const disputed = await read(a, 'swaps', problem.id); assert.equal(disputed.status, 'disputed'); assert.equal(disputed.statusBeforeDispute, 'accepted');
  await assertArticleState(problem.own, 'engaged'); await assertArticleState(problem.other, 'engaged');
  await assert.rejects(action(a, 'confirmSwapReception', problem, {}, {expectedRejection: true}), error => error.code === 'functions/failed-precondition');
  await notice(a, problem, 'disputed'); await notice(b, problem, 'disputed');
  const removable = await listing(a, 'withdraw');
  await a.call('removeItemFromPartySecure', {partyId: 'generalist', articleId: removable.articleId, expectedUid: a.uid});
  assert.equal((await getDocFromServer(doc(a.db, 'swapPartyItems', removable.itemId))).exists(), false);
  await assertArticleState(removable, 'available');
  mark('recipe-complete', {meetupSwapId: winner.id, postalSwapId: postal.id, disputedSwapId: problem.id,
    syntheticMembers: members.map(value => value.uid), topUpPaymentValidated: topUpSwapId !== null, topUpSwapId,
    ...(!checkTopUp ? {topUpLimit: 'Optional --check-topup was not selected; no complement payment is claimed.'} : {}),
    physicalPushConfirmed: false, deletedEvidence: false});
} catch (error) {
  console.error(JSON.stringify({project: PROJECT, runId, step, ...safeError(error), tracesPreserved: true})); process.exitCode = 1;
} finally {
  await Promise.all(members.map(member => deleteApp(member.app).catch(() => undefined)));
  recoveryInput?.close();
  adminToken = undefined; stripeSecret = undefined;
}
