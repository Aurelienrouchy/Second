import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'node:crypto';
import { Timestamp } from 'firebase-admin/firestore';
import { defineSecret, defineString } from 'firebase-functions/params';
import { HttpsError, onCall, onRequest } from 'firebase-functions/v2/https';
import { db } from '../config/firebase';
import { runtimeProjectId } from '../config/runtimeEnvironment';
import { assertPrivateAccountSession } from '../utils/privateAccountSession';
import { checkRateLimit } from '../utils/rateLimit';

const applicationId = defineString('SQUARE_SANDBOX_APPLICATION_ID', { default: '' });
const encryptionKey = defineSecret('SQUARE_SANDBOX_TOKEN_ENCRYPTION_KEY');
const base = 'https://connect.squareupsandbox.com';
const callback = 'https://northamerica-northeast1-seconde-dev.cloudfunctions.net/squareInventoryOAuthCallback';
const scopes = ['MERCHANT_PROFILE_READ', 'ITEMS_READ', 'INVENTORY_READ'];
const options = { region: 'northamerica-northeast1', memory: '512MiB' } as const;
const currentProject = () => runtimeProjectId() === 'seconde-dev' && process.env.FUNCTIONS_EMULATOR !== 'true';
const devOptions = currentProject() ? { ...options, secrets: [encryptionKey] } : options;
const hash = (value: string, encoding: 'hex' | 'base64url' = 'hex') => createHash('sha256').update(value).digest(encoding);
const fixtureId = (uid: string) => `square-pilot-${hash(uid)}`;
const invalid = (message = 'Requête Square invalide.') => new HttpsError('invalid-argument', message);
const unavailable = () => new HttpsError('unavailable', 'Square Sandbox est temporairement indisponible.');
const disconnected = { status: 'disconnected' } as const;
const text = (value: unknown, max = 190): value is string => typeof value === 'string' && value.length > 0 && value.length <= max;
const shopKey = (value: unknown): value is string => text(value, 128) && /^[A-Za-z0-9_-]+$/.test(value) && !/^__.*__$/.test(value);
const pilot = () => db.collection('square_inventory_pilot_shops');
const links = () => db.collection('square_inventory_pilot_links');
const states = () => db.collection('square_inventory_pilot_states');
const expires = (d: { expiresAt?: Timestamp } | undefined) => d?.expiresAt instanceof Timestamp ? d.expiresAt.toMillis() : 0;
const aad = (uid: string, shopId: string, stateId: string) => Buffer.from(JSON.stringify([uid, shopId, stateId]));
function tokenKey() {
  const key = Buffer.from(encryptionKey.value(), 'base64url');
  if (key.length !== 32) throw unavailable();
  return key;
}
function sealToken(token: string, context: Buffer) {
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', tokenKey(), iv).setAAD(context);
  const value = Buffer.concat([cipher.update(token, 'utf8'), cipher.final()]);
  return Buffer.concat([iv, cipher.getAuthTag(), value]).toString('base64url');
}
function openToken(sealed: string, context: Buffer) {
  try {
    const value = Buffer.from(sealed, 'base64url');
    const cipher = createDecipheriv('aes-256-gcm', tokenKey(), value.subarray(0, 12))
      .setAAD(context).setAuthTag(value.subarray(12, 28));
    return Buffer.concat([cipher.update(value.subarray(28)), cipher.final()]).toString('utf8');
  } catch { throw unavailable(); }
}

async function owner(tx: FirebaseFirestore.Transaction, uid: string, shopId: string) {
  if (shopId.startsWith('square-pilot-') && shopId !== fixtureId(uid)) throw new HttpsError('permission-denied', 'Boutique indisponible.');
  const ref = shopId.startsWith('square-pilot-') ? pilot().doc(shopId) : db.collection('shops').doc(shopId);
  const shop = (await tx.get(ref)).data();
  if (!shop || shop.ownerId !== uid || !['pending', 'approved'].includes(shop.status)) {
    throw new HttpsError('permission-denied', 'Boutique indisponible.');
  }
}

