import { useRef, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { randomUUID } from 'expo-crypto';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Button, Checkbox } from '@/components/ui';
import { AccountRelationshipReauthentication } from '@/components/AccountRelationshipReauthentication';
import { useLabelLifecycleContext } from '@/hooks/useLabelLifecycleContext';
import { getAuthSessionGeneration } from '@/store/authStore';
import { AccountRelationshipReviewService as Service, relationshipFailure } from '@/services/accountRelationshipReviewService';
import { AccountRelationshipPurchaseJournal as Journal } from '@/services/accountRelationshipPurchaseJournal';
import { productReviewEqual } from '@/services/productReviewService';
import { createRelationshipInteraction } from '@/utils/accountRelationshipPresentation';
import { ACCOUNT_RELATIONSHIP_REVIEW_ENABLED } from '@/config/featureFlags';
import { RELATIONSHIP_PURCHASE_RETIREMENT_CAPABILITY, type RelationshipPurchaseAttempt, type RelationshipReference, type RelationshipReauthentication } from '@/types/accountRelationshipReview';
import { SWAP_TOPUP_STATUS_LABELS } from '@/utils/swapTopUpCheckoutPresentation';
import { formatPriceWithCurrency } from '@/utils/formatPrice';
import { colors, spacing, typography } from '@/constants/theme';

