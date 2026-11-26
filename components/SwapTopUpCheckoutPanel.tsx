import { useRef, useState } from 'react';
import { Platform, StyleSheet, Text, View } from 'react-native';
import { randomUUID } from 'expo-crypto';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Button, Checkbox } from '@/components/ui';
import { AccountRelationshipReauthentication } from '@/components/AccountRelationshipReauthentication';
import { SwapTopUpCheckoutResult } from '@/components/SwapTopUpCheckoutResult';
import { useLabelLifecycleContext } from '@/hooks/useLabelLifecycleContext';
import { useUser } from '@/hooks/useAuth';
import { getAuthSessionGeneration } from '@/store/authStore';
import { isTradeProfileCurrent } from '@/services/tradeOperation';
import { CardField, useStripe } from '@/lib/stripe';
import type { StripeCardFieldProps } from '@/lib/stripe.types';
import { CHECKOUT_RETURN_URL } from '@/config/stripeConfig';
import { PAYMENTS_ENABLED, SWAP_TOPUP_MANUAL_ENABLED } from '@/config/featureFlags';
import { SwapTopUpCheckoutService as Service, swapTopUpFailure } from '@/services/swapTopUpCheckoutService';
import { SwapTopUpCheckoutJournal as Journal } from '@/services/swapTopUpCheckoutJournal';
import { productReviewEqual } from '@/services/productReviewService';
import { readScopedQuery } from '@/utils/readScopedQuery';
import { SWAP_TOPUP_STATUS_LABELS , createSwapTopUpInteraction } from '@/utils/swapTopUpCheckoutPresentation';
import { formatPriceWithCurrency } from '@/utils/formatPrice';
import { SWAP_TOPUP_MANUAL_CAPABILITY, type SwapTopUpAttempt, type SwapTopUpCommand, type SwapTopUpPayment, type SwapTopUpPreview,
  type SwapTopUpReauthentication, type SwapTopUpScope } from '@/types/swapTopUpCheckout';
import type { RelationshipReference } from '@/types/accountRelationshipReview';
import { colors, spacing, typography } from '@/constants/theme';

const cardStyle: StripeCardFieldProps['cardStyle'] = {backgroundColor: colors.surface, textColor: colors.foreground, placeholderColor: colors.muted};
const paymentIdentity = (payment: SwapTopUpPayment | null) => payment ? [payment.paymentIntentId, payment.intentId, payment.intentVersion, payment.providerStatus, payment.confirmationMethod, payment.action, payment.settlementReceiptVerified, payment.legacyExternalConfirmationPrevented] : null;
const sourceIdentity = (source: SwapTopUpPreview) => [source.sourceHash, source.amounts, source.preparation, source.manualEnabled, paymentIdentity(source.payment)];