class SandboxError extends Error { constructor(readonly status: number) { super('Square Sandbox rejected the request'); } }
async function square(path: '/oauth2/token' | '/v2/locations' | '/v2/catalog/search-catalog-items' | '/v2/inventory/counts/batch-retrieve', token?: string, body?: object): Promise<Record<string, unknown>> {
  let res: Response;
  try {
    res = await fetch(base + path, { method: body ? 'POST' : 'GET', redirect: 'error', signal: AbortSignal.timeout(8_000),
      headers: { 'Square-Version': '2026-09-16', ...(body ? { 'Content-Type': 'application/json' } : {}), ...(token ? { Authorization: `Bearer ${token}` } : {}) },
      ...(body ? { body: JSON.stringify(body) } : {}) });
  } catch { throw unavailable(); }
  if (!res.ok) throw new SandboxError(res.status);
  const response: unknown = await res.json().catch(() => null);
  if (!response || typeof response !== 'object' || Array.isArray(response)) throw unavailable();
  return response as Record<string, unknown>;
}
const list = (value: unknown): Record<string, unknown>[] => Array.isArray(value) ? value.filter(x => !!x && typeof x === 'object' && !Array.isArray(x)) : [];
async function locations(token: string, merchantId: string) {
  const data = await square('/v2/locations', token);
  return list(data.locations).filter(location => location.status === 'ACTIVE' && location.country === 'CA' && location.merchant_id === merchantId)
    .flatMap(l => text(l.id, 100) && text(l.name, 200) ? [{ id: l.id, name: l.name }] : []);
}
async function inventory(token: string, locationId: string, query: string) {
  const data = await square('/v2/catalog/search-catalog-items', token, { enabled_location_ids: [locationId],
    archived_state: 'ARCHIVED_STATE_NOT_ARCHIVED', limit: 20, ...(query ? { text_filter: query } : {}) });
  const matches = Array.isArray(data.matched_variation_ids) && data.matched_variation_ids.length ? new Set(data.matched_variation_ids) : null;
  const variants = list(data.items).flatMap(item => {
    const itemData = item.item_data as Record<string, unknown> | undefined;
    return list(itemData?.variations).flatMap(variant => {
      const v = variant.item_variation_data as Record<string, unknown> | undefined;
      if (!text(variant.id, 100) || !text(itemData?.name, 500) || (matches && !matches.has(variant.id)) ||
          (Array.isArray(variant.absent_at_location_ids) && variant.absent_at_location_ids.includes(locationId)) ||
          (variant.present_at_all_locations === false && (!Array.isArray(variant.present_at_location_ids) || !variant.present_at_location_ids.includes(locationId)))) return [];
      return [{ id: variant.id, name: text(v?.name, 500) && v.name !== 'Regular' ? `${itemData.name} — ${v.name}` : itemData.name,
        ...(text(v?.sku, 200) ? { sku: v.sku } : {}) }];
    });
  });
  const selection = variants.slice(0, 30);
  const ids = new Set(selection.map(v => v.id));
  const levels = ids.size ? await square('/v2/inventory/counts/batch-retrieve', token, { catalog_object_ids: [...ids], location_ids: [locationId], states: ['IN_STOCK'] }) : {};
  const counts = new Map<string, string>();
  for (const c of list(levels.counts)) if (text(c.catalog_object_id, 100) && ids.has(c.catalog_object_id) && c.location_id === locationId &&
    c.state === 'IN_STOCK' && typeof c.quantity === 'string' && /^-?\d+(?:\.\d+)?$/.test(c.quantity) && !counts.has(c.catalog_object_id)) counts.set(c.catalog_object_id, c.quantity);
  return { items: selection.map(v => ({ ...v, quantity: counts.get(v.id) ?? null })), sampledAt: new Date().toISOString(),
    truncated: !!data.cursor || !!levels.cursor || variants.length > selection.length };
}

