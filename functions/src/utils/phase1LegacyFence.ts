import { HttpsError } from 'firebase-functions/v2/https';
import {Timestamp} from 'firebase-admin/firestore';
import type {Auth} from 'firebase-admin/auth';

/** Compatibility fence for the production maintenance release only. Presence,
 * including a malformed marker, closes an old writer; it never qualifies a
 * source or grants the new writer permission to change it. */
export const PHASE1_CONTRACT = 'phase1_v2';
const sourceMarkers = ['phase1Contract', 'phase1Source', 'localAgreementWitness', 'localCatalogueWitness', 'financialRecoveryWitness', 'inventoryUnit',
  'articleEvidence', 'messageEvidence', 'withdrawalIntent', 'providerSubmission', 'privacyWithdrawal', 'contentModeration', 'accountErasureFence'] as const;
const modernAccountFields = ['mode', 'expectedUid', 'accountControlProof', 'capability', 'operation'] as const;
const hasOwn = (value: unknown, key: string) => value !== null && typeof value === 'object' &&
  Object.prototype.hasOwnProperty.call(value, key);

export function legacyDeletionInProgress(profile: unknown): boolean {
  return hasOwn(profile, 'legacyDeletionFence');
}

export function assertNoLegacyDeletionFence(profile: unknown): void {
  if (legacyDeletionInProgress(profile)) throw new HttpsError('failed-precondition',
    'La suppression de ce compte est en cours. Contactez notre équipe si elle ne se termine pas.',
    {reason: 'legacy_deletion_in_progress', action: 'contactSupport'});
}

export function isPhase1ProtectedSource(value: unknown): boolean {
  return sourceMarkers.some(key => hasOwn(value, key));
}

export function assertLegacySource(value: unknown): void {
  if (isPhase1ProtectedSource(value)) throw new HttpsError('failed-precondition',
    'Cet élément nécessite la nouvelle version de Seconde.', {reason: 'phase1_update_required'});
}

export function checkedLegacySource<T>(value: T): T {
  assertLegacySource(value);
  return value;
}

export function assertLegacyAcquisitionEnabled(env: NodeJS.ProcessEnv = process.env): void {
  const flag = env.SECONDE_LEGACY_ACQUISITION_DISABLED;
  if (flag !== undefined && flag !== 'false') throw new HttpsError('failed-precondition',
    'Mettez à jour Seconde pour créer une nouvelle opération.', {reason: 'phase1_update_required'});
}

/** Old deletion ignores its payload. Never let a modern observation, pause or
 * recovery command reach that destructive historical handler by mistake. */
export function assertLegacyAccountDeletionRequest(value: unknown): void {
  if (modernAccountFields.some(key => hasOwn(value, key))) throw new HttpsError('failed-precondition',
    'Cette démarche nécessite la nouvelle version de Seconde.', {reason: 'phase1_update_required'});
}

type LegacyRequest = {auth?: {uid: string; token?: Record<string, unknown>} | null; data?: unknown};
type LegacyDependencies = {db: FirebaseFirestore.Firestore; auth: Pick<Auth, 'getUser'>};
const updateRequired = (): never => {throw new HttpsError('failed-precondition',
  'Cette démarche nécessite la nouvelle version de Seconde.', {reason: 'phase1_update_required'});};
const stale = (): never => {throw new HttpsError('unauthenticated', 'Réauthentifiez-vous pour poursuivre.',
  {reason: 'private_session_stale', action: 'reauthenticate'});};
function ownDeletionFence(profile: unknown, uid: string): boolean {
  if (!legacyDeletionInProgress(profile)) return false;
  const fence = (profile as Record<string, any>).legacyDeletionFence;
  return fence?.protocol === 'phase1_legacy_deletion_fence_v1' && fence.ownerId === uid &&
    fence.startedAt instanceof Timestamp && fence.startedAt.toMillis() > 0 && fence.startedAt.toMillis() <= Date.now() &&
    Number.isSafeInteger(fence.authTime) && fence.authTime > 0;
}

/** Invoked at the explicit historical callable boundary and inside its native
 * transaction callbacks. It never changes Auth or reconstructs a declaration.
 * A migrated account uses V2 for new acquisitions; its old obligations remain
 * serviceable after fresh authentication unless deletion is already running. */
