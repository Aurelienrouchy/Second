/** Isolated, real-provider TEST commerce exercise. Never runs without --run.
 * node scripts/smoke-commerce-dev.mjs --run --allow-admin-verification [--withdraw] [--offer=accept|counter] [--check-meetup] [--check-return|--cancel-paid]
 * Optional: --until=signup|publish|connect|quote|payment|complete (default complete).
 * --card-scenario=declined|3ds requires --until=payment; 3DS is NOT completed
 * by this script, and its uncharged order is explicitly cancelled instead.
 * Uses two fresh synthetic members and the normal client callables. Administrator
 * access ONLY marks this run's synthetic emails verified. Stripe test credentials
 * are read into memory to tokenize an official test card; all payment confirmation,
 * fulfillment, wallet and tracking mutations run through their normal callables.
 * No account, financial evidence, Stripe claim or transaction is deleted afterward.
 */
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { randomBytes, randomUUID, createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { initializeApp, deleteApp } from 'firebase/app';
import { getAuth, setPersistence, inMemoryPersistence, createUserWithEmailAndPassword, getIdToken, reload, updateProfile,
  EmailAuthProvider, reauthenticateWithCredential } from 'firebase/auth';
import { getFirestore, collection, doc, getDocFromServer, getDocsFromServer, query, where,
  setDoc, updateDoc, serverTimestamp, increment } from 'firebase/firestore';
import { getFunctions, httpsCallable } from 'firebase/functions';
import { getStorage, ref, uploadBytes, getDownloadURL } from 'firebase/storage';

const PROJECT = 'seconde-dev';
const EXPECTED_STRIPE_ACCOUNT = 'acct_1UUxsw0kghMArvqh';
const SESSION_CUTOFF = Date.parse('2026-10-28T21:21:34.932Z');
const config = JSON.parse(await readFile(new URL('../config/firebaseProjects.json', import.meta.url), 'utf8')).development;
assert.equal(config.projectId, PROJECT);
assert.equal(config.authDomain, `${PROJECT}.firebaseapp.com`);
assert.equal(config.storageBucket, `${PROJECT}.firebasestorage.app`);
for (const name of ['FIRESTORE_EMULATOR_HOST', 'FIREBASE_AUTH_EMULATOR_HOST', 'FIREBASE_STORAGE_EMULATOR_HOST', 'FUNCTIONS_EMULATOR']) {
  assert(!process.env[name], 'Emulators are not a target of this probe.');
}
assert(!process.env.EXPO_PUBLIC_APP_ENV || process.env.EXPO_PUBLIC_APP_ENV === 'development', 'Production environments are forbidden.');
const until = process.argv.find(value => value.startsWith('--until='))?.slice(8) ?? 'complete';
const withdraw = process.argv.includes('--withdraw');
const offerFlow = process.argv.find(value => value.startsWith('--offer='))?.slice(8) ?? null;
const checkMeetup = process.argv.includes('--check-meetup');
const checkSocial = process.argv.includes('--check-social');
const checkBanks = process.argv.includes('--check-banks');
const checkReturn = process.argv.includes('--check-return');
const cancelPaid = process.argv.includes('--cancel-paid');
const keepUiListing = process.argv.includes('--keep-ui-listing');
const cardScenario = process.argv.find(value => value.startsWith('--card-scenario='))?.slice(16) ?? null;
const meetupOnly = process.argv.includes('--meetup-only');
const deviceArticleId = process.argv.find(value => value.startsWith('--device-offer-article='))?.split('=')[1];
const deviceOwnerId = process.argv.find(value => value.startsWith('--device-offer-owner='))?.split('=')[1];
assert(!deviceArticleId && !deviceOwnerId || /^[A-Za-z0-9_-]{1,128}$/.test(deviceArticleId ?? '') &&
  /^[A-Za-z0-9_-]{1,128}$/.test(deviceOwnerId ?? ''), 'A device exercise requires an exact Dev article and expected owner.');
assert(!deviceArticleId || !withdraw && !checkMeetup && !offerFlow, 'The device notification exercise never pays or completes a purchase.');
assert(offerFlow === null || ['accept', 'counter'].includes(offerFlow), 'Unknown offer scenario.');
assert(cardScenario === null || ['declined', '3ds'].includes(cardScenario), 'Unknown official Stripe test card scenario.');
assert(!cardScenario || until === 'payment' && !withdraw && !checkReturn && !cancelPaid && !checkMeetup && !deviceArticleId && !meetupOnly,
  'Card failure/authentication exercises stop at payment and never withdraw, deliver or modify a device member.');
assert(!meetupOnly || !withdraw && !offerFlow && !deviceArticleId, 'The isolated meetup exercise never runs a card purchase.');
const salePrice = offerFlow === 'counter' ? 14 : offerFlow === 'accept' ? 13 : 17;
const saleCents = salePrice * 100;
assert(['signup', 'publish', 'connect', 'quote', 'payment', 'complete'].includes(until));
assert(!withdraw || until === 'complete', '--withdraw requires the complete purchase and release flow.');
assert(!checkMeetup || until === 'complete', '--check-meetup requires the complete flow.');
assert(!checkBanks || until === 'connect' && !withdraw && !checkMeetup && !offerFlow && !deviceArticleId && !meetupOnly,
  '--check-banks is isolated to synthetic account management and stops before any purchase or payout.');
assert(!(checkReturn && cancelPaid), 'A return and a pre-dispatch cancellation require separate synthetic orders.');
assert(!checkReturn && !cancelPaid || until === 'complete' && !withdraw && !checkBanks && !checkMeetup && !deviceArticleId && !meetupOnly,
  'Return and cancellation exercises use a new complete synthetic purchase, without withdrawal or device-member changes.');
assert(!keepUiListing || ['connect', 'quote', 'payment', 'complete'].includes(until) && !deviceArticleId && !meetupOnly,
  'The independent UI listing requires the synthetic seller and its configured test Connect account.');
if (!process.argv.includes('--run') || !process.argv.includes('--allow-admin-verification')) {
  console.log('Prepared ONLY for seconde-dev. Run: node scripts/smoke-commerce-dev.mjs --run --allow-admin-verification [--until=complete] [--withdraw] [--offer=accept|counter] [--check-meetup]');
  process.exit(0);
}
assert(Date.now() > SESSION_CUTOFF, 'Fresh test accounts must be created after the current private-session cutoff.');

const signupPolicy = JSON.parse(await readFile(new URL('../functions/src/shared/signupConsentPolicy.json', import.meta.url), 'utf8'));
async function sourceVersion(path, constant) {
  const source = await readFile(new URL(path, import.meta.url), 'utf8');
  const match = source.match(new RegExp(`export const ${constant} = '([^']+)'`));
  assert(match, `Missing contract version ${constant}`);
  return match[1];
}
const connectConsentVersion = await sourceVersion('../functions/src/shared/connectConsent.ts', 'CONNECT_CONSENT_PRESENTATION_VERSION');
const bankConsentVersion = await sourceVersion('../functions/src/shared/bankConsent.ts', 'BANK_OWNERSHIP_STATEMENT_VERSION');
const runId = randomUUID().replaceAll('-', ''), members = [], ownedUids = new Set();
const ids = { runId, sellerUid: null, buyerUid: null, articleId: null, chatId: null, offerMessageId: null,
    transactionId: null, stripeAccountId: null, withdrawalRequestId: null, meetupTransactionId: null, uiArticleId: null };
let step = 'preflight', adminToken, stripeSecret, failed = false;
const hash = value => createHash('sha256').update(JSON.stringify(value)).digest('hex');
function mark(value, details = {}) { step = value; console.log(JSON.stringify({ at: new Date().toISOString(), project: PROJECT, step, ...details })); }
function safeError(error) {
  const result = { code: typeof error?.code === 'string' ? error.code.replace(/[^a-zA-Z0-9_/-]/g, '').slice(0, 90) : 'probe_failed' };
  for (const key of ['reason', 'field', 'action', 'stage']) {
    const value = error?.details?.[key];
    if (typeof value === 'string' && /^[a-zA-Z0-9_.:/-]{1,140}$/.test(value)) result[key] = value;
  }
  if (typeof error?.message === 'string') result.message = error.message
    .replace(/https?:\/\/[^\s"'<>]+/gi, '[url]')
    .replace(/\b(?:sk_test_|sk_live_|rk_test_|rk_live_|ya29\.|eyJ|AIza)[A-Za-z0-9._-]+/g, '[credential]')
    .replace(/\bpi_[A-Za-z0-9]+_secret_[A-Za-z0-9]+/g, '[client_secret]')
    .replace(/[A-Za-z0-9_-]{28,}/g, '[redacted]').slice(0, 250);
  return result;
}
function accessToken() {
  if (adminToken) return adminToken;
  const result = spawnSync('gcloud', ['auth', 'print-access-token', '--project', PROJECT], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
  if (result.status !== 0 || !result.stdout.trim()) throw Object.assign(new Error('Dev administrator token unavailable.'), { code: 'admin_token_unavailable' });
  adminToken = result.stdout.trim(); return adminToken;
}
async function googleRequest(url, method = 'GET', body) {
  const target = new URL(url);
  assert(['identitytoolkit.googleapis.com', 'secretmanager.googleapis.com'].includes(target.hostname));
  assert(target.pathname.includes(`/projects/${PROJECT}/`));
  const response = await fetch(url, { method, headers: { Authorization: `Bearer ${accessToken()}`, 'Content-Type': 'application/json', 'x-goog-user-project': PROJECT },
    ...(body ? { body: JSON.stringify(body) } : {}), signal: AbortSignal.timeout(20_000) });
  const data = await response.json().catch(() => null);
  if (!response.ok) throw Object.assign(new Error('Dev credential or synthetic-auth request failed.'), { code: `admin_http_${response.status}` });
  return data;
}
async function stripeRequest(path, fields, idempotencyKey) {
  assert(/^sk_test_[A-Za-z0-9]+$/.test(stripeSecret ?? ''), 'Only a Stripe test secret may be used.');
  assert(['/account', '/payment_methods'].includes(path), 'This probe cannot confirm/cancel/refund a provider PaymentIntent directly.');
  const response = await fetch(`https://api.stripe.com/v1${path}`, { method: fields ? 'POST' : 'GET',
    headers: { Authorization: `Bearer ${stripeSecret}`, 'Stripe-Version': '2026-04-22.dahlia',
      ...(fields ? { 'Content-Type': 'application/x-www-form-urlencoded' } : {}), ...(idempotencyKey ? { 'Idempotency-Key': idempotencyKey } : {}) },
    ...(fields ? { body: new URLSearchParams(fields) } : {}), signal: AbortSignal.timeout(25_000) });
  const data = await response.json().catch(() => null);
  if (!response.ok) throw Object.assign(new Error('Stripe test tokenization/preflight failed.'), { code: `stripe_http_${response.status}`,
    details: { reason: data?.error?.code ?? data?.error?.type ?? 'provider_error' } });
  return data;
}
function declaredAddress(name, street, postalCode) {
  const physical = { street, line2: null, city: 'Montréal', province: 'QC', postalCode, country: 'CA' };
  return { name, street, city: physical.city, province: 'QC', postalCode, country: 'CA', shippingUseDeclaration: {
    schemaVersion: 1, policyVersion: 'ordinary_address_2026_01', kind: 'ordinary_residential', accepted: true, addressHash: hash(physical),
  } };
}
async function createMember(role) {
  mark(`signup-${role}`);
  const app = initializeApp(config, `commerce-${role}-${runId}`), auth = getAuth(app);
  const member = { app, auth, db: getFirestore(app), functions: getFunctions(app, 'northamerica-northeast1'), storage: getStorage(app), uid: null };
  members.push(member);
  await setPersistence(auth, inMemoryPersistence);
  const email = `commerce-${role}-${runId}@seconde-smoke.test`, password = `${randomBytes(30).toString('base64url')}aA1!`;
  const { user } = await createUserWithEmailAndPassword(auth, email, password);
  // Fresh linked-provider authentication, exactly as a sensitive member action
  // requires. These synthetic credentials remain inside this in-memory closure.
  member.reauthenticate = async () => {
    await reauthenticateWithCredential(user, EmailAuthProvider.credential(email, password));
    await getIdToken(user, true);
  };
  member.uid = user.uid; ownedUids.add(user.uid); ids[`${role}Uid`] = user.uid;
  assert(Date.parse(user.metadata.creationTime) >= SESSION_CUTOFF);
  assert(Date.parse(user.metadata.creationTime) >= Date.now() - 60_000, 'Only an account created now belongs to this probe.');
  member.call = async (name, data = {}) => (await httpsCallable(member.functions, name, { timeout: 90_000 })(data)).data;
  const displayName = role === 'seller' ? 'Jean Test' : 'Acheteur Test';
  await updateProfile(user, { displayName });
  await setDoc(doc(member.db, 'users', user.uid), { id: user.uid, email, displayName, createdAt: serverTimestamp(), isActive: true, authProvider: 'email' });
  mark(`signup-consent-${role}`, { uid: user.uid });
  const eligibility = await member.call('getMyEligibility');
  assert.equal(typeof eligibility.version, 'string'); assert.equal(typeof eligibility.statementVersion, 'string');
  const consent = await member.call('recordSignupConsent', { dateOfBirth: '1990-04-12', acceptedTerms: true, acceptedPrivacy: true,
    marketingOptIn: false, desiredUsername: `ct${role[0]}${runId.slice(0, 13)}`, policyVersion: signupPolicy.version,
    sellerActivityDeclaration: { kind: 'personal', statementVersion: eligibility.statementVersion, personalDeclarationAccepted: true,
      expectedVersion: eligibility.version, requestId: `signup_${role}_${runId}`, expectedUid: user.uid } });
  assert.equal(consent.ok, true);
  mark(`verify-synthetic-email-${role}`, { uid: user.uid });
  assert(ownedUids.has(user.uid));
  const authBase = `https://identitytoolkit.googleapis.com/v1/projects/${PROJECT}`;
  const lookup = await googleRequest(`${authBase}/accounts:lookup`, 'POST', { localId: [user.uid] });
  const native = lookup.users?.find(value => value.localId === user.uid && value.email === email);
  assert(native && Number(native.createdAt) >= SESSION_CUTOFF, 'Administrator verification may affect only this fresh synthetic identity.');
  await googleRequest(`${authBase}/accounts:update`, 'POST', { localId: user.uid, emailVerified: true });
  await reload(user); await getIdToken(user, true); assert.equal(user.emailVerified, true);
  member.address = declaredAddress(displayName, role === 'seller' ? '100 Rue de Test' : '200 Rue de Test', role === 'seller' ? 'H2X1Y4' : 'H2X1Y5');
  await updateDoc(doc(member.db, 'users', user.uid), { addresses: [{ ...member.address, isDefault: true }], updatedAt: serverTimestamp() });
  return member;
}
async function readOrder(member) {
  const snap = await getDocFromServer(doc(member.db, 'transactions', ids.transactionId));
  assert(snap.exists(), 'The saved order must remain available.');
  const order = snap.data(); assert.equal(order.buyerId, ids.buyerUid); assert.equal(order.sellerId, ids.sellerUid); assert.equal(order.articleId, ids.articleId);
  return order;
}
async function poll(description, read, accepts, attempts = 12, intervalMs = 1500) {
  for (let i = 0; i < attempts; i++) {
    const value = await read();
    if (accepts(value)) return value;
    if (i < attempts - 1) await new Promise(resolve => setTimeout(resolve, intervalMs));
  }
  throw Object.assign(new Error(description), { code: 'probe_wait_incomplete' });
}
async function readStripeAccountStatus(member, input = {}) {
  // A webhook can invalidate a status observation while it is being read.
  // Refresh only this qualified read; never repeat a bank/payment mutation.
  for (let attempt = 0; attempt < 3; attempt++) {
    try { return await member.call('getStripeAccountStatus', input); }
    catch (error) {
      if (attempt === 2 || error?.code !== 'functions/aborted' ||
          error?.details?.reason !== 'connect_observation_stale' ||
          error?.details?.action !== 'getStripeAccountStatus') throw error;
      await new Promise(resolve => setTimeout(resolve, (attempt + 1) * 500));
    }
  }
}
const stop = name => until === name;

async function readSellerLedger(seller) {
  const snapshot = await getDocsFromServer(query(collection(seller.db, 'wallets', seller.uid, 'ledger'),
    where('transactionId', '==', ids.transactionId)));
  assert(snapshot.size < 101);
  return snapshot.docs.map(row => ({id: row.id, ...row.data()}));
}

async function awaitOrderNotice(member, type, leg) {
  const notices = await poll(`The ${type} notification is missing from the participant's own history.`, async () => {
    const snapshot = await getDocsFromServer(query(collection(member.db, 'notifications'), where('userId', '==', member.uid)));
    return snapshot.docs.map(row => ({id: row.id, ...row.data()})).filter(row => row.type === type && row.data?.transactionId === ids.transactionId &&
      (leg === undefined || row.data?.trackingLeg === leg));
  }, values => values.length > 0, 20, 1500);
  assert.equal(notices.length, 1); assert.equal(notices[0].userId, member.uid);
  if (notices[0].data.ownerId !== undefined) assert.equal(notices[0].data.ownerId, member.uid);
  mark('in-app-order-notification-confirmed', {recipientUid: member.uid, type, count: notices.length, physicalPushConfirmed: false});
}

async function assertUnpaidPurchase(seller, buyer, expectedIntentId) {
  const order = await readOrder(buyer);
  assert.equal(order.status, 'pending_payment'); assert.equal(order.stripePaymentIntentId, expectedIntentId);
  assert(!order.paidAt && !order.shipEngineLabelId && !order.stripeChargeId && !order.fundsReleasedAt);
  assert(order.capturedCardCents == null || order.capturedCardCents === 0);
  const wallet = await seller.call('getWalletInfo', {expectedUid: seller.uid});
  assert.equal(wallet.balance, 0); assert.equal(wallet.pendingBalance, 0); assert.equal(wallet.heldBalance, 0);
  assert.equal((await readSellerLedger(seller)).length, 0);
  mark('unpaid-purchase-qualified', {orderStatus: order.status, sellerCreditedCents: 0, labelCreated: false,
    samePaymentIntent: true, physicalAuthenticationVerified: false});
}

async function observeLabelDocument(member, direction) {
  const order = await readOrder(member);
  const expectedLabelId = direction === 'forward' ? order.shipEngineLabelId : order.returnLabelId;
  const input = {transactionId: ids.transactionId, expectedUid: member.uid, mode: 'label_document_observe', direction, expectedLabelId};
  const observed = await member.call('checkTrackingStatus', input);
  assert.equal(observed.protocol, 'label_document_observation_v1');
  assert.equal(observed.transactionId, ids.transactionId); assert.equal(observed.ownerId, member.uid);
  assert.equal(observed.labelId, expectedLabelId); assert.equal(observed.purchaseQualification, 'native_committed');
  assert.equal(typeof observed.documentUrl, 'string', 'A fresh private test label document must be available.');
  const checked = await member.call('checkTrackingStatus', {...input, operation: 'source_check',
    expectedSourceHash: observed.sourceHash, expectedSourceRevision: observed.sourceRevision});
  assert.equal(checked.observation, 'source_matches'); assert.equal(checked.documentUrl, null);
  const document = await fetch(observed.documentUrl, {signal: AbortSignal.timeout(20_000)});
  assert.equal(document.ok, true); assert(document.headers.get('content-type')?.includes('application/pdf'));
  const bytes = Buffer.from(await document.arrayBuffer()); assert.equal(bytes.subarray(0, 8).toString(), '%PDF-1.4');
  assert(bytes.includes(Buffer.from('NON EXPEDIABLE')));
  mark(`qualified-${direction}-label-document`, {bytes: bytes.length, privateUrlLogged: false, realShipment: false});
}

async function exercisePhysicalReturn(seller, buyer) {
  mark('prepare-damaged-return');
  const requestId = `return_${runId}`, input = {transactionId: ids.transactionId, expectedUid: buyer.uid,
    requestId, reason: 'damaged'};
  const prepared = await buyer.call('requestReturn', {...input, mode: 'prepare'});
  assert.equal(prepared.protocol, 'return_request_v1'); assert.equal(prepared.requestId, requestId);
  assert.equal(prepared.requestRecorded, true); assert.equal(prepared.fundsFrozen, true);
  assert.equal(prepared.labelCommitted, false); assert.equal(prepared.status, 'quoted');
  const quote = prepared.quote;
  assert(quote && quote.currency === 'CAD' && Number.isSafeInteger(quote.costCents));
  assert.equal(quote.refundDecisionGranted, false);
  mark('confirm-exact-return-quote', {costCents: quote.costCents});
  const confirmed = await buyer.call('requestReturn', {...input, mode: 'confirm', quoteId: quote.quoteId,
    rateId: quote.rateId, expectedVersion: quote.version, expectedCostCents: quote.costCents, accepted: true,
    ...(quote.depositTermsHash ? {returnDepositTermsHash: quote.depositTermsHash} : {})});
  assert.equal(confirmed.labelCommitted, true); assert.equal(confirmed.requestId, requestId);
  const observed = await buyer.call('requestReturn', {...input, mode: 'observe'});
  assert.equal(observed.labelCommitted, true); assert.equal(observed.shippingPermissionGranted, true);
  const returned = await readOrder(buyer);
  assert.equal(returned.returnCarrierCode, 'seconde_dev'); assert.equal(returned.returnLabelCost * 100, quote.costCents);
  assert.equal(returned.returnRequest.state, 'committed'); assert(!returned.fundsReleasedAt);
  await observeLabelDocument(buyer, 'return');
  for (const action of ['in_transit', 'delivered']) {
    mark(`simulate-return-${action}`);
    const result = await buyer.call('devAdvanceShipping', {expectedUid: buyer.uid, transactionId: ids.transactionId, action, leg: 'return'});
    assert.equal(result.success, true); assert.equal(result.realShipment, false);
  }
  const received = await readOrder(buyer);
  assert(received.returnDeliveredAt); assert.equal(received.returnTrackingStatus, 'DELIVERED');
  assert(!received.fundsReleasedAt); assert(!received.refund, 'A return scan must not invent a contents decision or new refund.');
  const wallet = await seller.call('getWalletInfo', {expectedUid: seller.uid});
  assert.equal(wallet.balance, 0); assert.equal(wallet.pendingBalance, 0); assert.equal(wallet.heldBalance, saleCents);
  const ledger = await readSellerLedger(seller);
  for (const type of ['sale_credit', 'funds_held']) {
    const rows = ledger.filter(row => row.type === type); assert.equal(rows.length, 1); assert.equal(rows[0].amount, saleCents);
  }
  assert(!ledger.some(row => ['funds_released', 'refund_debit'].includes(row.type)));
  await awaitOrderNotice(buyer, 'order_delivered', 'return'); await awaitOrderNotice(seller, 'order_delivered', 'return');
  mark('return-received-review-preserved', {returnReceived: true, refundAutomaticallyCreated: false,
    sellerHeldCents: wallet.heldBalance, physicalContentsVerified: false, realShipment: false});
}

async function exercisePaidCancellation(seller, buyer) {
  mark('seller-cancel-before-dispatch');
  const original = await readOrder(buyer), before = await seller.call('getWalletInfo', {expectedUid: seller.uid});
  assert.equal(original.status, 'label_created'); assert(!original.shippedAt && !original.fundsReleasedAt);
  assert.equal(before.balance, 0);
  const input = {transactionId: ids.transactionId, reason: 'Synthetic Dev seller cancellation before dispatch'};
  const result = await seller.call('sellerCancelTransaction', input);
  assert.equal(result.success, true, 'The normal seller cancellation must settle its test refund.');
  const refunded = await poll('The Stripe test refund is not yet settled; never submit another refund intention.',
    () => readOrder(buyer), order => order.status === 'refunded' && order.refund?.state === 'succeeded', 18, 1500);
  assert.equal(refunded.refund.source, 'sellerCancelTransaction');
  const wallet = await seller.call('getWalletInfo', {expectedUid: seller.uid});
  assert.equal(wallet.balance, 0); assert.equal(wallet.pendingBalance, 0); assert.equal(wallet.heldBalance, 0);
  const listing = (await getDocFromServer(doc(seller.db, 'articles', ids.articleId))).data();
  // A paid order already has a label. A cancellation/refund is not proof the
  // physical parcel was never deposited; inventory stays held for that review.
  assert.equal(listing.isSold, true);
  assert.equal(refunded.refundInventoryReviewRequired, true);
  const replay = await seller.call('sellerCancelTransaction', input);
  assert.equal(replay.success, true); assert.equal(replay.alreadyRefunded, true);
  const afterReplay = await readOrder(buyer);
  assert.equal(afterReplay.refund.intentId, refunded.refund.intentId);
  assert.equal(afterReplay.refund.stripeRefundId, refunded.refund.stripeRefundId);
  const ledger = await readSellerLedger(seller);
  for (const type of ['sale_credit', 'refund_debit']) {
    const rows = ledger.filter(row => row.type === type); assert.equal(rows.length, 1); assert.equal(rows[0].amount, saleCents);
  }
  await awaitOrderNotice(buyer, 'order_refunded'); await awaitOrderNotice(seller, 'order_refunded');
  mark('paid-cancellation-refund-confirmed', {refundState: refunded.refund.state, orderStatus: refunded.status,
    totalCents: Math.round(original.totalAmount * 100), sellerBalanceCents: wallet.balance,
    inventoryReviewRequired: true, articleAutomaticallyRelisted: false, replayCreatedSecondRefund: false,
    bankArrivalVerified: false, realMoney: false});
}

async function exerciseBankManagement(member) {
  assert(ownedUids.has(member.uid) && ids.transactionId === null && ids.withdrawalRequestId === null);
  mark('bank-management-inventory');
  await member.reauthenticate();
  const readBanks = () => readStripeAccountStatus(member, {includeBankAccounts: true});
  const initial = await readBanks();
  assert(Array.isArray(initial.bankAccounts) && initial.bankAccounts.length === 1);
  const original = initial.bankAccounts.find(bank => bank.isSelected && bank.isDefault);
  assert(original && original.currency === 'CAD' && original.country === 'CA');
  assert.equal(original.canDelete, false);
  const declaration = {expectedUid: member.uid, accountHolderName: 'Jean Test', bankOwnershipAccepted: true,
    bankOwnershipStatementVersion: bankConsentVersion};
  mark('bank-management-add');
  // Official Stripe Canada no_account TEST fixture. We never send any payout;
  // the candidate is selected, replaced by the original, then removed below.
  const added = await member.call('addBankAccount', {...declaration, requestId: `bank_add_${runId}`, mode: 'replace',
    transitNumber: '11000', institutionNumber: '000', accountNumber: '000111111116'});
  assert.equal(added.success, true, 'Adding the synthetic bank must complete.');
  assert.equal(added.action, null, 'Adding the synthetic bank must not require recovery.');
  const afterAdd = await readBanks();
  assert.equal(afterAdd.bankAccounts.length, 2);
  const candidate = afterAdd.bankAccounts.find(bank => bank.isSelected && bank.id !== original.id);
  assert(candidate && candidate.isDefault && candidate.last4 === '1116');
  mark('bank-management-select-original');
  const selected = await member.call('addBankAccount', {...declaration, requestId: `bank_select_${runId}`,
    mode: 'select_existing', bankAccountId: original.id});
  assert.equal(selected.success, true, 'Selecting the original synthetic bank must complete.');
  assert.equal(selected.action, null, 'Selecting the original synthetic bank must not require recovery.');
  const afterSelect = await readBanks();
  assert(afterSelect.bankAccounts.some(bank => bank.id === original.id && bank.isSelected && bank.isDefault));
  assert(afterSelect.bankAccounts.some(bank => bank.id === candidate.id && bank.canDelete));
  mark('bank-management-protect-selected');
  await assert.rejects(member.call('addBankAccount', {expectedUid: member.uid, requestId: `bank_protected_${runId}`,
    mode: 'delete_existing', bankAccountId: original.id}), error => error?.code === 'functions/failed-precondition');
  mark('bank-management-delete-candidate');
  const removal = {expectedUid: member.uid, requestId: `bank_delete_${runId}`, mode: 'delete_existing', bankAccountId: candidate.id};
  const deleted = await member.call('addBankAccount', removal);
  assert.equal(deleted.success, true, 'Deleting the unselected synthetic bank must complete.');
  assert.equal(deleted.action, null, 'Deleting the unselected synthetic bank must not require recovery.');
  mark('bank-management-delete-replay');
  const replay = await member.call('addBankAccount', {expectedUid: member.uid, requestId: removal.requestId});
  assert.equal(replay.success, true); assert.equal(replay.requestId, removal.requestId);
  const final = await readBanks();
  assert.equal(final.bankAccounts.length, 1);
  assert(final.bankAccounts.some(bank => bank.id === original.id && bank.isSelected && bank.isDefault));
  for (const bank of final.bankAccounts) {
    assert(!('accountNumber' in bank) && !('routing_number' in bank) && !('transitNumber' in bank));
  }
  mark('bank-management-confirmed', {bankCount: final.bankAccounts.length, added: true, selectedOriginal: true,
    protectedSelectedBank: true, removedCandidate: true, removalReplayConfirmed: true, realBankPayment: false});
}

async function awaitNotice(member, type, amount, chatId = ids.chatId) {
  const notices = await poll(`The ${type} notification is not present in the recipient's own SDK history.`, async () => {
    const snapshot = await getDocsFromServer(query(collection(member.db, 'notifications'), where('userId', '==', member.uid)));
    return snapshot.docs.map(value => ({ id: value.id, ...value.data() })).filter(value => value.type === type &&
      value.data?.chatId === chatId && (amount === undefined || value.data?.amount === String(amount)));
  }, values => values.length > 0, 20, 1500);
  assert.equal(notices.length, 1, 'One native source must not produce duplicate recipient notifications.');
  assert.equal(notices[0].userId, member.uid); assert.equal(notices[0].data?.ownerId, member.uid);
  assert.equal(notices[0].isRead, false);
  mark('in-app-notification-confirmed', { recipientUid: member.uid, type, notificationId: notices[0].id,
    physicalPushConfirmed: false });
}

async function createArticleChat(seller, buyer, articleId, listing) {
  const chatId = [seller.uid, buyer.uid].sort().join('__') + '__' + articleId;
  mark('create-normal-article-chat', { chatId });
  await setDoc(doc(buyer.db, 'chats', chatId), { participants: [seller.uid, buyer.uid].sort(),
    participantsInfo: [{ userId: seller.uid, userName: 'Jean Test' }, { userId: buyer.uid, userName: 'Acheteur Test' }],
    unreadCount: { [seller.uid]: 0, [buyer.uid]: 0 }, articleId, sellerId: seller.uid,
    articleTitle: listing.title, articlePrice: listing.price, createdAt: serverTimestamp(), updatedAt: serverTimestamp() });
  return chatId;
}
async function negotiateShippingPurchase(seller, buyer, listing) {
  ids.chatId = await createArticleChat(seller, buyer, ids.articleId, listing);
  const text = 'Message de recette Seconde Dev, sans article réel.';
  mark('send-normal-chat-message');
  await setDoc(doc(buyer.db, 'messages', `message_${runId}`), { chatId: ids.chatId, senderId: buyer.uid, receiverId: seller.uid,
    participants: [seller.uid, buyer.uid].sort(), type: 'text', content: text, timestamp: serverTimestamp(), status: 'sent', isRead: false });
  await updateDoc(doc(buyer.db, 'chats', ids.chatId), { lastMessage: text, lastMessageType: 'text',
    lastMessageTimestamp: serverTimestamp(), updatedAt: serverTimestamp(), [`unreadCount.${seller.uid}`]: increment(1) });
  await awaitNotice(seller, 'new_message');
  mark('send-shipping-offer');
  const proposed = await buyer.call('sendShippingOffer', { chatId: ids.chatId, requestId: `offer_${runId}`, amount: 13 });
  assert.equal(proposed.success, true); assert.equal(typeof proposed.messageId, 'string');
  ids.offerMessageId = proposed.messageId;
  const replay = await buyer.call('sendShippingOffer', { chatId: ids.chatId, requestId: `offer_${runId}`, amount: 13 });
  assert.equal(replay.messageId, proposed.messageId, 'Reobserving the same offer must not send a second one.');
  await awaitNotice(seller, 'offer_received', 13);
  const chat = (await getDocFromServer(doc(seller.db, 'chats', ids.chatId))).data();
  assert.equal(chat.lastMessageType, 'offer'); assert.equal(chat.unreadCount[seller.uid], 2);
  const available = (await getDocFromServer(doc(buyer.db, 'articles', ids.articleId))).data();
  assert.equal(available.isSold, false, 'A negotiation must not reserve the article before checkout.');
  let responder = seller;
  if (offerFlow === 'counter') {
    mark('send-counter-offer');
    const counter = await seller.call('sendShippingOffer', { chatId: ids.chatId, requestId: `counter_${runId}`,
      amount: 14, originalMessageId: proposed.messageId });
    assert.equal(counter.success, true); assert.equal(typeof counter.messageId, 'string');
    ids.offerMessageId = counter.messageId; responder = buyer;
    await awaitNotice(buyer, 'offer_counter');
  }
  mark('accept-native-shipping-offer', { offerMessageId: ids.offerMessageId, salePrice });
  const accepted = await responder.call('respondShippingOffer', { chatId: ids.chatId, messageId: ids.offerMessageId, action: 'accept' });
  assert.equal(accepted.success, true); assert.equal(accepted.amount, salePrice); assert.equal(accepted.accepted, true);
  const acceptedReplay = await responder.call('respondShippingOffer', { chatId: ids.chatId, messageId: ids.offerMessageId, action: 'accept' });
  assert.equal(acceptedReplay.amount, salePrice);
  await awaitNotice(offerFlow === 'counter' ? seller : buyer, 'offer_accepted', salePrice);
  const message = (await getDocFromServer(doc(buyer.db, 'messages', ids.offerMessageId))).data();
  assert.equal(message.offer.status, 'accepted'); assert.equal(message.offer.amount, salePrice);
  return { chatId: ids.chatId, offerMessageId: ids.offerMessageId };
}

async function exerciseMeetupOffer(seller, buyer, listingInput) {
  mark('publish-meetup-listing');
  const publication = await seller.call('createArticle', { ...listingInput, clientRequestId: `meetup_${runId}`,
    title: `TEST DEV RENCONTRE ${runId.slice(0, 8)}`, isShipping: false, isHandDelivery: true,
    neighborhoods: [{ id: 'downtown', name: 'Centre-ville', borough: 'Ville-Marie' }] });
  const articleId = publication.articleId;
  assert.equal(typeof articleId, 'string');
  const chatId = await createArticleChat(seller, buyer, articleId, listingInput);
  mark('send-meetup-offer');
  const sent = await buyer.call('sendMeetupProposal', { chatId, requestId: `meetup_offer_${runId}`, amount: 13,
    location: { toArrange: true } });
  assert.equal(sent.success, true); assert.equal(typeof sent.messageId, 'string');
  await awaitNotice(seller, 'offer_received', 13, chatId);
  mark('accept-meetup-offer');
  const accepted = await seller.call('acceptMeetupOffer', { chatId, messageId: sent.messageId });
  assert.equal(accepted.success, true); assert.equal(typeof accepted.transactionId, 'string');
  ids.meetupTransactionId = accepted.transactionId;
  await awaitNotice(buyer, 'offer_accepted', 13, chatId);
  await seller.call('confirmMeetupTransaction', { expectedUid: seller.uid, transactionId: accepted.transactionId, messageId: sent.messageId });
  mark('declare-test-meetup-complete');
  await buyer.call('completeMeetupTransaction', { expectedUid: buyer.uid, transactionId: accepted.transactionId, messageId: sent.messageId });
  const order = (await getDocFromServer(doc(buyer.db, 'transactions', accepted.transactionId))).data();
  assert.equal(order.deliveryType, 'meetup'); assert.equal(order.amount, 13); assert.equal(order.status, 'meetup_completed');
  assert(!order.stripePaymentIntentId, 'A cash meetup must not invent a platform payment.');
  mark('meetup-offer-complete', { transactionId: accepted.transactionId, realHandoverConfirmed: false, realPaymentConfirmed: false });
}

/** A visible, ordinary offer to the member testing Seconde Dev on their phone.
 * It never logs in as that member and never accepts, pays or reserves for them. */
async function exerciseDeviceOffer() {
  const buyer = await createMember('buyer');
  const snapshot = await getDocFromServer(doc(buyer.db, 'articles', deviceArticleId));
  assert(snapshot.exists(), 'The selected Dev article is unavailable.');
  const listing = snapshot.data();
  assert.equal(listing.sellerId, deviceOwnerId); assert.notEqual(listing.sellerId, buyer.uid);
  assert.equal(listing.isShipping, true); assert.equal(listing.isActive, true); assert.notEqual(listing.isSold, true);
  assert(Number.isFinite(listing.price) && listing.price > 0);
  ids.articleId = deviceArticleId; ids.sellerUid = deviceOwnerId;
  ids.chatId = await createArticleChat({uid: deviceOwnerId}, buyer, deviceArticleId, listing);
  mark('send-device-notification-test-offer');
  const response = await buyer.call('sendShippingOffer', { chatId: ids.chatId, requestId: `device_offer_${runId}`,
    amount: Math.round(listing.price * 80) / 100, message: 'Test de réception des notifications Seconde Dev. Aucun achat réel.' });
  assert.equal(response.success, true); assert.equal(typeof response.messageId, 'string');
  ids.offerMessageId = response.messageId;
  mark('device-test-offer-created', { recipientUid: deviceOwnerId, chatId: ids.chatId,
    messageId: response.messageId, physicalPushConfirmed: false, purchaseSubmitted: false });
}

try {
  mark('dev-test-credential-preflight'); accessToken();
  const secret = await googleRequest(`https://secretmanager.googleapis.com/v1/projects/${PROJECT}/secrets/STRIPE_SECRET_KEY/versions/latest:access`);
  stripeSecret = Buffer.from(secret.payload.data, 'base64').toString('utf8').trim();
  const platform = await stripeRequest('/account'); assert.equal(platform.id, EXPECTED_STRIPE_ACCOUNT);
  mark('test-platform-confirmed', { stripeAccountId: platform.id });
  if (deviceArticleId) {
    await exerciseDeviceOffer();
  } else {
  const seller = await createMember('seller'), buyer = await createMember('buyer');
  if (checkSocial) {
    mark('check-seller-follow');
    assert.deepEqual((await buyer.call('getLikedSellers')).sellers, []);
    const follow = {sellerId: seller.uid, isLiked: true};
    await buyer.call('toggleSellerLike', follow);
    await buyer.call('toggleSellerLike', follow);
    const followed = (await buyer.call('getLikedSellers')).sellers;
    assert.equal(followed.length, 1); assert.equal(followed[0].id, seller.uid);
    assert.equal((await getDocFromServer(doc(seller.db, 'users', seller.uid))).data().sellerLikesCount, 1);
    await buyer.call('toggleSellerLike', {...follow, isLiked: false});
    assert.deepEqual((await buyer.call('getLikedSellers')).sellers, []);
    assert.equal((await getDocFromServer(doc(seller.db, 'users', seller.uid))).data().sellerLikesCount, 0);
    mark('seller-follow-complete', {followedCount: 1, replayCreatedDuplicate: false, unfollowConfirmed: true});
  }
  if (!stop('signup')) {
    mark('publish-shipping-listing');
    const bytes = await readFile(new URL('../assets/images/favicon.png', import.meta.url));
    assert(bytes.readUInt32BE(16) <= 1200 && bytes.readUInt32BE(20) <= 1200 && bytes.length < 10 * 1024 * 1024);
    const object = ref(seller.storage, `drafts/${seller.uid}/commerce-${runId}/fixture.png`);
    await uploadBytes(object, new Uint8Array(bytes), { contentType: 'image/png' });
    const imageUrl = await getDownloadURL(object); assert(new URL(imageUrl).pathname.includes(`/b/${config.storageBucket}/`));
    const clientRequestId = `commerce_${runId}`;
    const listingInput = { clientRequestId, title: `TEST DEV COMMERCE ${runId.slice(0, 8)}`,
      description: 'Fixture synthétique Seconde Dev. Pictogramme technique, aucun vêtement réel. Paiement Stripe de test et livraison simulée uniquement.',
      price: 17, quantity: 1, stock: 1, images: [{ url: imageUrl }], category: 'T-shirts',
      categoryIds: ['women', 'women_clothing', 'women_clothing_tops', 'women_clothing_tops_tshirts'],
      condition: 'très bon état', brand: null, size: { value: 'M', system: 'EU' },
      isHandDelivery: false, isShipping: true, packageSize: 'small' };
    const publication = await seller.call('createArticle', listingInput);
    ids.articleId = publication.articleId; assert.equal(ids.articleId, createHash('sha256').update(`${seller.uid}:${clientRequestId}`).digest('hex').slice(0, 20));
    const listing = (await getDocFromServer(doc(seller.db, 'articles', ids.articleId))).data();
    assert.equal(listing.sellerId, seller.uid); assert.equal(listing.isActive, true); assert.equal(listing.saleDeclaration?.version, 'listing_content_v2');
    mark('automatic-parcel', { articleId: ids.articleId });
    const initial = await seller.call('getArticleShippingParcel', { articleId: ids.articleId });
    assert.equal(initial.version, 0); assert.equal(initial.status, 'missing'); assert.equal(initial.parcel, null);
    assert.equal(initial.recommendation?.source, 'automatic_profile');
    assert.equal(initial.recommendation?.profileSize, listingInput.packageSize);
    const parcelRequest = { articleId: ids.articleId, requestId: `parcel_${runId}`, expectedVersion: 0,
      profileSize: initial.recommendation.profileSize };
    const preparedParcel = await seller.call('setArticleShippingParcel', parcelRequest);
    assert.equal(preparedParcel.version, 1); assert.equal(preparedParcel.source, 'automatic_profile');
    assert.equal(preparedParcel.profileSize, listingInput.packageSize); assert.equal(preparedParcel.measurementVerified, false);
    const repeatedParcel = await seller.call('setArticleShippingParcel', parcelRequest);
    assert.equal(repeatedParcel.version, preparedParcel.version); assert.equal(repeatedParcel.replay, true);
    const observedParcel = await seller.call('getArticleShippingParcel', { articleId: ids.articleId });
    assert.equal(observedParcel.status, 'estimated'); assert.equal(observedParcel.source, 'automatic_profile');
    assert.equal(observedParcel.profileSize, preparedParcel.profileSize); assert.equal(observedParcel.profileVersion, 1);
    assert.equal(observedParcel.measurementVerified, false); assert.deepEqual(observedParcel.parcel, preparedParcel.parcel);
    mark('automatic-parcel-confirmed', { articleId: ids.articleId, profileSize: observedParcel.profileSize,
      profileVersion: observedParcel.profileVersion, parcelVersion: observedParcel.version, replayCreatedNewVersion: false,
      measurementVerified: false, realShipment: false });
    if (meetupOnly) await exerciseMeetupOffer(seller, buyer, listingInput);
    if (!stop('publish') && !meetupOnly) {
      mark('stripe-connect-synthetic-fixture');
      const connect = await seller.call('createStripeConnectAccount', { expectedUid: seller.uid, firstName: 'Jean', lastName: 'Test',
        dob: { year: 1990, month: 4, day: 12 }, address: { line1: 'address_full_match', city: 'Montréal', province: 'QC', postalCode: 'H2X1Y4' },
        transitNumber: '11000', institutionNumber: '000', accountNumber: '000123456789', accountHolderName: 'Jean Test',
        bankOwnershipAccepted: true, bankOwnershipStatementVersion: bankConsentVersion,
        paymentAccountConsent: { accepted: true, presentationVersion: connectConsentVersion }, useTestIdentity: true });
      ids.stripeAccountId = connect.stripeAccountId; assert(/^acct_[A-Za-z0-9]+$/.test(ids.stripeAccountId));
      const connectStatus = await poll('Stripe test account is not yet fully configured; inspect native requirements.',
        () => readStripeAccountStatus(seller), value => value.success === true && value.hasAccount === true && value.status === 'active' &&
          value.chargesEnabled === true && value.payoutsEnabled === true && value.payoutEligible === true && !value.disabledReason &&
          !value.bankDeclarationRequired && !value.connectActionRequired && !value.connectOperationState &&
          value.requirementsCurrentlyDue?.length === 0 && value.requirementsPastDue?.length === 0 &&
          value.verificationErrors?.length === 0 && value.requirementsPendingVerification?.length === 0, 30, 5000);
      assert.equal((await getDocFromServer(doc(seller.db, 'users', seller.uid))).data().stripeAccountId, ids.stripeAccountId);
      mark('stripe-connect-confirmed', {stripeAccountId: ids.stripeAccountId, chargesEnabled: connectStatus.chargesEnabled,
        payoutsEnabled: connectStatus.payoutsEnabled, payoutEligible: connectStatus.payoutEligible,
        identityRequirementsRemaining: connectStatus.requirementsCurrentlyDue.length, realPayment: false});
      await seller.call('activateWallet');
      if (keepUiListing) {
        const uiListing = await seller.call('createArticle', {...listingInput, clientRequestId: `ui_${runId}`,
          title: `TEST DEV PARCOURS ${runId.slice(0, 8)}`});
        ids.uiArticleId = uiListing.articleId;
        const suggestion = await seller.call('getArticleShippingParcel', {articleId: ids.uiArticleId});
        await seller.call('setArticleShippingParcel', {articleId: ids.uiArticleId, requestId: `ui_parcel_${runId}`,
          expectedVersion: 0, profileSize: suggestion.recommendation.profileSize});
        mark('ui-listing-ready', {articleId: ids.uiArticleId, sellerUid: seller.uid, willNotPurchase: true});
      }
      if (checkBanks) await exerciseBankManagement(seller);
      if (!stop('connect')) {
        const offerSource = offerFlow ? await negotiateShippingPurchase(seller, buyer, listing) : {};
        mark('quote-simulated-shipping');
        const quote = await buyer.call('quoteShippingPurchase', { articleId: ids.articleId, shippingAddress: buyer.address, ...offerSource });
        assert(quote.rates.length > 0); assert.equal(quote.transport?.testMode, 'seconde_dev_commerce_v1');
        const rate = quote.rates.find(value => value.carrierCode === 'seconde_dev'); assert(rate, 'A simulated Dev carrier must be quoted.');
        if (!stop('quote')) {
          mark('reserve-purchase');
          const reservation = await buyer.call('createTransaction', { articleId: ids.articleId, shippingAddress: buyer.address,
            deliveryType: 'shipping', quoteId: quote.quoteId, rateId: rate.rateId, expectedTotal: rate.totalAmount,
            purchasePolicyAccepted: true, expectedPurchasePolicyVersion: quote.purchasePolicy.policyVersion,
            expectedPurchasePolicyHash: quote.purchasePolicy.hash, purchasePolicy: quote.purchasePolicy,
            expectedTransportTermsHash: quote.transport.termsHash });
          ids.transactionId = reservation.transactionId; assert(/^[A-Za-z0-9_-]{1,128}$/.test(ids.transactionId));
          const reservedOrder = await readOrder(buyer);
          assert.equal(reservedOrder.amount, salePrice, 'The normal order must charge the native accepted article price.');
          mark('prepare-native-manual-checkout', { transactionId: ids.transactionId });
          let prepared = await buyer.call('createStripeCheckout', { transactionId: ids.transactionId, walletAmount: 0 });
          assert.equal(prepared.protocol, 'server_manual_v1'); assert.equal(prepared.providerStatus, 'requires_payment_method');
          assert.equal(prepared.action, 'confirmOnServer'); assert.equal(prepared.walletCents, 0); assert.equal(prepared.paymentPermissionGranted, false);
          mark('tokenize-official-stripe-test-card');
          // Official fixtures: https://docs.stripe.com/testing#declined-payments
          // and #regulatory-cards. No raw card data or real credentials.
          const token = cardScenario === 'declined' ? 'tok_visa_chargeDeclined' : cardScenario === '3ds' ? 'tok_threeDSecure2Required' : 'tok_bypassPendingInternational';
          let paymentMethod = await stripeRequest('/payment_methods', { type: 'card', 'card[token]': token,
            'metadata[secondeDevSmokeRun]': runId, 'metadata[transactionId]': ids.transactionId }, `commerce_${runId}_method`);
          assert.equal(paymentMethod.livemode, false); assert(/^pm_[A-Za-z0-9]+$/.test(paymentMethod.id));
          const originalIntentId = (await readOrder(buyer)).stripePaymentIntentId;
          if (cardScenario === 'declined') {
            mark('confirm-official-declined-card');
            await assert.rejects(buyer.call('confirmStripeCheckout', {transactionId: ids.transactionId,
              expectedIntentVersion: prepared.intentVersion, paymentMethodId: paymentMethod.id}),
            error => error?.code === 'functions/failed-precondition' && error?.details?.reason === 'stripe_checkout_payment_method_rejected');
            await assertUnpaidPurchase(seller, buyer, originalIntentId);
            mark('read-same-checkout-after-decline');
            prepared = await buyer.call('createStripeCheckout', {transactionId: ids.transactionId, walletAmount: 0});
            assert.equal(prepared.providerStatus, 'requires_payment_method'); assert.equal(prepared.action, 'confirmOnServer');
            assert.equal((await readOrder(buyer)).stripePaymentIntentId, originalIntentId);
            paymentMethod = await stripeRequest('/payment_methods', {type: 'card', 'card[token]': 'tok_bypassPendingInternational',
              'metadata[secondeDevSmokeRun]': runId}, `commerce_${runId}_replacement_method`);
            mark('explicit-same-order-payment-retry', {newOrderCreated: false, newPaymentIntentCreated: false});
          }
          mark('confirm-through-normal-checkout');
          let confirmation;
          try {
            confirmation = await buyer.call('confirmStripeCheckout', {transactionId: ids.transactionId,
              expectedIntentVersion: prepared.intentVersion, paymentMethodId: paymentMethod.id});
          } catch (error) {
            // The webhook can commit before this confirmation response returns.
            // Observe the SAME native PI only; an aborted response never proves
            // that its already-authorized provider POST was not executed.
            if (error?.code !== 'functions/aborted' || error?.details?.reason !== 'stripe_checkout_stale') throw error;
            const current = await readOrder(buyer);
            if (current.stripePaymentIntentId !== originalIntentId) throw error;
            const recovered = await buyer.call('createStripeCheckout', {transactionId: ids.transactionId, walletAmount: 0});
            if (recovered.protocol !== 'server_manual_v1' || !['succeeded', ...(cardScenario === '3ds' ? ['requires_action'] : [])].includes(recovered.providerStatus)) throw error;
            confirmation = recovered;
            mark('checkout-response-requalified', {providerStatus: recovered.providerStatus, samePaymentIntent: true, automaticReconfirmation: false});
          }
          assert.equal(confirmation.protocol, 'server_manual_v1');
          if (cardScenario === '3ds') {
            assert.equal(confirmation.providerStatus, 'requires_action'); assert.equal(confirmation.action, 'handleNextAction');
            await assertUnpaidPurchase(seller, buyer, originalIntentId);
            const read = await buyer.call('createStripeCheckout', {transactionId: ids.transactionId, walletAmount: 0});
            assert.equal(read.providerStatus, 'requires_action'); assert.equal(read.action, 'handleNextAction');
            assert.equal((await readOrder(buyer)).stripePaymentIntentId, originalIntentId);
            mark('3ds-requirement-preserved', {samePaymentIntent: true, physicalAuthenticationVerified: false,
              automaticReconfirmation: false, newPurchaseSubmitted: false});
            const cancelled = await buyer.call('cancelPendingTransaction', {expectedUid: buyer.uid, transactionId: ids.transactionId});
            assert.equal(cancelled.cancellationCommitted, true); assert.equal(cancelled.currentStatus, 'cancelled');
            assert.equal(cancelled.refundedCents, 0);
            const terminal = await readOrder(buyer); assert.equal(terminal.status, 'cancelled'); assert(!terminal.paidAt && !terminal.shipEngineLabelId);
            const available = (await getDocFromServer(doc(seller.db, 'articles', ids.articleId))).data(); assert.equal(available.isSold, false);
            mark('unauthenticated-test-payment-cancelled', {chargedCents: 0, labelCreated: false, realMoney: false});
          } else {
          assert.equal(confirmation.providerStatus, 'succeeded', 'This happy-path test card should not require manual 3DS.');
          mark('await-webhook-and-label');
          const paid = await poll('The native payment webhook or simulated label is not yet committed; do not reconfirm the charge.',
            () => readOrder(buyer), order => order.status === 'label_created', 18, 1500);
          assert.equal(paid.carrierCode, 'seconde_dev'); assert(/^se-devsim-[a-f0-9]{32}$/.test(paid.shipEngineLabelId));
          assert(paid.paidAt); assert.equal(paid.devShippingSimulation?.realShipment, false);
          await awaitOrderNotice(buyer, 'order_paid'); await awaitOrderNotice(seller, 'new_sale');
          if (!stop('payment')) {
            await observeLabelDocument(seller, 'forward');
            if (cancelPaid) await exercisePaidCancellation(seller, buyer);
            else {
            for (const action of ['in_transit', 'delivered', ...(checkReturn ? [] : ['release_funds'])]) {
              mark(`simulate-${action}`);
              const result = await seller.call('devAdvanceShipping', { expectedUid: seller.uid, transactionId: ids.transactionId, action, leg: 'forward' });
              assert.equal(result.success, true); assert.equal(result.simulated, true); assert.equal(result.realShipment, false);
              if (action === 'release_funds') assert.equal(result.fundsReleased, true);
            }
            if (checkReturn) await exercisePhysicalReturn(seller, buyer);
            else {
            mark('assert-final-commercial-and-wallet-state');
            const completed = await readOrder(buyer); assert(completed.fundsReleasedAt);
            const wallet = await seller.call('getWalletInfo', { expectedUid: seller.uid });
            assert.equal(wallet.hasWallet, true); assert.equal(wallet.balance, saleCents); assert.equal(wallet.pendingBalance, 0); assert.equal(wallet.heldBalance, 0);
            const sold = (await getDocFromServer(doc(seller.db, 'articles', ids.articleId))).data(); assert.equal(sold.isSold, true);
            mark('commerce-complete', { transactionStatus: completed.status, sellerBalanceCents: wallet.balance, realMoney: false, realShipment: false });
            if (checkMeetup) await exerciseMeetupOffer(seller, buyer, listingInput);
            if (withdraw) {
              mark('await-native-stripe-payout-capability');
              const bank = await poll('The native Stripe test account is not payout-enabled after 90 seconds; no withdrawal was requested.',
                () => seller.call('getStripeAccountStatus'), value => value.hasAccount === true && value.chargesEnabled === true &&
                  value.payoutsEnabled === true && value.payoutEligible === true && value.bankDeclarationRequired === false &&
                  typeof value.bankAccountId === 'string' && /^ba_[A-Za-z0-9_]+$/.test(value.bankAccountId), 19, 5000);
              mark('reauthenticate-synthetic-seller-for-withdrawal');
              await seller.reauthenticate();
              const requestId = `withdraw_${runId}`;
              ids.withdrawalRequestId = `wi_${hash([seller.uid, requestId])}`;
              const withdrawalInput = { expectedUid: seller.uid, requestId, amount: saleCents, expectedBankAccountId: bank.bankAccountId };
              mark('request-normal-wallet-withdrawal', { withdrawalRequestId: ids.withdrawalRequestId });
              const receipt = await seller.call('walletWithdraw', { ...withdrawalInput, mode: 'request' });
              const qualify = value => {
                assert.equal(value.protocol, 'withdrawal_intent_v1'); assert.equal(value.requestId, requestId);
                assert.equal(value.ownerId, seller.uid); assert.equal(value.withdrawalRequestId, ids.withdrawalRequestId);
                assert.equal(value.amountCents, saleCents); assert.equal(value.currency, 'CAD'); assert.equal(value.bankAccountId, bank.bankAccountId);
                assert.equal(value.retryPermissionGranted, false);
                assert.equal(typeof value.completedReceiptQualified, 'boolean');
                return value;
              };
              qualify(receipt);
              if (!receipt.intentCommitted || !receipt.debitCommitted) throw Object.assign(
                new Error('The native withdrawal was not committed. Its source and non-execution receipt are preserved; no second request is sent.'),
                { code: 'withdrawal_not_committed', details: { reason: receipt.nonExecutionReason ?? receipt.operationState } });
              // Only observe this SAME committed intention after the first POST.
              // A created payout remains separate from a provider-paid receipt.
              let observed = qualify(await seller.call('walletWithdraw', { ...withdrawalInput, mode: 'observe' }));
              for (let index = 0; index < 6 && !observed.completedReceiptQualified &&
                  !['failed', 'recovered', 'reconciliation_required', 'not_executed'].includes(observed.operationState); index++) {
                await new Promise(resolve => setTimeout(resolve, 2000));
                observed = qualify(await seller.call('walletWithdraw', { ...withdrawalInput, mode: 'observe' }));
              }
              assert.equal(observed.debitCommitted, true); assert.equal(observed.recoveryCommitted, false);
              assert(/^tr_[A-Za-z0-9_]+$/.test(observed.transferId ?? ''), 'The platform-to-connected transfer remains to be reconciled.');
              assert(/^po_[A-Za-z0-9_]+$/.test(observed.payoutId ?? ''), 'The connected-account payout remains to be reconciled.');
              const withdrawnWallet = await seller.call('getWalletInfo', { expectedUid: seller.uid });
              assert.equal(withdrawnWallet.balance, 0); assert.equal(withdrawnWallet.pendingBalance, 0); assert.equal(withdrawnWallet.heldBalance, 0);
              mark('withdrawal-observed', { withdrawalRequestId: observed.withdrawalRequestId, transferId: observed.transferId,
                payoutId: observed.payoutId, status: observed.status, operationState: observed.operationState,
                transferState: observed.transferState, payoutState: observed.payoutState,
                testPayoutCompletionQualified: observed.completedReceiptQualified, sellerBalanceCents: withdrawnWallet.balance,
                testTransferCreated: observed.transferState === 'created', testPayoutCreated: observed.payoutState === 'created',
                testPayoutPaid: observed.completedReceiptQualified, realBankPayment: false, automaticRetry: false });
            }
            }
            }
          }
          }
        }
      }
    }
  }
  }
  mark('probe-finished', { until, withdraw, offerFlow, checkMeetup, checkSocial, checkBanks, checkReturn, cancelPaid, keepUiListing, cardScenario,
    meetupOnly, deviceExercise: !!deviceArticleId,
    salePrice: deviceArticleId ? null : salePrice, ...ids, financialEvidencePreserved: true });
} catch (error) {
  failed = true;
  console.error(JSON.stringify({ at: new Date().toISOString(), project: PROJECT, step, error: safeError(error), ...ids,
    automaticRetry: false, financialEvidencePreserved: true }));
} finally {
  stripeSecret = undefined; adminToken = undefined;
  for (const member of members) await deleteApp(member.app).catch(() => undefined);
}
process.exitCode = failed ? 1 : 0;
