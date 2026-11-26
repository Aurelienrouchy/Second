import { useRef, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { colors, fonts, radius, spacing } from '@/constants/theme';
import { APP_LOCALE } from '@/constants/locale';
import { inspectPaymentCaptureAnomaly, type AdminPaymentAnomaly, type AdminPaymentInspection, type CaptureEvidence,
  type CaptureOrderProof, type CaptureCheckoutProof, type CheckoutOrderProof, type CheckoutProviderProof } from '@/services/adminFinancialService';
import { useAuthenticatedUid } from '@/hooks/useAuth';
import { useLabelLifecycleContext } from '@/hooks/useLabelLifecycleContext';
import { useShippingPurchaseContext } from '@/hooks/useShippingPurchaseContext';
import { auth } from '@/config/firebaseConfig';
import { AdminOrphanCaptureRefundPanel } from './AdminOrphanCaptureRefundPanel';
import { Checkbox } from '@/components/ui/Checkbox';
import { getFinancialErrorMessage } from '@/utils/refundPresentation';
import { formatCents } from '@/utils/formatPrice';

const labels = {
  not_checked: 'Paiement pas encore vérifié.',
  verified: 'Le paiement observé a été vérifié. Son attribution et son traitement restent à examiner. Aucun remboursement n’a été effectué.',
  invalid: 'Les informations actuelles ne permettent pas de confirmer cet encaissement. Le dossier reste ouvert.',
  unavailable: 'Le paiement n’a pas pu être vérifié actuellement. Le dossier reste ouvert.',
};
function money(value: number | null | undefined, currency: string | null | undefined): string {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 0) return 'Montant à vérifier';
  return currency === 'cad' || currency === 'CAD' ? formatCents(value) : `${value} cents (${currency ?? 'devise à vérifier'})`;
}
function proofLines(title: string, proof: CaptureEvidence): string[] {
  return [title, `Paiement observé : ${proof.observedPaymentIntentId ?? proof.paymentIntentId ?? 'Identité à vérifier'}`,
    `Paiement d’origine de la commande : ${proof.originalPaymentIntentId ?? 'Liaison non établie'}`,
    `Référence de commande à vérifier : ${proof.candidateReference ?? 'Absente'}`,
    `Montant collecté signalé : ${money(proof.collectedAmountCents, proof.currency)}`,
    `Montant prévu : ${money(proof.requestedAmountCents, proof.currency)}`,
    ...(proof.status ? [`État prestataire observé : ${proof.status}`] : []),
    ...(proof.checkedAtMs != null ? [`Preuve prestataire relue : ${date(proof.checkedAtMs)}`] : [])];
}
const kinds: Record<string, string> = {
  authorization_unsettled: 'Autorisation encore à rapprocher', cancellation_unsettled: 'Annulation encore à rapprocher',
  processing_unsettled: 'Traitement encore à rapprocher', confirmation_outcome_unknown: 'Résultat de confirmation inconnu',
};
function date(value: number | null): string {
  return value !== null && Number.isFinite(new Date(value).getTime()) ? new Date(value).toLocaleString(APP_LOCALE) : 'Date indisponible';
}
function checkoutProviderLines(proof: CheckoutProviderProof): string[] {
  return [`Paiement prestataire : ${proof.paymentIntentId ?? 'Identité à vérifier'}`, `État prestataire : ${proof.status ?? 'Inconnu'}`,
    `Montant demandé : ${money(proof.requestedCents, proof.currency)}`, `Montant reçu par le prestataire : ${money(proof.receivedCents, proof.currency)}`,
    `Montant encore autorisé, non encaissé : ${money(proof.capturableCents, proof.currency)}`,
    `Confirmation : ${proof.confirmationMethod ?? 'Inconnue'} · Encaissement : ${proof.captureMethod ?? 'Inconnu'}`,
    `Commande prestataire : ${proof.transactionId ?? 'Absente'}`, `Acheteur : ${proof.buyerId ?? 'Absent'} · Vendeur : ${proof.sellerId ?? 'Absent'}`,
    `Intention : ${proof.checkoutIntentId ?? 'Absente'}`, `Preuve prestataire relue : ${date(proof.checkedAtMs)}`];
}
function checkoutOrderLines(proof: CheckoutOrderProof): string[] {
  return [`Commande : ${proof.transactionId ?? 'Absente'} · État : ${proof.status ?? 'Inconnu'}`, `Paiement de la commande : ${proof.paymentIntentId ?? 'Absent'}`,
    `Total de commande : ${money(proof.totalCents, 'CAD')} · Part du solde : ${money(proof.walletCents, 'CAD')}`,
    `Acheteur : ${proof.buyerId ?? 'Absent'} · Vendeur : ${proof.sellerId ?? 'Absent'}`,
    `Intention : ${proof.intentId ?? 'Absente'} · Version : ${proof.intentVersion ?? 'Inconnue'} · État : ${proof.intentState ?? 'Inconnu'}`,
    `Écriture du solde : ${proof.walletLedgerId ?? 'Absente'}`, `Autorisation enregistrée : ${date(proof.authorizedAtMs)}`,
    `Paiement enregistré : ${date(proof.paidAtMs)} · Encaissement enregistré : ${money(proof.capturedCardCents, 'CAD')}`,
    `Référence de débit carte : ${proof.stripeChargeId ?? 'Absente'}`];
}
function captureOrderLines(proof: CaptureOrderProof): string[] {
  return [`Commande native : ${proof.transactionId} · État : ${proof.status ?? 'Inconnu'}`, `Paiement natif : ${proof.paymentIntentId ?? 'Absent'}`,
    `Total : ${money(proof.totalCents, proof.currency)} · Part du solde : ${money(proof.walletCents, proof.currency)}`,
    `Part carte enregistrée : ${money(proof.capturedCardCents, proof.currency)} · Débit carte : ${proof.stripeChargeId ?? 'Absent'}`,
    `Paiement enregistré : ${date(proof.paidAtMs)}`, `Intention native : ${proof.intentId ?? 'Absente'} · Version : ${proof.intentVersion ?? 'Inconnue'}`,
    `Révision de commande : ${proof.orderRevision ?? 'Indisponible'} · Révision d’intention : ${proof.intentRevision ?? 'Indisponible'}`,
    `Empreinte des sources : ${proof.sourceHash}`];
}
function missingOrderCheckoutLines(proof: CaptureCheckoutProof): string[] {
  return [`Référence native de la commande absente : ${proof.transactionId} · Annonce : ${proof.articleId}`,
    `Acheteur : ${proof.buyerId} · Vendeur : ${proof.sellerId}`,
    `Paiement lié : ${proof.paymentIntentId} · Capture : ${proof.stripeChargeId ?? 'Indisponible'}`,
    `Total accepté : ${money(proof.totalCents, proof.currency)} · Solde : ${money(proof.walletCents, proof.currency)} · Carte : ${money(proof.cardCents, proof.currency)}`,
    `Intention : ${proof.intentId} · Version ${proof.intentVersion} · Devis : ${proof.quoteId} · Tarif : ${proof.rateId}`,
    `Acceptation enregistrée : ${date(proof.acceptedAtMs)} · Autorisation enregistrée : ${date(proof.authorizedAtMs)}`,
    `Révision d’intention : ${proof.intentRevision} · Révision du devis : ${proof.quoteRevision}`,
    `Empreinte des sources : ${proof.sourceHash}`];
}
export function AdminCaptureCard({anomaly, userId, onRefresh}: {anomaly: AdminPaymentAnomaly; userId: string; onRefresh: () => void}) {
  const uid = useAuthenticatedUid();
  const renderOwner = auth.currentUser;
  const context = useLabelLifecycleContext(`admin-payment:${JSON.stringify([userId, anomaly])}`, uid);
  const native = useShippingPurchaseContext(`admin-capture-original-refund:${anomaly.id}`, uid);
  const [refundSelection, setRefundSelection] = useState<{frame: symbol; focusRevision: number; owner: typeof auth.currentUser} | null>(null);
  const orphanOperation = anomaly.type === 'payment_capture_reconciliation' && /^capture_[a-f0-9]{64}$/.test(anomaly.id) ? anomaly.id : null;
  const refundOpen = !!orphanOperation && refundSelection?.frame === native.frame && refundSelection.focusRevision === native.focusRevision && refundSelection.owner === auth.currentUser;
  const operationScope = (operation: ReturnType<typeof context.capture>) => ({frame: operation.base.frame,
    focusRevision: JSON.stringify([operation.base.focusEpoch, operation.activityRevision])});
  const [busyScope, setBusyScope] = useState<{frame: symbol; focusRevision: string} | null>(null);
  const [outcome, setOutcome] = useState<{frame: symbol; focusRevision: string; result?: AdminPaymentInspection; error?: string} | null>(null);
  const [consentScope, setConsentScope] = useState<{frame: symbol; focusRevision: string; transactionId: string} | null>(null);
  const consentRef = useRef(consentScope);
  const busy = busyScope?.frame === context.frame && busyScope.focusRevision === context.focusRevision;
  const current = outcome?.frame === context.frame && outcome.focusRevision === context.focusRevision ? outcome : null;
  const result = current?.result;
  const checkout = anomaly.type === 'payment_checkout_reconciliation' ? anomaly : null;
  const checkoutResult = result?.type === 'payment_checkout_reconciliation' ? result : null;
  const captureResult = result?.type === 'payment_capture_reconciliation' ? result : null;
  const captureProof = captureResult ? captureResult.currentProviderProof : anomaly.type === 'payment_capture_reconciliation' ? anomaly.currentProviderProof : null;
  const missingOrderProof = captureResult ? captureResult.currentCheckoutProof : anomaly.type === 'payment_capture_reconciliation' ? anomaly.currentCheckoutProof : null;
  const resolved = result?.status === 'resolved';
  const providerProof = checkoutResult && 'currentProviderProof' in checkoutResult ? checkoutResult.currentProviderProof : checkout?.currentProviderProof;
  const orderProof = checkoutResult && 'currentOrderProof' in checkoutResult ? checkoutResult.currentOrderProof : checkout?.currentOrderProof;
  const cancelledReceipt = checkoutResult?.status === 'resolved' && checkoutResult.resolution === 'canceled_purchase_committed' ? checkoutResult : null;
  const kind = checkoutResult?.kind ?? checkout?.kind;
  const reason = checkoutResult?.reason ?? checkout?.reason;
  const qualified = checkoutResult?.qualified ?? checkout?.qualified;
  const allowed = uid === userId && context.focused && (!checkout || !!checkout.transactionId);
  const consented = !!checkout && consentScope?.frame === context.frame && consentScope.focusRevision === context.focusRevision && consentScope.transactionId === checkout.transactionId;
  const toggleConsent = () => {
    if (!allowed || busy || !checkout?.transactionId) return;
    try {context.capture();} catch {return;}
    const previous = consentRef.current;
    const next = previous?.frame === context.frame && previous.focusRevision === context.focusRevision && previous.transactionId === checkout.transactionId ?
      null : {frame: context.frame, focusRevision: context.focusRevision, transactionId: checkout.transactionId};
    consentRef.current = next; setConsentScope(next);
  };
  const finish = (operation: ReturnType<typeof context.capture>) => {
    context.finish(operation);
    if (context.isCurrent(operation)) setBusyScope(null);
  };
  const inspect = async (operation: ReturnType<typeof context.capture>) => {
    try {
      context.assertCurrent(operation);
      const result = await inspectPaymentCaptureAnomaly(anomaly.id, userId, () => context.assertCurrent(operation), checkout?.transactionId);
      context.assertCurrent(operation);
      setOutcome({...operationScope(operation), result});
      // Keep the returned receipt visible until the operator explicitly reloads the queue.
    } catch (error) {
      if (context.isCurrent(operation)) setOutcome({...operationScope(operation), error: `${getFinancialErrorMessage(error)} Le résultat reste à vérifier dans ce même dossier.`});
    } finally { finish(operation); }
  };
  const requestInspection = () => {
    if (!allowed || busy || resolved) return;
    if (checkout && (consentRef.current?.frame !== context.frame || consentRef.current.focusRevision !== context.focusRevision ||
        consentRef.current.transactionId !== checkout.transactionId)) return;
    let operation: ReturnType<typeof context.capture>;
    try { const started = context.start(); if (!started) return; operation = started; }
    catch { return; }
    setBusyScope(operationScope(operation));
    consentRef.current = null; setConsentScope(null);
    void inspect(operation);
  };
  const refresh = () => {
    try {context.capture(); onRefresh();} catch {return;}
  };
  const toggleOriginalRefund = () => {try {if (auth.currentUser !== renderOwner) return; context.capture(); native.capture(); setRefundSelection(refundOpen ? null : {frame: native.frame, focusRevision: native.focusRevision, owner: auth.currentUser});} catch {return;}};
  if (uid !== userId || !native.focused) return null;
  return <View style={styles.card}>
    {context.focused ? <>
    <Text style={styles.title}>{checkout ? 'Paiement à rapprocher' : 'Encaissement à vérifier'}</Text>
    <Text style={styles.body}>Dossier {anomaly.id} · {resolved ? 'Rapprochement confirmé' : 'Dossier ouvert'}</Text>
    <Text style={styles.body}>{anomaly.createdAt?.toLocaleString(APP_LOCALE) ?? 'Date indisponible'}</Text>
    {anomaly.type === 'payment_capture_reconciliation' && <>
      {proofLines('Première preuve signalée', anomaly.firstEvidence).map((line, index) => <Text key={`first-${index}`} style={styles.body}>{line}</Text>)}
      {proofLines('Dernière preuve signalée', anomaly.lastEvidence).map((line, index) => <Text key={`last-${index}`} style={styles.body}>{line}</Text>)}
      {captureProof ? proofLines('Vérification du prestataire', captureProof).map((line, index) => <Text key={`current-${index}`} style={styles.body}>{line}</Text>) : <Text style={styles.body}>Aucune preuve prestataire actuelle disponible.</Text>}
      {captureResult?.status === 'resolved' ? <>
        <Text accessibilityRole="alert" style={styles.title}>Paiement déjà enregistré et rapproché avec la commande</Text>
        <Text style={styles.body}>Ce rapprochement reconnaît le règlement déjà enregistré. Aucun nouvel encaissement, remboursement carte ou mouvement de solde n’a été déclenché. Il ne confirme pas l’arrivée de fonds sur un compte bancaire.</Text>
      </> : <Text style={styles.body}>{labels[captureResult?.providerLookupState ?? anomaly.providerLookupState]}</Text>}
      {captureResult && <>
        <Text style={styles.body}>Qualification serveur : {captureResult.qualified ? 'Preuves concordantes' : 'Preuves à examiner'} · Motif : {captureResult.reason}</Text>
        <Text style={styles.body}>{captureResult.message}</Text>
        {captureResult.currentOrderProof ? captureOrderLines(captureResult.currentOrderProof).map((line, index) => <Text key={`native-${index}`} style={styles.body}>{line}</Text>) : <Text style={styles.body}>Aucune commande native unique et qualifiable disponible.</Text>}
      </>}
      {missingOrderProof ? <>
        <Text accessibilityRole="header" style={styles.title}>Intention et devis natifs reliés ; commande absente</Text>
        {missingOrderCheckoutLines(missingOrderProof).map((line, index) => <Text selectable key={`missing-order-${index}`} style={styles.body}>{line}</Text>)}
        <Text style={styles.body}>Ces sources ne recréent ni commande, ni règlement, ni engagement de stock. Le dossier reste ouvert ; aucun nouveau paiement, remboursement ou droit de réparation n’est accordé par cette preuve.</Text>
      </> : <Text style={styles.body}>Aucune preuve native d’intention et de devis pour une commande absente n’est disponible dans cette lecture.</Text>}
    </>}
    {checkout && <>
      <Text style={styles.body}>Commande liée : {checkout.transactionId ?? 'Liaison à vérifier'}</Text>
      <Text style={styles.body}>{kind && kinds[kind] ? kinds[kind] : 'Nature du dossier à examiner'}{kind ? ` (${kind})` : ''}</Text>
      <Text style={styles.body}>Qualification serveur : {qualified ? 'Preuves concordantes' : 'Preuves à examiner'} · Motif : {reason ?? 'Indisponible'}</Text>
      {!resolved && <Text style={styles.body}>Une autorisation ou un paiement signalé par le prestataire ne prouve pas à lui seul que la commande est payée. Le dossier reste ouvert.</Text>}
      {kind === 'confirmation_outcome_unknown' && !resolved && <Text style={styles.body}>L’absence de paiement confirmé ne prouve pas l’absence d’effet. Aucune nouvelle confirmation ni restitution locale n’est admissible tant que le paiement n’est pas neutralisé et les preuves rapprochées.</Text>}
      {cancelledReceipt && <>
        <Text accessibilityRole="alert" style={styles.title}>Annulation et restitution locale confirmées</Text>
        <Text style={styles.body}>Restitution au solde : {formatCents(cancelledReceipt.refundedCents)} · {cancelledReceipt.replay ? 'Reçu déjà enregistré, aucune nouvelle restitution' : 'Restitution enregistrée'}.</Text>
        <Text style={styles.body}>La commande a été annulée et la restitution locale est enregistrée. Aucun remboursement carte ni nouvel encaissement n’a été déclenché par cette action.</Text>
      </>}
      {checkoutResult?.status === 'resolved' && checkoutResult.resolution === 'purchase_payment_committed' && <Text accessibilityRole="alert" style={styles.title}>Paiement déjà enregistré et rapproché avec la commande. Aucun nouvel encaissement déclenché.</Text>}
      <Text style={styles.title}>{cancelledReceipt ? 'Preuves conservées avant rapprochement (historiques)' : 'Dernières preuves observées'}</Text>
      {providerProof ? checkoutProviderLines(providerProof).map((line, index) => <Text key={`provider-${index}`} style={styles.body}>{line}</Text>) : <Text style={styles.body}>Preuve prestataire indisponible.</Text>}
      {orderProof ? checkoutOrderLines(orderProof).map((line, index) => <Text key={`order-${index}`} style={styles.body}>{line}</Text>) : <Text style={styles.body}>Preuve de commande indisponible.</Text>}
      {!resolved && <>
        <Text style={styles.body}>Le serveur relira ce paiement et cette commande. Pour une annulation déjà prouvée, il peut enregistrer l’annulation locale et restituer au solde de l’acheteur les sommes déjà débitées. Une restitution déjà enregistrée ne sera pas répétée. Aucun nouvel encaissement ni remboursement carte ne sera déclenché.</Text>
        <Checkbox checked={consented} onToggle={toggleConsent} disabled={!allowed || busy} accessibilityLabel="Autoriser le rapprochement de ce dossier et la restitution locale éventuelle">
          <Text style={styles.body}>J’autorise le rapprochement du dossier {anomaly.id}, commande {checkout.transactionId ?? 'à vérifier'}, et cette restitution locale éventuelle.</Text>
        </Checkbox>
      </>}
    </>}
    <Text style={styles.body}>{result ? 'Vérification conservée avant cette relecture' : 'Dernière vérification enregistrée'} : {anomaly.updatedAt?.toLocaleString(APP_LOCALE) ?? 'Pas encore vérifié'}</Text>
    {!!current?.error && <Text accessibilityRole="alert" style={styles.body}>{current.error}</Text>}
    {resolved ? <Pressable accessibilityRole="button" style={styles.button} onPress={refresh}><Text style={styles.buttonText}>Relire la file</Text></Pressable> :
      <Pressable accessibilityRole="button" accessibilityState={{disabled: !allowed || busy || !!checkout && !consented, busy}} disabled={!allowed || busy || !!checkout && !consented} style={styles.button} onPress={requestInspection}>
        <Text style={styles.buttonText}>{checkout ? 'Rapprocher le paiement' : 'Vérifier le paiement'}</Text>
      </Pressable>}
    {orphanOperation ? <Pressable accessibilityRole="button" accessibilityState={{expanded: refundOpen}} style={styles.button} onPress={toggleOriginalRefund}><Text style={styles.buttonText}>{refundOpen ? 'Fermer l’examen du remboursement de capture' : 'Examiner le remboursement de cette capture au moyen d’origine'}</Text></Pressable> : null}
    </> : null}
    {refundOpen && orphanOperation && uid ? <AdminOrphanCaptureRefundPanel uid={uid} operationId={orphanOperation} onRecorded={onRefresh} /> : null}
  </View>;
}
const styles = StyleSheet.create({
  card: {padding: spacing.md, marginBottom: spacing.md, borderRadius: radius.md, backgroundColor: colors.surfaceWarm, gap: spacing.sm},
  title: {fontFamily: fonts.sansMedium, color: colors.foreground}, body: {fontFamily: fonts.sans, color: colors.foreground},
  button: {padding: spacing.md, borderRadius: radius.md, backgroundColor: colors.primary}, buttonText: {fontFamily: fonts.sansMedium, color: colors.cream},
});
