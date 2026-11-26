import { useTradeAdmissionError } from '@/hooks/useTradeAdmissionError';
import { useRouter } from 'expo-router';
import { Alert } from 'react-native';
import {useRef} from 'react';
import { acknowledgeMeetupProposal, readMeetupProposalRecovery, sendMeetupProposal } from '@/services/chat/offers';

/** Makes a previous exact attempt reachable from an entry even when new criteria now refuse. */
export function useMeetupProposalRecovery() {
  const router = useRouter();
  const showAdmissionError = useTradeAdmissionError();
  const refreshing = useRef(new Map<string, Promise<void>>());
  return async (uid: string, chatId: string, assertContext: () => void): Promise<boolean> => {
    const previous = await readMeetupProposalRecovery(uid, chatId, assertContext);
    assertContext();
    if (!previous) return false;
    const key = JSON.stringify([uid, chatId, previous.requestId]);
    const resume = async () => {
      assertContext();
      const existing = refreshing.current.get(key);
      if (existing) {await existing; return;}
      const pending = (async () => {
        try {
          assertContext();
          const messageId = await sendMeetupProposal(previous.payload, uid, assertContext, { deferAdoption: true, recoveryOnly: true, expectedRequestId: previous.requestId });
          assertContext();
          acknowledgeMeetupProposal(messageId, assertContext);
          router.push(`/chat/${chatId}`);
        } catch (error) {
          try { assertContext(); } catch { return; }
          const isCurrent = () => {try {assertContext(); return true;} catch {return false;}};
          if (!showAdmissionError(error, {isCurrent})) Alert.alert('Connexion indisponible', 'Impossible de confirmer votre offre pour le moment. Votre saisie est conservée.', [
            {text: 'Fermer', style: 'cancel'},
            {text: 'Actualiser', onPress: () => {if (isCurrent()) void resume();}},
          ]);
        }
      })();
      refreshing.current.set(key, pending);
      try {await pending;}
      finally {if (refreshing.current.get(key) === pending) refreshing.current.delete(key);}
    };
    await resume();
    return true;
  };
}
