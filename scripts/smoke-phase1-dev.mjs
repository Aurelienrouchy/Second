/** Phase 1 LOCAL commerce recipe. Dormant unless every explicit gate is set.
 * Uses the V2 public contracts on Seconde Dev, never ordinary Dev commerce TEST.
 * Credentials stay in memory. Administrator writes ONLY verify emails of
 * identities created by this run; fresh erasure may read their exact absence.
 * No privileged Firestore/Storage write or direct destruction.
 * Run: node scripts/smoke-phase1-dev.mjs --run --deployed-ready
 *   --allow-admin-verification --environment-proof /private/path/dev-env.json
 *   [--pause-on-error]
 * Fresh erasure only: --fresh-erasure-only [--qualification-window-minutes 10..90]
 * Optional completed cash case: --fresh-erasure-only --completed-local-erasure
 * Postal case: --fresh-erasure-only --completed-postal-erasure
 *   --late-storage-composite-proof /tmp/private-postal-composite.json
 * No provider, payment, label, real meeting, physical push, automatic erasure
 * or operator-decision claim is made by this fixture.
 */
import assert from 'node:assert/strict';
import {createHash, randomBytes, randomUUID} from 'node:crypto';
import {mkdtemp, readFile, writeFile, lstat, chmod, rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {spawnSync} from 'node:child_process';
import {isDeepStrictEqual} from 'node:util';
import {postalErasurePaths, terminalPostalProof} from './phase1-postal-erasure-fixture.mjs';
import {createInterface} from 'node:readline';
import {initializeApp, deleteApp, setLogLevel as setFirebaseLogLevel} from 'firebase/app';
import {getAuth, setPersistence, inMemoryPersistence, createUserWithEmailAndPassword, updateProfile,
  getIdToken, reload, reauthenticateWithCredential, EmailAuthProvider} from 'firebase/auth';
import {getFirestore, doc, setDoc, updateDoc, collection, query, where, limit, runTransaction,
  serverTimestamp, increment, getDocFromServer, getDocsFromServer, setLogLevel, Timestamp} from 'firebase/firestore';
import {getFunctions, httpsCallable} from 'firebase/functions';
import {getStorage, ref, uploadBytes, uploadBytesResumable, getMetadata} from 'firebase/storage';

const PROJECT = 'seconde-dev';
const REGION = 'northamerica-northeast1';
const args = process.argv.slice(2);
const requiredFlags = ['--run', '--deployed-ready', '--allow-admin-verification'];
const flags = new Set([...requiredFlags, '--pause-on-error', '--environment-proof', '--fresh-erasure-only', '--qualification-window-minutes', '--completed-local-erasure', '--completed-postal-erasure', '--late-storage-composite-proof']);
const erasureOnly = args.includes('--fresh-erasure-only');
const completedLocalErasure = args.includes('--completed-local-erasure');
const completedPostalErasure = args.includes('--completed-postal-erasure');
const completedAgreementErasure = completedLocalErasure || completedPostalErasure;
assert(!completedPostalErasure || erasureOnly, '--completed-postal-erasure requires --fresh-erasure-only.');
assert(!(completedLocalErasure && completedPostalErasure), 'Choose one completed agreement fixture.');
assert(args.filter(value => value === '--completed-postal-erasure').length <= 1, 'One postal fixture option is allowed.');
assert(!completedLocalErasure || erasureOnly, '--completed-local-erasure requires --fresh-erasure-only.');
assert(args.filter(value => value === '--completed-local-erasure').length <= 1, 'One completed-local-erasure option is allowed.');
let environmentPath, lateCompositePath, qualificationWindowMinutes = 10, qualificationWindowProvided = false;
for (let i = 0; i < args.length; i++) {
  assert(flags.has(args[i]), 'Unknown runner argument.');
  if (args[i] === '--environment-proof') {
    assert(!environmentPath && typeof args[i + 1] === 'string' && !args[i + 1].startsWith('--'), 'One environment proof path is required.');
    environmentPath = args[++i];
  } else if (args[i] === '--qualification-window-minutes') {
    assert(!qualificationWindowProvided && erasureOnly && /^(?:[1-8][0-9]|90)$/.test(args[i + 1] ?? ''),
      'One integer qualification window from 10 to 90 minutes requires --fresh-erasure-only.');
    qualificationWindowProvided = true; qualificationWindowMinutes = Number(args[++i]);
  } else if (args[i] === '--late-storage-composite-proof') {
    const path = args[i + 1];
    assert(!lateCompositePath && erasureOnly && typeof path === 'string' && /^(?:\/tmp\/|\/private\/tmp\/).+\.json$/.test(path) &&
      !path.split('/').includes('..') && !/[\u0000-\u001f]/.test(path), 'One private /tmp JSON composite proof path requires fresh erasure.');
    lateCompositePath = args[++i];
  }
}
const config = JSON.parse(await readFile(new URL('../config/firebaseProjects.json', import.meta.url), 'utf8')).development;
const manifest = JSON.parse(await readFile(new URL('../functions/phase1-release.json', import.meta.url), 'utf8'));
const aliases = new Map(manifest.versionedFunctions.map(({original, name}) => [original, name]));
assert.equal(config.projectId, PROJECT); assert.equal(manifest.projects.dev, PROJECT);
assert.equal(config.authDomain, `${PROJECT}.firebaseapp.com`);
assert.equal(config.storageBucket, `${PROJECT}.firebasestorage.app`);
assert.equal(aliases.size, 36, 'This runner targets the qualified set of 36 contracts, including manual postal swaps.');
for (const [original, name] of aliases) assert.equal(name, `${original}V2`);
for (const key of ['FIRESTORE_EMULATOR_HOST', 'FIREBASE_AUTH_EMULATOR_HOST', 'FIREBASE_STORAGE_EMULATOR_HOST', 'FUNCTIONS_EMULATOR']) {
  assert(!process.env[key], 'This recipe targets the isolated Dev cloud only.');
}
assert(!process.env.EXPO_PUBLIC_APP_ENV || process.env.EXPO_PUBLIC_APP_ENV === 'development', 'Production is forbidden.');
const stages = erasureOnly ? ['new-synthetic-owner-and-peer', ...(completedAgreementErasure ? ['new-owner-financial-read-absence'] : []),
  'new-owned-chat-media-generations', ...(completedLocalErasure ? ['completed-local-cash-agreement-before-erasure'] : completedPostalErasure ? ['completed-postal-agreement-before-erasure'] : []),
  'late-upload-paused-before-request', 'confirmed-erasure-v1', 'anonymous-observation-after-auth-closure', 'native-absence-verification',
  ...(completedAgreementErasure ? ['private-terminal-contract-retention-verification'] : []), 'peer-account-preserved-and-paused'] : ['synthetic-signup-v2', 'draft-upload-and-publication-v2', 'native-owner-edit-and-favorites',
  'sdk-chat-text-photo-and-private-reader-v2', 'source-bound-message-and-article-reports-v2',
  'cash-meetup-with-privacy-and-completion', 'cash-cancellation-and-absence',
  'local-swap-privacy-two-receptions-and-reviews', 'proposal-decline-and-cancel',
  'owner-support-receipts', 'public-withdrawal-and-account-pause', 'erasure-review-refusal'];
if (!requiredFlags.every(flag => args.includes(flag))) {
  console.log(JSON.stringify({project: PROJECT, state: 'prepared_only', cloudActions: 0, aliases: aliases.size, stages,
    requiredFlags, environmentProofRequired: true, credentialsPersisted: false,
    ...(erasureOnly ? {completedLocalErasure, completedPostalErasure, compositeProofConfigured: !!lateCompositePath, qualificationWindowMinutes,
      observationPauseMinutes: 15, pauseRenewal: 'explicit observe only'} : {}),
    limits: ['operator decision not exercised', erasureOnly ? 'erasure not run before deployment qualification' : 'no completed erasure claim', 'no physical handover or device push proof']}));
  process.exit(0);
}
assert(environmentPath, 'Supply the root-qualified, nonsecret phase1 Dev environment proof.');
const environment = JSON.parse(await readFile(environmentPath, 'utf8'));
for (const [key, value] of Object.entries({SECONDE_ENV: 'development',
  FINANCIAL_RECOVERY_ENVIRONMENT: 'unconfigured', FINANCIAL_RECOVERY_FIRESTORE_PROJECT_ID: PROJECT,
  FINANCIAL_RECOVERY_FIRESTORE_DATABASE_ID: '(default)', PAYMENTS_ENABLED: 'false', SHIPPING_ENABLED: 'false'})) {
  assert.equal(environment[key], value, `Unqualified environment key: ${key}`);
}
if (environment.SECONDE_PROJECT_ID !== undefined) assert.equal(environment.SECONDE_PROJECT_ID, PROJECT);
assert.equal(environment.SECONDE_PHASE1_RUNTIME_SERVICE_ACCOUNT, `seconde-phase1-runtime@${PROJECT}.iam.gserviceaccount.com`);
assert.equal(environment.FINANCIAL_RECOVERY_BUCKET, 'seconde-dev-phase1-controls');
assert.equal(environment.FINANCIAL_RECOVERY_CONTROL_OBJECT, 'control/current.json');
assert(!environment.FINANCIAL_RECOVERY_STRIPE_ACCOUNT_ID, 'No financial provider may be claimed.');
assert.equal(typeof environment.FINANCIAL_RECOVERY_INSTALLATION_ID, 'string');
assert(environment.FINANCIAL_RECOVERY_INSTALLATION_ID.startsWith('phase1_dev_'));
setFirebaseLogLevel('silent'); setLogLevel('silent');

const shared = new Set(['getMyEligibility', 'getUserPublicProfile', 'getUserReviews', 'getWalletInfo', 'withdrawArticlePrivacy',
  'getStripeAccountStatus', 'checkTrackingStatus', 'openSwapDispute', 'resolveSwapDispute',
  'readPrivateArticleEvidence', 'readPrivateArticleMedia', 'readSupportRequests', 'commandSupportRequest']);
// These Dev-only views retain the unconfigured release profile while the
// ordinary Dev names keep their existing commerce TEST runtime and bindings.
const devSharedCallables = Object.freeze({
  getMyEligibility: 'getMyEligibilityPhase1Dev',
  getWalletInfo: 'getWalletInfoPhase1Dev',
  getStripeAccountStatus: 'getStripeAccountStatusPhase1Dev',
  checkTrackingStatus: 'checkTrackingStatusPhase1Dev',
  openSwapDispute: 'openSwapDisputePhase1Dev',
  resolveSwapDispute: 'resolveSwapDisputePhase1Dev',
  readSupportRequests: 'readSupportRequestsPhase1Dev',
  commandSupportRequest: 'commandSupportRequestPhase1Dev',
  administerSupportRequest: 'administerSupportRequestPhase1Dev',
});
const runId = randomUUID().replaceAll('-', '');
const startedAt = Date.now();
const members = [], items = [], completed = [];
const owned = new Map();
const diagnosticTargets = new Map();
let administratorToken, input, temporaryDirectory, fixture, step = 'preflight', failed = false;
const hash = value => createHash('sha256').update(typeof value === 'string' ? value : JSON.stringify(value)).digest('hex');
const bytesHash = value => createHash('sha256').update(value).digest('hex');
// Mirrors the native account-erasure source digest for this bounded SDK
// transaction DTO. Unknown SDK objects fail rather than being JSON-coerced.
function erasureSourceHash(value) {
  const ancestors = new Set();
  const canonical = (v, depth = 0) => {
    assert(depth <= 40, 'Oversized native-source nesting.');
    if (v === undefined) return ['absent'];
    if (v === null) return ['null'];
    if (typeof v === 'string') return ['string', v];
    if (typeof v === 'boolean') return ['boolean', v];
    if (typeof v === 'number') {assert(Number.isFinite(v)); return ['number', Object.is(v, -0) ? '-0' : String(v)];}
    if (v instanceof Timestamp) return ['timestamp', v.seconds, v.nanoseconds];
    assert(typeof v === 'object' && !ancestors.has(v) && (Array.isArray(v) || [Object.prototype, null].includes(Object.getPrototypeOf(v))),
      'Unqualified SDK value in the retained native transaction.');
    ancestors.add(v);
    const result = Array.isArray(v) ? ['array', v.map(x => canonical(x, depth + 1))] :
      ['map', Object.keys(v).sort().map(key => [key, canonical(v[key], depth + 1)])];
    ancestors.delete(v); return result;
  };
  const encoded = JSON.stringify(canonical(value)); assert(Buffer.byteLength(encoded) <= 2_000_000);
  return createHash('sha256').update(encoded).digest('hex');
}
const privateUploadMetadata = {contentType: 'image/jpeg', cacheControl: 'private, no-store, max-age=0',
};
const privateMediaUrl = path => `https://firebasestorage.googleapis.com/v0/b/${config.storageBucket}/o/${encodeURIComponent(path)}?alt=media`;
const stamp = value => value?.toMillis?.() ?? null;
const mark = (next, facts = {}) => {
  step = next;
  console.log(JSON.stringify({at: new Date().toISOString(), project: PROJECT, runId, step, ...facts}));
};
function safeError(error) {
  const safe = {code: typeof error?.code === 'string' ? error.code.replace(/[^A-Za-z0-9_/-]/g, '').slice(0, 100) : 'recipe_failed'};
  if (Number.isSafeInteger(error?.status) && error.status >= 100 && error.status <= 599) safe.providerHttpStatus = error.status;
  // Preserve only a numeric provider status, never a raw response, URL or token.
  try {
    const raw = error?.serverResponse ?? error?.customData?.serverResponse;
    const status = typeof raw === 'string' && raw.length < 32_000 ? JSON.parse(raw)?.error?.code : null;
    if (Number.isSafeInteger(status) && status >= 100 && status <= 599) safe.providerHttpStatus = status;
  } catch {}
  for (const key of ['reason', 'field', 'action']) if (typeof error?.details?.[key] === 'string' && /^[A-Za-z0-9_.:/-]{1,120}$/.test(error.details[key])) safe[key] = error.details[key];
  return safe;
}
function assertionFrame(error) {
  if(error?.code!=='ERR_ASSERTION')return undefined;
  const point=typeof error.stack==='string'?error.stack.match(/smoke-phase1-dev\.mjs:(\d+):(\d+)/):null;
  const known=new Set(['cash','meetup','meetup_pending','meetup_confirmed','meetup_completed','available','engaged','consumed',
    'completed','pending','recorded','unrecorded','native_current','local_agreement_source_v1','local_catalogue_source_v1',
    'private_article_media_v1','article_inventory_unit_view_v1']);
  const scalar=value=>value===undefined?{type:'undefined'}:value===null?{type:'null'}:typeof value==='boolean'?{type:'boolean',value}:
    typeof value==='number'?{type:'number',finite:Number.isFinite(value),...([0,1].includes(value)?{value}:{})}:
    typeof value==='string'?{type:'string',length:value.length,...(known.has(value)?{value}:{sha256:hash(value)})}:
    Array.isArray(value)?{type:'array',length:value.length}:{type:typeof value,keys:value&&typeof value==='object'?Object.keys(value).length:0};
  const result={line:point?Number(point[1]):null,column:point?Number(point[2]):null,
    operator:['strictEqual','deepStrictEqual','notStrictEqual','notDeepStrictEqual','==','!='].includes(error.operator)?error.operator:'assert',
    actual:scalar(error.actual),expected:scalar(error.expected)};
  if(error.actual&&error.expected&&typeof error.actual==='object'&&typeof error.expected==='object'&&!Array.isArray(error.actual)&&!Array.isArray(error.expected)){
    const allowed=new Set(['updatedAt','createdAt','articlePrivacyWithdrawal','articlePrivacyWithdrawals','cashAgreement','localAgreementWitness',
      'exchangeAgreement','status','amount','shippingCost','serviceFee','inventoryUnitCommitment','meetupSpot','meetupDate']);
    const changed=[...new Set([...Object.keys(error.actual),...Object.keys(error.expected)])].filter(key=>!isDeepStrictEqual(error.actual[key],error.expected[key]));
    result.changedKnownFields=changed.filter(key=>allowed.has(key));result.changedOtherFieldCount=changed.filter(key=>!allowed.has(key)).length;
  }
  return result;
}
function watchNative(member,root,id){
  assert(owned.has(member.uid)&&['articles','messages','transactions','swaps','article_privacy_evidence'].includes(root)&&typeof id==='string'&&!id.includes('/'));
  diagnosticTargets.set(root,{member,root,id});
}
async function diagnoseNativeReadOnly(){
  const safeStates=new Set(['pending','accepted','completed','meetup_pending','meetup_confirmed','meetup_completed','cancelled','disputed','proposed','declined','recorded','unrecorded','needs_review']);
  for(const {member,root,id}of diagnosticTargets.values()){
    try{
      const snapshot=await getDocFromServer(doc(member.db,root,id)),value=snapshot.data();
      const data={root,referenceHash:hash([root,id]),exists:snapshot.exists()};
      if(value){
        const protocol=v=>['local_agreement_source_v1','local_catalogue_source_v1','cash_meetup_agreement_v1','swap_exchange_agreement_v1'].includes(v)?v:'other_or_absent';
        Object.assign(data,{state:safeStates.has(value.status??value.state)?value.status??value.state:'other_or_absent',
          isActive:typeof value.isActive==='boolean'?value.isActive:null,isSold:typeof value.isSold==='boolean'?value.isSold:null,
          imagesCount:Array.isArray(value.images)?value.images.length:null,privateMediaCount:Array.isArray(value.media)?value.media.length:null,
          assetScanComplete:value.assetScanComplete===true,contractCaptureComplete:value.contractCaptureComplete===true,
          publicProjectionScanComplete:value.publicProjectionScanComplete===true,updatedAtMs:stamp(value.updatedAt),
          localWitnessProtocol:protocol(value.localAgreementWitness?.protocol),catalogueWitnessProtocol:protocol(value.localCatalogueWitness?.protocol),
          cashProtocol:protocol(value.cashAgreement?.protocol),privacyMarkerPresent:Object.hasOwn(value,'articlePrivacyWithdrawal')||Object.hasOwn(value,'articlePrivacyWithdrawals')||Object.hasOwn(value,'privacyWithdrawal'),
          imageGenerationPresent:typeof value.image?.generation==='string',thumbnailGenerationPresent:typeof value.image?.thumbnailGeneration==='string'});
      }
      console.log(JSON.stringify({project:PROJECT,runId,step,operation:'fatal_diagnostic_read_only',...data}));
    }catch(error){console.error(JSON.stringify({project:PROJECT,runId,step,operation:'fatal_diagnostic_read_only',root,...safeError(error)}));}
  }
}
async function uploadFixture(member, object) {
  for (let attempt = 0; attempt < 3; attempt++) {
    try {await uploadBytes(object, new Uint8Array(fixture.bytes), privateUploadMetadata); return;}
    catch (error) {
      const diagnostic = {operation: 'own_synthetic_draft_upload', role: member.role, ...safeError(error)};
      console.error(JSON.stringify({project: PROJECT, runId, step, ...diagnostic}));
      let next = await instruction(diagnostic, ['stop', 'observe-upload', 'retry-upload-exact']);
      if (next === 'observe-upload') {
        try {
          const metadata = await getMetadata(object);
          assert.equal(metadata.size, fixture.bytes.length);
          assert.equal(metadata.contentType, 'image/jpeg');
          assert.equal(metadata.md5Hash, createHash('md5').update(fixture.bytes).digest('base64'));
          assert.equal(metadata.cacheControl, privateUploadMetadata.cacheControl);
          // Native ownership/rules protect this staging reference. Never
          // distribute the token the provider may create; promotion revokes it.
          mark('own-synthetic-upload-observed', {role: member.role, matchingFixture: true});
          return;
        } catch (observed) {
          if (observed?.code !== 'storage/object-not-found') throw observed;
          next = await instruction({operation: 'own_synthetic_draft_absent', role: member.role}, ['stop', 'retry-upload-exact']);
        }
      }
      if (next !== 'retry-upload-exact' || attempt === 2) throw error;
    }
  }
}
async function instruction(context, choices) {
  if (!args.includes('--pause-on-error')) return 'stop';
  input ??= createInterface({input: process.stdin, terminal: false});
  console.log(JSON.stringify({project: PROJECT, runId, step, state: 'paused_sessions_in_memory', context, choices,
    instruction: 'Root must diagnose first. Mutations never retry automatically; replay-exact repeats only the same bound payload.'}));
  return new Promise(resolve => {
    const line = value => {
      if (!choices.includes(value.trim())) return;
      clearTimeout(timer); input.off('line', line); resolve(value.trim());
    };
    const timer = setTimeout(() => {input.off('line', line); resolve('stop');}, 15 * 60_000);
    input.on('line', line);
  });
}
function accessToken() {
  if (administratorToken) return administratorToken;
  const result = spawnSync('gcloud', ['auth', 'print-access-token', '--project', PROJECT], {encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe']});
  assert.equal(result.status, 0, 'Dev email-verification credential unavailable.');
  administratorToken = result.stdout.trim(); assert(administratorToken);
  return administratorToken;
}
async function verifySyntheticEmail(member) {
  assert.equal(owned.get(member.uid), member.email);
  const request = async (action, body) => {
    assert(['lookup', 'update'].includes(action));
    const response = await fetch(`https://identitytoolkit.googleapis.com/v1/projects/${PROJECT}/accounts:${action}`, {
      method: 'POST', headers: {Authorization: `Bearer ${accessToken()}`, 'Content-Type': 'application/json', 'x-goog-user-project': PROJECT},
      body: JSON.stringify(body), signal: AbortSignal.timeout(20_000),
    });
    assert(response.ok, `Own synthetic email verification failed (${response.status}).`);
    return response.json();
  };
  const selected = (await request('lookup', {localId: [member.uid]})).users?.find(user => user.localId === member.uid && user.email === member.email);
  assert(selected && Number(selected.createdAt) >= startedAt, 'Only this run’s newly created identities may be verified.');
  await request('update', {localId: member.uid, emailVerified: true});
  await reload(member.auth.currentUser); await getIdToken(member.auth.currentUser, true);
  assert.equal(member.auth.currentUser.emailVerified, true);
}
async function call(member, original, data = {}, options = {}) {
  const name = aliases.get(original) ?? devSharedCallables[original] ?? original;
  assert(aliases.has(original) || shared.has(original), 'Callable outside the nonfinancial recipe.');
  if(['confirmMeetupTransaction','completeMeetupTransaction','reportMeetupNoShow','cancelPendingTransaction'].includes(original)) {
    assert.equal(data.expectedUid,member.uid,'The current SDK actor must be explicit before dispatch.');
  }
  for (let attempt = 0; ; attempt++) {
    try {return (await httpsCallable(member.functions, name, {timeout: 120_000})(data)).data;}
    catch (error) {
      if (options.expectedRefusal) throw error;
      const diagnostic = {callable: name, ...safeError(error)};
      console.error(JSON.stringify({project: PROJECT, runId, step, ...diagnostic}));
      if (attempt >= 2) throw error;
      const choices = ['stop', ...(options.readOnly ? ['retry-read'] : options.replayable ? ['replay-exact'] : []), ...(options.observe ? ['observe'] : [])];
      const next = await instruction(diagnostic, choices);
      if (next === 'observe') return options.observe();
      if (!['retry-read', 'replay-exact'].includes(next)) throw error;
    }
  }
}
async function read(member, root, id) {
  const snapshot = await getDocFromServer(doc(member.db, root, id));
  assert(snapshot.exists(), `Expected native ${root} source missing.`);
  return snapshot.data();
}
async function expectRefusal(work, codes = ['functions/failed-precondition', 'functions/permission-denied']) {
  let result;
  try {await work();} catch (error) {result = error;}
  assert(result && codes.includes(result.code), 'Expected an explicit bounded refusal.');
  return result;
}
async function prepareFixture() {
  temporaryDirectory = await mkdtemp(join(tmpdir(), 'seconde-phase1-sdk-fixture-'));
  const destination = join(temporaryDirectory, 'fixture.jpg');
  let source = new URL('../assets/images/favicon.png', import.meta.url).pathname;
  if (erasureOnly) {
    // Technical random pixels only; enough entropy for a real multipart
    // resumable JPEG after the same 1200px / quality .75 compression.
    source = join(temporaryDirectory, 'synthetic-noise.bmp');
    const pixels = randomBytes(1200 * 1200 * 3), header = Buffer.alloc(54);
    header.write('BM'); header.writeUInt32LE(54 + pixels.length, 2); header.writeUInt32LE(54, 10);
    header.writeUInt32LE(40, 14); header.writeInt32LE(1200, 18); header.writeInt32LE(1200, 22);
    header.writeUInt16LE(1, 26); header.writeUInt16LE(24, 28); header.writeUInt32LE(pixels.length, 34);
    await writeFile(source, Buffer.concat([header, pixels]), {mode: 0o600});
  }
  const result = spawnSync('sips', ['--resampleHeightWidthMax', '1200', '-s', 'format', 'jpeg', '-s', 'formatOptions', '75', source, '--out', destination], {encoding: 'utf8'});
  assert.equal(result.status, 0, 'Synthetic image compression failed.');
  await chmod(destination, 0o600);
  const dimensions = spawnSync('sips', ['-g', 'pixelWidth', '-g', 'pixelHeight', destination], {encoding: 'utf8'});
  assert.equal(dimensions.status, 0);
  const width = Number(dimensions.stdout.match(/pixelWidth:\s*(\d+)/)?.[1]);
  const height = Number(dimensions.stdout.match(/pixelHeight:\s*(\d+)/)?.[1]);
  const bytes = await readFile(destination);
  assert(width > 0 && height > 0 && width <= 1200 && height <= 1200 && bytes.length > 0 && bytes.length < 10 * 1024 * 1024);
  if (erasureOnly) assert(width === 1200 && height === 1200 && bytes.length > 256 * 1024,
    'The late-upload fixture requires a genuine compressed JPEG larger than one resumable chunk.');
  fixture = {bytes, width, height};
  mark('synthetic-image-compressed', {width, height, bytes: bytes.length, quality: 75});
}
async function createMember(role) {
  const desiredUsername = `p1${runId.slice(0, 12)}${members.length}`;
  assert(/^[a-z0-9_]{3,20}$/.test(desiredUsername), 'Synthetic username must pass the real signup contract before Auth creation.');
  mark('synthetic-signup-v2', {role});
  const app = initializeApp(config, `phase1-${role}-${runId}`), auth = getAuth(app);
  const member = {role, app, auth, db: getFirestore(app), functions: getFunctions(app, REGION), storage: getStorage(app),
    name: `TEST DEV PHASE1 ${role}`, email: `phase1-${role}-${runId}@seconde-smoke.test`, uid: null, paused: false};
  members.push(member); await setPersistence(auth, inMemoryPersistence);
  const password = `${randomBytes(30).toString('base64url')}aA1!`;
  const {user} = await createUserWithEmailAndPassword(auth, member.email, password);
  member.uid = user.uid; owned.set(user.uid, member.email);
  member.reauthenticate = async () => {await reauthenticateWithCredential(user, EmailAuthProvider.credential(member.email, password)); await getIdToken(user, true);};
  member.call = (name, data, options) => call(member, name, data, options);
  await updateProfile(user, {displayName: member.name});
  await setDoc(doc(member.db, 'users', member.uid), {id: member.uid, email: member.email, displayName: member.name,
    createdAt: serverTimestamp(), isActive: true, authProvider: 'email'});
  const before = await member.call('getMyEligibility', {}, {readOnly: true});
  const consent = await member.call('recordSignupConsent', {dateOfBirth: '1990-04-12', acceptedTerms: true, acceptedPrivacy: true,
    marketingOptIn: false, desiredUsername, policyVersion: signupPolicy.version,
    sellerActivityDeclaration: {kind: 'personal', statementVersion: before.statementVersion, personalDeclarationAccepted: true,
      expectedVersion: before.version, requestId: `signup_${role}_${runId}`, expectedUid: member.uid}}, {replayable: true});
  assert.equal(consent.ok, true); await verifySyntheticEmail(member);
  const current = await member.call('getMyEligibility', {}, {readOnly: true});
  const declaration = {kind: 'personal', statementVersion: current.statementVersion, personalDeclarationAccepted: true,
    expectedVersion: current.version, requestId: `qc_${role}_${runId}`, expectedUid: member.uid,
    quebecResidenceDeclaration: {version: current.quebecResidenceStatementVersion, country: 'CA', province: 'QC', accepted: true}};
  assert.equal((await member.call('declareSellerActivity', declaration, {replayable: true})).recorded, true);
  const after = await member.call('getMyEligibility', {}, {readOnly: true});
  assert.equal(after.decisions.sell.allowed, true); assert.equal(after.swapLaunch.allowed, true);
  const object = ref(member.storage, `drafts/${member.uid}/phase1-${runId}/fixture.jpg`);
  await uploadFixture(member, object);
  member.imageUrl = privateMediaUrl(object.fullPath);
  assert.equal(new URL(member.imageUrl).hostname, 'firebasestorage.googleapis.com');
  assert(new URL(member.imageUrl).pathname.includes(`/b/${config.storageBucket}/`));
  mark('member-admitted-and-draft-uploaded', {role, ownIdentityHash: hash(member.uid)});
  return member;
}
const signupPolicy = JSON.parse(await readFile(new URL('../functions/src/shared/signupConsentPolicy.json', import.meta.url), 'utf8'));
async function listing(member, name, deposit = false) {
  mark('draft-upload-and-publication-v2', {role: member.role, fixture: name});
  const payload = {clientRequestId: `phase1_${name}_${runId}`, title: `TEST DEV PHASE1 ${name} ${runId.slice(0, 8)}`,
    description: 'Fixture synthétique de recette. Pictogramme technique ; aucun vêtement, rendez-vous, paiement ou envoi réel.',
    price: 20, quantity: 1, stock: 1, images: [{url: member.imageUrl}], category: 'T-shirts',
    categoryIds: ['women', 'women_clothing', 'women_clothing_tops', 'women_clothing_tops_tshirts'],
    condition: 'très bon état', brand: null, size: {value: 'M', system: 'EU'}, isHandDelivery: true, isShipping: false,
    neighborhoods: [{id: 'downtown', name: 'Centre-ville', borough: 'Ville-Marie'}]};
  const result = await member.call('createArticle', payload, {replayable: true});
  assert.equal(result.articleId, createHash('sha256').update(`${member.uid}:${payload.clientRequestId}`).digest('hex').slice(0, 20));
  assert.equal((await member.call('createArticle', payload, {replayable: true})).articleId, result.articleId);
  const article = await read(member, 'articles', result.articleId);
  assert.equal(article.sellerId, member.uid); assert.equal(article.isActive, true);
  assert.equal(article.isShipping, false); assert.equal(article.quantity, 1);
  assert.equal(article.localCatalogueWitness?.protocol, 'local_catalogue_source_v1');
  assert.equal(article.localCatalogueWitness.installationId, environment.FINANCIAL_RECOVERY_INSTALLATION_ID);
  assert(!Object.hasOwn(article, 'financialRecoveryWitness'));
  const item = {member, articleId: result.articleId, title: article.title, price: article.price, imageUrl: article.images[0].url, name, withdrawn: false};
  assert(decodeURIComponent(new URL(item.imageUrl).pathname).includes(`/articles/${item.articleId}/`));
  items.push(item);
  watchNative(member,'articles',item.articleId);
  if (deposit) await depositItem(item);
  return item;
}
async function depositItem(item) {
  const member = item.member, input = {expectedUid: member.uid, partyId: 'generalist', articleId: item.articleId,
    title: item.title, price: item.price, imageUrl: item.imageUrl, userName: member.name};
  const receipt = await member.call('addItemToPartySecure', input, {replayable: true});
  assert.equal(receipt.success, true); item.itemId = receipt.itemId;
  assert.equal((await member.call('addItemToPartySecure', input, {replayable: true})).itemId, item.itemId);
}
async function inventory(item, expected) {
  const value = await item.member.call('updateArticle', {mode: 'inventory_unit', articleId: item.articleId, expectedUid: item.member.uid}, {readOnly: true});
  assert.equal(value.protocol, 'article_inventory_unit_view_v1'); assert.equal(value.qualification, 'native_current');
  assert.equal(value.availability, expected);
  const article = await read(item.member, 'articles', item.articleId);
  assert.equal(article.isSold, expected !== 'available');
  return article;
}
async function editAndFavorite(owner, other, item) {
  mark('native-owner-edit-and-favorites');
  const before = await owner.call('updateArticle', {articleId: item.articleId, mode: 'declaration_observe', expectedUid: owner.uid}, {readOnly: true});
  assert.equal(before.qualification, 'matching_listing_content');
  const updates = {description: 'Fixture synthétique corrigée par son propriétaire. Aucun bien réel.', expectedSaleDeclarationContentHash: before.currentContentHash};
  const payload = {articleId: item.articleId, updates};
  assert.equal((await owner.call('updateArticle', payload, {replayable: true})).success, true);
  const receipt = await owner.call('updateArticle', payload, {replayable: true}); assert.equal(receipt.replayed, true);
  await expectRefusal(() => other.call('updateArticle', {articleId: item.articleId, updates: {description: 'Tentative de recette non propriétaire.'}}, {expectedRefusal: true}));
  await other.call('toggleProductLike', {productId: item.articleId, isLiked: true}, {replayable: true});
  assert((await read(other, 'favorites', other.uid)).articleIds.includes(item.articleId));
  await other.call('toggleProductLike', {productId: item.articleId, isLiked: false}, {replayable: true});
  assert(!(await read(other, 'favorites', other.uid)).articleIds.includes(item.articleId));
  const profile = await other.call('getUserPublicProfile', {userId: owner.uid}, {readOnly: true});
  assert.equal(profile.profile.displayName, owner.name);
}
async function chat(seller, buyer, item) {
  const participants = [seller.uid, buyer.uid].sort(), id = `${participants.join('__')}__${item.articleId}`;
  const target = doc(buyer.db, 'chats', id);
  await runTransaction(buyer.db, async tx => {
    const previous = await tx.get(target);
    if (!previous.exists()) tx.set(target, {participants, participantsInfo: [seller, buyer].map(m => ({userId: m.uid, userName: m.name})),
      unreadCount: {[seller.uid]: 0, [buyer.uid]: 0}, createdAt: serverTimestamp(), updatedAt: serverTimestamp(),
      sellerId: seller.uid, articleId: item.articleId, articleTitle: item.title, articleImage: item.imageUrl, articlePrice: item.price});
  });
  assert.deepEqual((await read(seller, 'chats', id)).participants, participants);
  return {id, seller, buyer, item};
}
async function sendSdkMessage(sender, receiver, c, suffix, image) {
  const id = `phase1_${suffix}_${runId}`, target = doc(sender.db, 'messages', id);
  const data = {chatId: c.id, senderId: sender.uid, receiverId: receiver.uid, participants: [sender.uid, receiver.uid].sort(),
    type: image ? 'image' : 'text', content: image ? 'Photo' : 'Message synthétique de recette ; aucune proposition réelle.',
    timestamp: serverTimestamp(), status: 'sent', isRead: false, ...(image ? {image} : {})};
  await setDoc(target, data);
  await updateDoc(doc(sender.db, 'chats', c.id), {lastMessage: image ? 'Photo' : data.content, lastMessageType: data.type,
    lastMessageTimestamp: serverTimestamp(), updatedAt: serverTimestamp(), [`unreadCount.${receiver.uid}`]: increment(1)});
  assert.equal((await read(receiver, 'messages', id)).type, data.type);
  return id;
}
async function chatAndReports(a, b, item) {
  mark('sdk-chat-text-photo-and-private-reader-v2');
  const c = await chat(a, b, item);
  const textId = await sendSdkMessage(a, b, c, 'text');
  const imagePath = `chat_images/${c.id}/${a.uid}/phase1_${runId}.jpg`, object = ref(a.storage, imagePath);
  const thumbnailPath = `chat_images/${c.id}/${a.uid}/phase1_${runId}_thumb.jpg`, thumbnail = ref(a.storage, thumbnailPath);
  const [imageUpload, thumbnailUpload] = await Promise.all([
    uploadBytes(object, new Uint8Array(fixture.bytes), privateUploadMetadata),
    uploadBytes(thumbnail, new Uint8Array(fixture.bytes), privateUploadMetadata),
  ]);
  const generation = imageUpload.metadata.generation, thumbnailGeneration = thumbnailUpload.metadata.generation;
  assert([generation, thumbnailGeneration].every(value => typeof value === 'string' && /^[1-9][0-9]{0,31}$/.test(value)),
    'Native chat upload generations are required.');
  const imageUrl = privateMediaUrl(imagePath);
  const imageId = await sendSdkMessage(a, b, c, 'image', {url: imageUrl, thumbnail: privateMediaUrl(thumbnailPath),
    generation, thumbnailGeneration, width: fixture.width, height: fixture.height});
  const nativeImage = (await read(b, 'messages', imageId)).image;
  assert.equal(nativeImage.generation, generation); assert.equal(nativeImage.thumbnailGeneration, thumbnailGeneration);
  const sourceReferenceHash = hash(['chat_message_image_reference_v1', config.storageBucket, imagePath]);
  const pixels = await b.call('submitReport', {operation: 'readChatMessageImage', capability: 'chat_message_image_v1',
    expectedUid: b.uid, chatId: c.id, messageId: imageId, fileKind: 'image', sourceReferenceHash}, {readOnly: true});
  assert.equal(pixels.protocol, 'chat_message_image_v1'); assert.equal(pixels.sourceReferenceHash, sourceReferenceHash);
  assert.equal(pixels.size, fixture.bytes.length); assert.equal(bytesHash(Buffer.from(pixels.dataUrl.split(',')[1], 'base64')), bytesHash(fixture.bytes));
  mark('source-bound-message-and-article-reports-v2');
  const preview = await b.call('submitReport', {operation: 'previewMessageReport', capability: 'message_report_v1',
    expectedUid: b.uid, chatId: c.id, messageId: textId, transactionId: null}, {readOnly: true});
  assert.equal(preview.source.qualification, 'native_message');
  const command = {chatId: c.id, messageId: textId, transactionId: null, previewId: preview.previewId,
    sourceHash: preview.source.sourceHash, sourceRevision: preview.source.sourceRevision, reason: 'other',
    description: 'Signalement synthétique technique. Aucun comportement réel signalé.',
    exposure: {linkOpened: 'declared_no', informationShared: 'declared_no', externalPaymentDeclared: 'declared_no'}, acknowledged: true};
  const input = {operation: 'messageReportCommand', capability: 'message_report_v1', expectedUid: b.uid,
    requestId: `message_report_${runId}`, mode: 'execute', command};
  const report = await b.call('submitReport', input, {replayable: true,
    observe: () => b.call('submitReport', {...input, mode: 'observe'}, {readOnly: true})});
  assert.equal(report.state, 'committed'); assert.equal(report.faultEstablished, false);
  assert.equal((await b.call('submitReport', {...input, mode: 'observe'}, {readOnly: true})).reportId, report.reportId);
  const article = await read(a, 'articles', item.articleId);
  const fields = ['title', 'description', 'price', 'images', 'condition', 'brand', 'brandStatus', 'categoryIds', 'size',
    'color', 'colors', 'material', 'materials', 'pattern', 'hasKnownDefects', 'defectsDescription', 'hasAlterations', 'alterationsDescription', 'quantity'];
  const examined = Object.fromEntries(fields.map(key => [key, key === 'images' ? article.images.map(i => ({url: i.url, blurhash: i.blurhash ?? null})) :
    key === 'size' && article.size ? {value: article.size.value ?? null, system: article.size.system ?? null} : article[key] ?? null]));
  const articlePreview = await b.call('submitReport', {operation: 'previewArticleReport', expectedUid: b.uid,
    targetId: item.articleId, expectedArticle: examined}, {readOnly: true});
  assert.equal(articlePreview.protocol, 'article_report_preview_v1');
  const articleInput = {targetType: 'article', targetId: item.articleId, expectedUid: b.uid, requestId: `article_report_${runId}`,
    reason: 'other', description: 'Signalement synthétique technique. Aucun problème de vêtement réel.',
    expectedArticleRevision: articlePreview.articleRevision, expectedArticleContentHash: articlePreview.contentHash, expectedMedia: articlePreview.expectedMedia};
  const articleReport = await b.call('submitReport', articleInput, {replayable: true,
    observe: () => b.call('submitReport', {operation: 'observeArticleReport', expectedUid: b.uid, targetId: item.articleId, requestId: articleInput.requestId}, {readOnly: true})});
  assert.equal(articleReport.protocol, 'article_report_receipt_v1'); assert.equal(articleReport.authenticityVerified, false);
  assert.notEqual(articleReport.state, 'unrecorded');
  completed.push('chat_and_source_bound_reports');
}
async function cashAgreement(seller, buyer, item, suffix) {
  const c = await chat(seller, buyer, item), messageId = `offer_${suffix}_${runId}`;
  const payload = {chatId: c.id, requestId: messageId, amount: item.price, location: {toArrange: true}};
  watchNative(buyer,'messages',messageId);
  const offer = await buyer.call('sendMeetupProposal', payload, {replayable: true}); assert.equal(offer.messageId, messageId);
  assert.equal((await buyer.call('sendMeetupProposal', payload, {replayable: true})).messageId, messageId);
  const receipt = await seller.call('acceptMeetupOffer', {chatId: c.id, messageId}, {replayable: true});
  watchNative(seller,'transactions',receipt.transactionId);
  const order = await read(seller, 'transactions', receipt.transactionId);
  assert.equal(order.paidVia, 'cash'); assert.equal(order.shippingCost, 0); assert.equal(order.serviceFee, 0);
  assert.equal(order.localAgreementWitness?.protocol, 'local_agreement_source_v1');
  assert.equal(order.localAgreementWitness.installationId, environment.FINANCIAL_RECOVERY_INSTALLATION_ID);
  assert(!Object.hasOwn(order, 'financialRecoveryWitness')); await inventory(item, 'engaged');
  return {...c, id: receipt.transactionId, chatId: c.id, messageId, order};
}
const without = (value, key) => Object.fromEntries(Object.entries(value).filter(([k]) => k !== key));
async function withdraw(item, context = {}) {
  const owner = item.member, requestId = `privacy_${item.name}_${runId}`;
  const payload = {articleId: item.articleId, expectedUid: owner.uid, requestId, mode: 'request'};
  watchNative(owner,'article_privacy_evidence',item.articleId);
  const receipt = await owner.call('withdrawArticlePrivacy', payload, {replayable: true,
    observe: () => owner.call('withdrawArticlePrivacy', {...payload, mode: 'observe'}, {readOnly: true})});
  mark('privacy-withdrawal-receipt-shape',{fixture:item.name,state:['pending','needs_review','completed','not_executed'].includes(receipt.state)?receipt.state:'other',
    intentCommitted:receipt.intentCommitted===true,publicWithdrawalComplete:receipt.publicWithdrawalComplete===true,
    mediaTotal:Number.isSafeInteger(receipt.mediaTotal)?receipt.mediaTotal:null,mediaRevoked:Number.isSafeInteger(receipt.mediaRevoked)?receipt.mediaRevoked:null});
  assert.equal(receipt.intentCommitted, true); assert.equal(receipt.publicWithdrawalComplete, true);
  assert.equal(receipt.state, 'completed'); assert.equal(receipt.mediaRevoked, receipt.mediaTotal);
  const replay = await owner.call('withdrawArticlePrivacy', payload, {replayable: true}); assert.equal(replay.operationId, receipt.operationId);
  const hidden = await read(owner, 'articles', item.articleId);
  assert.equal(hidden.isActive, false); assert.deepEqual(hidden.images, []); assert.equal(hidden.privacyWithdrawal.operationId, receipt.operationId);
  item.withdrawn = true;
  const evidence = await owner.call('readPrivateArticleEvidence', {articleId: item.articleId, expectedUid: owner.uid}, {readOnly: true});
  assert.equal(evidence.state, 'recorded'); assert.equal(evidence.publicReferenceUseAllowed, false);
  assert(evidence.mediaRefs.length > 0, 'This promoted synthetic JPEG must have a private copy.');
  const media = evidence.mediaRefs[0];
  const pixels = await owner.call('readPrivateArticleMedia', {articleId: item.articleId, expectedUid: owner.uid,
    evidenceId: media.evidenceId, mediaId: media.mediaId, sourceReferenceHash: media.sourceReferenceHash}, {readOnly: true});
  assert.equal(pixels.kind, 'private_article_media_v1'); assert.equal(pixels.generation, media.generation);
  assert.equal(bytesHash(Buffer.from(pixels.dataUrl.split(',')[1], 'base64')), bytesHash(fixture.bytes));
  if (context.member) {
    const ownContract = await context.member.call('readPrivateArticleEvidence', {articleId: item.articleId,
      expectedUid: context.member.uid, ...(context.transactionId ? {transactionId: context.transactionId} : {swapId: context.swapId})}, {readOnly: true});
    assert.equal(ownContract.state, 'recorded'); assert.equal(ownContract.contractId, context.transactionId ?? context.swapId);
  }
  return receipt;
}
async function cashRecipe(a, b) {
  mark('cash-meetup-with-privacy-and-completion');
  const item = await listing(a, 'cash_complete'), c = await cashAgreement(a, b, item, 'complete');
  const before = await read(a, 'transactions', c.id);
  await withdraw(item, {member: b, transactionId: c.id});
  assert.deepEqual(without(await read(a, 'transactions', c.id), 'articlePrivacyWithdrawal'), before);
  await inventory(item, 'engaged');
  await a.call('confirmMeetupTransaction', {transactionId: c.id, messageId: c.messageId, expectedUid: a.uid}, {replayable: true});
  const result = await b.call('completeMeetupTransaction', {transactionId: c.id, messageId: c.messageId, expectedUid: b.uid}, {replayable: true});
  assert.equal(result.success, true);
  const completedOrder = await read(a, 'transactions', c.id), at = stamp(completedOrder.meetupCompletedAt);
  assert.equal(completedOrder.status, 'meetup_completed'); assert(at);
  await b.call('completeMeetupTransaction', {transactionId: c.id, messageId: c.messageId, expectedUid: b.uid}, {replayable: true});
  assert.equal(stamp((await read(a, 'transactions', c.id)).meetupCompletedAt), at);
  await inventory(item, 'consumed');
  const review = {transactionId: c.id, targetUserId: a.uid, transactionType: 'achat', note: 5,
    text: 'Avis synthétique de recette, aucune transaction physique réelle.', articleId: item.articleId};
  await b.call('createReview', review, {replayable: true});
  assert.equal((await read(b, 'avis', `${b.uid}_${c.id}`)).note, 5);
  completed.push('cash_completion_privacy_review');

  mark('cash-cancellation-and-absence');
  for (const role of ['buyer', 'seller']) {
    const cancelledItem = await listing(a, `cash_cancel_${role}`), order = await cashAgreement(a, b, cancelledItem, `cancel_${role}`);
    const actor = role === 'buyer' ? b : a, name = role === 'buyer' ? 'cancelPendingTransaction' : 'sellerCancelTransaction';
    await actor.call(name, {transactionId: order.id, expectedUid: actor.uid}, {replayable: true});
    const native = await read(actor, 'transactions', order.id);
    assert.equal(native.status, 'cancelled'); assert.equal(native.localCancellation.moneyMoved, false);
    await inventory(cancelledItem, 'available');
  }
  const absentItem = await listing(a, 'cash_absence'), absent = await cashAgreement(a, b, absentItem, 'absence');
  const report = await b.call('reportMeetupNoShow', {transactionId: absent.id, expectedUid: b.uid, expectedDisputeId: null, reason: 'other_party_no_show',
    details: 'Déclaration synthétique de recette, aucun rendez-vous réel.'}, {replayable: true});
  assert.equal(report.reservationReleased, true);
  await a.call('reportMeetupNoShow', {transactionId: absent.id, expectedUid: a.uid, expectedDisputeId: report.disputeId, reason: 'other',
    details: 'Contre-récit synthétique technique, aucune faute réelle déclarée.'}, {replayable: true});
  await inventory(absentItem, 'available');
  completed.push('cash_buyer_seller_cancellation_and_absence');
}
async function proposal(a, b, own, other, suffix, exchangeMode = 'hand_delivery') {
  const arrangements = 'Rencontre synthétique de recette à Montréal. Aucun rendez-vous réel.';
  const source = (await a.call('getMyEligibility', {operation: 'swap_proposal_preview', expectedUid: a.uid, receiverId: b.uid,
    initiatorArticleIds: [own.articleId], receiverArticleIds: [other.articleId], exchangeMode,
    arrangements, message: null, cashTopUp: null}, {readOnly: true})).swapProposalPreview;
  assert.equal(source.protocol, 'swap_exchange_agreement_v1');
  const payload = {expectedUid: a.uid, initiatorId: a.uid, initiatorName: a.name, receiverId: b.uid, receiverName: b.name,
    initiatorItems: [{articleId: own.articleId, title: own.title, price: own.price}], receiverItems: [{articleId: other.articleId, title: other.title, price: other.price}],
    partyId: 'generalist', exchangeMode, arrangements, message: null, cashTopUp: null,
    agreementProtocol: source.protocol, expectedSourceHash: source.sourceHash, clientRequestId: `swap_${suffix}_${runId}`};
  const result = await a.call('proposeMultiSwap', payload, {replayable: true}); assert.equal(result.success, true);
  assert.equal((await a.call('proposeMultiSwap', payload, {replayable: true})).swapId, result.swapId);
  const value = await read(a, 'swaps', result.swapId); assert.equal(value.status, 'proposed'); assert.equal(value.cashTopUp, null);
  assert.equal(value.localAgreementWitness?.installationId, environment.FINANCIAL_RECOVERY_INSTALLATION_ID);
  assert(!Object.hasOwn(value, 'financialRecoveryWitness'));
  await inventory(own, 'available'); await inventory(other, 'available');
  return {id: result.swapId, own, other, payload, ack: {swapId: result.swapId, expectedUid: b.uid,
    agreementProtocol: source.protocol, expectedSourceHash: source.sourceHash}};
}
async function notice(member, swapId, status) {
  for (let attempt = 0; attempt < 30; attempt++) {
    const rows = await getDocsFromServer(query(collection(member.db, 'notifications'), where('userId', '==', member.uid), limit(100)));
    if (rows.docs.some(row => row.data().type === 'swap_update' && row.data().data?.swapId === swapId && row.data().data?.status === status)) return;
    if (attempt < 29) await new Promise(resolve => setTimeout(resolve, 1000));
  }
  throw Object.assign(new Error('Native in-app swap notice missing.'), {code: 'native_notice_missing'});
}
async function swapRecipe(a, b) {
  mark('local-swap-privacy-two-receptions-and-reviews');
  await a.call('ensureGeneralistZone', {}, {replayable: true});
  const own = await listing(a, 'swap_own', true), other = await listing(b, 'swap_other', true);
  const p = await proposal(a, b, own, other, 'complete');
  const receipt = await b.call('acceptSwap', p.ack, {replayable: true}); assert.equal(receipt.status, 'accepted');
  assert.equal((await b.call('acceptSwap', p.ack, {replayable: true})).replay, true);
  const original = await read(a, 'swaps', p.id);
  await inventory(own, 'engaged'); await inventory(other, 'engaged');
  await withdraw(own, {member: b, swapId: p.id});
  assert.deepEqual(without(await read(a, 'swaps', p.id), 'articlePrivacyWithdrawals'), original);
  const deposited = await read(a, 'swapPartyItems', own.itemId); assert.equal(deposited.isPending, true);
  assert.equal(deposited.privacyWithdrawal?.articleId, own.articleId); assert.equal(deposited.imageUrl, null);
  await a.call('confirmSwapReception', {swapId: p.id, expectedUid: a.uid}, {replayable: true});
  const first = await read(a, 'swaps', p.id); assert.equal(first.status, 'accepted'); assert(stamp(first.initiatorReceivedAt));
  await b.call('confirmSwapReception', {swapId: p.id, expectedUid: b.uid}, {replayable: true});
  const final = await read(a, 'swaps', p.id); assert.equal(final.status, 'completed');
  assert.deepEqual(final.exchangeAgreement, original.exchangeAgreement);
  await inventory(own, 'consumed'); await inventory(other, 'consumed');
  for (const member of [a, b]) {
    await member.call('rateSwap', {swapId: p.id, expectedUid: member.uid, score: 5,
      comment: 'Avis synthétique de recette, aucun échange physique réel.'}, {replayable: true});
    assert.equal((await read(member, 'avis', `${member.uid}_swap_${p.id}`)).note, 5);
    await notice(member, p.id, 'completed');
  }
  completed.push('local_swap_privacy_two_receptions_reviews_notices');
  mark('proposal-decline-and-cancel');
  const declineA = await listing(a, 'swap_decline_a', true), declineB = await listing(b, 'swap_decline_b', true);
  const declined = await proposal(a, b, declineA, declineB, 'decline');
  await b.call('declineSwap', {swapId: declined.id, expectedUid: b.uid}, {replayable: true});
  assert.equal((await read(a, 'swaps', declined.id)).status, 'declined');
  const cancelled = await proposal(a, b, declineA, declineB, 'cancel');
  await a.call('cancelSwap', {swapId: cancelled.id, expectedUid: a.uid}, {replayable: true});
  assert.equal((await read(a, 'swaps', cancelled.id)).status, 'cancelled');
  await inventory(declineA, 'available'); await inventory(declineB, 'available');
  completed.push('swap_proposal_decline_cancel');
}
async function support(member) {
  mark('owner-support-receipts');
  const command = {action: 'submit', kind: 'access_interruption', narrative: 'Demande synthétique technique ; aucun accès réel perdu.'};
  const payload = {expectedUid: member.uid, requestId: `support_${runId}`, mode: 'execute', command};
  const receipt = await member.call('commandSupportRequest', payload, {replayable: true,
    observe: () => member.call('commandSupportRequest', {...payload, mode: 'observe'}, {readOnly: true})});
  assert.equal(receipt.protocol, 'support_command_v1'); assert.equal(receipt.state, 'committed'); assert.equal(receipt.financialEffect, 'none');
  const observed = await member.call('commandSupportRequest', {...payload, mode: 'observe'}, {readOnly: true});
  assert.equal(observed.supportRequestId, receipt.supportRequestId); assert.equal(observed.payloadHash, receipt.payloadHash);
  const capabilities = {expectedUid: member.uid, scope: 'owner', capability: 'support_account_review_v2',
    privacyRetentionCapability: 'privacy_retention_v1', lateCommercialCapability: 'late_commercial_recourse_v1', confidentialityCapability: 'support_confidentiality_v1'};
  const list = await member.call('readSupportRequests', capabilities, {readOnly: true});
  assert.equal(list.protocol, 'support_list_v1'); assert(list.items.some(item => item.id === receipt.supportRequestId));
  const detail = await member.call('readSupportRequests', {...capabilities, supportRequestId: receipt.supportRequestId}, {readOnly: true});
  assert.equal(detail.protocol, 'support_read_v1'); assert.equal(detail.request.ownerId, member.uid);
  const withdrawal = {expectedUid: member.uid, requestId: `support_withdraw_${runId}`, mode: 'execute',
    command: {action: 'withdraw', supportRequestId: receipt.supportRequestId, expectedVersion: detail.request.version,
      narrative: 'Fin de recette synthétique ; conserver les reçus techniques.'}};
  assert.equal((await member.call('commandSupportRequest', withdrawal, {replayable: true})).state, 'committed');
  completed.push('support_submit_observe_list_detail_withdraw');
}
async function pause(member, checkDelete = false) {
  await member.reauthenticate();
  const receipt = await member.call('deleteUserAccount', {mode: 'pause', expectedUid: member.uid}, {replayable: true});
  assert.equal(receipt.status, 'paused'); assert.equal(receipt.deletionComplete, false); assert.equal(receipt.newOperationsBlocked, true);
  member.paused = true;
  const replay = await member.call('deleteUserAccount', {mode: 'pause', expectedUid: member.uid}, {replayable: true});
  assert.equal(replay.status, 'paused');
  const stillPresent = await read(member, 'users', member.uid); assert.equal(stillPresent.id, member.uid);
  const eligibility = await member.call('getMyEligibility', {}, {readOnly: true}); assert.equal(eligibility.decisions.sell.allowed, false);
  if (checkDelete) {
    mark('erasure-review-refusal');
    const result = await member.call('deleteUserAccount', {mode: 'delete', expectedUid: member.uid}, {replayable: true});
    assert.equal(result.deletionComplete, false); assert.equal(result.newOperationsBlocked, true);
    assert(result.blockers.includes('external_erasure_retention_review_required'));
    await read(member, 'users', member.uid);
    completed.push('pause_replay_and_honest_erasure_review_refusal');
  }
}

/** NEW fixtures only. No old account, paid agreement, mutation by Admin or
 * historical migration is involved. Observation capability stays in this
 * process; this SDK recipe does not claim a native Keychain/restart test. */
async function pausedLateUpload(owner, path = `drafts/${owner.uid}/late-${runId}/after-fence.jpg`) {
  const task = uploadBytesResumable(ref(owner.storage, path), new Uint8Array(fixture.bytes), privateUploadMetadata);
  const partial = await new Promise((resolve, reject) => {
    let stop = () => {}, requested = false;
    const finish = (error, snapshot) => {clearTimeout(timer); stop(); error ? reject(error) : resolve(snapshot);};
    const timer = setTimeout(() => {task.cancel(); finish(Object.assign(new Error('No partial resumable pause observed.'),
      {code: 'late_upload_pause_unconfirmed'}));}, 120_000);
    stop = task.on('state_changed', snapshot => {
      if (snapshot.state === 'running' && snapshot.bytesTransferred > 0 && snapshot.bytesTransferred < snapshot.totalBytes && !requested) {
        requested = true;
        if (!task.pause()) finish(Object.assign(new Error('The same resumable task could not pause.'), {code: 'late_upload_pause_refused'}));
      } else if (snapshot.state === 'paused') {
        if (snapshot.bytesTransferred > 0 && snapshot.bytesTransferred < snapshot.totalBytes) finish(null, snapshot);
        else finish(Object.assign(new Error('No admitted partial bytes before erasure.'), {code: 'late_upload_partial_unconfirmed'}));
      }
    }, error => finish(error), () => finish(Object.assign(new Error('Upload finalized before the erasure fence.'),
      {code: 'late_upload_finalized_too_early'})));
  });
  mark('late-upload-paused-before-request', {bytesTransferred: partial.bytesTransferred, totalBytes: partial.totalBytes,
    sdkState: partial.state, ownerIdentityHash: hash(owner.uid), sessionPersisted: false});
  return {task, path, state: 'paused', generation: null, receipt: null};
}
async function freshErasureRecipe() {
  const {isAccountErasureReceipt} = await import('../types/accountErasure.ts');
  const owner = await createMember('erasure'), peer = await createMember('erasurepeer');
  if (completedAgreementErasure) {
    const stripeStatus = await owner.call('getStripeAccountStatus', {expectedUid: owner.uid}, {readOnly: true});
    assert.equal(stripeStatus.hasAccount, false);
    const wallet = await owner.call('getWalletInfo', {expectedUid: owner.uid}, {readOnly: true});
    assert.equal(wallet.hasWallet, false);
    const bankStatus = await owner.call('getStripeAccountStatus', {expectedUid: owner.uid, includeBankAccounts: true}, {readOnly: true});
    assert.equal(bankStatus.hasAccount, false); assert.deepEqual(bankStatus.bankAccounts, []);
    assert.equal(owned.get(owner.uid), owner.email);
    const nativeWallet = await fetch(`https://firestore.googleapis.com/v1/projects/${PROJECT}/databases/(default)/documents/wallets/${owner.uid}`,
      {headers: {Authorization: `Bearer ${accessToken()}`, 'x-goog-user-project': PROJECT}, signal: AbortSignal.timeout(30_000)});
    assert.equal(nativeWallet.status, 404, 'Reading financial absence must not create a native wallet.');
    mark('new-owner-financial-read-absence', {hasStripeAccount: false, hasWallet: false, bankAccountsCount: 0,
      nativeWalletAbsent: true, accountCreatedByStatusRead: false, directFinancialWrites: false});
  }
  const item = await listing(owner, 'erasure_new_public'), conversation = await chat(owner, peer, item);
  mark('new-owned-chat-media-generations');
  const imagePath = `chat_images/${conversation.id}/${owner.uid}/erasure_${runId}.jpg`,
    thumbnailPath = `chat_images/${conversation.id}/${owner.uid}/erasure_${runId}_thumb.jpg`;
  const [image, thumbnail] = await Promise.all([
    uploadBytes(ref(owner.storage, imagePath), new Uint8Array(fixture.bytes), privateUploadMetadata),
    uploadBytes(ref(owner.storage, thumbnailPath), new Uint8Array(fixture.bytes), privateUploadMetadata),
  ]);
  assert([image.metadata.generation, thumbnail.metadata.generation].every(value => typeof value === 'string' && /^[1-9][0-9]{0,31}$/.test(value)));
  await sendSdkMessage(owner, peer, conversation, 'erasure_image', {url: privateMediaUrl(imagePath), thumbnail: privateMediaUrl(thumbnailPath),
    generation: image.metadata.generation, thumbnailGeneration: thumbnail.metadata.generation, width: fixture.width, height: fixture.height});
  const draftPath = `drafts/${owner.uid}/phase1-${runId}/fixture.jpg`, draftMetadata = await getMetadata(ref(owner.storage, draftPath));
  const publicPath = decodeURIComponent(new URL(item.imageUrl).pathname.split('/o/')[1]);
  assert(publicPath.startsWith(`articles/${item.articleId}/`));
  const publicMetadata = await getMetadata(ref(owner.storage, publicPath));
  const storageProof = [{path: imagePath, generation: image.metadata.generation}, {path: thumbnailPath, generation: thumbnail.metadata.generation},
    {path: draftPath, generation: draftMetadata.generation}, {path: publicPath, generation: publicMetadata.generation}];
  assert(storageProof.every(value => /^[1-9][0-9]{0,31}$/.test(value.generation)));
  let terminalContract, postalLate;
  if (completedLocalErasure) {
    mark('completed-local-cash-agreement-before-erasure', {physicalHandoverAsserted: false, platformPaymentAsserted: false});
    const agreement = await cashAgreement(owner, peer, item, 'erasure_terminal');
    assert.equal(agreement.chatId, conversation.id);
    await owner.call('confirmMeetupTransaction', {transactionId: agreement.id, messageId: agreement.messageId, expectedUid: owner.uid}, {replayable: true});
    const completion = await peer.call('completeMeetupTransaction', {transactionId: agreement.id, messageId: agreement.messageId, expectedUid: peer.uid}, {replayable: true});
    assert.equal(completion.success, true);
    const native = await read(peer, 'transactions', agreement.id);
    assert.equal(native.status, 'meetup_completed'); assert.equal(native.paidVia, 'cash');
    assert.equal(native.buyerId, peer.uid); assert.equal(native.sellerId, owner.uid); assert.equal(native.articleId, item.articleId);
    assert.equal(native.shippingCost, 0); assert.equal(native.serviceFee, 0); assert(!Object.hasOwn(native, 'financialRecoveryWitness'));
    const acceptedAt = stamp(native.cashAgreement?.acceptedAt), completedAt = stamp(native.meetupCompletedAt);
    assert(acceptedAt > 0 && completedAt >= acceptedAt);
    assert.equal(native.localAgreementWitness?.protocol, 'local_agreement_source_v1');
    assert.equal(native.localAgreementWitness.financialSettlement, 'not_asserted');
    assert.equal(native.localAgreementWitness.ref, `transactions/${agreement.id}`);
    assert.equal(native.localAgreementWitness.installationId, environment.FINANCIAL_RECOVERY_INSTALLATION_ID);
    assert(/^[a-f0-9]{64}$/.test(native.localAgreementWitness.nativeSourceHash));
    await inventory(item, 'consumed');
    const reviewAt = new Date(completedAt); reviewAt.setUTCFullYear(reviewAt.getUTCFullYear() + 3);
    terminalContract = {agreement, source: native, sourceHash: erasureSourceHash(native), reviewAt: reviewAt.toISOString()};
    mark('terminal-contract-native-source-captured', {sourceHash: terminalContract.sourceHash,
      nativeWitnessHash: native.localAgreementWitness.nativeSourceHash, buyerIdentityHash: erasureSourceHash(peer.uid),
      sellerIdentityHash: erasureSourceHash(owner.uid), nativeStatus: native.status, terminalTimeVerified: true,
      localCashOnly: true, physicalHandoverAsserted: false});
  }
  if (completedPostalErasure) {
    mark('completed-postal-agreement-before-erasure', {physicalShipmentAsserted: false, platformPaymentAsserted: false});
    await owner.call('ensureGeneralistZone', {}, {replayable: true});
    await depositItem(item);
    const counterpart = await listing(peer, 'erasure_postal_peer', true);
    const agreement = await proposal(owner, peer, item, counterpart, 'erasure_postal_terminal', 'shipping');
    await peer.call('acceptSwap', agreement.ack, {replayable: true});
    assert.equal((await read(owner, 'swaps', agreement.id)).status, 'photos_pending');
    const ownPaths = postalErasurePaths(agreement.id, owner.uid, runId, randomUUID(), randomUUID());
    const peerPaths = postalErasurePaths(agreement.id, peer.uid, runId, randomUUID(), randomUUID());
    // Admission of the partial upload occurs while proof uploads are allowed.
    // The later 403 can reflect both the native fence and the completed status;
    // only an actual distinct Eventarc effect qualifies late cleanup.
    postalLate = await pausedLateUpload(owner, ownPaths.late);
    for (const [member, paths] of [[owner, ownPaths], [peer, peerPaths]]) {
      await uploadFixture(member, ref(member.storage, paths.photo));
      const receipt = await member.call('uploadSwapPhotos', {swapId: agreement.id, expectedUid: member.uid,
        photoUrls: [privateMediaUrl(paths.photo)]}, {replayable: true});
      assert.equal(receipt.success, true);
    }
    assert.equal((await read(owner, 'swaps', agreement.id)).status, 'shipping');
    for (const member of [owner, peer]) await member.call('confirmSwapShipping', {swapId: agreement.id, expectedUid: member.uid}, {replayable: true});
    for (const member of [owner, peer]) await member.call('confirmSwapReception', {swapId: agreement.id, expectedUid: member.uid}, {replayable: true});
    // Remove only the peer's synthetic public listing through its own RPC.
    await withdraw(counterpart, {member: owner, swapId: agreement.id});
    const native = await read(peer, 'swaps', agreement.id);
    const proof = terminalPostalProof(native, {swapId: agreement.id, ownerId: owner.uid, peerId: peer.uid,
      installationId: environment.FINANCIAL_RECOVERY_INSTALLATION_ID, bucket: config.storageBucket, bytes: fixture.bytes.length});
    await inventory(item, 'consumed'); await inventory(counterpart, 'consumed');
    const reviewAt = new Date(proof.completedAt); reviewAt.setUTCFullYear(reviewAt.getUTCFullYear() + 3);
    terminalContract = {kind: 'swap', agreement, source: native, sourceHash: erasureSourceHash(native),
      reviewAt: reviewAt.toISOString(), proof, operatorPath: ownPaths.operator};
    mark('terminal-postal-contract-native-source-captured', {sourceHash: terminalContract.sourceHash,
      nativeWitnessHash: native.localAgreementWitness.nativeSourceHash, nativeStatus: native.status,
      ownProofCount: proof.ownerObjects.length, peerProofCount: proof.peerObjects.length, physicalShipmentAsserted: false, platformMoneyAsserted: false});
  }
  const late = postalLate ?? await pausedLateUpload(owner);
  await owner.reauthenticate();
  assert.equal(owned.get(owner.uid), owner.email, 'Only this run’s new synthetic owner may request erasure.');
  const capability = 'account_erasure_v1', requestId = `erasure_${runId}`, commandId = hash([capability, owner.uid, requestId]),
    observationKey = randomBytes(32).toString('hex');
  const base = {capability, mode: 'delete', requestId, commandId, observationKey};
  const adminHeaders = () => ({Authorization: `Bearer ${accessToken()}`, 'x-goog-user-project': PROJECT});
  const allowedAdminPaths = new Set([`account_erasure_commands/${commandId}`, `eligibility_profiles/${owner.uid}`, `articles/${item.articleId}`]);
  if (terminalContract) {
    const path = `${terminalContract.kind === 'swap' ? 'swaps' : 'transactions'}/${terminalContract.agreement.id}`;
    allowedAdminPaths.add(`account_erasure_commands/${commandId}/retained/${erasureSourceHash(path)}`);
    for (const object of terminalContract.proof?.ownerObjects ?? []) allowedAdminPaths.add(
      `account_erasure_commands/${commandId}/retained/${erasureSourceHash(['storage', object.path, object.generation])}`);
  }
  const adminDocument = async path => {
    assert.equal(owned.get(owner.uid), owner.email); assert(allowedAdminPaths.has(path), 'Admin read must target this run’s exact source.');
    const url = `https://firestore.googleapis.com/v1/projects/${PROJECT}/databases/(default)/documents/${path}`;
    let response = await fetch(url, {headers: adminHeaders(), signal: AbortSignal.timeout(30_000)});
    if (response.status === 401) {administratorToken = undefined;
      response = await fetch(url, {headers: adminHeaders(), signal: AbortSignal.timeout(30_000)});}
    if (response.status === 404) return null;
    assert(response.ok, 'Bounded own-source Admin read failed.');
    const raw = await response.text(); assert(raw.length < 1_000_000, 'Oversized own-source response.');
    return JSON.parse(raw).fields;
  };
  const readLateReceipt = async (path, generation) => {
    const targetHash = erasureSourceHash([path, generation]);
    const response = await fetch(`https://firestore.googleapis.com/v1/projects/${PROJECT}/databases/(default)/documents/account_erasure_commands/${commandId}:runQuery`, {
      method: 'POST', headers: {...adminHeaders(), 'Content-Type': 'application/json'}, signal: AbortSignal.timeout(30_000),
      body: JSON.stringify({structuredQuery: {from: [{collectionId: 'late_storage_receipts'}], limit: 2,
        where: {fieldFilter: {field: {fieldPath: 'targetHash'}, op: 'EQUAL', value: {stringValue: targetHash}}}}}),
    });
    assert(response.ok, 'Native late-finalization receipt read failed.');
    const rows = await response.json(); assert(Array.isArray(rows) && rows.length <= 2);
    for (const row of rows) {
      const f = row.document?.fields; if (!f) continue;
      assert.deepEqual(Object.keys(f).sort(), ['eventIdHash', 'observedAt', 'protocol', 'state', 'targetHash']);
      assert.equal(f.protocol.stringValue, 'account_erasure_late_storage_receipt_v1');
      assert.equal(f.state.stringValue, 'generation_absence_verified'); assert.equal(f.targetHash.stringValue, targetHash);
      assert(/^[a-f0-9]{64}$/.test(f.eventIdHash.stringValue)); assert.equal(row.document.name.split('/').at(-1), f.eventIdHash.stringValue);
      assert(Number.isFinite(Date.parse(f.observedAt.timestampValue)));
      const absent = await fetch(`https://storage.googleapis.com/storage/v1/b/${config.storageBucket}/o/${encodeURIComponent(path)}?generation=${generation}`,
        {headers: adminHeaders(), signal: AbortSignal.timeout(30_000)});
      assert.equal(absent.status, 404, 'The exact finalized generation must be absent after the real event receipt.');
      return {protocol: f.protocol.stringValue, state: f.state.stringValue, eventIdHash: f.eventIdHash.stringValue,
        targetHash, generation, observedAt: f.observedAt.timestampValue};
    }
    return null;
  };
  const readGcsProof = async reference => {
    assert.equal(reference.bucket, environment.FINANCIAL_RECOVERY_BUCKET);
    assert(/^[1-9][0-9]{0,24}$/.test(reference.generation) && /^[a-f0-9]{64}$/.test(reference.sha256));
    const metadata = await fetch(`https://storage.googleapis.com/storage/v1/b/${reference.bucket}/o/${encodeURIComponent(reference.object)}`,
      {headers: adminHeaders(), signal: AbortSignal.timeout(30_000)});
    assert(metadata.ok, 'Pinned operator-source metadata unavailable.');
    const m = await metadata.json(); assert.equal(m.generation, reference.generation);
    assert(m.contentType === 'application/json' && Number(m.size) > 0 && Number(m.size) <= 32768);
    const response = await fetch(`https://storage.googleapis.com/download/storage/v1/b/${reference.bucket}/o/${encodeURIComponent(reference.object)}?alt=media&generation=${reference.generation}`,
      {headers: adminHeaders(), signal: AbortSignal.timeout(30_000)});
    assert(response.ok, 'Pinned operator-source bytes unavailable.');
    const raw = await response.text(); assert(Buffer.byteLength(raw) <= 32768);
    assert.equal(bytesHash(Buffer.from(raw)), reference.sha256); return JSON.parse(raw);
  };
  const readCompositeProof = async () => {
    assert.equal(late.state, 'refused'); assert.equal(late.refusalCode, 'storage/unauthorized');
    assert.equal(late.refusalStatus, 403); assert.equal(late.fenceObserved, true);
    let file;
    try {file = await lstat(lateCompositePath);} catch (error) {if (error?.code === 'ENOENT') return null; throw error;}
    assert(file.isFile() && !file.isSymbolicLink() && file.size > 0 && file.size <= 32768, 'Composite fixture must be a bounded regular JSON file.');
    const raw = await readFile(lateCompositePath); assert(raw.byteLength <= 32768);
    const packet = JSON.parse(raw.toString('utf8'));
    assert.deepEqual(Object.keys(packet).sort(), ['protocol', 'project', 'runId', 'commandId', 'ownerHash', 'serverSourceSha256', 'control', 'operatorObject', 'intentSource'].sort());
    assert.equal(packet.protocol, 'phase1_late_storage_composite_fixture_v1'); assert.equal(packet.project, PROJECT);
    assert.equal(packet.runId, runId); assert.equal(packet.commandId, commandId); assert.equal(packet.ownerHash, erasureSourceHash(owner.uid));
    assert(/^[a-f0-9]{64}$/.test(packet.serverSourceSha256));
    assert.deepEqual(Object.keys(packet.operatorObject).sort(), ['generation', 'path']);
    assert.equal(packet.operatorObject.path, terminalContract?.operatorPath ?? `drafts/${owner.uid}/operator-finalizer-${runId}/late.jpg`);
    assert.notEqual(packet.operatorObject.path, late.path); assert(/^[1-9][0-9]{0,24}$/.test(packet.operatorObject.generation));
    assert.deepEqual(Object.keys(packet.control).sort(), ['epoch', 'generation', 'installationId', 'sourceHash']);
    const [job, profile] = await Promise.all([adminDocument(`account_erasure_commands/${commandId}`), adminDocument(`eligibility_profiles/${owner.uid}`)]);
    assert.equal(job?.protocol?.stringValue, capability); assert.equal(job.ownerId?.stringValue, owner.uid);
    assert.equal(job.commandId?.stringValue, commandId); assert.equal(job.requestId?.stringValue, requestId);
    assert.equal(job.fenceCommitted?.booleanValue, true); assert.equal(job.confirmed?.booleanValue, true);
    const fence = profile?.accountErasureFence?.mapValue?.fields;
    assert.equal(fence?.protocol?.stringValue, 'account_erasure_fence_v1'); assert.equal(fence?.commandId?.stringValue, commandId);
    assert.equal(fence?.ownerId?.stringValue, owner.uid);
    const nativeControl = Object.fromEntries(Object.keys(packet.control).map(key => [key, job.control?.mapValue?.fields?.[key]?.stringValue]));
    assert.deepEqual(packet.control, nativeControl); assert.equal(nativeControl.installationId, environment.FINANCIAL_RECOVERY_INSTALLATION_ID);
    const currentControl = await readGcsProof({bucket: environment.FINANCIAL_RECOVERY_BUCKET, object: environment.FINANCIAL_RECOVERY_CONTROL_OBJECT,
      generation: nativeControl.generation, sha256: nativeControl.sourceHash});
    assert.equal(currentControl.installationId, nativeControl.installationId); assert.equal(currentControl.epoch, nativeControl.epoch);
    assert.equal(currentControl.mode, 'normal'); assert.equal(currentControl.previousEpoch, null); assert.equal(currentControl.financialEnvironment, 'unconfigured');
    for (const name of ['deleteUserAccountV2', 'eraseLateAccountStorage']) {
      const response = await fetch(`https://cloudfunctions.googleapis.com/v2/projects/${PROJECT}/locations/${REGION}/functions/${name}`,
        {headers: adminHeaders(), signal: AbortSignal.timeout(30_000)});
      assert(response.ok, 'Native function source metadata unavailable.');
      const metadata = await response.json(); assert.equal(metadata.state, 'ACTIVE');
      assert.equal(metadata.serviceConfig?.environmentVariables?.ACCOUNT_ERASURE_SERVER_SOURCE_SHA256, packet.serverSourceSha256);
    }
    const target = packet.operatorObject, effectId = erasureSourceHash(['storage', target.path, target.generation]);
    const effectPath = `account_erasure_commands/${commandId}/effects/${effectId}`; allowedAdminPaths.add(effectPath);
    const effect = await adminDocument(effectPath); if (!effect) return null;
    assert.deepEqual(Object.keys(effect).sort(), ['identity', 'observedAt', 'preparedAt', 'state']); assert.equal(effect.state.stringValue, 'absent');
    const identity = effect.identity.mapValue.fields;
    assert.deepEqual(Object.keys(identity).sort(), ['commandId', 'generation', 'ownerId', 'path', 'protocol']);
    assert.equal(identity.protocol.stringValue, 'account_erasure_storage_effect_v1'); assert.equal(identity.commandId.stringValue, commandId);
    assert.equal(identity.ownerId.stringValue, owner.uid); assert.equal(identity.path.stringValue, target.path); assert.equal(identity.generation.stringValue, target.generation);
    const preparedAt = Date.parse(effect.preparedAt.timestampValue), observedAt = Date.parse(effect.observedAt.timestampValue);
    assert(preparedAt >= Date.parse(fence.recordedAt.timestampValue) && observedAt >= preparedAt && observedAt <= Date.now() + 60000);
    assert.deepEqual(Object.keys(packet.intentSource).sort(), ['bucket', 'generation', 'object', 'sha256']);
    assert.equal(packet.intentSource.object, `${environment.FINANCIAL_RECOVERY_PREFIX}/permits/${nativeControl.epoch}/account-erasure/${commandId}/${effectId}.json`);
    const intent = await readGcsProof(packet.intentSource);
    assert.deepEqual(Object.keys(intent).sort(), ['commandId', 'epoch', 'financialSettlement', 'inputHash', 'protocol', 'targetHash']);
    assert.equal(intent.protocol, 'account_erasure_exact_generation_intent_v1'); assert.equal(intent.commandId, commandId);
    assert.equal(intent.inputHash, job.inputHash.stringValue); assert.equal(intent.epoch, nativeControl.epoch);
    assert.equal(intent.targetHash, erasureSourceHash([target.path, target.generation])); assert.equal(intent.financialSettlement, 'not_asserted');
    const receipt = await readLateReceipt(target.path, target.generation); if (!receipt) return null;
    assert(Date.parse(receipt.observedAt) >= observedAt);
    const peerProfile = await read(peer, 'users', peer.uid); assert.equal(peerProfile.id, peer.uid);
    return {...receipt, proofMode: 'sdk403_plus_distinct_operator_event', packetSha256: bytesHash(raw),
      serverSourceSha256: packet.serverSourceSha256, intentSourceSha256: packet.intentSource.sha256, effectId,
      sdkUploadFinalized: false, peerPreserved: true};
  };
  const adoptCompositeProof = async () => {
    const proof = await readCompositeProof();
    if (!proof) return false;
    late.receipt = proof;
    mark('late-storage-composite-native-proof', {...proof, sdkRefusedAfterFence: true, operatorObjectDistinct: true, adminStorageWrite: false});
    return true;
  };
  let nextLateReadAt = 0;
  const observeLateUpload = async () => {
    if (late.receipt || Date.now() < nextLateReadAt) return;
    nextLateReadAt = Date.now() + 5000;
    if (late.state === 'refused') {
      if (!lateCompositePath) return;
      if (!await adoptCompositeProof()) {
        const next = await instruction({operation: 'late_storage_composite_native_proof_pending', sdkUploadFinalized: false,
          noOperatorUploadPerformedByRunner: true}, ['stop', 'observe']);
        if (next !== 'observe') throw Object.assign(new Error('Composite native proof remains pending.'), {code: 'late_storage_composite_pending'});
        return;
      }
      return;
    }
    if (late.state === 'paused') {
      const [job, profile] = await Promise.all([adminDocument(`account_erasure_commands/${commandId}`), adminDocument(`eligibility_profiles/${owner.uid}`)]);
      if (job?.fenceCommitted?.booleanValue !== true) return;
      const fence = profile?.accountErasureFence?.mapValue?.fields;
      assert.equal(job.protocol?.stringValue, capability); assert.equal(job.ownerId?.stringValue, owner.uid);
      assert.equal(job.commandId?.stringValue, commandId); assert.equal(job.requestId?.stringValue, requestId);
      assert.equal(job.confirmed?.booleanValue, true); assert.equal(fence?.protocol?.stringValue, 'account_erasure_fence_v1');
      assert.equal(fence?.ownerId?.stringValue, owner.uid); assert.equal(fence?.commandId?.stringValue, commandId);
      late.fenceObserved = true;
      mark('late-upload-native-fence-observed', {fenceCommitted: true, ownCommandAndProfileMatched: true, sessionUnchanged: true});
      assert.equal(late.task.snapshot.state, 'paused'); assert(late.task.resume(), 'The exact paused SDK session must resume.');
      try {
        const snapshot = await late.task; const generation = snapshot.metadata.generation;
        assert.equal(snapshot.state, 'success'); assert.equal(snapshot.bytesTransferred, snapshot.totalBytes);
        assert(typeof generation === 'string' && /^[1-9][0-9]{0,24}$/.test(generation));
        late.state = 'finalized'; late.generation = generation;
        mark('late-upload-sdk-finalized-after-fence', {generation, bytesTransferred: snapshot.bytesTransferred,
          sameSdkSession: true, finalizerQualified: false});
      } catch (error) {
        late.state = 'refused';
        late.refusalCode = safeError(error).code;
        late.refusalStatus = safeError(error).providerHttpStatus;
        mark('late-upload-sdk-not-finalized', {...safeError(error), nativeFencePreviouslyVerified: true,
          finalizerQualified: false, noOperatorUploadPerformed: true});
        const next = await instruction({operation: 'late_storage_sdk_result_unqualified', ...safeError(error),
          nextProof: 'Root must decide a separately identified native composite proof; this runner does not create it.'}, ['stop', 'observe']);
        if (next !== 'observe') throw error;
        // The next anonymous read may already be completed. Consume a packet
        // supplied during this explicit pause now, without another SDK resume
        // or the observer's five-second polling throttle.
        if (lateCompositePath) await adoptCompositeProof();
        return;
      }
    }
    late.receipt = await readLateReceipt(late.path, late.generation);
    if (late.receipt) {
      late.receipt.proofMode = 'sdk_finalization';
      mark('late-upload-native-finalizer-receipt', {...late.receipt, ownGenerationAbsent: true,
        proofHash: hash(late.receipt), directHandlerCalled: false, adminStorageWrite: false});
    }
  };
  const observe = async () => {
    const response = await fetch(`https://${REGION}-${PROJECT}.cloudfunctions.net/deleteUserAccountV2`, {
      method: 'POST', credentials: 'omit', redirect: 'error', headers: {'Content-Type': 'application/json'},
      body: JSON.stringify({data: {...base, operation: 'observe'}}), signal: AbortSignal.timeout(30_000),
    });
    const raw = await response.text(); assert(raw.length < 32_000, 'Oversized erasure receipt.');
    let envelope; try {envelope = JSON.parse(raw);} catch {throw Object.assign(new Error('Unreadable erasure observation.'), {code: 'erasure_observation_unknown'});}
    assert(response.ok && envelope && Object.keys(envelope).join(',') === 'result', 'Erasure observation not confirmed.');
    assert(isAccountErasureReceipt(envelope.result, {commandId, requestId}), 'Minimal erasure receipt invalid.');
    return envelope.result;
  };
  mark('confirmed-erasure-v1', {newOwnerOnly: true, capabilityPersisted: false, noAdminDestruction: true});
  const admitted = await owner.call('deleteUserAccount', {...base, operation: 'request', expectedUid: owner.uid, confirmed: true},
    {replayable: true, observe});
  assert(isAccountErasureReceipt(admitted, {commandId, requestId}));
  // Simulate an unadopted acknowledgement by recovering only through the
  // original capability, rather than issuing another destructive request.
  await expectRefusal(() => peer.call('deleteUserAccount', {...base, operation: 'observe'}, {expectedRefusal: true}), ['functions/permission-denied']);
  let receipt = await observe(), version = receipt.version, lastState;
  const deadline = Date.now() + qualificationWindowMinutes * 60_000;
  while ((!receipt.deletionComplete || late.state === 'finalized' && !late.receipt ||
    lateCompositePath && late.state === 'refused' && !late.receipt) && Date.now() < deadline) {
    await observeLateUpload();
    if (receipt.state !== lastState) {mark('anonymous-observation-after-auth-closure', {state: receipt.state,
      accountAccessClosed: receipt.accountAccessClosed, completedSteps: receipt.progress.completedSteps, totalSteps: receipt.progress.totalSteps,
      requestAcknowledgementDiscarded: true, jwtRefreshedForObservation: false}); lastState = receipt.state;}
    if (['needs_attention', 'not_executed', 'awaiting_apple_authorization', 'awaiting_obligations', 'awaiting_review'].includes(receipt.state)) {
      const next = await instruction({operation: 'fresh_erasure_state_requires_qualification', state: receipt.state,
        qualificationWindowMinutes, observationPauseMinutes: 15, pauseRenewal: 'explicit observe only; same intention, no mutation'}, ['stop', 'observe']);
      if (next !== 'observe') throw Object.assign(new Error('Fresh erasure remains incomplete.'), {code: 'fresh_erasure_incomplete'});
    } else await new Promise(resolve => setTimeout(resolve, 2000));
    receipt = await observe(); assert(receipt.version >= version, 'Erasure receipt version regressed.'); version = receipt.version;
  }
  assert.equal(receipt.deletionComplete, true, 'No completed erasure claim without a terminal native receipt.');
  await observeLateUpload();
  assert.equal(receipt.accountAccessClosed, true); assert.equal(receipt.status, 'complete'); assert.equal(receipt.state, 'completed');
  mark('native-absence-verification');
  // Read-only admin checks are scoped to IDs/paths created and observed above.
  // The worker, never this runner, performs every deletion/status mutation.
  const lookup = await fetch(`https://identitytoolkit.googleapis.com/v1/projects/${PROJECT}/accounts:lookup`, {method: 'POST',
    headers: {...adminHeaders(), 'Content-Type': 'application/json'}, body: JSON.stringify({localId: [owner.uid]}), signal: AbortSignal.timeout(30_000)});
  assert(lookup.ok, 'Synthetic Auth absence could not be checked.');
  assert(!(await lookup.json()).users?.some(user => user.localId === owner.uid), 'Synthetic Auth identity still exists.');
  const profile = await fetch(`https://firestore.googleapis.com/v1/projects/${PROJECT}/databases/(default)/documents/users/${encodeURIComponent(owner.uid)}`,
    {headers: adminHeaders(), signal: AbortSignal.timeout(30_000)});
  assert.equal(profile.status, 404, 'Synthetic profile absence not confirmed.');
  const publicArticle = await adminDocument(`articles/${item.articleId}`);
  assert(publicArticle, 'The current withdrawal contract retains a minimal operational article tombstone.');
  const tombstoneFields = new Set(('sellerId price originalPrice priceDropPercent lastPriceDropAt isSold soldAt activeTransactionId '+
    'isHandDelivery isShipping packageSize isPromoted shopId views likes favoritesCount createdAt updatedAt moderationStatus '+
    'publicationRequestHash publicationRequestVersion popularityScore quantity stock ownerId inventoryUnit inventoryAvailability '+
    'financialRecoveryWitness localCatalogueWitness phase1Contract title description images sellerName sellerImage isActive privacyWithdrawal').split(' '));
  assert(Object.keys(publicArticle).every(key => tombstoneFields.has(key)), 'Unexpected content remains in the public article tombstone.');
  assert.equal(publicArticle.sellerId?.stringValue, owner.uid); assert.equal(publicArticle.isActive?.booleanValue, false);
  assert.equal(publicArticle.title?.stringValue, 'Annonce retirée pour confidentialité');
  assert.equal(publicArticle.description?.stringValue, ''); assert.equal(publicArticle.sellerName?.stringValue, 'Utilisateur');
  const sellerImage = publicArticle.sellerImage;
  assert(sellerImage && typeof sellerImage === 'object' && !Array.isArray(sellerImage) &&
    Object.keys(sellerImage).length === 1 && Object.hasOwn(sellerImage, 'nullValue') &&
    (sellerImage.nullValue === null || sellerImage.nullValue === 'NULL_VALUE'),
    'The public seller image must be an explicit ProtoJSON null, never missing or a URL.');
  assert.equal(publicArticle.images?.arrayValue?.values?.length ?? 0, 0);
  const marker = publicArticle.privacyWithdrawal?.mapValue?.fields;
  assert(marker && Object.keys(marker).sort().join(',') === 'articleId,operationId,schemaVersion,withdrawnAt');
  assert.equal(marker.articleId.stringValue, item.articleId); assert.equal(marker.schemaVersion.integerValue, '1');
  assert(/^[a-f0-9]{64}$/.test(marker.operationId.stringValue)); assert(Number.isFinite(Date.parse(marker.withdrawnAt.timestampValue)));
  for (const media of storageProof) {
    const response = await fetch(`https://storage.googleapis.com/storage/v1/b/${config.storageBucket}/o/${encodeURIComponent(media.path)}`,
      {headers: adminHeaders(), signal: AbortSignal.timeout(30_000)});
    assert.equal(response.status, 404, 'A newly owned synthetic media absence is not confirmed.');
  }
  if (terminalContract?.kind !== 'swap' && terminalContract) {
    mark('private-terminal-contract-retention-verification');
    const id = terminalContract.agreement.id, retained = await read(peer, 'transactions', id);
    assert.deepEqual(without(retained, 'articlePrivacyWithdrawal'), without(terminalContract.source, 'articlePrivacyWithdrawal'),
      'Erasure must preserve the exact native contractual source, apart from its documented privacy overlay.');
    assert.equal(retained.localAgreementWitness.nativeSourceHash, terminalContract.source.localAgreementWitness.nativeSourceHash);
    const disposition = await adminDocument(`account_erasure_commands/${commandId}/retained/${erasureSourceHash(`transactions/${id}`)}`);
    assert(disposition && Object.keys(disposition).sort().join(',') === 'path,policyVersion,protocol,purpose,recordedAt,reviewAt,sourceHash');
    assert.equal(disposition.protocol.stringValue, 'account_erasure_retained_source_v1');
    assert.equal(disposition.path.stringValue, `transactions/${id}`);
    assert.equal(disposition.sourceHash.stringValue, terminalContract.sourceHash);
    assert.equal(disposition.purpose.stringValue, 'private_local_agreement_and_outcome_recours');
    assert.equal(disposition.policyVersion.stringValue, 'seconde-erasure-2026-11-25-v1');
    assert.equal(new Date(disposition.reviewAt.timestampValue).toISOString(), terminalContract.reviewAt);
    assert(Number.isFinite(Date.parse(disposition.recordedAt.timestampValue)));
    await expectRefusal(() => getDocFromServer(doc(peer.db, 'account_erasure_commands', commandId, 'retained', erasureSourceHash(`transactions/${id}`))), ['permission-denied']);
    const evidence = await peer.call('readPrivateArticleEvidence', {articleId: item.articleId, expectedUid: peer.uid, transactionId: id}, {readOnly: true});
    assert.equal(evidence.kind, 'private_article_evidence_v1'); assert.equal(evidence.state, 'recorded');
    assert.deepEqual(Object.keys(evidence).sort(), ['kind', 'state', 'publicReferenceUseAllowed', 'publicReferenceHashes', 'viewerId',
      'ownerId', 'articleId', 'evidenceId', 'ownerWithdrawalAttempt', 'capturedAt', 'sourceUpdatedAt', 'snapshot', 'evidenceScope',
      'contractId', 'mediaRefs', 'mediaNeedsReview'].sort());
    assert.equal(evidence.evidenceScope, 'transaction_contract'); assert.equal(evidence.contractId, id);
    assert.equal(evidence.viewerId, peer.uid); assert.equal(evidence.ownerId, owner.uid); assert.equal(evidence.articleId, item.articleId);
    assert.equal(evidence.publicReferenceUseAllowed, false); assert.deepEqual(evidence.publicReferenceHashes, []);
    assert.equal(evidence.ownerWithdrawalAttempt, null); assert.equal(evidence.mediaNeedsReview, 0);
    const permittedSnapshot = ['title', 'description', 'price', 'categoryIds', 'condition', 'brand', 'brandStatus', 'size',
      'hasKnownDefects', 'defectsDescription', 'hasAlterations', 'alterationsDescription', 'hygieneDeclaration'];
    const expectedSnapshot = Object.fromEntries(permittedSnapshot.filter(key => Object.hasOwn(terminalContract.source.articleSnapshot, key))
      .map(key => [key, terminalContract.source.articleSnapshot[key]]));
    assert.deepEqual(evidence.snapshot, expectedSnapshot, 'The private party view must expose only the server-scoped native article snapshot.');
    assert(evidence.mediaRefs.length > 0);
    for (const media of evidence.mediaRefs) {
      assert.deepEqual(Object.keys(media).sort(), ['contentType', 'evidenceId', 'generation', 'historicalPixelsVerified', 'mediaBasis', 'mediaId', 'size', 'sourceReferenceHash']);
      assert(/^[1-9][0-9]{0,24}$/.test(media.generation)); assert.equal(media.contentType, 'image/jpeg');
      assert.equal(media.mediaBasis, 'source_generation_at_withdrawal'); assert.equal(media.historicalPixelsVerified, false);
      assert.equal(media.size, fixture.bytes.length);
    }
    const media = evidence.mediaRefs[0];
    const privatePixels = await peer.call('readPrivateArticleMedia', {articleId: item.articleId, expectedUid: peer.uid,
      transactionId: id, evidenceId: media.evidenceId, mediaId: media.mediaId, sourceReferenceHash: media.sourceReferenceHash}, {readOnly: true});
    assert.equal(privatePixels.kind, 'private_article_media_v1'); assert.equal(privatePixels.generation, media.generation);
    assert.equal(bytesHash(Buffer.from(privatePixels.dataUrl.split(',')[1], 'base64')), bytesHash(fixture.bytes));
    mark('terminal-contract-retained-private-native-proof', {originalSourceHash: terminalContract.sourceHash,
      nativeContractUnchanged: true, publicPersonalContentRemoved: true, purpose: disposition.purpose.stringValue,
      reviewAt: terminalContract.reviewAt, privateScopedMediaVerified: true, internalDispositionDirectReadRefused: true,
      nativeContractRemoved: false, platformMoneyAsserted: false, physicalHandoverAsserted: false});
  }
  if (terminalContract?.kind === 'swap') {
    mark('private-terminal-postal-retention-verification');
    const id = terminalContract.agreement.id, parentPath = `swaps/${id}`, retained = await read(peer, 'swaps', id);
    assert.deepEqual(without(retained, 'articlePrivacyWithdrawals'), without(terminalContract.source, 'articlePrivacyWithdrawals'));
    const dispositionPath = `account_erasure_commands/${commandId}/retained/${erasureSourceHash(parentPath)}`;
    const disposition = await adminDocument(dispositionPath);
    assert.equal(disposition?.protocol?.stringValue, 'account_erasure_retained_source_v1');
    assert.equal(disposition.path.stringValue, parentPath); assert.equal(disposition.sourceHash.stringValue, terminalContract.sourceHash);
    assert.equal(disposition.purpose.stringValue, 'private_local_agreement_and_outcome_recours');
    assert.equal(new Date(disposition.reviewAt.timestampValue).toISOString(), terminalContract.reviewAt);
    for (const object of terminalContract.proof.ownerObjects) {
      const retainedMedia = await adminDocument(`account_erasure_commands/${commandId}/retained/${erasureSourceHash(['storage',object.path,object.generation])}`);
      assert.equal(Object.keys(retainedMedia ?? {}).sort().join(','), 'generation,parentPath,parentSourceHash,path,policyVersion,protocol,purpose,recordedAt,reviewAt,sourceHash');
      assert.equal(retainedMedia.protocol.stringValue, 'account_erasure_retained_media_v1');
      assert.equal(retainedMedia.path.stringValue, object.path); assert.equal(retainedMedia.generation.stringValue, object.generation);
      assert.equal(retainedMedia.parentPath.stringValue, parentPath); assert.equal(retainedMedia.parentSourceHash.stringValue, erasureSourceHash(retained));
      assert.equal(retainedMedia.sourceHash.stringValue, erasureSourceHash(object));
      assert.equal(new Date(retainedMedia.reviewAt.timestampValue).toISOString(), terminalContract.reviewAt);
    }
    for (const object of [...terminalContract.proof.ownerObjects, ...terminalContract.proof.peerObjects]) {
      const response = await fetch(`https://storage.googleapis.com/storage/v1/b/${config.storageBucket}/o/${encodeURIComponent(object.path)}?generation=${object.generation}`,
        {headers: adminHeaders(), signal: AbortSignal.timeout(30_000)});
      assert.equal(response.status, 200); const metadata = await response.json();
      assert.equal(metadata.generation, object.generation); assert.equal(metadata.crc32c, object.crc32c);
      assert.equal(metadata.contentType, object.contentType); assert.equal(Number(metadata.size), object.size);
      assert(!metadata.metadata?.firebaseStorageDownloadTokens); assert.match(metadata.cacheControl, /private/); assert.match(metadata.cacheControl, /no-store/);
    }
    await expectRefusal(() => getDocFromServer(doc(peer.db, dispositionPath)), ['permission-denied']);
    const evidence = await peer.call('readPrivateArticleEvidence', {articleId: item.articleId, expectedUid: peer.uid, swapId: id}, {readOnly: true});
    assert.equal(evidence.evidenceScope, 'swap_contract'); assert.equal(evidence.contractId, id); assert.equal(evidence.mediaNeedsReview, 0);
    assert(evidence.mediaRefs.length > 0);
    const media = evidence.mediaRefs[0], pixels = await peer.call('readPrivateArticleMedia', {articleId: item.articleId, expectedUid: peer.uid,
      swapId: id, evidenceId: media.evidenceId, mediaId: media.mediaId, sourceReferenceHash: media.sourceReferenceHash}, {readOnly: true});
    assert.equal(bytesHash(Buffer.from(pixels.dataUrl.split(',')[1], 'base64')), bytesHash(fixture.bytes));
    mark('terminal-postal-retained-private-native-proof', {originalSourceHash: terminalContract.sourceHash,
      nativeContractUnchanged: true, ownRetainedProofs: terminalContract.proof.ownerObjects.length,
      peerProofsPreserved: terminalContract.proof.peerObjects.length, reviewAt: terminalContract.reviewAt,
      privateArticleMediaVerified: true, physicalShipmentAsserted: false, platformMoneyAsserted: false});
  }
  const peerProfile = await read(peer, 'users', peer.uid); assert.equal(peerProfile.id, peer.uid);
  if (!late.receipt && late.state === 'refused' && lateCompositePath) await adoptCompositeProof();
  mark('ordinary-erasure-native-postconditions', {accountErasureCompleted: true, authAbsenceVerified: true,
    userProfileAbsent: true, ownedMediaAbsencesVerified: storageProof.length, lateUploadState: late.state,
    lateFinalizerReceiptObserved: !!late.receipt});
  assert(late.receipt, 'Late storage requires a native SDK receipt or a fully revalidated explicit composite proof.');
  owner.erased = true; item.withdrawn = true;
  mark('peer-account-preserved-and-paused'); await pause(peer);
  completed.push('new_account_erasure_receipt_auth_profile_owned_media_and_peer_preservation');
  mark('recipe-complete', {completed, accountErasureCompleted: true, authAbsenceVerified: true, userProfileAbsent: true,
    publicArticlePersonalContentRemoved: true, publicArticleTombstoneRetained: true, lateStorageFinalizerReceiptObserved: true,
    lateStorageProofMode: late.receipt.proofMode, sdkLateUploadFinalized: late.state === 'finalized', sdkLateUploadRefusedAfterFence: late.state === 'refused',
    completedLocalAgreementRetainedPrivately: !!terminalContract,
    ownedMediaAbsencesVerified: storageProof.length, unrelatedSyntheticPeerPreserved: true, peerPaused: true,
    credentialsPersisted: false, observationUsedAuth: false, operatorDecisionExercised: false, directFinancialWrites: false});
}

try {
  // Fail before fixture creation if the permitted verification identity is unavailable.
  accessToken(); await prepareFixture();
  if (erasureOnly) {
    await freshErasureRecipe();
  } else {
  const a = await createMember('alice'), b = await createMember('bob');
  const basic = await listing(a, 'basic'); await editAndFavorite(a, b, basic);
  const reportItem = await listing(a, 'reports'); await chatAndReports(a, b, reportItem);
  await cashRecipe(a, b); await swapRecipe(a, b); await support(a);
  const c = await createMember('closure'); await pause(c, true);
  mark('public-withdrawal-and-account-pause');
  for (const item of items) if (!item.withdrawn) await withdraw(item);
  for (const member of [a, b]) await pause(member);
  mark('recipe-complete', {completed, allPublicFixturesWithdrawn: items.every(item => item.withdrawn),
    allSyntheticAccountsPaused: members.every(member => member.paused), financialProviderUsed: false,
    directFinancialWrites: false, operatorDecisionExercised: false, accountErasureCompleted: false, physicalPushVerified: false});
  }
} catch (error) {
  failed = true;
  console.error(JSON.stringify({at: new Date().toISOString(), project: PROJECT, runId, step, state: 'recipe_incomplete',
    error: safeError(error),assertion:assertionFrame(error), completed, syntheticAccountsCreated: members.filter(member => member.uid).length,
    publicFixtureReferences: items.filter(item => !item.withdrawn).map(item => ({articleId: item.articleId, ownerIdentityHash: hash(item.member.uid)})),
    cleanupPerformed: false, evidencePreserved: true, credentialsPersisted: false}));
  if(args.includes('--pause-on-error')){
    for(;;){
      const next=await instruction({operation:'fatal_read_only_diagnostics',...safeError(error),assertion:assertionFrame(error)},['stop','diagnose-read-only']);
      if(next!=='diagnose-read-only')break;
      await diagnoseNativeReadOnly();
    }
  }
} finally {
  input?.close();
  for (const member of members) await deleteApp(member.app).catch(() => {});
  if (temporaryDirectory) await rm(temporaryDirectory, {recursive: true, force: true});
  administratorToken = undefined;
}
process.exitCode = failed ? 1 : 0;