export async function assertLegacyActor(request: LegacyRequest, dependencies: LegacyDependencies,
  options: {tx?: FirebaseFirestore.Transaction; acquisition?: boolean; admin?: boolean; allowDeletionRetry?: boolean} = {}) {
  if (options.acquisition) assertLegacyAcquisitionEnabled();
  const uid = request.auth?.uid, authTime = request.auth?.token?.auth_time;
  if (typeof uid !== 'string' || !uid || uid.includes('/') || !Number.isSafeInteger(authTime) ||
      (authTime as number) < 1 || (authTime as number) > Math.floor(Date.now() / 1000) + 60) return stale();
  let user;
  try {user = await dependencies.auth.getUser(uid);} catch (error) {
    if ((error as {code?: unknown})?.code === 'auth/user-not-found') return stale();
    throw new HttpsError('unavailable', 'La session ne peut pas être vérifiée actuellement.');
  }
  const cutoff = typeof user.tokensValidAfterTime === 'string' ? Date.parse(user.tokensValidAfterTime) : NaN;
  if (user.uid !== uid || user.disabled !== false || !Number.isSafeInteger(cutoff) || cutoff < 0 || cutoff > Date.now() ||
      (authTime as number) * 1000 < cutoff) return stale();
  const ref = dependencies.db.collection('eligibility_profiles').doc(uid);
  const snapshot = await (options.tx ? options.tx.get(ref) : ref.get()), profile = snapshot.data();
  if (hasOwn(profile, 'accountErasureFence')) return updateRequired();
  if (legacyDeletionInProgress(profile) && !(options.allowDeletionRetry && ownDeletionFence(profile, uid))) assertNoLegacyDeletionFence(profile);
  // A modern containment/recovery episode cannot be interpreted by the old
  // handler; do not let an old JWT bypass it, even after Auth revocation settles.
  if (hasOwn(profile, 'accountSecurityBarrier')) return updateRequired();
  if (options.admin) {
    const currentRef = dependencies.db.collection('users').doc(uid);
    const current = (await (options.tx ? options.tx.get(currentRef) : currentRef.get())).data();
    if (user.customClaims?.admin !== true && current?.isAdmin !== true ||
        hasOwn(current, 'isActive') && current?.isActive !== true) {
      throw new HttpsError('permission-denied', 'Accès administrateur actuel requis.');
    }
  }
  if (options.acquisition && snapshot.exists) return updateRequired();
  if (options.acquisition) {
    const data = request.data && typeof request.data === 'object' && !Array.isArray(request.data)
      ? request.data as Record<string, unknown> : {};
    const participants = new Set<string>([uid]);
    const identifier = (value: unknown): value is string => typeof value === 'string' && value.length > 0 && value.length <= 200 && !value.includes('/');
    if (identifier(data.receiverId)) participants.add(data.receiverId);
    for (const [field, collection] of [['chatId', 'chats'], ['swapId', 'swaps']] as const) {
      if (!identifier(data[field])) continue;
      const relatedRef = dependencies.db.collection(collection).doc(data[field]);
      const related = (await (options.tx ? options.tx.get(relatedRef) : relatedRef.get())).data();
      assertLegacySource(related);
      const parties = collection === 'chats' ? related?.participants : [related?.initiatorId, related?.receiverId];
      if (Array.isArray(parties)) for (const party of parties) if (identifier(party)) participants.add(party);
    }
    if (participants.size > 2) return updateRequired();
    for (const party of participants) {
      if (party !== uid) {
        const partyRef = dependencies.db.collection('eligibility_profiles').doc(party);
        if ((await (options.tx ? options.tx.get(partyRef) : partyRef.get())).exists) return updateRequired();
      }
      const userRef = dependencies.db.collection('users').doc(party);
      const nativeUser = (await (options.tx ? options.tx.get(userRef) : userRef.get())).data();
      if (!nativeUser || hasOwn(nativeUser, 'isActive') && nativeUser.isActive !== true) return updateRequired();
    }
  }
  return {uid, profile, profileRef: ref, profileExists: snapshot.exists, authTime: authTime as number};
}

/** Production old-delete preflight. The private profile write is the mutex:
 * V2 servicing and both-party acquisition read it in their transactions. A
 * conflicting V2 commit either precedes this scan (and is refused as modern)
 * or retries after the fence and is denied. The fence stays after a failed
 * cleanup so an empty-payload retry may resume without reopening operations. */