export const squareInventoryPilot = onCall(devOptions, async request => {
  if (!currentProject()) throw new HttpsError('not-found', 'Test Square indisponible.');
  const uid = request.auth?.uid;
  if (!uid || request.auth?.token.firebase?.sign_in_provider === 'anonymous' || request.data?.expectedUid !== uid) throw new HttpsError('unauthenticated', 'Reconnectez-vous à Seconde Dev.');
  const { action, shopId, locationId } = request.data;
  if (!['prepare', 'status', 'start', 'disconnect', 'inventory'].includes(action)) throw invalid();
  await checkRateLimit(hash(uid), true, { functionName: 'squareInventoryPilot', maxCallsAuthenticated: 30,
    maxCallsUnauthenticated: 0, windowMs: 60_000 });
  const clientId = applicationId.value();
  const configured = /^sandbox-sq0idb-[A-Za-z0-9_-]{8,120}$/.test(clientId);
  const session = (tx: FirebaseFirestore.Transaction) => assertPrivateAccountSession(request, tx);
  if (action === 'prepare') {
    const ref = pilot().doc(fixtureId(uid));
    await db.runTransaction(async tx => {
      await session(tx);
      const prior = await tx.get(ref);
      if (prior.exists && (prior.data()?.ownerId !== uid || prior.data()?.status !== 'pending')) throw new HttpsError('permission-denied', 'Boutique indisponible.');
      if (!prior.exists) tx.create(ref, { ownerId: uid, name: 'Boutique pilote Square', status: 'pending' });
    });
    return { shopId: ref.id };
  }
  if (!shopKey(shopId)) throw invalid();
  const link = links().doc(shopId);
  const guard = async (tx: FirebaseFirestore.Transaction) => {
    await session(tx);
    await owner(tx, uid, shopId);
    const doc = (await tx.get(link)).data();
    return doc?.uid === uid ? doc : undefined;
  };
  if (action === 'disconnect') return db.runTransaction(async tx => {
    const previous = await guard(tx);
    if (typeof previous?.stateId === 'string' && /^[a-f0-9]{64}$/.test(previous.stateId)) tx.delete(states().doc(previous.stateId));
    tx.delete(link);
    return disconnected;
  });
  if (action === 'start') {
    const state = randomBytes(32).toString('base64url');
    const stateId = hash(state);
    const verifier = randomBytes(32).toString('base64url');
    await db.runTransaction(async tx => {
      const previous = await guard(tx);
      if (!configured) throw new HttpsError('failed-precondition', 'Configurez Square Sandbox.');
      if (previous && ['pending', 'exchanging', 'connected'].includes(previous.phase) && expires(previous) > Date.now()) {
        throw new HttpsError('failed-precondition', 'Une connexion Square est déjà en cours.');
      }
      const expiresAt = Timestamp.fromMillis(Date.now() + 10 * 60_000);
      if (typeof previous?.stateId === 'string' && /^[a-f0-9]{64}$/.test(previous.stateId)) tx.delete(states().doc(previous.stateId));
      tx.create(states().doc(stateId), { uid, shopId, verifier, authTime: request.auth!.token.auth_time, expiresAt });
      tx.set(link, { uid, stateId, phase: 'pending', expiresAt });
    });
    const authorization = new URL('/oauth2/authorize', base);
    authorization.search = new URLSearchParams({ client_id: clientId, scope: scopes.join(' '), state,
      redirect_uri: callback, code_challenge: hash(verifier, 'base64url'), locale: 'fr-CA' }).toString();
    return { authorizationUrl: authorization.href };
  }
  const existing = await db.runTransaction(guard);
  if (!configured) {
    if (action === 'status') return { status: 'unconfigured' };
    throw new HttpsError('failed-precondition', 'Configurez Square Sandbox.');
  }
  const now = Date.now();
  const expiry = expires(existing);
  const ensureStillCurrent = async () => db.runTransaction(async tx => {
    const latest = await guard(tx);
    if (!latest || latest.stateId !== existing?.stateId || latest.phase !== 'connected' || expires(latest) <= Date.now()) throw new HttpsError('failed-precondition', 'La connexion Square a changé.');
  });
  if (!existing || existing.phase !== 'connected' || expiry <= now || !text(existing.sealedToken, 2048) || !text(existing.merchantId, 191)) {
    if (action !== 'status') throw new HttpsError('failed-precondition', 'Connectez un compte Square Sandbox.');
    if (!existing) return disconnected;
    if (existing.phase === 'failed') return { status: 'failed' };
    if (expiry <= now) return { status: 'expired' };
    if (['pending', 'exchanging'].includes(existing.phase)) return { status: 'pending', expiresAt: new Date(expiry).toISOString() };
    return { status: 'failed' };
  }
  try {
    const token = openToken(existing.sealedToken, aad(uid, shopId, existing.stateId));
    const stores = await locations(token, existing.merchantId);
    if (action === 'status') {
      await ensureStillCurrent();
      return { status: 'connected', expiresAt: new Date(expiry).toISOString(), locations: stores };
    }
    const query = request.data.query ?? '';
    if (typeof query !== 'string' || query.length > 80 || !stores.some(l => l.id === locationId)) throw invalid('Emplacement ou recherche Square invalide.');
    await ensureStillCurrent();
    const sample = await inventory(token, locationId, query.trim());
    await ensureStillCurrent();
    return sample;
  } catch (error) {
    if (!(error instanceof SandboxError)) throw error;
    if (error.status !== 401 && error.status !== 403) throw unavailable();
    await db.runTransaction(async tx => {
      const latest = await guard(tx);
      if (latest?.stateId === existing.stateId) tx.set(link, { uid, stateId: existing.stateId, phase: 'failed', expiresAt: Timestamp.fromMillis(Date.now() + 3600_000) });
    });
    if (action === 'status') return { status: 'failed' };
    throw new HttpsError('failed-precondition', 'Autorisez de nouveau le compte Square.');
  }
});

