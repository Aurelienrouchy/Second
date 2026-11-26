import { useState } from 'react';
import { Alert, StyleSheet, Text, View } from 'react-native';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Button, Checkbox } from '@/components/ui';
import { useAuthenticatedUid } from '@/hooks/useAuth';
import { useShippingPurchaseContext } from '@/hooks/useShippingPurchaseContext';
import { getAuthSessionGeneration } from '@/store/authStore';
import { ShippingReceiptDeclarationService } from '@/services/shippingReceiptDeclarationService';
import { SHIPPING_RECEIPT_DECLARATION_STATEMENT } from '@/types/shippingReceiptDeclaration';
import type { ShippingReceiptDeclarationObservation } from '@/types/shippingReceiptDeclaration';
import { colors, radius, spacing, typography } from '@/constants/theme';

type Action = 'declare' | 'observe' | 'resume' | 'neutralize' | 'acknowledge';
export function BuyerReceiptDeclaration({transactionId, onHumanRecourse, compact = false}: {transactionId: string; onHumanRecourse: () => void; compact?: boolean}) {
  const uid = useAuthenticatedUid(), queryClient = useQueryClient();
  const context = useShippingPurchaseContext(`buyer-receipt:${transactionId}`, uid);
  const queryKey = ['buyer-shipping-receipt', uid, getAuthSessionGeneration(), transactionId, context.focusRevision];
  const [busy, setBusy] = useState({frame: context.frame, focus: context.focusRevision, value: false});
  const working = busy.frame === context.frame && busy.focus === context.focusRevision && busy.value;
  const [confirmation, setConfirmation] = useState({frame: context.frame, focus: context.focusRevision, source: '', accepted: false});
  const [notice, setNotice] = useState({frame: context.frame, focus: context.focusRevision, text: ''});
  const query = useQuery({queryKey, enabled: !!uid && context.focused, staleTime: 0, gcTime: 0, retry: false,
    queryFn: () => {const operation = context.capture(); return ShippingReceiptDeclarationService.read(operation.session.uid, transactionId, () => context.assertCurrent(operation));}});
  const ready = context.focused && query.isSuccess && !query.isFetching && !query.error;
  const data = ready ? query.data : null, current = data?.current, receipt = data?.receipt, intent = data?.intent;
  const role = current?.role ?? receipt?.role;
  const declaration = current ? current.declaration : receipt?.declaration;
  const sourceKey = current ? JSON.stringify([current.ownerId, transactionId, current.sourceRevision, current.sourceHash]) : '';
  const accepted = confirmation.frame === context.frame && confirmation.focus === context.focusRevision && confirmation.source === sourceKey && confirmation.accepted;
  const canDeclare = ready && role === 'buyer' && !!current && current.sourceObservedCurrently && current.qualification === 'native_paid_contract' &&
    current.sourceRevision !== null && current.sourceHash !== null && !current.declaration && !intent;
  const perform = async (action: Action) => {
    let operation;
    try {operation = context.start();} catch {return;}
    if (!operation) return;
    setBusy({frame: context.frame, focus: context.focusRevision, value: true});
    if (action !== 'observe') setConfirmation({frame: context.frame, focus: context.focusRevision, source: sourceKey, accepted: false});
    const assertCurrent = () => context.assertCurrent(operation);
    try {
      let result: ShippingReceiptDeclarationObservation;
      if (action === 'declare') {
        if (!canDeclare || !current) throw new Error('La source doit être relue avant une nouvelle déclaration.');
        result = await ShippingReceiptDeclarationService.declare(current, accepted, assertCurrent);
      } else if (action === 'resume') result = await ShippingReceiptDeclarationService.resume(operation.session.uid, transactionId, assertCurrent);
      else if (action === 'neutralize') result = await ShippingReceiptDeclarationService.neutralize(operation.session.uid, transactionId, assertCurrent);
      else if (action === 'acknowledge') result = await ShippingReceiptDeclarationService.acknowledge(operation.session.uid, transactionId, assertCurrent);
      else result = await ShippingReceiptDeclarationService.read(operation.session.uid, transactionId, assertCurrent);
      assertCurrent(); queryClient.setQueryData(queryKey, result);
      setNotice({frame: context.frame, focus: context.focusRevision, text: action === 'acknowledge' ? 'Le suivi de cet envoi est terminé.' : ''});
    } catch {
      if (context.isCurrent(operation)) {
        setNotice({frame: context.frame, focus: context.focusRevision, text: 'Impossible de confirmer l’envoi pour le moment. Actualisez cette page pour connaître son résultat.'});
        await query.refetch();
      }
    } finally {if (context.isCurrent(operation)) setBusy({frame: context.frame, focus: context.focusRevision, value: false}); context.finish(operation);}
  };
  const neutralize = () => {
    let operation;
    try {operation = context.capture();} catch {return;}
    Alert.alert('Annuler cet envoi ?', 'Si votre confirmation de réception a déjà été enregistrée, elle sera conservée.', [
      {text: 'Retour', style: 'cancel'}, {text: 'Annuler l’envoi', onPress: () => {if (context.isCurrent(operation)) void perform('neutralize');}},
    ]);
  };
  const humanRecourse = () => {try {context.capture(); onHumanRecourse();} catch { /* Changed owner/focus. */ }};
  return <View style={styles.card}>
    <Text style={styles.title}>Réception du colis</Text>
    {notice.frame === context.frame && notice.focus === context.focusRevision && notice.text ? <Text accessibilityRole="alert" style={styles.body}>{notice.text}</Text> : null}
    {!ready ? <Text style={styles.body}>{query.isError ? 'Impossible de charger la confirmation de réception. Réessayez.' : 'Chargement de la réception…'}</Text> : null}
    {data?.currentUnavailable ? <Text style={styles.body}>L’état actuel de la commande est indisponible. La confirmation précédente reste consultable.</Text> : null}
    {declaration ? <View style={styles.section}>
      <Text style={styles.body}>L’acheteur a indiqué avoir reçu le colis.</Text>
      {!compact ? <Text selectable style={styles.caption}>Référence : {declaration.requestId}</Text> : null}
      <Text style={styles.caption}>Confirmation enregistrée le {new Date(declaration.recordedAt).toLocaleString('fr-CA')}.</Text>
    </View> : ready && current && !compact ? <Text style={styles.caption}>L’acheteur n’a pas encore confirmé la réception ici.</Text> : null}
    {current?.qualification === 'needs_review' ? <Text style={styles.caption}>Contactez notre équipe pour confirmer la réception de cette commande.</Text> : null}
    {canDeclare ? <View style={styles.section}>
      <Checkbox checked={accepted} disabled={working} accessibilityLabel={SHIPPING_RECEIPT_DECLARATION_STATEMENT}
        onToggle={() => {try {context.capture(); setConfirmation({frame: context.frame, focus: context.focusRevision, source: sourceKey, accepted: !accepted});} catch { /* Stale native source. */ }}}>
        <Text style={styles.body}>{SHIPPING_RECEIPT_DECLARATION_STATEMENT}</Text>
      </Checkbox>
      <Button disabled={working || !accepted} onPress={() => {void perform('declare');}}>Confirmer la réception</Button>
      {!compact ? <Text style={styles.caption}>Vos délais de protection et vos recours restent inchangés.</Text> : null}
    </View> : null}
    {intent ? <View style={styles.section}>
      <Text style={styles.title}>Suivi de votre confirmation</Text>
      {!compact ? <><Text selectable style={styles.caption}>{intent.requestId}</Text><Text style={styles.body}>{intent.statement}</Text></> : null}
      {receipt?.command ? <Text style={styles.body}>{receipt.command.state === 'committed' ? 'Votre confirmation a été enregistrée.'
        : receipt.command.state === 'neutralized' ? 'Cet envoi a été annulé.'
          : receipt.command.reason === 'already_declared' ? 'La réception avait déjà été confirmée.'
            : receipt.command.reason === 'source_changed' ? 'La commande a changé : cette confirmation n’a pas été enregistrée.' : 'Cette confirmation n’a pas pu être enregistrée.'}</Text>
        : <Text style={styles.body}>L’envoi reste à confirmer. Actualisez son suivi avant de continuer.</Text>}
      {role === 'buyer' && !receipt?.command ? <>
        <Button disabled={working} onPress={() => {void perform('resume');}}>Reprendre l’envoi</Button>
        <Button variant="secondary" disabled={working} onPress={neutralize}>Annuler cet envoi</Button>
      </> : null}
      {role === 'buyer' && receipt?.command ? <Button variant="secondary" disabled={working} onPress={() => {void perform('acknowledge');}}>Terminer ce suivi</Button> : null}
    </View> : null}
    {!compact || !!intent || query.isError || data?.currentUnavailable ? <Button variant="secondary" disabled={working || !uid || !context.focused} onPress={() => {void perform('observe');}}>Actualiser</Button> : null}
    <Button variant="ghost" disabled={!uid || !context.focused} onPress={humanRecourse}>Contacter l’équipe</Button>
  </View>;
}
const styles = StyleSheet.create({card: {padding: spacing.md, gap: spacing.sm, borderWidth: StyleSheet.hairlineWidth, borderColor: colors.border, borderRadius: radius.md},
  section: {gap: spacing.sm}, title: {...typography.body, color: colors.foreground}, body: {...typography.bodySmall, color: colors.foreground}, caption: {...typography.caption, color: colors.muted}});