export function AccountRelationshipPurchasePanel({uid, transactionId, relationshipReference, sourceKey, assertSelection, renderReauthentication}: {
  uid: string; transactionId: string; relationshipReference: RelationshipReference; sourceKey: string; assertSelection: () => void; renderReauthentication?: RelationshipReauthentication;
}) {
  const frame = useLabelLifecycleContext(JSON.stringify(['relationship-purchase-preview', transactionId, relationshipReference, sourceKey]), uid), client = useQueryClient(), lock = useRef(false);
  const [interaction] = useState(createRelationshipInteraction), [revision, setRevision] = useState(0), [authenticated, setAuthenticated] = useState<string | null>(null);
  const key = JSON.stringify([uid, getAuthSessionGeneration(), transactionId, relationshipReference, sourceKey, frame.focusRevision, revision]);
  const choice = interaction.capture(), selected = () => {frame.capture(); assertSelection(); choice();};
  const source = useQuery({queryKey: ['relationship-purchase-preview', key], enabled: frame.focused && authenticated === key,
    staleTime: 0, gcTime: 0, retry: false, structuralSharing: false, queryFn: () => {
      const op = frame.capture(), current = () => {frame.assertCurrent(op); assertSelection(); choice();};
      current(); return Service.purchasePreview(uid, transactionId, relationshipReference, current);
    }});
  const preview = authenticated === key && source.isSuccess && !source.isFetching && !source.isError ? source.data : null;
  const formKey = JSON.stringify([key, preview]);
  const commandFrame = useLabelLifecycleContext(`relationship-purchase-command:${formKey}`, uid);
  const [draft, setDraft] = useState<{key: string; revision: number; acknowledged: boolean; authenticated: boolean} | null>(null);
  const form = draft?.key === formKey ? draft : {key: formKey, revision: 0, acknowledged: false, authenticated: false};
  const [busy, setBusy] = useState<string | null>(null), [notice, setNotice] = useState<{key: string; text: string} | null>(null);
  const journal = useQuery({queryKey: ['relationship-purchase-journal', uid, getAuthSessionGeneration(), commandFrame.focusRevision], enabled: commandFrame.focused,
    staleTime: 0, gcTime: 0, retry: false, queryFn: () => {const op = commandFrame.capture(); return Journal.read(uid, () => commandFrame.assertCurrent(op));}});
  const allowed = ACCOUNT_RELATIONSHIP_REVIEW_ENABLED && commandFrame.focused && preview?.canNeutralize === true && !!preview.commandTemplate && journal.isSuccess && !journal.isFetching && !journal.isError && journal.data === null;
  const submit = async () => {
    if (!allowed || !preview?.commandTemplate || !form.acknowledged || !form.authenticated || lock.current) return;
    let op; try {op = commandFrame.start();} catch {return;} if (!op) return;
    lock.current = true; setBusy(formKey); setNotice(null);
    const current = () => {commandFrame.assertCurrent(op); assertSelection(); choice(); if (!ACCOUNT_RELATIONSHIP_REVIEW_ENABLED) throw relationshipFailure();};
    try {
      current(); const attempt: RelationshipPurchaseAttempt = {version: 1, uid, requestId: randomUUID(), capability: RELATIONSHIP_PURCHASE_RETIREMENT_CAPABILITY, command: preview.commandTemplate};
      const receipt = await Journal.submit(attempt, current, async () => {
        const fresh = await Service.purchasePreview(uid, transactionId, relationshipReference, current); current();
        if (!fresh.canNeutralize || !productReviewEqual(fresh.commandTemplate, attempt.command) || fresh.sourceHash !== preview.sourceHash) throw relationshipFailure();
      }); current();
      setNotice({key: formKey, text: receipt.state === 'received' ? 'La neutralisation de cette seule capacité carte est observée. Le reçu reste dans votre journal ; la commande et les fonds ne sont pas modifiés.'
        : receipt.state === 'not_executed' ? 'L’instruction est enregistrée comme non exécutée. Relisez son reçu dans votre journal.' : 'L’issue reste inconnue ou en cours. Seule la relecture exacte dans votre journal est proposée.'});
    } catch {try {current(); setNotice({key: formKey, text: 'Le résultat doit être rapproché dans votre journal. Aucun nouvel envoi de cette instruction n’est proposé après une réponse incertaine.'});} catch { /* No obsolete surface can expose a replacement selection. */ }}
    finally {commandFrame.finish(op); lock.current = false; if (commandFrame.isCurrent(op)) setBusy(null); void client.invalidateQueries({queryKey: ['relationship-purchase-journal', uid]});}
  };
  return <View style={styles.section}><Text accessibilityRole="header" style={styles.title}>Ancienne capacité de paiement d’un achat</Text>
    <Text selectable style={styles.caption}>Achat {transactionId} · décision {relationshipReference.id} · version {relationshipReference.version}.</Text>
    <Text style={styles.caption}>Cette opération examine une capacité carte historique non engagée. Elle n’autorise aucun paiement, n’agit pas comme acheteur et ne change ni commande, stock, portefeuille, remboursement ou fonds.</Text>
    <AccountRelationshipReauthentication render={renderReauthentication} uid={uid} sourceKey={`relationship-purchase-read:${key}`} parcel disabled={!frame.focused || source.isFetching || !!busy}
      onVerified={() => {try {selected(); setAuthenticated(key);} catch { /* Original reader frame only. */ }}}/>
    {preview ? <>
      <Text selectable style={styles.caption}>Source native {preview.sourceHash} · acheteur {preview.buyerId} · vendeur {preview.sellerId}.</Text>
      <Text style={styles.body}>Total : {formatPriceWithCurrency(preview.amounts.totalCents / 100)} CAD · portefeuille : {formatPriceWithCurrency(preview.amounts.walletCents / 100)} CAD · carte : {formatPriceWithCurrency(preview.amounts.cardCents / 100)} CAD.</Text>
      <Text style={styles.body}>Statut prestataire observé : {SWAP_TOPUP_STATUS_LABELS[preview.provider.status]} · {preview.provider.observedAt}. Confirmation {preview.provider.confirmationMethod === 'manual' ? 'manuelle' : 'automatique'}.</Text>
      <Text style={styles.body}>Portefeuille : {preview.wallet.qualification === 'native_debit' ? 'débit natif qualifié' : preview.wallet.qualification === 'none' ? 'aucune portion portefeuille dans cette source' : 'source inconnue'}. {preview.wallet.obligationOpen ? 'Une obligation portefeuille reste ouverte ; aucun fonds n’est restitué par cette opération.' : 'Aucune obligation ouverte qualifiée dans cette observation.'}</Text>
      {!preview.canNeutralize ? <Text style={styles.caption}>Cette source ne permet aucune nouvelle neutralisation. Son résultat et les opérations engagées restent à examiner séparément.</Text> : null}
      <Checkbox checked={form.acknowledged} disabled={!allowed || !!busy} onToggle={() => {try {commandFrame.capture(); selected(); interaction.invalidate(); setDraft({...form, revision: form.revision + 1, acknowledged: !form.acknowledged, authenticated: false});} catch { /* Superseded consent. */ }}}>
        <Text style={styles.body}>Je confirme la neutralisation de cette capacité historique exacte, sans payer pour l’acheteur et sans effet sur les fonds, le stock ou l’état de sa commande.</Text>
      </Checkbox>
      <AccountRelationshipReauthentication render={renderReauthentication} uid={uid} sourceKey={`relationship-purchase-command:${formKey}:${form.revision}`} parcel disabled={!allowed || !form.acknowledged || !!busy}
        onVerified={() => {try {commandFrame.capture(); selected(); setDraft(old => old?.key === formKey && old.revision === form.revision ? {...old, authenticated: true} : old);} catch { /* A late provider callback approves no newer command. */ }}}/>
      <Button disabled={!allowed || !form.acknowledged || !form.authenticated || !!busy} onPress={() => {void submit();}}>Neutraliser cette seule capacité historique</Button>
    </> : source.isError ? <Text accessibilityRole="alert" style={styles.caption}>La source privée de cet achat ne peut pas être qualifiée. Aucun ancien endpoint mutateur n’est utilisé pour la relire.</Text> : <Text style={styles.caption}>{source.isFetching ? 'Lecture native et observation de la capacité…' : 'Réauthentifiez-vous pour lire cette capacité et sa décision exactes.'}</Text>}
    {journal.isError ? <Text style={styles.caption}>Le propre journal doit être relu avant tout nouvel envoi.</Text> : journal.data ? <Text style={styles.caption}>Une intention exacte est conservée. Ouvrez votre journal d’achat historique ci-dessus pour la relire sans nouvel envoi.</Text> : null}
    {notice?.key === formKey ? <Text accessibilityRole="alert" style={styles.caption}>{notice.text}</Text> : null}
    <Button variant="secondary" disabled={!frame.focused || !!busy} onPress={() => {try {selected(); interaction.invalidate(); setAuthenticated(null); setRevision(value => value + 1);} catch { /* No stale source reload. */ }}}>Relire explicitement cette capacité après réauthentification</Button>
  </View>;
}
const styles = StyleSheet.create({section: {gap: spacing.sm, paddingVertical: spacing.sm}, title: {...typography.body, color: colors.foreground}, body: {...typography.bodySmall, color: colors.foreground}, caption: {...typography.caption, color: colors.muted}});
