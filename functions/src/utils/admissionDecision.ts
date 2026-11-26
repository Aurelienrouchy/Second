/** FIRST3 active-entry refusals only. A recorded refusal grants no right and
 * never changes an existing agreement, money, stock or another member's data. */
import { createHash } from 'node:crypto';
import { Timestamp } from 'firebase-admin/firestore';
import { HttpsError } from 'firebase-functions/v2/https';
import { db } from '../config/firebase';
import { evaluateEligibility, evaluatePublicationEligibility, evaluateSwapLaunch, eligibilityVersion, ELIGIBILITY_REASON_MESSAGES, type EligibilityReason } from '../shared/eligibility';
import { hasUnavailableAccountStanding } from '../shared/accountStanding';
import { readEligibilityEvidence } from './eligibility';
import {isDeepStrictEqual} from 'node:util';
import {activeLocalAgreementScope} from './localAgreement';
import {assertFinancialRecoveryEffect} from './financialRecoveryInterlock';
import {assertPrivateAccountSession} from './privateAccountSession';

export const ADMISSION_REFUSAL_PROTOCOL = 'admission_refused_v1';
export type AdmissionOperation = 'acceptMeetupOffer' | 'proposeMultiSwap' | 'acceptSwap' | 'createArticle' | 'updateArticle' | 'relistArticle';
export type AdmissionScope = 'buy' | 'sell' | 'swap';
export interface RecordedAdmissionRefusal { admissionRefused: true; decisionId: string; ownerId: string; }
const digest = (value: unknown) => createHash('sha256').update(JSON.stringify(value, (_key, item) =>
  item && typeof item === 'object' && !Array.isArray(item)
    ? Object.fromEntries(Object.keys(item).sort().map(key => [key, item[key]])) : item)).digest('hex');
type Request=Parameters<typeof assertPrivateAccountSession>[0];
type NativeWrite={method:string;args:any[]};
const localOperations:Partial<Record<AdmissionOperation,string>>={acceptMeetupOffer:'callable/payments/meetup.acceptMeetupOffer',
  proposeMultiSwap:'callable/swaps.proposeMultiSwap',acceptSwap:'callable/swaps.acceptSwap'};
const nativeIdentity=Symbol.for('seconde.admission_refusal_native_attempt');
const copy=(v:any):any=>v instanceof Timestamp?new Timestamp(v.seconds,v.nanoseconds):Array.isArray(v)?v.map(copy):
  v&&typeof v==='object'&&Object.getPrototypeOf(v)===Object.prototype?Object.fromEntries(Object.entries(v).map(([k,x])=>[k,copy(x)])):v;
type RefusalPlan={ownerId:string;operation:AdmissionOperation;scope:AdmissionScope;request:Request;evidenceHash:string;
  quotaPath:string;decisionPath:string;quotaBefore:unknown;quotaValue:Record<string,unknown>;decisionValue:Record<string,any>;at:Timestamp};
const nativePlans=new WeakMap<object,RefusalPlan>();
const nativeRefusalInvalid=():never=>{throw new Error('Native admission refusal pair unqualified.');};

/** A refusal authorizes only its quota and immutable own decision. The opaque
 * attempt identity carries no native SDK methods or client capability. */
export async function qualifyAdmissionRefusalTransaction(identity:object,writes:readonly NativeWrite[],tx:FirebaseFirestore.Transaction):Promise<boolean>{
  const plan=nativePlans.get(identity);if(!plan)return false;
  const local=activeLocalAgreementScope();
  if(!local?.control||local.operation!==localOperations[plan.operation]||plan.request.auth?.uid!==plan.ownerId||
    plan.quotaPath!==`rate_limits/${plan.ownerId}_admissionRefusals`||writes.length!==2||
    plan.decisionValue.ownerId!==plan.ownerId||plan.decisionValue.operation!==plan.operation||plan.decisionValue.scope!==plan.scope)
    return nativeRefusalInvalid();
  await assertPrivateAccountSession(plan.request,tx);
  const evidence=await readEligibilityEvidence(tx,plan.ownerId),quota=(await tx.get(db.doc(plan.quotaPath))).data(),
    prior=await tx.get(db.doc(plan.decisionPath));
  if(eligibilityVersion(evidence)!==plan.evidenceHash||!isDeepStrictEqual(quota??null,plan.quotaBefore)||prior.exists||
    plan.at.toMillis()>Date.now()+60000)return nativeRefusalInvalid();
  const decision=plan.scope==='swap'?evaluateSwapLaunch(evidence,plan.at.toDate()):evaluateEligibility(evidence,plan.scope,plan.at.toDate()),
    reasons=[...new Set([...decision.reasons,...(hasUnavailableAccountStanding(evidence.user)?['account_unavailable']:[])])].sort();
  if(!reasons.length||!isDeepStrictEqual(reasons,plan.decisionValue.reasons)||decision.policyVersion!==plan.decisionValue.policyVersion||
    decision.civilDate!==plan.quotaValue.civilDate)return nativeRefusalInvalid();
  const expected=[{path:plan.quotaPath,method:'set',value:plan.quotaValue},{path:plan.decisionPath,method:'create',value:plan.decisionValue}];
  for(const row of expected){const write=writes.find(w=>w.args[0]?.path===row.path);
    if(!write||write.method!==row.method||write.args.length!==2||!isDeepStrictEqual(write.args[1],row.value))return nativeRefusalInvalid();}
  await assertFinancialRecoveryEffect('firestore_commit',{refs:[plan.decisionPath]});
  nativePlans.delete(identity);return true;
}

