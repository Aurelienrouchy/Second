import { useRouter, type Href } from 'expo-router';
import { Alert } from 'react-native';
import { useRef } from 'react';
import { currentPublicationAdmissionPresentation, tradeAdmissionPresentation, type PublicationAdmissionContext } from '@/utils/tradeAdmissionPresentation';
import { EligibilityService } from '@/services/eligibilityService';
import { acknowledgeMeetupProposal, sendMeetupProposal } from '@/services/chat/offers';
import { captureTradeSession, assertTradeSessionCurrent, staleTradeOperation } from '@/services/tradeOperation';

export interface TradeAdmissionErrorOptions {
  isCurrent: () => boolean;
  retry?: () => void;
  beforeCriteria?: () => void;
  publication?: PublicationAdmissionContext;
}

/** Every CTA checks its original context; retry asks the current user to act again. */
export function useTradeAdmissionError() {
  const router = useRouter();
  const publicationReadRevision = useRef(0);
  return function showError(error: unknown, options: TradeAdmissionErrorOptions): boolean {
    const readRevision = ++publicationReadRevision.current;
    if (error && typeof error === 'object' && 'tradeRecovery' in error && error.tradeRecovery === true && (options.retry || 'proposalRecovery' in error)) {
      if (!options.isCurrent()) return true;
      const proposal = 'proposalRecovery' in error ? error.proposalRecovery as { uid: string; chatId: string; requestId: string; payload: Record<string, unknown> } : null;
      Alert.alert('Connexion interrompue', 'Le résultat ne peut pas encore être confirmé. Votre saisie est conservée.', [
        { text: 'Fermer', style: 'cancel' },
        { text: 'Actualiser', onPress: async () => {
          if (!options.isCurrent()) return;
          if (!proposal) { options.retry?.(); return; }
          const session = captureTradeSession(proposal.uid);
          const assertCurrent = () => { assertTradeSessionCurrent(session); if (!options.isCurrent()) throw staleTradeOperation(); };
          try {
            const messageId = await sendMeetupProposal(proposal.payload, proposal.uid, assertCurrent, { deferAdoption: true, recoveryOnly: true, expectedRequestId: proposal.requestId });
            assertCurrent();
            acknowledgeMeetupProposal(messageId, assertCurrent);
            options.beforeCriteria?.();
            router.push(`/chat/${proposal.chatId}`);
          } catch (recoveryError) {
            if (!options.isCurrent()) return;
            if (!showError(recoveryError, options)) Alert.alert('Connexion indisponible', 'Impossible de confirmer le résultat pour le moment. Réessayez dans un instant.');
          }
        } },
      ]);
      return true;
    }
    const presentation = tradeAdmissionPresentation(error, !!options.publication);
    if (!presentation) return false;
    if (!options.isCurrent()) return true;
    if (presentation.kind === 'own_eligibility' && options.publication) {
      const publication = options.publication;
      const isCurrent = () => publicationReadRevision.current === readRevision && options.isCurrent();
      const assertCurrent = () => {if (!isCurrent()) throw staleTradeOperation();};
      const readCurrentEligibility = async () => {
        try {
          assertCurrent();
          const session = captureTradeSession(publication.uid);
          const owner = await EligibilityService.getMine(publication.uid);
          assertTradeSessionCurrent(session); assertCurrent();
          const content = currentPublicationAdmissionPresentation(owner?.publication);
          if (!content) throw new Error('Current publication eligibility unavailable');
          Alert.alert(content.title, content.message, [
            {text: 'Fermer', style: 'cancel'},
            ...(content.route || options.retry ? [{text: content.actionLabel, onPress: () => {
              if (!isCurrent()) return;
              if (content.route) {options.beforeCriteria?.(); router.push(content.route);}
              else options.retry?.();
            }}] : []),
          ]);
        } catch {
          if (!isCurrent()) return;
          Alert.alert('Connexion indisponible', 'Impossible de vérifier votre compte pour le moment. Votre saisie est conservée.', [
            {text: 'Fermer', style: 'cancel'},
            {text: 'Réessayer', onPress: () => {if (isCurrent()) void readCurrentEligibility();}},
          ]);
        }
      };
      void readCurrentEligibility();
      return true;
    }
    const text = presentation.action === 'decision' ? 'Explications et aide' : presentation.action === 'criteria' ? 'Mes critères' : presentation.action === 'support' ? 'Contacter l’assistance' : 'Réessayer';
    Alert.alert(presentation.title, presentation.message, [
      { text: 'Fermer', style: 'cancel' },
      { text, onPress: () => {
        if (!options.isCurrent()) return;
        if (presentation.action === 'decision') {
          options.beforeCriteria?.();
          const decisionId = presentation.decisionId;
          router.push((decisionId && /^admission_[a-f0-9]{64}$/.test(decisionId)
            ? `/settings/decisions?decisionId=${encodeURIComponent(decisionId)}` : '/settings/decisions') as Href);
        }
        else if (presentation.action === 'criteria') { options.beforeCriteria?.(); router.push('/settings/eligibility' as Href); }
        else if (presentation.action === 'support') router.push('/settings/help');
        else options.retry?.();
      } },
    ]);
    return true;
  };
}
