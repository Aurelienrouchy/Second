import assert from 'node:assert/strict';
import { randomBytes, randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { deleteApp, initializeApp } from 'firebase/app';
import { createUserWithEmailAndPassword, deleteUser, getAuth } from 'firebase/auth';
import { getFunctions, httpsCallable } from 'firebase/functions';

const config = JSON.parse(await readFile(new URL('../config/firebaseProjects.json', import.meta.url), 'utf8')).development;
assert.equal(config.projectId, 'seconde-dev');
assert.equal(config.authDomain, 'seconde-dev.firebaseapp.com');
assert(!process.env.FIREBASE_AUTH_EMULATOR_HOST && !process.env.FIRESTORE_EMULATOR_HOST);
const region = 'northamerica-northeast1';
const callback = `https://${region}-${config.projectId}.cloudfunctions.net/squareInventoryOAuthCallback`;
const app = initializeApp(config, 'smoke-square-dev');
const auth = getAuth(app);
const call = httpsCallable(getFunctions(app, region), 'squareInventoryPilot', { timeout: 25_000 });
let stage = 'unauthenticated';
let shopId;

async function result(data) { return (await call(data)).data; }

try {
  await assert.rejects(result({ action: 'prepare', expectedUid: 'smoke-without-auth' }), { code: 'functions/unauthenticated' });
  stage = 'sign-up';
  const { user } = await createUserWithEmailAndPassword(auth, `square-smoke-${randomUUID()}@seconde-smoke.test`,
    `${randomBytes(30).toString('base64url')}aA1!`);
  const expectedUid = user.uid;
  stage = 'prepare';
  ({ shopId } = await result({ action: 'prepare', expectedUid }));
  assert.match(shopId, /^square-pilot-[a-f0-9]+$/);
  assert.deepEqual(await result({ action: 'prepare', expectedUid }), { shopId });
  const request = { expectedUid, shopId };
  stage = 'status';
  assert.equal((await result({ action: 'status', ...request })).status, 'disconnected');
  stage = 'start';
  const authorization = new URL((await result({ action: 'start', ...request })).authorizationUrl);
  assert.equal(authorization.origin, 'https://connect.squareupsandbox.com');
  assert.equal(authorization.pathname, '/oauth2/authorize');
  assert.equal(authorization.searchParams.get('redirect_uri'), callback);
  assert.match(authorization.searchParams.get('code_challenge'), /^[A-Za-z0-9_-]{43}$/);
  assert.match(authorization.searchParams.get('client_id'), /^sandbox-sq0idb-/);
  assert.deepEqual(authorization.searchParams.get('scope').split(' ').sort(), ['INVENTORY_READ', 'ITEMS_READ', 'MERCHANT_PROFILE_READ']);
  assert.equal((await result({ action: 'status', ...request })).status, 'pending');
  stage = 'callback';
  const url = new URL(callback);
  url.searchParams.set('error', 'access_denied');
  url.searchParams.set('state', authorization.searchParams.get('state'));
  const denied = await fetch(url, { redirect: 'error', signal: AbortSignal.timeout(15_000) });
  assert([200, 400].includes(denied.status));
  assert.equal((await result({ action: 'status', ...request })).status, 'failed');
  const replay = await fetch(url, { redirect: 'error', signal: AbortSignal.timeout(15_000) });
  assert([200, 400, 410].includes(replay.status));
  stage = 'disconnect';
  assert.deepEqual(await result({ action: 'disconnect', ...request }), { status: 'disconnected' });
  console.log('Square Dev smoke passed: auth, prepare, OAuth URL, pending, denial, replay, disconnect.');
} catch (error) {
  // OAuth URLs and raw responses contain state and must stay out of console logs.
  console.error(`Square Dev smoke failed at ${stage} (${error?.code ?? error?.name ?? 'unknown'}).`);
  process.exitCode = 1;
} finally {
  if (auth.currentUser) await deleteUser(auth.currentUser).catch(() => { process.exitCode = 1; });
  await deleteApp(app);
}
