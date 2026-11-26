/** Live synthetic fixture, development ONLY. Credentials remain in memory.
 * node scripts/smoke-dev.mjs --allow-admin-verification [--upload-only] [--ai-validation] [--photo-search]
 * Admin permission is used only to verify the synthetic email and remove this
 * run's own documents/objects. No payment, label or financial qualification.
 */
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { randomBytes, randomUUID, createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { initializeApp, deleteApp } from 'firebase/app';
import { getAuth, setPersistence, inMemoryPersistence, createUserWithEmailAndPassword, getIdToken, reload, updateProfile } from 'firebase/auth';
import { getFirestore, doc, getDoc, setDoc, serverTimestamp } from 'firebase/firestore';
import { getFunctions, httpsCallable } from 'firebase/functions';
import { getStorage, ref, uploadBytes, getDownloadURL } from 'firebase/storage';

const PROJECT = 'seconde-dev';
const config = JSON.parse(await readFile(new URL('../config/firebaseProjects.json', import.meta.url), 'utf8')).development;
assert.equal(config.projectId, PROJECT);
assert.equal(config.authDomain, `${PROJECT}.firebaseapp.com`);
assert.equal(config.storageBucket, `${PROJECT}.firebasestorage.app`);
assert(!process.env.FIRESTORE_EMULATOR_HOST && !process.env.FIREBASE_AUTH_EMULATOR_HOST && !process.env.FIREBASE_STORAGE_EMULATOR_HOST, 'This probe targets the isolated dev cloud, not emulators.');
if (!process.argv.includes('--allow-admin-verification')) {
  console.log('Prepared dev-only probe. Run with --allow-admin-verification to create, verify, publish and clean up one synthetic fixture.');
  process.exit(0);
}

const runId = randomUUID().replaceAll('-', '');
const username = `smoke${runId.slice(0, 12)}`;
const password = `${randomBytes(30).toString('base64url')}aA1!`;
const email = `smoke-${runId}@seconde-smoke.test`;
const hash = value => createHash('sha256').update(JSON.stringify(value)).digest('hex');
let step = 'configuration', uid, articleId, adminToken, app, failed = false;
const cleanupErrors = [];
const uploadOnly = process.argv.includes('--upload-only');

function diagnosticText(value) {
  return value.replace(/https?:\/\/[^\s"'<>]+/gi, '[url]')
    .replace(/\b(?:Bearer|Firebase)\s+[A-Za-z0-9._~+/-]+=*/gi, '[credential]')
    .replace(/\b(?:ya29\.|eyJ|AIza)[A-Za-z0-9._-]+/g, '[credential]')
    .replace(/[A-Za-z0-9_-]{28,}/g, '[redacted]').slice(0, 400);
}

function safeError(error) {
  const safe = {code: typeof error?.code === 'string' ? error.code.replace(/[^a-zA-Z0-9_/-]/g, '').slice(0, 100) : 'probe_failed'};
  const details = error?.details;
  for (const key of ['reason', 'field', 'action', 'policyVersion', 'declarationVersion']) {
    if (typeof details?.[key] === 'string' && /^[a-zA-Z0-9_.:/-]{1,150}$/.test(details[key])) safe[key] = details[key];
  }
  if (typeof error?.code === 'string' && error.code.startsWith('storage/')) {
    try {
      const response = JSON.parse(error.customData?.serverResponse ?? 'null');
      const server = response?.error;
      if (typeof server?.message === 'string') safe.storageServerMessage = diagnosticText(server.message);
      const reasons = [...(Array.isArray(server?.details) ? server.details : []), ...(Array.isArray(server?.errors) ? server.errors : [])]
        .map(item => item?.reason).filter(value => typeof value === 'string').map(diagnosticText).slice(0, 3);
      if (reasons.length) safe.storageServerReasons = reasons;
    } catch { safe.storageServerResponse = 'not_json'; }
  }
  return safe;
}
function mark(name) { step = name; console.log(JSON.stringify({at:new Date().toISOString(),step:name, project:PROJECT})); }
function accessToken() {
  if (adminToken) return adminToken;
  const result = spawnSync('gcloud', ['auth', 'print-access-token', '--project', PROJECT], {encoding:'utf8', stdio:['ignore','pipe','pipe']});
  if (result.status !== 0 || !result.stdout.trim()) throw Object.assign(new Error('Dev administrator token unavailable'), {code:'admin_token_unavailable'});
  adminToken = result.stdout.trim();
  return adminToken;
}
async function adminRequest(url, method = 'GET', body, allowMissing = false) {
  const target = new URL(url);
  assert(['identitytoolkit.googleapis.com', 'firestore.googleapis.com', 'storage.googleapis.com'].includes(target.hostname));
  assert(target.pathname.includes(PROJECT), 'Every administrator request must target the dev project/bucket.');
  const response = await fetch(url, {method, headers:{Authorization:`Bearer ${accessToken()}`, 'Content-Type':'application/json', 'x-goog-user-project':PROJECT},
    ...(body ? {body:JSON.stringify(body)} : {}), signal:AbortSignal.timeout(20_000)});
  if (allowMissing && response.status === 404) return null;
  const data = await response.json().catch(() => null);
  if (!response.ok) throw Object.assign(new Error('Dev administrator request failed'), {code:`admin_http_${response.status}`});
  return data;
}
const documents = `https://firestore.googleapis.com/v1/projects/${PROJECT}/databases/(default)/documents`;
const authAdmin = `https://identitytoolkit.googleapis.com/v1/projects/${PROJECT}`;
const encodePath = path => path.split('/').map(encodeURIComponent).join('/');
async function removeDocument(path) {
  await adminRequest(`${documents}/${encodePath(path)}`, 'DELETE', undefined, true);
}
async function removeOwnedQuery(collectionId, fieldPath, value) {
  const rows = await adminRequest(`${documents}:runQuery`, 'POST', {structuredQuery:{from:[{collectionId}],
    where:{fieldFilter:{field:{fieldPath},op:'EQUAL',value:{stringValue:value}}}}});
  for (const row of rows ?? []) if (row.document) {
    const fields = row.document.fields ?? {};
    assert(fields[fieldPath]?.stringValue === value);
    if (fieldPath === 'articleId') assert(fields.ownerId?.stringValue === uid);
    const path = row.document.name.split('/documents/')[1];
    await removeDocument(path);
  }
}
async function removeObjects(prefix) {
  assert(prefix === `drafts/${uid}/smoke-${runId}/` || prefix === `articles/${articleId}/`);
  let pageToken;
  do {
    const query = new URLSearchParams({prefix, ...(pageToken ? {pageToken} : {})});
    const page = await adminRequest(`https://storage.googleapis.com/storage/v1/b/${config.storageBucket}/o?${query}`);
    for (const object of page.items ?? []) {
      assert(object.name.startsWith(prefix));
      await adminRequest(`https://storage.googleapis.com/storage/v1/b/${config.storageBucket}/o/${encodeURIComponent(object.name)}?ifGenerationMatch=${object.generation}`, 'DELETE', undefined, true);
    }
    pageToken = page.nextPageToken;
  } while (pageToken);
}

try {
  // Resolve the administrator before creating anything, so cleanup is ready.
  accessToken();
  app = initializeApp(config, `smoke-${runId}`);
  const auth = getAuth(app);
  await setPersistence(auth, inMemoryPersistence);
  const db = getFirestore(app), functions = getFunctions(app, 'northamerica-northeast1'), storage = getStorage(app);
  const call = async (name, data) => (await httpsCallable(functions, name, {timeout:90_000})(data)).data;
  mark('signup');
  const credentials = await createUserWithEmailAndPassword(auth, email, password);
  uid = credentials.user.uid;
  mark('create-client-profile-like-auth-service');
  const displayName = `TEST DEV ${runId.slice(0,8)}`;
  await updateProfile(credentials.user, {displayName});
  await setDoc(doc(db, 'users', uid), {id:uid,email,displayName,createdAt:serverTimestamp(),isActive:true,authProvider:'email'});
  mark('recordSignupConsent');
  await call('recordSignupConsent', {dateOfBirth:'1990-04-12',acceptedTerms:true,acceptedPrivacy:true,marketingOptIn:false,desiredUsername:username});
  mark('getMyEligibility-before-declaration');
  const before = await call('getMyEligibility', {});
  assert.equal(before.policyVersion, '2026-10-10.v1');
  assert.equal(typeof before.version, 'string');
  mark('declareSellerActivity');
  await call('declareSellerActivity', {kind:'personal',statementVersion:before.statementVersion,personalDeclarationAccepted:true,
    expectedVersion:before.version,requestId:`smoke_${runId}`,expectedUid:uid,
    quebecResidenceDeclaration:{version:before.quebecResidenceStatementVersion,country:'CA',province:'QC',accepted:true}});
  const after = await call('getMyEligibility', {});
  assert.equal(after.policyVersion, before.policyVersion);
  assert.equal(after.decisions.sell.allowed, true);
  assert.equal(after.activityDeclaration.kind, 'personal');
  assert.equal(after.quebecResidenceDeclaration.province, 'QC');
  console.log(JSON.stringify({at:new Date().toISOString(),step:'admission-qualified', policyVersion:after.policyVersion, sellAllowed:true}));

  mark('verify-synthetic-email');
  await adminRequest(`${authAdmin}/accounts:update`, 'POST', {localId:uid,emailVerified:true});
  await reload(credentials.user);
  await getIdToken(credentials.user, true);
  assert.equal(credentials.user.emailVerified, true);

  if (!uploadOnly && process.argv.includes('--ai-validation')) {
    mark('ai-input-boundary');
    let code;
    try { await call('analyzeProductImage', {}); } catch (error) { code = error.code; }
    assert.equal(code, 'functions/invalid-argument');
  }

  mark('upload-dev-fixture');
  const bytes = await readFile(new URL('../assets/images/favicon.png', import.meta.url));
  assert(bytes.readUInt32BE(16) <= 1200 && bytes.readUInt32BE(20) <= 1200 && bytes.length < 10 * 1024 * 1024);
  const stagedPath = `drafts/${uid}/smoke-${runId}/fixture.png`;
  const object = ref(storage, stagedPath);
  await uploadBytes(object, new Uint8Array(bytes), {contentType:'image/png'});
  const imageUrl = await getDownloadURL(object);
  assert(new URL(imageUrl).pathname.includes(`/b/${config.storageBucket}/`));
  console.log(JSON.stringify({at:new Date().toISOString(),step:'upload-and-draft-read-ok',project:PROJECT}));

  if (!uploadOnly) {
  if (process.argv.includes('--photo-search')) {
    mark('photo-search-live-vertex');
    try {
      // A real embedding/search of a pictogram, not garment autofill. An empty
      // new dev catalogue is a valid outcome; no match is manufactured.
      const result = await call('visualSearch', {imageBase64:bytes.toString('base64'),limit:1});
      assert(Array.isArray(result.results));
      console.log(JSON.stringify({at:new Date().toISOString(),step:'photo-search-live-vertex-ok',resultCount:result.results.length}));
    } catch (error) {
      failed = true;
      console.error(JSON.stringify({at:new Date().toISOString(),step,error:safeError(error)}));
      // Continue the independent publication check and clean up both paths.
    }
  }

  mark('publish-test-article');
  const clientRequestId = `smoke_${runId}`;
  articleId = createHash('sha256').update(`${uid}:${clientRequestId}`).digest('hex').slice(0,20);
  const publication = await call('createArticle', {clientRequestId,title:`TEST DEV ${runId.slice(0,8)}`,
    description:'Donnée synthétique de vérification technique. Le pictogramme joint ne représente aucun vêtement réel ; aucune vente réelle.',
    price:1,images:[{url:imageUrl}],category:'T-shirts',categoryIds:['women','women_clothing','women_clothing_tops','women_clothing_tops_tshirts'],
    condition:'très bon état',brandStatus:'unbranded',brand:null,size:{value:'M',system:'EU'},
    hasKnownDefects:false,defectsDescription:null,hasAlterations:false,alterationsDescription:null,
    quantity:1,stock:1,saleUnit:'single_article',counterfeitStatus:'not_counterfeit',
    saleDeclaration:{version:'personal_item_v3',accepted:true,saleUnit:'single_article',counterfeitStatus:'not_counterfeit'},
    inventoryUnitDeclaration:{kind:'new_unit'},isHandDelivery:true,isShipping:false,
    neighborhoods:[{id:'smoke-test-qc',name:'TEST DEV — aucun rendez-vous réel',borough:'Montréal'}]});
  assert.equal(publication.articleId, articleId);
  const article = (await getDoc(doc(db, 'articles', articleId))).data();
  assert.equal(article?.sellerId, uid);
  assert.equal(article?.isActive, true);
  const publishedUrl = article.images[0].url;
  assert(new URL(publishedUrl).pathname.includes(`/b/${config.storageBucket}/`));
  assert.equal((await fetch(publishedUrl, {signal:AbortSignal.timeout(15_000)})).status, 200);
  console.log(JSON.stringify({at:new Date().toISOString(),step:'published-and-image-readable',project:PROJECT,uid,articleId}));
  }
} catch (error) {
  failed = true;
  console.error(JSON.stringify({at:new Date().toISOString(),step, error:safeError(error)}));
} finally {
  if (!uid && app) {
    // A lost signup response can leave the synthetic Auth user committed.
    // Resolve only the exact random address created by THIS run.
    try {
      const lookup = await adminRequest(`${authAdmin}/accounts:lookup`, 'POST', {email:[email]});
      uid = lookup.users?.find(user => user.email === email)?.localId;
    } catch { /* The main failure remains visible; no unrelated user is selected. */ }
  }
  if (uid) {
    mark('cleanup-own-synthetic-fixture');
    // Give already queued index/stat triggers a short opportunity to finish.
    await new Promise(resolve => setTimeout(resolve, 2000));
    const attempt = async (name, fn) => {try {await fn();} catch (error) {cleanupErrors.push({name,...safeError(error)});}};
    if (articleId) {
      await attempt('promoted-objects', () => removeObjects(`articles/${articleId}/`));
      await attempt('promotions', () => removeOwnedQuery('article_media_promotions','articleId',articleId));
      for (const collection of ['articles','search_index','embeddings']) await attempt(collection, () => removeDocument(`${collection}/${articleId}`));
      for (const id of [`unit_${hash(['seller_inventory_unit_v1',uid,articleId])}`,`article_${hash(['seller_inventory_article_v1',uid,articleId])}`]) {
        await attempt('inventory', () => removeDocument(`inventory_units/${id}`));
      }
    }
    await attempt('draft-objects', () => removeObjects(`drafts/${uid}/smoke-${runId}/`));
    await attempt('eligibility-audit', () => removeOwnedQuery('eligibility_audit','ownerId',uid));
    await attempt('own-rate-limits', () => removeOwnedQuery('rate_limits','callerKey',uid));
    await attempt('consents', async () => {
      const page = await adminRequest(`${documents}/users/${uid}/consents`);
      for (const d of page.documents ?? []) await removeDocument(d.name.split('/documents/')[1]);
    });
    await attempt('own-username', async () => {
      const existing = await adminRequest(`${documents}/usernames/${username}`, 'GET', undefined, true);
      if (existing) {
        assert.equal(existing.fields?.uid?.stringValue, uid);
        await removeDocument(`usernames/${username}`);
      }
    });
    for (const path of [`users/${uid}`,`eligibility_profiles/${uid}`,`financial_subject_guards/${hash(uid)}`]) {
      await attempt('account-documents', () => removeDocument(path));
    }
    await attempt('synthetic-auth-user', () => adminRequest(`${authAdmin}/accounts:delete`, 'POST', {localId:uid}));
    if (cleanupErrors.length) console.error(JSON.stringify({at:new Date().toISOString(),step:'cleanup-incomplete',uid,articleId,errors:cleanupErrors}));
    else console.log(JSON.stringify({at:new Date().toISOString(),step:'cleanup-complete',project:PROJECT}));
  }
  if (app) await deleteApp(app);
}
process.exitCode = failed || cleanupErrors.length ? 1 : 0;
