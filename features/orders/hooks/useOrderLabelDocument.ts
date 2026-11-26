import {useState} from 'react';
import {Alert, Linking} from 'react-native';
import * as Haptics from 'expo-haptics';
import {useAuthenticatedUid} from '@/hooks/useAuth';
import {useShippingPurchaseContext} from '@/hooks/useShippingPurchaseContext';
import {LabelDocumentService} from '@/services/labelDocumentService';
import {track} from '@/lib/analytics';
import type {Transaction} from '@/types';
import type {LabelDocumentDirection} from '@/types/labelDocument';

/** The current provider document and its exact native source are rechecked
 * before opening. Merely consulting a stored URL never authorizes shipping. */
export function useOrderLabelDocument(transaction: Transaction, returnOrder?: Transaction | null, assertSelection?: () => void) {
  const uid = useAuthenticatedUid();
  const context = useShippingPurchaseContext(JSON.stringify(['label-document', transaction.id, transaction.buyerId, transaction.sellerId,
    transaction.shipEngineLabelId ?? null, transaction.returnLabelId ?? null, returnOrder?.buyerId, returnOrder?.sellerId,
    returnOrder?.returnLabelId ?? null]), uid);
  const [state, setState] = useState<{frame: symbol; focusRevision: number; direction: LabelDocumentDirection; loading: boolean; message: string} | null>(null);
  const current = state?.frame === context.frame && state.focusRevision === context.focusRevision ? state : null;
  const open = async (direction: LabelDocumentDirection, expectedLabelId: string | null) => {
    if (!uid || !context.focused || current?.loading ||
        (direction === 'forward' ? uid !== transaction.sellerId : uid !== transaction.buyerId)) return;
    let operation; try {operation = context.start();} catch {return;} if (!operation) return;
    const assertCurrent = () => {context.assertCurrent(operation); assertSelection?.();};
    const show = (message: string, loading = false) => setState({frame: operation.frame, focusRevision: operation.focusEpoch, direction, loading, message});
    show('Ouverture de l’étiquette…', true);
    try {
      const document = await LabelDocumentService.observe(operation.session.uid, transaction.id, direction, expectedLabelId, assertCurrent);
      assertCurrent();
      if (document.observation !== 'document_available' || !document.documentUrl) {
        show(document.observation === 'provider_voided' ? 'Cette étiquette a été annulée. Contactez notre équipe.'
          : document.observation === 'needs_review' ? 'Cette étiquette doit être vérifiée. Contactez notre équipe.'
            : 'Impossible d’ouvrir l’étiquette pour le moment. Réessayez.'); return;
      }
      if (transaction.carrierCode === 'seconde_dev' || direction === 'return' && transaction.returnCarrierCode === 'seconde_dev') {
        const accepted = await new Promise<boolean>(resolve => Alert.alert('Étiquette de test',
          'Ce document n’est pas expédiable. Aucun colis réel ne peut être déposé avec cette étiquette.', [
            {text: 'Annuler', style: 'cancel', onPress: () => resolve(false)},
            {text: 'Ouvrir le document', onPress: () => resolve(true)},
          ], {cancelable: true, onDismiss: () => resolve(false)}));
        assertCurrent();
        if (!accepted) {show(''); return;}
      }
      await LabelDocumentService.confirmSource(operation.session.uid, document, assertCurrent);
      assertCurrent();
      void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
      await Linking.openURL(document.documentUrl);
      assertCurrent(); show('');
      track(direction === 'forward' ? 'shipping_label_downloaded' : 'return_label_opened', {transaction_id: transaction.id});
    } catch {
      try {assertCurrent(); show('Impossible d’ouvrir l’étiquette. Actualisez la commande puis réessayez.');}
      catch {setState(previous => previous?.frame === operation.frame && previous.focusRevision === operation.focusEpoch ? null : previous);}
    } finally {
      // Cleanup may clear only this operation's loading state, never a newer
      // owner/selection's message after navigation or a parent fence change.
      setState(previous => previous?.frame === operation.frame && previous.focusRevision === operation.focusEpoch && previous.loading
        ? {...previous, loading: false} : previous);
      context.finish(operation);
    }
  };
  return {context, current, loading: current?.loading === true, message: context.focused ? current?.message ?? null : null, open};
}