export const squareInventoryOAuthCallback = onRequest({ ...devOptions, invoker: 'public' }, async (request, response) => {
  response.set({ 'Cache-Control': 'no-store', 'Referrer-Policy': 'no-referrer', 'Content-Security-Policy': "default-src 'none'; frame-ancestors 'none'", 'X-Content-Type-Options': 'nosniff' });
  const finish = (status: number, label: string) => { response.status(status).type('html').send(`<!doctype html><html lang="fr"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Seconde Dev</title><h1>${label}</h1><p>Revenez dans Seconde Dev et choisissez « Vérifier la connexion ».</p></html>`); };
  if (!currentProject()) { finish(404, 'Test indisponible'); return; }
  if (request.method !== 'GET') { response.set('Allow', 'GET'); finish(405, 'Méthode non autorisée'); return; }
  const { state, code, error } = request.query;
  const clientId = applicationId.value();
  if (typeof state !== 'string' || !/^[A-Za-z0-9_-]{43}$/.test(state) || !/^sandbox-sq0idb-[A-Za-z0-9_-]{8,120}$/.test(clientId) ||
      !(text(code, 191) && error === undefined || code === undefined && text(error, 100))) { finish(400, 'Autorisation invalide'); return; }
  const stateId = hash(state);
  const pending = states().doc(stateId);
  let claim: { uid: string; shopId: string; verifier: string; authTime: number } | null = null;
  const confirmSession = (value: { uid: string; authTime: number }, tx: FirebaseFirestore.Transaction) =>
    assertPrivateAccountSession({ auth: { uid: value.uid, token: { auth_time: value.authTime } }, data: { expectedUid: value.uid } }, tx);
  try {
    claim = await db.runTransaction(async tx => {
      const attempt = (await tx.get(pending)).data();
      if (!attempt || expires(attempt) <= Date.now() || !text(attempt.uid, 128) || !shopKey(attempt.shopId) || !text(attempt.verifier, 128) || !Number.isSafeInteger(attempt.authTime)) return null;
      const value = { uid: attempt.uid, shopId: attempt.shopId, verifier: attempt.verifier, authTime: attempt.authTime as number };
      const link = links().doc(value.shopId);
      const active = (await tx.get(link)).data();
      if (!active || active.uid !== value.uid || active.phase !== 'pending' || active.stateId !== stateId) return null;
      await confirmSession(value, tx);
      await owner(tx, value.uid, value.shopId);
      tx.delete(pending);
      tx.set(link, { uid: value.uid, stateId, phase: error ? 'failed' : 'exchanging', expiresAt: Timestamp.fromMillis(Date.now() + 10 * 60_000) });
      return value;
    });
    if (!claim) { finish(410, 'Autorisation expirée'); return; }
    if (error) { finish(200, 'Autorisation annulée'); return; }
    const token = await square('/oauth2/token', undefined, { client_id: clientId, code, grant_type: 'authorization_code',
      code_verifier: claim.verifier, redirect_uri: callback, short_lived: true });
    if (!text(token.access_token, 1024) || !text(token.merchant_id, 191) || !text(token.expires_at, 48) || token.short_lived !== true ||
        !Number.isFinite(Date.parse(token.expires_at)) || Date.parse(token.expires_at) <= Date.now()) throw unavailable();
    const value = claim;
    const completed = await db.runTransaction(async tx => {
      const link = links().doc(value.shopId);
      const active = (await tx.get(link)).data();
      if (!active || active.uid !== value.uid || active.phase !== 'exchanging' || active.stateId !== stateId || expires(active) <= Date.now()) return false;
      await confirmSession(value, tx);
      await owner(tx, value.uid, value.shopId);
      tx.set(link, { uid: value.uid, stateId, phase: 'connected',
        sealedToken: sealToken(token.access_token as string, aad(value.uid, value.shopId, stateId)), merchantId: token.merchant_id,
        expiresAt: Timestamp.fromMillis(Math.min(Date.parse(token.expires_at as string), Date.now() + 864e5)) });
      return true;
    });
    finish(completed ? 200 : 410, completed ? 'Autorisation reçue' : 'Autorisation expirée');
  } catch {
    if (claim) {
      const link = links().doc(claim.shopId);
      const uid = claim.uid;
      await db.runTransaction(async tx => {
        const active = (await tx.get(link)).data();
        if (active?.uid === uid && active.stateId === stateId && active.phase === 'exchanging') {
          tx.set(link, { uid, stateId, phase: 'failed', expiresAt: Timestamp.fromMillis(Date.now() + 3600_000) });
        }
      }).catch(() => undefined);
    }
    finish(400, 'Autorisation non confirmée');
  }
});
