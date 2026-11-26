import { useCallback, useLayoutEffect, useRef, useState } from 'react';
import { StyleSheet, Text, TextInput, View } from 'react-native';
import { useQuery } from '@tanstack/react-query';
import { randomUUID } from 'expo-crypto';
import { Button, Checkbox } from '@/components/ui';
import { colors, spacing, typography } from '@/constants/theme';
import { useProductParcelContext } from '@/hooks/useProductParcelContext';
import { getAuthSessionGeneration } from '@/store/authStore';
import { TransactionService } from '@/services/transactionService';
import { observeAdminProductResumeSource } from '@/services/adminFinancialService';
import { productFinancialCaseId } from '@/services/adminProductFinancialSource';
import { readAdminFinancialAttempts, type AdminFinancialAttempt, type AdminFinancialPreview } from '@/services/adminFinancialDecisionJournal';
import { readDisputeResolutionAttempts, type DisputeResolutionAttempt } from '@/services/disputeResolutionJournal';
import { formatPrice } from '@/utils/formatPrice';
import { AdminFinancialReauthentication } from './AdminFinancialReauthentication';
import { AdminProductFinancialReview } from './AdminProductFinancialReview';
import { AdminProductFinancialHistory } from './AdminProductFinancialHistory';
import type { LateCommercialReference } from '@/types/lateCommercialRecourse';
const ref = (v: string) => /^[A-Za-z0-9_-]{1,200}$/.test(v);
interface Draft {key: string; requestId: string; preview: AdminFinancialPreview; note: string; sourceCurrent: boolean; allOpened: boolean;
  examined: boolean; reauthenticated: boolean; accepted: boolean}
