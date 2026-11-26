import { useLayoutEffect, useRef, useState } from 'react';
import { Alert, StyleSheet, Text, TextInput, View } from 'react-native';
import { useInfiniteQuery, useQuery } from '@tanstack/react-query';
import { randomUUID } from 'expo-crypto';
import { Button, Checkbox } from '@/components/ui';
import { colors, spacing, typography } from '@/constants/theme';
import { useLabelLifecycleContext } from '@/hooks/useLabelLifecycleContext';
import { useShippingPurchaseContext } from '@/hooks/useShippingPurchaseContext';
import { getAuthSessionGeneration } from '@/store/authStore';
import { PurchaseRefundService, hashPurchaseRefund } from '@/services/purchaseRefundService';
import { PurchaseRefundAgreementJournal } from '@/services/purchaseRefundAgreementJournal';
import { purchaseRefundEqual, purchaseRefundIso } from '@/utils/purchaseRefundContract';
import type { PurchaseRefundAgreementAttempt, PurchaseRefundAgreementCommand, PurchaseRefundTerms } from '@/types/purchaseRefund';
import { PurchaseRefundTermsForm } from './PurchaseRefundTermsForm';
import { PurchaseRefundTermsSummary } from './PurchaseRefundTermsSummary';
const refusal: Record<string, string> = {requester_neutralized: 'Cette intention a été neutralisée avant engagement.', purchase_refund_not_exposed: 'Ce parcours reste fermé ; cette intention n’a pas été engagée.', not_a_native_participant: 'Le compte ne peut pas être qualifié comme partie de cette commande.', native_sources_unknown: 'Les montants et les sources doivent être rapprochés.', source_changed: 'Les sources ont changé ; une nouvelle lecture est nécessaire.', agreement_or_expiration_changed: 'La proposition ou son expiration a changé.', agreement_or_sources_changed: 'La proposition, sa version ou ses sources a changé.', agreement_version_unknown: 'La version de la proposition doit être rapprochée.', participant_session_unavailable: 'La session actuelle ne permet pas cette nouvelle action. Le reçu de votre intention reste consultable.', participant_security_restricted: 'Cette nouvelle action est suspendue par les restrictions actuelles du compte. Le suivi de votre intention reste accessible.'};
export function PurchaseRefundAgreementPanel({uid, transactionId, evidenceReferences = []}: {uid: string; transactionId: string; evidenceReferences?: {evidenceId: string; contentHash: string}[]}) {
  const own = useShippingPurchaseContext(`purchase-refund-own:${transactionId}`, uid), fresh = useLabelLifecycleContext(`purchase-refund-source:${transactionId}`, uid);
  const ownKey = JSON.stringify([uid, getAuthSessionGeneration(), transactionId, own.focusRevision]), key = JSON.stringify([ownKey, fresh.focusRevision]);
  const [prepared, setPrepared] = useState<{key: string; terms: PurchaseRefundTerms} | null>(null), [expiration, setExpiration] = useState<{key: string; kind: 'none' | 'exact'; value: string} | null>(null);
  const [intent, setIntent] = useState<{key: string; command: PurchaseRefundAgreementCommand; accepted: boolean} | null>(null), [busy, setBusy] = useState<string | null>(null);
  const [notice, setNotice] = useState<{key: string; text: string} | null>(null), lock = useRef<symbol | null>(null);
  const interactions = useRef(0);
  const [invalidated, setInvalidated] = useState<string | null>(null);
  const journal = useQuery({queryKey: ['purchase-refund-own-journal', ownKey], enabled: own.focused, staleTime: 0, gcTime: 0, retry: false,
    queryFn: () => {const op = own.capture(); return PurchaseRefundAgreementJournal.read(uid, transactionId, () => own.assertCurrent(op));}});
  const ownReady = own.focused && journal.isSuccess && !journal.isFetching && !journal.isError;
  const pending = ownReady ? journal.data.attempt : null, receipt = ownReady ? journal.data.receipt : null;
  const sourceQuery = useQuery({queryKey: ['purchase-refund-own-source', key], enabled: fresh.focused, staleTime: 0, gcTime: 0, retry: false, structuralSharing: false,
    queryFn: () => {const op = fresh.capture(); return PurchaseRefundService.source(uid, transactionId, () => fresh.assertCurrent(op));}});
  const source = invalidated !== key && fresh.focused && sourceQuery.isSuccess && !sourceQuery.isFetching && !sourceQuery.isError ? sourceQuery.data : null;
  const sourceKey = JSON.stringify([key, source?.sourceHash, source?.sourceRevision, source?.agreement?.contentHash, sourceQuery.dataUpdatedAt]);
  const business = useRef<string | null>(null); useLayoutEffect(() => {business.current = sourceKey; return () => {business.current = null;};}, [sourceKey]);
  const allowed = !!source && source.qualification === 'native_initial_and_cumulative' && !!source.sourceRevision && ownReady && !pending;
  const terms = prepared?.key === sourceKey ? prepared.terms : null, expires = expiration?.key === sourceKey ? expiration : null, currentIntent = source && intent?.key === sourceKey ? intent : null;
  const history = useInfiniteQuery({queryKey: ['purchase-refund-own-agreements', sourceKey], enabled: !!source && fresh.focused, staleTime: 0, gcTime: 0, retry: false, initialPageParam: null as {lastId: string} | null,
    queryFn: async ({pageParam}) => {const op = fresh.capture(); const page = await PurchaseRefundService.page(uid, transactionId, pageParam, () => fresh.assertCurrent(op)); fresh.assertCurrent(op); if (!source || page.sourceHash !== source.sourceHash || page.sourceRevision !== source.sourceRevision || page.basisHash !== source.basisHash || page.cumulativeHash !== source.cumulativeHash) throw new Error('Les sources de cet historique ont changé.'); return page;}, getNextPageParam: page => page.nextCursor ?? undefined});
  const entries = source && history.isSuccess && !history.isFetching && !history.isError ? history.data.pages.flatMap(p => p.entries) : [];
  const unique = new Set(entries.map(e => e.id)).size === entries.length;
  const onPrepared = (value: PurchaseRefundTerms | null) => {if (business.current !== sourceKey) return; if (value) {try {fresh.capture();} catch {return;}} interactions.current++; setPrepared(old => value ? {key: sourceKey, terms: value} : old?.key === sourceKey ? null : old); setIntent(old => old?.key === sourceKey ? null : old);};
  const prepare = async (action: PurchaseRefundAgreementCommand['action']) => {
    if (!allowed || !source?.sourceHash || !source.sourceRevision || action === 'propose' && (!terms || !expires)) return;
    let op; try {op = fresh.capture();} catch {return;}
    const interaction = ++interactions.current;
    const assertCurrent = () => {fresh.assertCurrent(op); if (business.current !== sourceKey || interactions.current !== interaction) throw new Error('Votre choix a changé. Examinez à nouveau les termes visibles.');};
    setIntent(null);
    try {const agreement = source.agreement;
      if (action !== 'propose' && (!agreement?.sourceCurrentlyMatches || agreement.expired || agreement.state !== 'proposed')) throw new Error('Relisez la proposition actuelle avant une réponse.');
      if (action === 'propose' && expires?.kind === 'exact' && !purchaseRefundIso(expires.value)) throw new Error('L’expiration exige un instant complet ISO avec heure et fuseau UTC, ou un choix explicite sans expiration.');
      const command: PurchaseRefundAgreementCommand = {transactionId, action, sourceHash: source.sourceHash, sourceRevision: source.sourceRevision, agreementId: action === 'propose' ? null : agreement!.agreementId,
        expectedVersion: action === 'propose' ? 0 : agreement!.version, termsHash: action === 'propose' ? await hashPurchaseRefund(terms) : agreement!.termsHash, terms: action === 'propose' ? terms : null, expiresAt: action === 'propose' && expires?.kind === 'exact' ? expires.value : null, acknowledged: true};
      assertCurrent(); setIntent({key: sourceKey, command, accepted: false}); setNotice(null);
    } catch (e) {if (fresh.isCurrent(op) && business.current === sourceKey && interactions.current === interaction) setNotice({key: ownKey, text: e instanceof Error ? e.message : 'Les termes doivent être relus.'});}
  };
  const run = async (action: 'execute' | 'observe' | 'neutralize' | 'acknowledge') => {
    if (!ownReady || lock.current || action === 'execute' && (!currentIntent?.accepted || !source || source.qualification !== 'native_initial_and_cumulative')) return;
    let sourceOp: ReturnType<typeof fresh.start> = null, ownOp: ReturnType<typeof own.start> = null;
    try {if (action === 'execute') sourceOp = fresh.start(); else ownOp = own.start();} catch {return;} if (!sourceOp && !ownOp) return;
    const interaction = interactions.current;
    const assertCurrent = () => {if (sourceOp) {fresh.assertCurrent(sourceOp); if (business.current !== sourceKey || interactions.current !== interaction) throw new Error('La lecture ou votre choix actuel a changé.');} if (ownOp) own.assertCurrent(ownOp);};
    const current = () => {try {assertCurrent(); return true;} catch {return false;}};
    const token = Symbol(); lock.current = token; setBusy(ownKey); setNotice(null);
    try {
      let a = pending;
      if (action === 'execute') {
        const reread = await PurchaseRefundService.source(uid, transactionId, assertCurrent); assertCurrent();
        if (reread.sourceHash !== source!.sourceHash || reread.sourceRevision !== source!.sourceRevision || !purchaseRefundEqual(reread.agreement, source!.agreement)) throw new Error('Les sources ou la proposition ont changé.');
        if (a && !purchaseRefundEqual(a.command, currentIntent!.command)) throw new Error('Une intention d’origine différente reste conservée.');
        a ??= {version: 1, uid, requestId: randomUUID(), command: currentIntent!.command};
        await PurchaseRefundAgreementJournal.execute(a, assertCurrent); assertCurrent(); setIntent(null);
      } else if (action === 'neutralize') {if (!a) throw new Error('Intention propre requise.'); await PurchaseRefundAgreementJournal.neutralize(a, assertCurrent); assertCurrent();}
      else if (action === 'acknowledge') {if (!a) throw new Error('Intention propre requise.'); await PurchaseRefundAgreementJournal.acknowledge(a, assertCurrent); assertCurrent();}
      await journal.refetch(); assertCurrent();
      if (action === 'execute' || action === 'acknowledge') {if (action === 'execute') setInvalidated(key); setPrepared(null); setExpiration(null); setNotice({key: ownKey, text: 'Le reçu propre a été relu. Relisez explicitement les termes actuels ; aucun remboursement n’est confirmé par cet accord.'});}
    } catch (e) {if (current()) {if (action === 'execute') setInvalidated(key); setNotice({key: ownKey, text: `${e instanceof Error ? e.message : 'Résultat inconnu.'} La même intention et ses termes restent conservés ; relisez son reçu.`}); void journal.refetch();} else if (action === 'execute') {try {own.capture(); void journal.refetch();} catch { /* A staged intention remains recoverable by its SDK owner. */ }}}
    finally {if (sourceOp) fresh.finish(sourceOp); if (ownOp) own.finish(ownOp); if (lock.current === token) {lock.current = null; setBusy(null);}}
  };
  const refreshSource = async () => {let op; try {op = fresh.capture(); interactions.current++; setIntent(null); setPrepared(null); setExpiration(null); const read = await sourceQuery.refetch(); fresh.assertCurrent(op); if (read.isSuccess) setInvalidated(null);} catch { /* A prior activity epoch cannot reopen private sources. */ }};
  const agreement = source?.agreement;
  return <View style={styles.section}>
    <Text accessibilityRole="header" style={styles.title}>Proposition et accord de remboursement</Text><Text style={styles.caption}>L’acheteur et le vendeur acceptent chacun les mêmes termes dans l’application. Proposer, accepter ou montrer une preuve externe ne transfère aucun argent.</Text>
    <Button variant="secondary" disabled={!fresh.focused || sourceQuery.isFetching} onPress={() => {void refreshSource();}}>Relire les montants et l’accord actuels</Button>
    {sourceQuery.isError ? <Text accessibilityRole="alert" style={styles.caption}>Les sources actuelles ne sont pas accessibles. Le suivi SDK de votre intention reste disponible ci-dessous.</Text> : null}
    {source ? <><PurchaseRefundTermsSummary source={source} />
      {source.qualification === 'unknown' ? <Text accessibilityRole="alert" style={styles.caption}>Les montants initiaux ou cumulatifs sont inconnus : aucune nouvelle proposition ou acceptation n’est disponible.</Text> : null}
      {agreement ? <><Text style={styles.body}>Proposition {agreement.agreementId}, version {agreement.version} · {agreement.state}.</Text><PurchaseRefundTermsSummary source={source} terms={agreement.terms} />
        <Text style={styles.caption}>Expiration : {agreement.expiresAt ?? 'aucune expiration déclarée'}. {agreement.expired ? 'Expiration constatée dans cette lecture.' : ''} Acheteur : {agreement.buyerAcceptedRecorded ? 'acceptation enregistrée' : 'acceptation non enregistrée'} · vendeur : {agreement.sellerAcceptedRecorded ? 'acceptation enregistrée' : 'acceptation non enregistrée'}.</Text>
        <Text style={styles.caption}>{source.bilateralAgreementVerified ? 'Deux acceptations natives actuelles sont qualifiées. Le règlement financier exige encore sa décision distincte.' : 'Aucun accord bilatéral actuel qualifié dans cette lecture. Une preuve externe ou une seule acceptation ne le remplace pas.'}</Text>
        {allowed && agreement.sourceCurrentlyMatches && !agreement.expired ? <>
          <Button variant="secondary" onPress={() => {void prepare('accept');}}>Examiner mon acceptation de ces termes exacts</Button>
          <Button variant="secondary" onPress={() => {void prepare('refuse');}}>Examiner mon refus de cette proposition</Button>
          <Button variant="secondary" onPress={() => {void prepare('withdraw');}}>Examiner le retrait de cette proposition</Button>
        </> : null}</> : null}
      {allowed ? <><PurchaseRefundTermsForm source={source} sourceKey={sourceKey} enabled={allowed} evidenceReferences={evidenceReferences} assertCurrent={() => {fresh.capture();}} onPrepared={onPrepared} />
        <Text style={styles.caption}>Expiration de cette nouvelle proposition, distincte de sa date de paiement déclarée</Text>{(['none', 'exact'] as const).map(kind => <Button key={kind} variant={expires?.kind === kind ? 'primary' : 'secondary'} onPress={() => {try {fresh.capture(); interactions.current++; setExpiration({key: sourceKey, kind, value: ''}); setIntent(null);} catch { /* Old activity grants no expiration choice. */ }}}>{kind === 'none' ? 'Sans expiration déclarée' : 'Instant d’expiration complet connu'}</Button>)}
        {expires?.kind === 'exact' ? <TextInput accessibilityLabel="Instant d’expiration ISO UTC complet" style={styles.input} placeholder="AAAA-MM-JJTHH:mm:ss.sssZ" placeholderTextColor={colors.muted} value={expires.value} onChangeText={value => {try {fresh.capture(); interactions.current++; setExpiration(old => old?.key === sourceKey && old.kind === 'exact' ? {...old, value} : old); setIntent(null);} catch { /* No date is inferred. */ }}} /> : null}
        <Button disabled={!terms || !expires} onPress={() => {void prepare('propose');}}>Examiner ma nouvelle proposition</Button></> : null}
      {unique ? entries.map(e => <View key={e.id} style={styles.section}>{e.view ? <><Text style={styles.caption}>Historique : {e.id}, version {e.view.version}, {e.view.state}. Cet historique ne vaut pas permission actuelle ni règlement.</Text><PurchaseRefundTermsSummary terms={e.view.terms} /></> : <Text style={styles.caption}>L’accord {e.id} a été inspecté, mais sa vue est inconnue.</Text>}</View>) : <Text accessibilityRole="alert" style={styles.caption}>L’historique comporte une référence répétée ; sa lecture doit être reprise.</Text>}
      {history.hasNextPage ? <Button variant="secondary" onPress={() => {try {fresh.capture(); void history.fetchNextPage();} catch { /* Private history remains activity-bound. */ }}}>Lire les accords suivants</Button> : null}</> : null}
    {currentIntent ? <><Text style={styles.body}>Action préparée : {currentIntent.command.action}. Proposition {currentIntent.command.agreementId ?? 'nouvelle'} · version {currentIntent.command.expectedVersion}.</Text>
      <PurchaseRefundTermsSummary source={source} terms={currentIntent.command.terms ?? agreement?.terms ?? null} />
      <Checkbox checked={currentIntent.accepted} disabled={busy === ownKey} onToggle={() => {try {fresh.capture(); interactions.current++; setIntent(old => old?.key === sourceKey && purchaseRefundEqual(old.command, currentIntent.command) ? {...old, accepted: !old.accepted} : old);} catch { /* An old admission grants no consent. */ }}}><Text style={styles.caption}>Je confirme explicitement cette seule action pour cette commande, cette version et ces termes exacts. Aucun paiement, retour physique ou délai bancaire n’est confirmé.</Text></Checkbox>
      <Button disabled={!currentIntent.accepted || busy === ownKey} onPress={() => {void run('execute');}}>Enregistrer cette seule action d’accord</Button></> : null}
    <Text style={styles.title}>Mon intention conservée et son reçu</Text>
    <Button variant="secondary" disabled={!own.focused || journal.isFetching || busy === ownKey} onPress={() => {try {own.capture(); void journal.refetch();} catch { /* Only the same SDK identity reads its journal. */ }}}>Relire mon suivi SDK propre</Button>
    {journal.isError ? <Text accessibilityRole="alert" style={styles.caption}>Le journal propre ne peut pas être qualifié. Aucune nouvelle intention n’est permise.</Text> : null}
    {pending ? <><Text selectable style={styles.caption}>Intention {pending.requestId} · action {pending.command.action} · commande {pending.command.transactionId}. Les termes et références d’origine sont immuables.</Text>
      {receipt ? <Text style={styles.body}>{receipt.state === 'committed' ? 'Cette seule action d’accord est historiquement enregistrée. Aucun mouvement d’argent n’est attesté par ce reçu.' : receipt.state === 'not_executed' ? refusal[receipt.reason ?? ''] ?? 'La non-exécution de cette intention est enregistrée.' : 'Aucun reçu natif enregistré ; cela ne prouve pas une non-exécution.'}</Text> : null}
      {receipt?.state === 'unrecorded' ? <>{source?.sourceHash === pending.command.sourceHash && source.sourceRevision === pending.command.sourceRevision ? <Button variant="secondary" onPress={() => {try {fresh.capture(); interactions.current++; setIntent({key: sourceKey, command: pending.command, accepted: false});} catch { /* Same tuple requires a new active confirmation. */ }}}>Réexaminer mon intention d’origine à l’identique</Button> : null}
        <Button variant="secondary" disabled={busy === ownKey} onPress={() => Alert.alert('Neutraliser cette intention', 'Une action déjà engagée conserve son vrai reçu. Cette neutralisation bloque seulement les effets non engagés de la même référence ; elle ne retire pas un accord déjà enregistré.', [{text: 'Conserver', style: 'cancel'}, {text: 'Neutraliser', onPress: () => {void run('neutralize');}}])}>Neutraliser mon intention non engagée</Button></> : receipt ? <Button variant="secondary" disabled={busy === ownKey} onPress={() => {void run('acknowledge');}}>Relire le reçu puis terminer ce suivi local</Button> : null}</> : null}
    {notice?.key === ownKey ? <Text accessibilityRole="alert" style={styles.caption}>{notice.text}</Text> : null}
  </View>;
}
const styles = StyleSheet.create({section: {gap: spacing.sm, paddingVertical: spacing.md}, title: {...typography.body, color: colors.foreground}, body: {...typography.bodySmall, color: colors.foreground}, caption: {...typography.caption, color: colors.muted}, input: {...typography.bodySmall, color: colors.foreground, borderWidth: 1, borderColor: colors.border, padding: spacing.md}});
