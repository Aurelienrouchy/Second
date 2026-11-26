import { COPY_SELL_GATE } from '@/constants/authMessages';
import { getCallableErrorCode } from '@/utils/callableError';
import type { EligibilityDecision } from '@/types/eligibility';

export interface PublicationAdmissionContext { uid: string; requestId?: string }

/** An older commercial decision cannot stand in for the listing-only server contract. */
export function isPublicationEligibilityDecision(value: unknown): value is EligibilityDecision {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const decision = value as Partial<EligibilityDecision>;
  return decision.scope === 'sell' && decision.evaluationStage === 'foundations' && decision.policyVersion === '2026-10-26.v1' &&
    typeof decision.allowed === 'boolean' && ['allowed', 'incomplete', 'blocked', 'review_required'].includes(String(decision.status)) &&
    Array.isArray(decision.reasons) && decision.reasons.every(reason => typeof reason === 'string' && !!reason &&
      !['activity_missing', 'activity_version_required', 'quebec_residence_declaration_required'].includes(reason)) &&
    Array.isArray(decision.messages) && decision.messages.every(message => typeof message === 'string' && !!message) &&
    decision.reasons.length === decision.messages.length && (decision.allowed
      ? decision.status === 'allowed' && decision.reasons.length === 0
      : decision.status !== 'allowed' && decision.reasons.length > 0);
}

export function publicationAdmissionPresentation(decision: Pick<EligibilityDecision, 'reasons' | 'messages'>): {
  title: string; message: string; actionLabel: string; route: '/settings/account-security' | '/settings/help';
} {
  const securityOnly = decision.reasons.length > 0 && decision.reasons.every(reason => reason === 'account_security_contained');
  const ageMissing = decision.reasons.some(reason => ['age_missing', 'age_invalid'].includes(reason));
  return {
    title: 'Annonce indisponible',
    message: `${ageMissing ? 'Votre date de naissance doit être vérifiée pour publier une annonce. Contactez l’assistance.' : decision.messages.join('\n')}\n\nVotre saisie est conservée.`,
    actionLabel: securityOnly ? 'Sécuriser mon compte' : 'Contacter l’assistance',
    route: securityOnly ? '/settings/account-security' : '/settings/help',
  };
}

/** Current foundations can guide a correction; they do not explain an older refusal or grant publication. */
export function currentPublicationAdmissionPresentation(value: unknown): {
  title: string; message: string; actionLabel: string; route: ReturnType<typeof publicationAdmissionPresentation>['route'] | null;
} | null {
  if (!isPublicationEligibilityDecision(value)) return null;
  const decision = value;
  if (decision.allowed) return {
    title: 'Prêt à réessayer', message: 'Vous pouvez réessayer votre action sur cette annonce.', actionLabel: 'Réessayer', route: null,
  };
  const content = publicationAdmissionPresentation({reasons: decision.reasons, messages: decision.messages});
  return content;
}

export interface TradeAdmissionPresentation {
  kind: 'own_eligibility' | 'own_account' | 'counterparty' | 'read_failed';
  title: string;
  message: string;
  action: 'criteria' | 'support' | 'retry' | 'decision';
  decisionId?: string;
}

/** Ordinary permission errors never become eligibility refusals by their wording. */
export function tradeAdmissionPresentation(error: unknown, publication = false): TradeAdmissionPresentation | null {
  const code: string | null = getCallableErrorCode(error);
  if (code === 'client/eligibility-unavailable') return {
    kind: 'read_failed', title: 'Vérification impossible',
    message: 'Impossible de vérifier vos critères pour le moment. Votre saisie est conservée.', action: 'retry',
  };
  const details = error && typeof error === 'object' && 'details' in error ? error.details : null;
  if (code === 'permission-denied' && details && typeof details === 'object' && 'reason' in details && details.reason === 'admission_refused' &&
    'automated' in details && details.automated === true && 'action' in details && details.action === 'reviewAutomatedDecision' &&
    'decisionId' in details && typeof details.decisionId === 'string' && /^admission_[a-f0-9]{64}$/.test(details.decisionId)) return {
      kind: 'own_eligibility', title: 'Vérification du compte', action: 'decision', decisionId: details.decisionId,
      message: 'Cette action nécessite une vérification. Consultez les motifs et demandez un examen par notre équipe si nécessaire. Vos engagements existants restent accessibles.',
    };
  if (!details || typeof details !== 'object' || !('scope' in details) || !['buy', 'sell', 'new_paid_shipping'].includes(String(details.scope)) || !('reason' in details)) return null;
  if (code === 'permission-denied' && details.reason === 'eligibility_required') {
    const messages = 'messages' in details && Array.isArray(details.messages) ? details.messages.filter((message): message is string => typeof message === 'string') : [];
    if (publication || 'admission' in details && details.admission === 'publication') {
      const reasons = 'reasons' in details && Array.isArray(details.reasons) ? details.reasons.filter((reason): reason is string => typeof reason === 'string') : [];
      const content = publicationAdmissionPresentation({reasons, messages});
      return {kind: 'own_eligibility', title: content.title, message: content.message, action: 'support'};
    }
    return { kind: 'own_eligibility', title: 'Vos critères d’achat et de vente', message: messages.length ? messages.join('\n') : COPY_SELL_GATE, action: 'criteria' };
  }
  if (code === 'permission-denied' && details.reason === 'account_unavailable') return {
    kind: 'own_account', title: 'Compte indisponible', message: 'Cette nouvelle opération n’est pas disponible pour votre compte. Vous pouvez contacter l’assistance.', action: 'support',
  };
  if (code === 'failed-precondition' && details.reason === 'counterparty_unavailable') return {
    kind: 'counterparty', title: 'Opération indisponible',
    message: 'message' in details && typeof details.message === 'string' ? details.message : 'Cette nouvelle opération n’est pas disponible avec cet utilisateur.', action: 'support',
  };
  return null;
}