/** Only call AFTER the native context and caller's role/ownership have been
 * established, AFTER historical receipts, and BEFORE any business write.
 * Returning a sentinel commits the refusal; throwing here would roll it back. */
export async function recordOwnAdmissionRefusal(tx: FirebaseFirestore.Transaction, input: {
  ownerId: string; operation: AdmissionOperation; scope: AdmissionScope;
  sourceContext: Record<string, unknown>;
  request?: Request;
}): Promise<RecordedAdmissionRefusal | null> {
  const local=activeLocalAgreementScope();
  if(local){if(localOperations[input.operation]!==local.operation||input.request?.auth?.uid!==input.ownerId||
    (input.operation==='acceptMeetupOffer'?!['sell','buy'].includes(input.scope):input.scope!=='swap'))return nativeRefusalInvalid();
    await assertPrivateAccountSession(input.request,tx);}
  const evidence = await readEligibilityEvidence(tx, input.ownerId), now = Timestamp.now();
  const publication = ['createArticle', 'updateArticle', 'relistArticle'].includes(input.operation);
  const decision = publication ? evaluatePublicationEligibility(evidence, now.toDate())
    : input.scope === 'swap' ? evaluateSwapLaunch(evidence, now.toDate()) : evaluateEligibility(evidence, input.scope, now.toDate());
  const reasons = [...new Set([...decision.reasons, ...(hasUnavailableAccountStanding(evidence.user) ? ['account_unavailable'] : [])])].sort();
  if (reasons.length === 0) return null;
  const messages = reasons.map(reason => reason === 'account_unavailable' ? 'Votre compte ne peut pas créer une nouvelle opération.'
    : reason === 'quebec_residence_declaration_required' ? 'Les nouveaux Trocs demandent une déclaration de résidence au Québec.'
      : ELIGIBILITY_REASON_MESSAGES[reason as EligibilityReason]);
  if (messages.some(message => typeof message !== 'string')) throw new HttpsError('failed-precondition', 'La décision d’admissibilité nécessite un examen.');
  const criteria = { minimumAge: 18, ageSource: 'declared_profile', ageVerified: false,
    ageCondition: reasons.includes('age_missing') ? 'missing' : reasons.includes('age_invalid') ? 'invalid' : reasons.includes('underage') ? 'under18' : 'adult_declared',
    activityRequirement: publication || input.scope === 'buy' ? 'not_required' : 'personal',
    ...(publication ? { sellerRestriction: 'no_declared_professionals' } : {}),
    residenceRequirement: input.scope === 'swap' ? 'quebec_owner_declaration' : 'not_applied',
    residenceVerified: false, restrictionDetailsDisclosed: false };
  // This key deliberately excludes raw DOB, addresses, private signal actors,
  // notes and evaluation clock time. The civil day and own source fingerprint
  // distinguish a changed age/source without storing the raw birth date.
  const identity = { ownerId: input.ownerId, operation: input.operation, scope: input.scope,
    sourceContext: input.sourceContext, policyVersion: decision.policyVersion, reasons,
    eligibilitySourceHash: eligibilityVersion(evidence), civilDate: decision.civilDate, criteria };
  const decisionId = 'admission_' + digest(identity), ref = db.collection('automatic_decisions_log').doc(decisionId);
  const prior = await tx.get(ref);
  if (prior.exists) {
    const value = prior.data()!;
    if (value.protocol !== ADMISSION_REFUSAL_PROTOCOL || value.ownerId !== input.ownerId || value.identityHash !== digest(identity)) {
      throw new HttpsError('failed-precondition', 'La référence du refus nécessite un examen.');
    }
    return { admissionRefused: true, decisionId, ownerId: input.ownerId };
  }
  // One bounded counter in the EXISTING rate-limit collection. Exact replay is
  // checked first and incurs no write, including after the quota is exhausted.
  const quotaRef = db.collection('rate_limits').doc(`${input.ownerId}_admissionRefusals`), quota = (await tx.get(quotaRef)).data();
  const atMs = now.toMillis();
  if (quota && (quota.callerKey !== input.ownerId || !Number.isSafeInteger(quota.windowStartedAtMs) || quota.windowStartedAtMs < 0 ||
      quota.windowStartedAtMs > atMs || !Number.isSafeInteger(quota.count) || quota.count < 0 ||
      !Number.isSafeInteger(quota.dailyCount) || quota.dailyCount < 0 || typeof quota.civilDate !== 'string' ||
      !/^\d{4}-\d{2}-\d{2}$/.test(quota.civilDate) || decision.civilDate === null || quota.civilDate > decision.civilDate)) {
    throw new HttpsError('failed-precondition', 'La limite de nouvelles références nécessite un examen. Vos références existantes restent consultables.');
  }
  const sameMinute = Number.isSafeInteger(quota?.windowStartedAtMs) &&
    quota!.windowStartedAtMs <= atMs && quota!.windowStartedAtMs > atMs - 60_000;
  const count = sameMinute && Number.isSafeInteger(quota?.count) && quota!.count >= 0 ? quota!.count : 0;
  const sameDay = quota?.civilDate === decision.civilDate;
  const dailyCount = sameDay && Number.isSafeInteger(quota?.dailyCount) && quota!.dailyCount >= 0 ? quota!.dailyCount : 0;
  if (count >= 20 || dailyCount >= 100) throw new HttpsError('resource-exhausted', 'Limite de nouvelles références atteinte. Vos refus déjà enregistrés restent consultables.');
  const quotaValue={ callerKey: input.ownerId, count: count + 1, windowStartedAtMs: sameMinute ? quota!.windowStartedAtMs : atMs,
    civilDate: decision.civilDate, dailyCount: dailyCount + 1 };
  const decisionValue={ protocol: ADMISSION_REFUSAL_PROTOCOL, decisionType: 'admission_refused', transactionId: null,
    ownerId: input.ownerId, userId: input.ownerId, buyerId: null, sellerId: null,
    operation: input.operation, scope: input.scope, policyVersion: decision.policyVersion, reasons, messages, criteria,
    sourceContext: input.sourceContext, identityHash: digest(identity), automated: true,
    result: 'Nouvel engagement refusé automatiquement. Les engagements et recours existants restent distincts.', executedAt: now,
    financialEffect: 'none', admissionGranted: false };
  if(local){
    await assertFinancialRecoveryEffect('firestore_commit',{refs:[ref.path]});
    const identity=(tx as any)[nativeIdentity];if(!identity||typeof identity!=='object'||nativePlans.has(identity))return nativeRefusalInvalid();
    nativePlans.set(identity,{ownerId:input.ownerId,operation:input.operation,scope:input.scope,request:copy({auth:input.request!.auth,data:{expectedUid:input.ownerId}}),
      evidenceHash:eligibilityVersion(evidence),quotaPath:quotaRef.path,decisionPath:ref.path,quotaBefore:copy(quota??null),
      quotaValue:copy(quotaValue),decisionValue:copy(decisionValue),at:now});
  }
  tx.set(quotaRef,quotaValue);tx.create(ref,decisionValue);
  return { admissionRefused: true, decisionId, ownerId: input.ownerId };
}