/** Native card/tokenization and 3DS reuse the purchase adapters; every financial confirmation stays on the server. */
export function SwapTopUpCheckoutPanel({uid, swapId, scope, relationshipReference = null, assertSelection, renderReauthentication}: {
  uid: string; swapId: string; scope: SwapTopUpScope; relationshipReference?: RelationshipReference | null;
  assertSelection?: () => void; renderReauthentication?: SwapTopUpReauthentication;
}) {
  const frame = useLabelLifecycleContext(`swap-topup-panel:${scope}:${swapId}:${JSON.stringify(relationshipReference)}`, uid), client = useQueryClient(), stripe = useStripe(), normalUser = useUser(), lock = useRef(false);
  const [readInteraction] = useState(createSwapTopUpInteraction), [formInteraction] = useState(createSwapTopUpInteraction);
  const [readVersion, setReadVersion] = useState(0), [requested, setRequested] = useState<string | null>(null), [authenticated, setAuthenticated] = useState<string | null>(null);
  const generation = getAuthSessionGeneration(), key = JSON.stringify([uid, generation, swapId, scope, relationshipReference, frame.focusRevision]), sourceKey = JSON.stringify([key, readVersion]);
  const [showDetails, setShowDetails] = useState(false);
  const [busy, setBusy] = useState<string | null>(null), [notice, setNotice] = useState<{key: string; text: string} | null>(null);
  const readChoice = readInteraction.capture();
  const currentRead = () => {frame.capture(); assertSelection?.(); readChoice();};
  const source = useQuery({queryKey: ['swap-topup-preview', sourceKey], enabled: frame.focused && (requested === key || requested === null && scope === 'own') && (scope === 'own' || authenticated === sourceKey), staleTime: 0, gcTime: 0, retry: false, structuralSharing: false,
    queryFn: ({signal}) => readScopedQuery(signal, () => {const op = frame.capture(); return () => {frame.assertCurrent(op); currentRead();};}, assertCurrent => Service.preview(uid, swapId, scope, relationshipReference, assertCurrent))});
  const current = (requested === key || requested === null && scope === 'own') && frame.focused && (scope === 'own' || authenticated === sourceKey) && source.isSuccess && !source.isFetching && !source.isError ? source.data : null;
  const journal = useQuery({queryKey: ['swap-topup-journal', uid, scope, generation, frame.focusRevision], enabled: frame.focused, staleTime: 0, gcTime: 0, retry: false,
    queryFn: ({signal}) => readScopedQuery(signal, () => {const op = frame.capture(); return () => frame.assertCurrent(op);}, assertCurrent => Journal.read(uid, scope, assertCurrent))});
  const pending = frame.focused && journal.isSuccess && !journal.isFetching && !journal.isError ? journal.data : null;
  const emptyJournal = journal.isSuccess && !journal.isFetching && !journal.isError && journal.data === null;
  const payment = current?.payment ?? null, formKey = JSON.stringify([sourceKey, current ? sourceIdentity(current) : null]);
  const empty = {key: formKey, revision: 0, cardComplete: false, cardVersion: 0, acknowledged: false, authenticated: false};
  const [draft, setDraft] = useState<typeof empty | null>(null), form = draft?.key === formKey ? draft : empty;
  const formChoice = formInteraction.capture();
  const stageReady = SWAP_TOPUP_MANUAL_ENABLED && !!current?.manualEnabled && frame.focused;
  const nativeCardReady = stageReady && PAYMENTS_ENABLED && scope === 'own' && normalUser?.id === uid && Platform.OS !== 'web';
  const ready = stageReady && emptyJournal && busy !== key;
  const canPrepare = ready && nativeCardReady && current?.preparation.canPrepareNow === true;
  const canConfirm = ready && nativeCardReady && payment?.confirmationMethod === 'manual' && payment.action === 'confirmOnServer' && ['requires_payment_method', 'requires_confirmation'].includes(payment.providerStatus);
  const canAuthenticate = ready && nativeCardReady && payment?.confirmationMethod === 'manual' && payment.action === 'handleNextAction' && payment.providerStatus === 'requires_action' && !!payment.actionClientSecret;
  const canRetire = ready && current?.preparation.qualification === 'native_legacy_exposure' && payment?.confirmationMethod === 'automatic' &&
    (payment.action === 'reviewLegacyExposure' && ['requires_payment_method', 'requires_confirmation', 'requires_action'].includes(payment.providerStatus) || payment.action === 'reviewCancellation' && payment.providerStatus === 'canceled');
  const update = (patch: Partial<typeof form>) => {try {currentRead(); formInteraction.invalidate(); setDraft({...form, ...patch, revision: form.revision + 1, acknowledged: patch.acknowledged ?? false, authenticated: false});} catch { /* A stale card/choice cannot approve a NEW request. */ }};
  const read = () => {try {frame.capture(); assertSelection?.(); readInteraction.invalidate(); formInteraction.invalidate(); setReadVersion(n => n + 1); setRequested(key); setAuthenticated(null);} catch { /* SDK/focus/activity loss preserves only the own journal. */ }};
  const finishRecordedAttempt = async (attempt: SwapTopUpAttempt, current: () => void) => {
    const receipt = await Journal.observe(attempt, current); current();
    if (['received', 'not_executed'].includes(receipt.state) && receipt.recordedAt !== null) {
      await Journal.acknowledge(attempt, current); current(); return true;
    }
    return false;
  };
  const resumePending = async () => {
    if (!pending || pending.swapId !== swapId || lock.current) return;
    let op; try {op = frame.start();} catch {return;} if (!op) return;
    lock.current = true; setBusy(key); setNotice(null);
    const current = () => {frame.assertCurrent(op); currentRead();};
    try {
      const cleared = await finishRecordedAttempt(pending, current); current();
      await client.invalidateQueries({queryKey: ['swap-topup-journal', uid, scope]}); current();
      setNotice({key, text: cleared ? 'Votre paiement est à jour. Vous pouvez poursuivre.' : 'Votre paiement est encore en cours. Aucun nouveau paiement n’a été envoyé.'});
      if (cleared) read();
    } catch {if (frame.isCurrent(op)) setNotice({key, text: 'Le suivi n’a pas pu être chargé. Votre paiement est conservé.'});}
    finally {frame.finish(op); lock.current = false; if (frame.isCurrent(op)) setBusy(null);}
  };
  const send = async (action: SwapTopUpCommand['action']) => {
    if (!current || !form.acknowledged || lock.current || (action === 'prepare' ? !canPrepare : action === 'confirm' ? !canConfirm || payment?.providerStatus === 'requires_payment_method' && !form.cardComplete : !canRetire || scope === 'admin' && !form.authenticated)) return;
    let op; try {op = frame.start();} catch {return;} if (!op) return;
    lock.current = true; setBusy(key); setNotice(null);
    const assertCurrent = () => {frame.assertCurrent(op); currentRead(); formChoice(); if (!SWAP_TOPUP_MANUAL_ENABLED || !current.manualEnabled || action !== 'retire_legacy' && (!PAYMENTS_ENABLED || Platform.OS === 'web' || !isTradeProfileCurrent(op.base.session))) throw swapTopUpFailure();};
    const verify = async () => {assertCurrent(); const latest = await Service.preview(uid, swapId, scope, relationshipReference, assertCurrent); assertCurrent(); if (!productReviewEqual(sourceIdentity(latest), sourceIdentity(current))) throw swapTopUpFailure(); return latest;};
    try {
      await verify(); assertCurrent(); let paymentMethodId: string | null = null;
      if (action === 'confirm' && payment?.providerStatus === 'requires_payment_method') {
        const result = await stripe.createPaymentMethod({paymentMethodType: 'Card'}); assertCurrent();
        if (result.error || !result.paymentMethod || !/^pm_[A-Za-z0-9]+$/.test(result.paymentMethod.id)) throw swapTopUpFailure();
        paymentMethodId = result.paymentMethod.id;
        await verify(); assertCurrent();
      }
      const command: SwapTopUpCommand = {action, scope, sourceHash: current.sourceHash,
        intentId: action === 'confirm' ? payment!.intentId : null, intentVersion: action === 'confirm' ? payment!.intentVersion : null,
        paymentIntentId: action === 'prepare' ? null : payment!.paymentIntentId, paymentMethodId, totalCents: current.amounts.totalCents, relationshipReference, acknowledged: true};
      const attempt: SwapTopUpAttempt = {version: 1, uid, swapId, requestId: randomUUID(), capability: SWAP_TOPUP_MANUAL_CAPABILITY, command};
      await Journal.prepare(attempt, assertCurrent); assertCurrent();
      await Journal.executeNew(attempt, assertCurrent); assertCurrent();
      await finishRecordedAttempt(attempt, assertCurrent); assertCurrent();
      setNotice({key, text: 'Votre demande a été envoyée. Le paiement se met à jour.'});
      read();
    } catch {try {assertCurrent(); setNotice({key, text: 'Le paiement prend un peu plus de temps. Consultez son état avant de réessayer.'});} catch { /* A late result cannot overwrite the replacement selection/card. */ }}
    finally {frame.finish(op); lock.current = false; if (frame.isCurrent(op)) {setBusy(null); void client.invalidateQueries({queryKey: ['swap-topup-journal', uid, scope]});}}
  };
  const authenticate = async () => {
    if (!current || !payment || !canAuthenticate || !form.acknowledged || lock.current) return;
    let op; try {op = frame.start();} catch {return;} if (!op) return;
    lock.current = true; setBusy(key); setNotice(null);
    const assertCurrent = () => {frame.assertCurrent(op); currentRead(); formChoice(); if (!SWAP_TOPUP_MANUAL_ENABLED || !PAYMENTS_ENABLED || Platform.OS === 'web' || !isTradeProfileCurrent(op.base.session)) throw swapTopUpFailure();};
    try {
      assertCurrent(); const fresh = await Service.preview(uid, swapId, 'own', null, assertCurrent); assertCurrent();
      if (!productReviewEqual(sourceIdentity(fresh), sourceIdentity(current)) || fresh.payment?.action !== 'handleNextAction' || fresh.payment.confirmationMethod !== 'manual' || !fresh.payment.actionClientSecret || !fresh.payment.actionClientSecret.startsWith(`${fresh.payment.paymentIntentId}_secret_`)) throw swapTopUpFailure();
      // This secret authenticates an already durable manual intent. It cannot confirm the payment autonomously.
      const result = await stripe.handleNextAction(fresh.payment.actionClientSecret, CHECKOUT_RETURN_URL); assertCurrent();
      setNotice({key, text: result.error ? 'La confirmation bancaire a été interrompue. Vous pouvez la reprendre.' : 'Confirmation bancaire terminée. Vérifiez le montant, puis finalisez votre paiement.'});
      read();
    } catch {try {assertCurrent(); setNotice({key, text: 'La confirmation bancaire n’a pas pu être vérifiée. Actualisez votre paiement.'});} catch { /* A background roundtrip or changed choice cannot confirm or alter the replacement UI. */ }}
    finally {frame.finish(op); lock.current = false; if (frame.isCurrent(op)) setBusy(null);}
  };
  return <View style={styles.section}><Text accessibilityRole="header" style={styles.title}>{scope === 'admin' ? 'Paiement de l’échange' : 'Régler le complément'}</Text>

    {!SWAP_TOPUP_MANUAL_ENABLED ? <Text style={styles.caption}>Le paiement est momentanément indisponible. Vous pouvez consulter son état.</Text> : null}
    <Button variant="secondary" disabled={!frame.focused || busy === key} onPress={read}>Actualiser le paiement</Button>
    {scope === 'admin' && requested === key ? <AccountRelationshipReauthentication render={renderReauthentication} uid={uid} sourceKey={`swap-topup-reader:${sourceKey}`} parcel disabled={!frame.focused || busy === key} onVerified={() => {try {currentRead(); setAuthenticated(sourceKey);} catch { /* Old operator verification cannot open another source. */ }}}/> : null}
    {pending?.swapId === swapId ? <Button loading={busy === key} onPress={() => {void resumePending();}}>Reprendre le paiement</Button> : null}
    {current ? <>
      <Text style={styles.body}>Complément : {formatPriceWithCurrency(current.amounts.baseCents / 100)}</Text>
      <Text style={styles.body}>Frais : {formatPriceWithCurrency((current.amounts.serviceFeeCents + current.amounts.taxCents) / 100)}</Text>
      <Text style={styles.title}>Total : {formatPriceWithCurrency(current.amounts.totalCents / 100)}</Text>
      {payment ? <Text style={styles.body}>{payment.settlementReceiptVerified ? 'Paiement confirmé' : SWAP_TOPUP_STATUS_LABELS[payment.providerStatus]}</Text> : null}
      <Button variant="ghost" onPress={() => setShowDetails(value => !value)}>{showDetails ? 'Masquer les détails' : 'Détails du paiement'}</Button>
      {showDetails ? <SwapTopUpCheckoutResult preview={current}/> : null}
      {!emptyJournal ? <Text style={styles.caption}>Un paiement est déjà en cours. Consultez son suivi ci-dessous avant de poursuivre.</Text> : null}
      {nativeCardReady && emptyJournal && payment?.confirmationMethod === 'manual' && payment.action === 'confirmOnServer' && payment.providerStatus === 'requires_payment_method' ? <CardField key={`${formKey}/${form.cardVersion}`} style={styles.cardField} cardStyle={cardStyle} countryCode="CA" postalCodeEnabled dangerouslyGetFullCardDetails={false} disabled={busy === key} onCardChange={details => {if (busy !== key) update({cardComplete: details.complete});}}/> : null}
      {canPrepare || canConfirm || canAuthenticate || canRetire ? <Checkbox checked={form.acknowledged} disabled={busy === key} onToggle={() => update({acknowledged: !form.acknowledged})}><Text style={styles.caption}>{canRetire ? `Je demande l’annulation de cette ancienne tentative de paiement.` : `Je confirme le paiement de ${formatPriceWithCurrency(current.amounts.totalCents / 100)} pour cet échange.`}</Text></Checkbox> : null}
      {canRetire && scope === 'admin' ? <AccountRelationshipReauthentication render={renderReauthentication} uid={uid} sourceKey={`swap-topup-retire:${formKey}/${form.revision}`} parcel disabled={busy === key} onVerified={() => {try {currentRead(); formChoice(); setDraft(old => old?.key === formKey && old.revision === form.revision ? {...old, authenticated: true} : form.revision === 0 ? {...form, authenticated: true} : old);} catch { /* An old callback never approves another decision or payment. */ }}}/> : null}
      {canPrepare ? <Button disabled={!form.acknowledged || busy === key} onPress={() => {void send('prepare');}}>Continuer vers le paiement</Button> : null}
      {canConfirm ? <Button disabled={!form.acknowledged || busy === key || payment?.providerStatus === 'requires_payment_method' && !form.cardComplete} onPress={() => {void send('confirm');}}>Payer le complément</Button> : null}
      {canAuthenticate ? <Button disabled={!form.acknowledged || busy === key} onPress={() => {void authenticate();}}>Confirmer avec ma banque</Button> : null}
      {canRetire ? <Button variant="secondary" disabled={!form.acknowledged || busy === key || scope === 'admin' && !form.authenticated} onPress={() => {void send('retire_legacy');}}>Annuler l’ancienne tentative</Button> : null}
    </> : source.isError ? <Text accessibilityRole="alert" style={styles.caption}>Votre paiement n’a pas pu être chargé. Réessayez dans un instant.</Text> : <Text style={styles.caption}>{source.isFetching ? 'Chargement du paiement…' : 'Actualisez pour retrouver ce paiement.'}</Text>}
    {notice?.key === key ? <Text accessibilityRole="alert" style={styles.caption}>{notice.text}</Text> : null}
  </View>;
}
const styles = StyleSheet.create({section: {gap: spacing.sm, padding: spacing.md}, title: {...typography.body, color: colors.foreground}, body: {...typography.bodySmall, color: colors.foreground}, caption: {...typography.caption, color: colors.muted}, cardField: {height: spacing['4xl'], width: '100%'}});