export async function beginLegacyDeletion(request: LegacyRequest, dependencies: LegacyDependencies): Promise<void> {
  assertLegacyAccountDeletionRequest(request.data);
  await dependencies.db.runTransaction(async tx => {
    const actor = await assertLegacyActor(request, dependencies, {tx, allowDeletionRetry: true});
    if (actor.profileExists && !ownDeletionFence(actor.profile, actor.uid)) return updateRequired();
    const userRef = dependencies.db.collection('users').doc(actor.uid), user = await tx.get(userRef);
    assertLegacySource(user.data());
    const walletRef = dependencies.db.collection('wallets').doc(actor.uid), walletSnapshot = await tx.get(walletRef);
    const wallet = walletSnapshot.data();
    assertLegacySource(wallet);
    if (wallet) for (const field of ['balance', 'pendingBalance', 'heldBalance', 'sellerDebt']) {
      const amount = wallet[field] ?? 0;
      if (typeof amount !== 'number' || !Number.isFinite(amount) || amount < 0) return updateRequired();
      if (amount > 0) throw new HttpsError('failed-precondition', 'Votre porte-monnaie doit être réglé avant la suppression.',
        {reason: 'legacy_obligations_open'});
    }
    const sources: Array<[string, string, ('==' | 'array-contains')?]> = [
      ['articles', 'sellerId'], ['transactions', 'buyerId'], ['transactions', 'sellerId'],
      ['swaps', 'initiatorId'], ['swaps', 'receiverId'], ['messages', 'senderId'], ['messages', 'receiverId'],
      ['reports', 'reporterId'], ['reports', 'targetOwnerId'], ['reports', 'targetId'],
      ['disputes', 'buyerId'], ['disputes', 'sellerId'], ['withdrawal_requests', 'userId'],
      ['swapPartyItems', 'sellerId'], ['avis', 'reviewerId'], ['avis', 'vendeurId'],
      ['notifications', 'userId'], ['chats', 'participants', 'array-contains'], ['drafts', 'userId'],
    ];
    const ownedArticles: string[] = [], partyIds = new Set<string>();
    for (const [collection, field, operator = '=='] of sources) {
      const page = await tx.get(dependencies.db.collection(collection).where(field, operator, actor.uid).limit(1001));
      if (page.size > 1000) return updateRequired();
      for (const source of page.docs) {
        const data = source.data();
        assertLegacySource(data);
        if (collection === 'articles') ownedArticles.push(source.id);
        if (collection === 'swapPartyItems' && typeof data.partyId === 'string' && data.partyId && !data.partyId.includes('/')) partyIds.add(data.partyId);
        if (collection === 'withdrawal_requests' && data.status === 'processing' ||
            collection === 'disputes' && data.status === 'open' && data.type !== 'meetup_no_show') {
          throw new HttpsError('failed-precondition', 'Une opération en cours doit être finalisée avant la suppression.',
            {reason: 'legacy_obligations_open'});
        }
        if (collection === 'transactions' && !(data.status === 'disputed' && data.deliveryType === 'meetup') &&
            !['completed', 'cancelled', 'refunded', 'meetup_completed'].includes(data.status) ||
            collection === 'swaps' && (!['declined', 'cancelled', 'completed'].includes(data.status) ||
              !!data.topUpPaidAt && !data.topUpReleasedAt && !data.topUpRefundedAt)) {
          throw new HttpsError('failed-precondition', 'Une opération en cours doit être finalisée avant la suppression.',
            {reason: 'legacy_obligations_open'});
        }
      }
    }
    for (const collection of ['favorites', 'seller_balances']) assertLegacySource((await tx.get(dependencies.db.collection(collection).doc(actor.uid))).data());
    for (const articleId of ownedArticles) for (const collection of ['search_index', 'embeddings']) {
      assertLegacySource((await tx.get(dependencies.db.collection(collection).doc(articleId))).data());
    }
    for (const partyId of partyIds) assertLegacySource((await tx.get(dependencies.db.collection('swapParties').doc(partyId))).data());
    const subcollections = ['savedSearches', 'searchHistory', 'consents'].map(name => userRef.collection(name));
    if (walletSnapshot.exists) subcollections.push(walletRef.collection('ledger'));
    for (const collection of subcollections) {
      const page = await tx.get(collection.limit(1001));
      if (page.size > 1000) return updateRequired();
      for (const source of page.docs) assertLegacySource(source.data());
    }
    if (!actor.profileExists) tx.create(actor.profileRef, {legacyDeletionFence: {
      protocol: 'phase1_legacy_deletion_fence_v1', ownerId: actor.uid, startedAt: Timestamp.now(), authTime: actor.authTime,
    }});
    if (user.exists) tx.update(userRef, {isActive: false});
  });
}
