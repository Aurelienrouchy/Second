import { EligibilityService } from '@/services/eligibilityService';
import { assertTradeSessionCurrent, captureTradeSession } from '@/services/tradeOperation';
import { useAuthStore } from '@/store/authStore';
import type { EligibilityDecision, EligibilityScope } from '@/types/eligibility';
import { readMeetupProposalRecovery } from '@/services/chat/offers';
import { isPublicationEligibilityDecision } from '@/utils/tradeAdmissionPresentation';

/** A stored exact attempt is checked by the server's receipt-before-admission path. */
export async function assertNewProposalAdmission(uid: string, scope: EligibilityScope, input: Record<string, unknown>, assertContext: () => void): Promise<void> {
  if (typeof input.chatId !== 'string' || !input.chatId) throw eligibilityReadUnavailable();
  const pending = await readMeetupProposalRecovery(uid, input.chatId, assertContext, input);
  assertContext();
  if (!pending) await assertNewSaleAdmission(uid, scope, assertContext);
  assertContext();
}

export function eligibilityReadUnavailable(): Error {
  return Object.assign(new Error('Impossible de vérifier vos critères pour le moment. Votre saisie est conservée.'), {
    code: 'client/eligibility-unavailable',
  });
}

async function assertCurrentFoundations(uid: string, scope: EligibilityScope, assertContext: () => void,
  assertDecision: (decision: EligibilityDecision) => void, publication = false): Promise<void> {
  const session = captureTradeSession(uid);
  const assertCurrent = () => { assertTradeSessionCurrent(session); assertContext(); };
  const assertIdentity = () => {
    const state = useAuthStore.getState();
    if (state.identityError || state.isLoading || state.identityUser?.id !== uid) throw eligibilityReadUnavailable();
    if (state.identityUser.isActive === false) throw Object.assign(new Error('Compte indisponible'), { code: 'permission-denied', details: { reason: 'account_unavailable', scope } });
  };
  assertCurrent();
  assertIdentity();
  let owner;
  try { owner = await EligibilityService.getMine(uid); }
  catch (error) {
    assertCurrent();
    const code = error && typeof error === 'object' && 'code' in error ? String(error.code).replace('functions/', '') : '';
    if (code === 'permission-denied' || code === 'client/stale-operation') throw error;
    throw eligibilityReadUnavailable();
  }
  assertCurrent();
  assertIdentity();
  const decision = publication ? owner?.publication : owner?.decisions?.[scope];
  if (!decision || decision.scope !== scope || decision.evaluationStage !== 'foundations' || typeof decision.allowed !== 'boolean' || !Array.isArray(decision.messages) || !Array.isArray(decision.reasons) || typeof decision.policyVersion !== 'string') throw eligibilityReadUnavailable();
  if (publication && !isPublicationEligibilityDecision(decision)) throw eligibilityReadUnavailable();
  assertDecision(decision);
  assertCurrent();
}

function eligibilityRequired(decision: EligibilityDecision, publication = false): Error {
  return Object.assign(new Error(decision.messages.join('\n')), { code: 'permission-denied', details: {
    reason: 'eligibility_required', scope: decision.scope, reasons: decision.reasons, messages: decision.messages,
    policyVersion: decision.policyVersion, actions: ['getMyEligibility', 'requestEligibilityReview'],
    ...(publication ? {admission: 'publication'} : {}),
  } });
}

/** Fresh foundations only; the operation's callable remains the final authority. */
export async function assertNewSaleAdmission(uid: string, scope: EligibilityScope, assertContext: () => void): Promise<void> {
  return assertCurrentFoundations(uid, scope, assertContext, decision => {
    if (!decision.allowed || decision.status !== 'allowed') throw eligibilityRequired(decision);
  });
}

/** The server's listing decision grants no commercial agreement or declaration. */
export async function assertSalePreparationAdmission(uid: string, assertContext: () => void): Promise<void> {
  return assertCurrentFoundations(uid, 'sell', assertContext, decision => {
    if (!decision.allowed || decision.status !== 'allowed') throw eligibilityRequired(decision, true);
  }, true);
}