/** Outside runTransaction ONLY: the committed native revision/hash must be
 * read, never predicted. A transient read failure retains the durable ID. */
export async function throwRecordedAdmissionRefusal(refusal: RecordedAdmissionRefusal, verifySession?: () => Promise<unknown>): Promise<never> {
  let view: { id: string; revision: string | null; sourceHash: string } | null = null;
  try {
    const snap = await db.collection('automatic_decisions_log').doc(refusal.decisionId).get();
    // Error-detail reading must not bootstrap the entire support graph when a
    // payment/Troc handler is imported. It is needed only after this commit.
    const { admissionDecisionView } = await import('./supportRequest');
    if (snap.data()?.ownerId === refusal.ownerId) view = admissionDecisionView(snap);
  } catch { /* Durable ID remains available for a read-only retry. */ }
  // New private entry points can requalify after the native read/import. This
  // is independent of commercial eligibility and never alters old receipts.
  if (verifySession) await verifySession();
  const exact = view?.revision && view.sourceHash ? { id: view.id, revision: view.revision, sourceHash: view.sourceHash } : null;
  throw new HttpsError('permission-denied', 'Ce nouvel engagement a été refusé automatiquement. Consultez les motifs et demandez un examen par notre équipe si nécessaire.', {
    reason: 'admission_refused', automated: true, decisionId: refusal.decisionId,
    decisionReference: exact, decisionReadState: exact ? 'read' : 'unavailable', action: 'reviewAutomatedDecision',
    admissionGranted: false, financialEffect: 'none',
  });
}
