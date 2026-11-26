import { useLayoutEffect, useRef, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { useQuery } from '@tanstack/react-query';
import { Button } from '@/components/ui';
import { ProductReviewCasePanel } from '@/components/ProductReviewCasePanel';
import { LateCommercialHistory } from '@/components/LateCommercialHistory';
import { LateCommercialLinkSummary } from '@/components/LateCommercialLinkSummary';
import { LateCommercialFinancialSummary } from '@/components/LateCommercialFinancialSummary';
import { APP_LOCALE } from '@/constants/locale';
import { colors, spacing, typography } from '@/constants/theme';
import { useLabelLifecycleContext } from '@/hooks/useLabelLifecycleContext';
import { LateCommercialRecourseJournal } from '@/services/lateCommercialRecourseJournal';
import { LateCommercialRecourseService } from '@/services/lateCommercialRecourseService';
import { productReviewEqual, productReviewHash } from '@/services/productReviewService';
import type { LateCommercialEntry, LateCommercialReceipt, LateCommercialReference } from '@/types/lateCommercialRecourse';
import { AdminFinancialReauthentication } from './AdminFinancialReauthentication';
import { AdminLateCommercialDecision } from './AdminLateCommercialDecision';
import { AdminProductFinancialEntry } from './AdminProductFinancialEntry';

export function AdminLateCommercialReview({uid, supportRequestId}: {uid: string; supportRequestId: string | null}) {
  const context = useLabelLifecycleContext(`admin-late-commercial:${supportRequestId}`, uid);
  const key = JSON.stringify([uid, supportRequestId, context.focusRevision]);
  const [readerAuthentication, setReaderAuthentication] = useState<string | null>(null), [resumeAuthentication, setResumeAuthentication] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null), [notice, setNotice] = useState<{key: string; text: string} | null>(null);
  const [receipt, setReceipt] = useState<{key: string; value: LateCommercialReceipt} | null>(null);
  const journal = useQuery({queryKey: ['late-commercial-own-journal', key], enabled: context.focused, staleTime: 0, gcTime: 0, retry: false,
    queryFn: () => {const op = context.capture(); return LateCommercialRecourseJournal.read(uid, () => context.assertCurrent(op));}});
  const journalReady = context.focused && journal.isSuccess && !journal.isFetching && !journal.isError;
  const pending = journalReady ? journal.data : null;
  const preview = useQuery({queryKey: ['late-commercial-admin-preview', key], enabled: context.focused && !!supportRequestId && readerAuthentication === key,
    staleTime: 0, gcTime: 0, retry: false, queryFn: () => {const op = context.capture(); return LateCommercialRecourseService.preview(uid, supportRequestId!, () => context.assertCurrent(op));}});
  const source = context.focused && preview.isSuccess && !preview.isFetching && !preview.isError && readerAuthentication === key ? preview.data : null;
  const selectionKey = JSON.stringify([key, source?.sourceHash, source?.currentAdmission]);
  const liveSelection = useRef(selectionKey);
  useLayoutEffect(() => {liveSelection.current = selectionKey; return () => {liveSelection.current = '';};}, [selectionKey]);
  const [financial, setFinancial] = useState<{key: string; transactionId: string; disputeId: string; reference: LateCommercialReference} | null>(null);
  const selected = financial?.key === selectionKey ? financial : null;
  const refresh = () => {void journal.refetch(); if (source) void preview.refetch();};
  const resumeKey = JSON.stringify([key, pending?.requestId]);
  const service = async (mode: 'observe' | 'resume' | 'neutralize' | 'acknowledge') => {
    if (!pending || busy === key || mode === 'resume' && resumeAuthentication !== resumeKey) return;
    let op; try {op = context.start();} catch {return;} if (!op) return; setBusy(key); setNotice(null);
    try {
      const assertCurrent = () => context.assertCurrent(op);
      const result = mode === 'resume' ? await LateCommercialRecourseJournal.execute(pending, assertCurrent, true) :
        mode === 'neutralize' ? await LateCommercialRecourseJournal.neutralize(pending, assertCurrent) :
        mode === 'acknowledge' ? await LateCommercialRecourseJournal.acknowledge(pending, assertCurrent) : await LateCommercialRecourseJournal.observe(pending, assertCurrent);
      assertCurrent(); setReceipt({key, value: result}); refresh();
    } catch (error) {if (context.isCurrent(op)) {setNotice({key, text: error instanceof Error ? error.message : 'Le même reçu doit être relu.'}); void journal.refetch();}}
    finally {context.finish(op); if (context.isCurrent(op)) setBusy(null);}
  };
  const selectFinancial = async (entry: LateCommercialEntry) => {
    const op = context.capture(); if (liveSelection.current !== selectionKey) return;
    if (!source || !source.currentAdmission || entry.decision !== 'admit_examination' || entry.supportRequestId !== source.supportRequestId ||
      entry.topic !== source.source.link.topic || !productReviewEqual(entry.reference, source.currentAdmission)) {
      setNotice({key, text: 'Cette entrée historique n’est pas l’admission courante qualifiée de ce ticket. Relisez les sources avant un examen financier.'}); return;
    }
    const disputeId = `late_${await productReviewHash([source.source.clockOriginSupportRequestId, source.transactionId])}`; context.assertCurrent(op);
    if (liveSelection.current !== selectionKey) return;
    setFinancial({key: selectionKey, transactionId: source.transactionId, disputeId, reference: entry.reference});
  };
  const ownReceipt = receipt?.key === key && pending?.requestId === receipt.value.requestId ? receipt.value : null;
  return <View style={styles.section}>
    <Text accessibilityRole="header" style={styles.title}>Admission de la réclamation commerciale tardive</Text>
    {journal.isError ? <Text style={styles.caption}>Le journal privé doit être relu avant toute nouvelle instruction.</Text> : null}
    {pending ? <View style={styles.section}>
      <Text selectable style={styles.caption}>Intention conservée : {pending.requestId} · {pending.command.transactionId} · {pending.command.supportRequestId}</Text>
      <Text selectable style={styles.body}>{pending.command.reason}</Text><Text selectable style={styles.body}>{pending.command.partyMessage}</Text>
      <Button variant="secondary" disabled={busy === key} onPress={() => {void service('observe');}}>Relire exactement cette instruction</Button>
      <Button variant="secondary" disabled={busy === key} onPress={() => {void service('neutralize');}}>Neutraliser cette intention non exécutée</Button>
      <AdminFinancialReauthentication key={resumeKey} uid={uid} sourceKey={`late-commercial-resume:${resumeKey}`} purpose="commercial" parcel disabled={busy === key}
        onVerified={() => {try {context.capture(); setResumeAuthentication(resumeKey);} catch { /* Old verification. */ }}} />
      <Button variant="secondary" disabled={busy === key || resumeAuthentication !== resumeKey} onPress={() => {void service('resume');}}>Reprendre la même instruction et les mêmes sources</Button>
      {ownReceipt ? <Text style={styles.caption}>{ownReceipt.state === 'committed' ? 'L’instruction et les avis sont enregistrés, sans mouvement financier.' :
        ownReceipt.state === 'not_executed' ? `Instruction non exécutée : ${ownReceipt.reason}.` : 'Aucun reçu natif visible pour cette intention ; le résultat reste inconnu.'}</Text> : null}
      {ownReceipt && ownReceipt.state !== 'unrecorded' ? <Button variant="secondary" disabled={busy === key} onPress={() => {void service('acknowledge');}}>Relire le reçu frais et terminer le suivi local</Button> : null}
    </View> : null}
    {supportRequestId ? <>
      <AdminFinancialReauthentication key={key} uid={uid} sourceKey={`late-commercial-preview:${key}`} purpose="commercial" parcel disabled={!journalReady || !!pending || busy === key}
        onVerified={() => {try {context.capture(); setReaderAuthentication(key);} catch { /* Old verification. */ }}} />
      {source ? <>
        <Text style={styles.caption}>Ticket version {source.ticket.version}. Réception initiale suivie : {new Date(source.source.initialReceivedAtMs).toLocaleString(APP_LOCALE)}. Découverte déclarée : {source.source.discoveryDeclaredAt ?? 'non précisée'}.</Text>
        <Text selectable style={styles.body}>{source.ticket.narrative}</Text>
        {source.ticket.latestClarification ? <Text selectable style={styles.body}>{source.ticket.latestClarification}</Text> : null}
        <LateCommercialLinkSummary link={source.source.link} /><LateCommercialFinancialSummary situation={source.source.financialSituation} />
        <ProductReviewCasePanel uid={uid} context={{kind: 'order', id: source.transactionId}} scope="admin"
          material={source.source.link.materialCapability !== undefined} parcel={source.source.link.parcelCapability !== undefined}
          renderReauthentication={props => <AdminFinancialReauthentication {...props} purpose="commercial" />}
          renderOrderCommercial={nativeAdmission => <AdminLateCommercialDecision uid={uid} preview={source} nativeAdmission={nativeAdmission}
            disabled={!journalReady || !!pending || busy === key} onRecorded={() => {refresh();}} onJournalChanged={() => {void journal.refetch();}} />} />
        <LateCommercialHistory uid={uid} transactionId={source.transactionId} scope="admin" refreshKey={preview.dataUpdatedAt}
          onSelect={entry => {void selectFinancial(entry).catch(() => undefined);}} />
        {selected ? <AdminProductFinancialEntry uid={uid} disabled={!journalReady || !!pending || busy === key} blockedTransactions={[]}
          onRecorded={refresh} selection={{transactionId: selected.transactionId, disputeId: selected.disputeId}} lateCommercial={selected.reference}
          material={source.source.link.materialCapability !== undefined} parcel={source.source.link.parcelCapability !== undefined} topic={source.source.link.topic} /> : null}
      </> : preview.isError ? <Text style={styles.caption}>Les sources du ticket et du corpus ne peuvent pas être qualifiées. L’historique ne donne aucune admission actuelle.</Text> : null}
      <Button variant="secondary" disabled={!context.focused || readerAuthentication !== key || preview.isFetching || !!pending} onPress={() => {try {context.capture(); void preview.refetch();} catch { /* Inactive. */ }}}>Relire le ticket, l’admission et le corpus actuels</Button>
    </> : null}
    {notice?.key === key ? <Text accessibilityRole="alert" style={styles.caption}>{notice.text}</Text> : null}
  </View>;
}
const styles = StyleSheet.create({section: {gap: spacing.sm, paddingVertical: spacing.sm}, title: {...typography.body, color: colors.foreground},
  body: {...typography.bodySmall, color: colors.foreground}, caption: {...typography.caption, color: colors.muted}});
