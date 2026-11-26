/** Causal catalogue of current native preservation writers. This semaphore is
 * not a historical legal inventory, a release of a hold, or a disposal power. */
import {Timestamp} from 'firebase-admin/firestore';
import {db} from '../config/firebase';
import {supportHash, supportSourceHash, supportRevision} from './supportRequest';

const ref = () => db.collection('privacy_preservation_catalogues').doc('native_support_v1');
const stamp = (v: any): v is Timestamp => v instanceof Timestamp && v.toMillis() > 0 && v.toMillis() <= Date.now();
export async function readPrivacyPreservationCatalogue(tx: FirebaseFirestore.Transaction) {
  const snapshot = await tx.get(ref()), value = snapshot.data();
  const qualified = !snapshot.exists || value?.protocol === 'privacy_preservation_catalogue_v1' &&
    Number.isSafeInteger(value.version) && value.version > 0 && value.version < Number.MAX_SAFE_INTEGER &&
    stamp(value.recordedAt) && value.priorUnqualifiedSourceHash === null && value.legalUniverseVerified === false &&
    typeof value.latestMutationHash === 'string' && /^[a-f0-9]{64}$/.test(value.latestMutationHash);
  return {exists: snapshot.exists, qualified, version: qualified ? value?.version ?? 0 : null,
    revision: supportRevision(snapshot), sourceHash: supportSourceHash(value ?? null), legalUniverseVerified: false};
}
/** Read before ANY writes. A malformed semaphore never prevents intake: its
 * causal successor remains unknown for disposal until separately reconciled. */
export async function preparePrivacyPreservationCatalogueChange(tx: FirebaseFirestore.Transaction,
  mutation: {caseId: string; actorId: string; requestId: string; kind: string}) {
  const current = await readPrivacyPreservationCatalogue(tx);
  const next = {protocol: 'privacy_preservation_catalogue_v1',
    version: current.qualified && current.version !== null ? current.version + 1 : 1,
    recordedAt: Timestamp.now(), latestMutationHash: supportHash(mutation),
    priorUnqualifiedSourceHash: current.qualified ? null : current.sourceHash, legalUniverseVerified: false};
  return {commit() {tx.set(ref(), next);}};
}
export const privacyDispositionFenceRef = (ownerId: string) => db.collection('privacy_disposition_fences').doc(supportHash(ownerId));