export function AdminProductFinancialEntry({uid, disabled, blockedTransactions, onRecorded, selection, material = false, parcel = false, topic = 'authenticity', showHistory = true, lateCommercial, assertSelection}: {uid: string; disabled: boolean;
  blockedTransactions: string[]; onRecorded: () => void; selection?: {transactionId: string; disputeId: string}; material?: boolean; parcel?: boolean; topic?: 'authenticity' | 'nonconformity' | 'parcel_delivery'; showHistory?: boolean; lateCommercial?: LateCommercialReference; assertSelection?: () => void}) {
  const activityGuarded = parcel || !!lateCommercial;
  const context = useProductParcelContext(`admin-product-financial:${disabled}${material ? `:material:${topic}` : ''}${parcel ? `:parcel:${topic}` : ''}${lateCommercial ? JSON.stringify(lateCommercial) : ''}`, uid, activityGuarded);
  const key = JSON.stringify([uid, getAuthSessionGeneration(), context.focusRevision, disabled, ...(material ? ['product_review_material_v1', topic] : []), ...(parcel ? ['product_review_parcel_v1', topic] : []), ...(lateCommercial ? [lateCommercial] : [])]);
  const interaction = useRef(0);
  const currentContext = useRef({key, context}); useLayoutEffect(() => {currentContext.current = {key, context};}, [key, context]);
  const [input, setInput] = useState<{key: string; transactionId: string; disputeId: string} | null>(null);
  const currentInput = input?.key === key ? input : {key, transactionId: selection?.transactionId ?? '', disputeId: selection?.disputeId ?? ''};
  const authenticationKey = JSON.stringify([key, currentInput.transactionId, currentInput.disputeId]), [readerAuthentication, setReaderAuthentication] = useState<string | null>(null);
  const [draft, setDraft] = useState<Draft | null>(null), current = !disabled && context.focused && draft?.key === key ? draft : null;
  const [notice, setNotice] = useState<{key: string; text: string} | null>(null), [busy, setBusy] = useState<string | null>(null);
  const lock = useRef<symbol | null>(null);
  const journal = useQuery({queryKey: ['admin-product-financial-existing', key], enabled: !disabled && context.focused, staleTime: 0, gcTime: 0, retry: false,
    queryFn: async () => {const op = context.capture(); const all = await Promise.all([readAdminFinancialAttempts(uid, () => context.assertCurrent(op)), readDisputeResolutionAttempts(uid, () => context.assertCurrent(op))]); context.assertCurrent(op); return all;}});
  const ready = !disabled && context.focused && journal.isSuccess && !journal.isFetching && !journal.isError;
  const ownBlocked = ready ? journal.data.flatMap(items => items.map(a => a.transactionId)) : [];
  const open = async (decisionType: 'dismissed' | 'refund_without_return', resumeRequested = false) => {
    const transactionId = currentInput.transactionId.trim(), disputeId = currentInput.disputeId.trim();
    if (!ready || lock.current || activityGuarded && readerAuthentication !== authenticationKey || !ref(transactionId) || !ref(disputeId) || [...blockedTransactions, ...ownBlocked].includes(transactionId) || resumeRequested && decisionType !== 'refund_without_return') return;
    let op; try {assertSelection?.(); op = context.start();} catch {return;} if (!op) return;
    const token = Symbol(); lock.current = token; setBusy(key); setDraft(null); setNotice(null);
    try {
      const assertCurrent = () => {context.assertCurrent(op); assertSelection?.();}; assertCurrent(); const caseId = await productFinancialCaseId(transactionId); assertCurrent();
      let resume;
      if (resumeRequested) {
        const original = await observeAdminProductResumeSource(uid, transactionId, assertCurrent, material, topic, parcel); assertCurrent();
        if (original.qualification !== 'qualified' || !original.resume || original.financial?.success) throw new Error('L’intention d’origine ne peut pas être reprise depuis cette lecture.');
        resume = original.resume;
      }
      const preview = await TransactionService.previewAdminFinancialDecision(transactionId, disputeId, uid, decisionType, assertCurrent, 'product_review', resume, undefined, caseId, topic, material, parcel, undefined, lateCommercial);
      assertCurrent(); setDraft({key, requestId: randomUUID(), preview, note: '', sourceCurrent: false, allOpened: false, examined: false, reauthenticated: false, accepted: false});
    } catch (error) {try {assertSelection?.(); if (context.isCurrent(op)) setNotice({key, text: error instanceof Error ? error.message : 'Le dossier et son issue doivent être qualifiés avant toute instruction.'});} catch { /* A replaced G20 selection cannot alter a new preview. */ }}
    finally {context.finish(op); if (lock.current === token) {lock.current = null; try {assertSelection?.(); setBusy(null);} catch { /* New selection. */ }}}
  };
  const onRead = useCallback((sourceCurrent: boolean, allOpened: boolean) => {
    try {assertSelection?.();} catch {return;}
    if (activityGuarded && (sourceCurrent || allOpened)) {try {if (currentContext.current.key !== key) return; currentContext.current.context.capture();} catch {return;}}
    setDraft(old => !old || old.key !== key || old.sourceCurrent === sourceCurrent && old.allOpened === allOpened ? old :
      {...old, sourceCurrent, allOpened, examined: false, accepted: false});
  }, [key, activityGuarded, assertSelection]);
  const submit = async () => {
    if (!ready || lock.current || !current || !current.sourceCurrent || !current.allOpened || !current.examined || !current.reauthenticated || !current.accepted || !current.note.trim()) return;
    const p = current.preview; if (!p.productReview) return;
    let op; try {assertSelection?.(); op = context.start();} catch {return;} if (!op) return;
    const token = Symbol(); lock.current = token; setBusy(key); setNotice(null);
    const capturedInteraction = interaction.current;
    const assertCurrent = () => {context.assertCurrent(op); assertSelection?.(); if (lateCommercial && capturedInteraction !== interaction.current) throw new Error('La confirmation financière a changé.');};
    try {
      if (p.decisionType === 'dismissed') {
        const a: DisputeResolutionAttempt = {version: 1, adminUid: uid, transactionId: p.transactionId, disputeId: p.expectedDisputeId, requestId: current.requestId,
          note: current.note.trim(), previewId: p.previewId, expectedSourceHash: p.sourceHash, previewMonetaryContext: p.monetaryContext,
          expectedSettledRefundIntentId: p.refundIntentId ?? null, productReview: p.productReview};
        const receipt = await TransactionService.resolveDispute(a, assertCurrent, 'confirm'); assertCurrent();
        setNotice({key, text: receipt.outcome === 'dismissed' ? 'Le classement du dossier exact est enregistré. L’authenticité, les autres obligations et le règlement financier restent distincts.' :
          receipt.outcome === 'not_executed' ? 'Cette intention n’a pas été exécutée ; relisez son reçu dans le suivi propre.' : 'Le reçu reste à vérifier avec la même intention.'});
      } else {
        const a: AdminFinancialAttempt = {version: 1, adminUid: uid, transactionId: p.transactionId, disputeId: p.expectedDisputeId, requestId: current.requestId,
          note: current.note.trim(), previewId: p.previewId, expectedSourceHash: p.sourceHash, expectedTotalCents: p.totalCents, expectedCardCents: p.cardCents,
          expectedWalletCents: p.walletCents, expectedSellerDebitCents: p.sellerDebitCents, decisionType: 'refund_without_return', productReview: p.productReview, ...(p.resume ? {resume: p.resume} : {})};
        const receipt = await TransactionService.adminRefundTransaction(a, assertCurrent, 'confirm'); assertCurrent();
        setNotice({key, text: receipt.outcome === 'reserved' ? receipt.financial.success ? 'L’instruction et le règlement d’origine sont enregistrés. Le crédit bancaire et l’authenticité restent non certifiés.' :
          'L’instruction est enregistrée. Le règlement de la même intention reste à suivre ; aucune deuxième réservation n’est proposée.' : 'Le reçu de la même intention doit être relu dans le suivi propre.'});
      }
      setDraft(null); await journal.refetch(); assertCurrent(); onRecorded();
    } catch {try {assertCurrent(); setDraft(null); setNotice({key, text: 'Le résultat doit être relu avec la même intention, ses références et sa note d’origine. Aucune autre commande n’a été envoyée.'}); void journal.refetch(); onRecorded();} catch { /* An edited current draft keeps its choices and exact journal. */ }}
    finally {context.finish(op); if (lock.current === token) {lock.current = null; try {assertSelection?.(); setBusy(null);} catch { /* New selection. */ }}}
  };
  return <View style={styles.section}>
    <Text accessibilityRole="header" style={styles.title}>{topic === 'parcel_delivery' ? 'Décision financière distincte après examen du colis' : topic === 'nonconformity' ? 'Décision financière distincte après comparaison matérielle' : 'Décision distincte après examen d’authenticité'}</Text>
    <Text style={styles.caption}>{topic === 'nonconformity' ? 'L’issue documentaire ne certifie ni le contenu reçu, ni une faute, ni une réception de retour. Le remboursement exige cette décision distincte et son aperçu natif actuel.' : 'L’issue documentaire ne certifie pas une contrefaçon et n’autorise aucun remboursement. Choisissez explicitement la commande et le litige, puis examinez leur aperçu natif actuel.'}</Text>
    <TextInput value={currentInput.transactionId} editable={!lateCommercial && !disabled && busy !== key} style={styles.input} autoCapitalize="none" maxLength={200} placeholder="Référence exacte de la commande" placeholderTextColor={colors.muted}
      onChangeText={transactionId => {setInput({...currentInput, transactionId}); setDraft(null);}} />
    <TextInput value={currentInput.disputeId} editable={!lateCommercial && !disabled && busy !== key} style={styles.input} autoCapitalize="none" maxLength={200} placeholder="Référence exacte du litige" placeholderTextColor={colors.muted}
      onChangeText={disputeId => {setInput({...currentInput, disputeId}); setDraft(null);}} />
    {activityGuarded ? <AdminFinancialReauthentication uid={uid} sourceKey={authenticationKey} disabled={!ready || busy === key} parcel onVerified={() => {try {context.capture(); assertSelection?.(); setReaderAuthentication(authenticationKey); setDraft(null);} catch { /* Old activity cannot qualify a new private reading. */ }}} /> : null}
    <Button variant="secondary" disabled={!ready || busy === key || activityGuarded && readerAuthentication !== authenticationKey} onPress={() => {void open('dismissed');}}>Examiner le classement de ce litige</Button>
    <Button variant="secondary" disabled={!ready || busy === key || activityGuarded && readerAuthentication !== authenticationKey} onPress={() => {void open('refund_without_return');}}>{topic !== 'authenticity' ? 'Examiner le remboursement entier du paiement d’origine' : 'Examiner un remboursement sans retour'}</Button>
    <Button variant="secondary" disabled={!ready || busy === key || activityGuarded && readerAuthentication !== authenticationKey} onPress={() => {void open('refund_without_return', true);}}>Examiner la reprise de l’intention financière d’origine</Button>
    {journal.isError ? <Text accessibilityRole="alert" style={styles.caption}>Les journaux doivent être relus avant toute nouvelle décision.</Text> : null}
    {current ? <View style={styles.section}>
      <AdminProductFinancialReview key={current.requestId} uid={uid} preview={current.preview} enabled={!disabled && busy !== key} onCurrentReadChange={onRead} assertSelection={assertSelection}/>
      {current.sourceCurrent ? <>
        <Text style={styles.body}>{current.preview.decisionType === 'dismissed' ? 'Classement motivé du dossier exact' : current.preview.resume ? 'Reprise de la même intention financière' : topic !== 'authenticity' ? 'Instruction de remboursement entier du paiement d’origine' : 'Instruction de remboursement sans retour'}.</Text>
        <Text style={styles.caption}>Total CAD : {formatPrice(current.preview.totalCents / 100)} · carte d’origine : {formatPrice(current.preview.cardCents / 100)} · porte-monnaie : {formatPrice(current.preview.walletCents / 100)} · débit ou dette vendeur : {formatPrice(current.preview.sellerDebitCents / 100)}.</Text>
        <Text selectable style={styles.caption}>Acheteur : {current.preview.buyerId} · vendeur : {current.preview.sellerId}. Autres dossiers ouverts : {current.preview.remainingOpenDisputeIds.join(', ') || 'aucun'} ; obligations conservées : {current.preview.retainedObligations.join(', ') || 'aucune'}.</Text>
        {current.preview.resume ? <Text selectable style={styles.caption}>Intention {current.preview.resume.refundIntentId}, tentative {current.preview.resume.refundAttemptId}. Montants, options, clé et réservation d’origine restent inchangés.</Text> : null}
        <Text style={styles.caption}>La possession physique reste inconnue ; ce choix n’autorise aucune remise en vente. Le classement, l’admission matérielle et le règlement financier sont distincts.</Text>
        <AdminFinancialReauthentication key={current.requestId} uid={uid} sourceKey={current.preview.previewId} disabled={busy === key} parcel={activityGuarded}
          onVerified={() => {try {context.capture(); assertSelection?.(); setDraft(old => old?.key === key && old.requestId === current.requestId ? {...old, reauthenticated: true, accepted: false} : old);} catch { /* A prior activity epoch grants no confirmation. */ }}} />
        <TextInput value={current.note} multiline maxLength={500} editable={busy !== key} style={styles.input} placeholder="Motivation obligatoire de cette décision distincte" placeholderTextColor={colors.muted}
          onChangeText={note => {try {assertSelection?.(); interaction.current++; setDraft({...current, note, examined: false, accepted: false});} catch { /* New selection. */ }}} />
        <Checkbox checked={current.examined} disabled={!current.allOpened || !current.note.trim() || busy === key} onToggle={() => {try {assertSelection?.(); interaction.current++; setDraft({...current, examined: !current.examined, accepted: false});} catch { /* New selection. */ }}}>
          <Text style={styles.caption}>J’ai examiné les déclarations, l’issue et toutes les pièces du corpus actuel. La motivation ci-dessus concerne ce litige et ces sources ; elle ne certifie pas l’authenticité.</Text>
        </Checkbox>
        <Checkbox checked={current.accepted} disabled={!current.examined || !current.reauthenticated || busy === key} onToggle={() => {try {assertSelection?.(); interaction.current++; setDraft({...current, accepted: !current.accepted});} catch { /* New selection. */ }}}>
          <Text style={styles.caption}>Je confirme ce choix distinct pour ce litige, cette version du dossier, ces parties, ces montants et cette motivation.</Text>
        </Checkbox>
        <Button disabled={!current.accepted || !current.examined || !current.reauthenticated || !current.allOpened || busy === key} onPress={() => {void submit();}}>Enregistrer cette décision distincte</Button>
      </> : null}
      <Button variant="ghost" disabled={busy === key} onPress={() => {try {assertSelection?.(); setDraft(null);} catch { /* New selection. */ }}}>Fermer cet aperçu sans envoyer</Button>
    </View> : null}
    {notice?.key === key ? <Text accessibilityRole="alert" style={styles.caption}>{notice.text}</Text> : null}
    {showHistory ? <AdminProductFinancialHistory uid={uid} refreshKey={journal.dataUpdatedAt} /> : null}
  </View>;
}
const styles = StyleSheet.create({section: {gap: spacing.sm, paddingVertical: spacing.md}, title: {...typography.body, color: colors.foreground},
  body: {...typography.bodySmall, color: colors.foreground}, caption: {...typography.caption, color: colors.muted}, input: {...typography.bodySmall, color: colors.foreground, borderWidth: 1, borderColor: colors.border, padding: spacing.md}});
