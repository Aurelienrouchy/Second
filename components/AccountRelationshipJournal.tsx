import { useRef, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Button } from '@/components/ui';
import { AccountRelationshipReauthentication } from '@/components/AccountRelationshipReauthentication';
import { useLabelLifecycleContext } from '@/hooks/useLabelLifecycleContext';
import { getAuthSessionGeneration } from '@/store/authStore';
import { AccountRelationshipReviewJournal as Journal } from '@/services/accountRelationshipReviewJournal';
import { AccountRelationshipReviewService as Service, relationshipFailure } from '@/services/accountRelationshipReviewService';
import { productReviewEqual } from '@/services/productReviewService';
import { ACCOUNT_RELATIONSHIP_REVIEW_ENABLED } from '@/config/featureFlags';
import type { RelationshipReauthentication, RelationshipReceipt, RelationshipScope } from '@/types/accountRelationshipReview';
import { RELATIONSHIP_ORDER_LABELS, RELATIONSHIP_PAIR_LABELS } from '@/utils/accountRelationshipPresentation';
import { colors, spacing, typography } from '@/constants/theme';

export function AccountRelationshipJournal({uid, scope, renderReauthentication}: {uid: string; scope: RelationshipScope; renderReauthentication?: RelationshipReauthentication}) {
  const frame = useLabelLifecycleContext(`account-relationship-journal:${scope}`, uid), client = useQueryClient(), lock = useRef(false);
  const generation = getAuthSessionGeneration(), key = JSON.stringify([uid, generation, scope, frame.focusRevision]);
  const [busy, setBusy] = useState<string | null>(null), [authenticated, setAuthenticated] = useState<string | null>(null);
  const [notice, setNotice] = useState<{key: string; text: string} | null>(null), [receipt, setReceipt] = useState<{key: string; value: RelationshipReceipt} | null>(null);
  const journal = useQuery({queryKey: ['account-relationship-journal', uid, scope, generation, frame.focusRevision], enabled: frame.focused, staleTime: 0, gcTime: 0, retry: false,
    queryFn: () => {const op = frame.capture(); return Journal.read(uid, scope, () => frame.assertCurrent(op));}});
  const pending = frame.focused && journal.isSuccess && !journal.isFetching && !journal.isError ? journal.data : null;
  const attemptKey = JSON.stringify([key, pending?.requestId]), ownReceipt = receipt?.key === attemptKey && receipt.value.requestId === pending?.requestId ? receipt.value : null;
  const perform = async (mode: 'observe' | 'resume' | 'neutralize' | 'acknowledge') => {
    if (!pending || lock.current) return; let op; try {op = frame.start();} catch {return;} if (!op) return;
    lock.current = true; setBusy(attemptKey); setNotice(null);
    const current = () => frame.assertCurrent(op);
    const verifyNew = async () => {
      current(); if (!ACCOUNT_RELATIONSHIP_REVIEW_ENABLED) throw new Error('Les nouveaux actes restent fermés. Le reçu exact peut être relu et l’intention non engagée neutralisée.');
      if (scope === 'admin' && authenticated !== attemptKey) throw new Error('Confirmez votre identité opérateur avant de reprendre une intention non engagée.');
      const source = await Service.read(uid, scope, pending.command.context, pending.command.decisionReference, 'preview', null, current); current();
      if (source.source.qualification !== 'native_current' || !productReviewEqual({sourceHash: source.source.sourceHash, pairId: source.source.pairId, version: source.source.version}, pending.command.source) || (scope === 'admin' ? !source.canRecordReview || !source.accounts || !productReviewEqual(source.accounts.map(a => a.declaredAccountId).sort(), pending.command.partyMessages.map(m => m.userId).sort()) : !source.canContest)) throw relationshipFailure();
    };
    try {
      const result = mode === 'resume' ? await Journal.resume(pending, current, verifyNew) : await Journal[mode](pending, current); current();
      setReceipt({key: attemptKey, value: result});
      // A historical receipt owns only this SDK journal, never a newer form or private source.
      await client.invalidateQueries({queryKey: ['account-relationship-journal', uid, scope]}); current();
    } catch (error) {try {current(); setNotice({key: attemptKey, text: error instanceof Error ? error.message : 'Le même reçu doit être relu.'}); void journal.refetch();} catch { /* No stale callback. */ }}
    finally {frame.finish(op); lock.current = false; if (frame.isCurrent(op)) setBusy(null);}
  };
  return <View style={styles.section}>
    {journal.isError ? <Text accessibilityRole="alert" style={styles.caption}>Le journal propre doit être qualifié avant une nouvelle intention.</Text> : null}
    <Button variant="secondary" disabled={!frame.focused || !!busy} onPress={() => {try {frame.capture(); void journal.refetch();} catch { /* Inactive. */ }}}>Relire mon journal d’examen des comptes</Button>
    {pending ? <><Text accessibilityRole="header" style={styles.body}>Intention exacte conservée</Text>
      <Text selectable style={styles.caption}>{pending.requestId} · dossier {pending.command.context.supportRequestId} · version paire {pending.command.source.version}</Text>
      <Text style={styles.body}>{RELATIONSHIP_PAIR_LABELS[pending.command.pairAction]}. {RELATIONSHIP_ORDER_LABELS[pending.command.orderAction]}.</Text>
      {pending.command.context.orders.map(order => <Text selectable key={`${order.kind}/${order.id}`} style={styles.caption}>{order.kind === 'purchase' ? 'Achat' : 'Troc'} · {order.id}</Text>)}
      {pending.command.statement ? <Text selectable style={styles.body}>{pending.command.statement}</Text> : null}
      {pending.command.privateReason ? <Text selectable style={styles.body}>Motivation d’origine : {pending.command.privateReason}</Text> : null}
      {pending.command.partyMessages.map(m => <Text selectable key={m.userId} style={styles.body}>Message conservé à {m.userId} : {m.message}</Text>)}
      <Text style={styles.caption}>Vos propres reçus restent accessibles sans admission ou rôle actuel. Une reprise commence par leur relecture exacte ; seule une intention non engagée nécessite ensuite une qualification actuelle. Aucun reçu ne prouve une permission actuelle.</Text>
      <Button variant="secondary" disabled={!!busy} onPress={() => {void perform('observe');}}>Relire le reçu de cette intention</Button>
      {scope === 'admin' ? <AccountRelationshipReauthentication render={renderReauthentication} uid={uid} sourceKey={`relationship-resume:${attemptKey}`} parcel disabled={!!busy} onVerified={() => {try {frame.capture(); setAuthenticated(attemptKey);} catch { /* Old identity. */ }}}/> : null}
      <Button variant="secondary" disabled={!!busy} onPress={() => {void perform('resume');}}>Reprendre à l’identique après observation du reçu</Button>
      <Button variant="secondary" disabled={!!busy} onPress={() => {void perform('neutralize');}}>Neutraliser si l’intention n’est pas enregistrée</Button>
      {ownReceipt ? <Text style={styles.caption}>{ownReceipt.state === 'committed' ? 'Examen ou contestation historiquement enregistré ; effets actuels à qualifier séparément.' : ownReceipt.state === 'not_executed' ? `Intention non exécutée : ${ownReceipt.reason}.` : 'Aucun reçu natif enregistré. Le résultat reste inconnu.'}</Text> : null}
      {ownReceipt && ownReceipt.state !== 'unrecorded' ? <Button variant="secondary" disabled={!!busy} onPress={() => {void perform('acknowledge');}}>Relire le reçu frais et terminer ce suivi local</Button> : null}
    </> : null}
    {notice?.key === attemptKey ? <Text accessibilityRole="alert" style={styles.caption}>{notice.text}</Text> : null}
  </View>;
}
const styles = StyleSheet.create({section: {gap: spacing.sm, paddingVertical: spacing.sm}, body: {...typography.bodySmall, color: colors.foreground}, caption: {...typography.caption, color: colors.muted}});
