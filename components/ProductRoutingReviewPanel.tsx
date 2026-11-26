import { useCallback, useRef, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { FlashList } from '@shopify/flash-list';
import { useInfiniteQuery, useQuery, useQueryClient } from '@tanstack/react-query';
import { Button } from '@/components/ui';
import { ProductRoutingStatementSummary } from '@/components/ProductRoutingStatementSummary';
import { ProductParcelOperatorRoutes } from '@/components/ProductParcelOperatorRoutes';
import { ProductRoutingDecisionForm } from '@/components/ProductRoutingDecisionForm';
import { ProductRoutingReauthentication, type RoutingReauthentication } from '@/components/ProductRoutingReauthentication';
import { useLabelLifecycleContext } from '@/hooks/useLabelLifecycleContext';
import { PRODUCT_ROUTING_REVIEW_ENABLED } from '@/config/featureFlags';
import { ProductRoutingReviewService } from '@/services/productRoutingReviewService';
import { ProductRoutingReviewJournal } from '@/services/productRoutingReviewJournal';
import { productReviewEqual } from '@/services/productReviewService';
import type { ProductPhysicalDocumentaryAdmission } from '@/types/productPhysicalReview';
import type { ProductReviewScope } from '@/types/productReview';
import type { ProductRoutingHistory, ProductRoutingReceipt } from '@/types/productRoutingReview';
import { colors, spacing, typography } from '@/constants/theme';
import { APP_LOCALE } from '@/constants/locale';
type HistoryEntry = ProductRoutingHistory['entries'][number];
const entryId = (entry: HistoryEntry) => entry.qualification === 'unknown' ? entry.decisionId : entry.decision.decisionId;
const recordedAt = (v: string) => new Date(v).toLocaleString(APP_LOCALE, { timeZone: 'America/Toronto' });
export function ProductRoutingReviewPanel({ uid, transactionId, scope, nativeAdmission = null, renderReauthentication, assertSelection }: {
    uid: string;
    transactionId: string;
    scope: ProductReviewScope;
    nativeAdmission?: ProductPhysicalDocumentaryAdmission | null;
    renderReauthentication?: RoutingReauthentication;
    assertSelection?: () => void;
}) {
    const context = useLabelLifecycleContext(`product-routing-panel:${transactionId}:${scope}`, uid), client = useQueryClient(), interaction = useRef(0), lock = useRef(false);
    const [readRevision, setReadRevision] = useState(0), [authenticated, setAuthenticated] = useState<string | null>(null), [notice, setNotice] = useState<{
        key: string;
        text: string;
    } | null>(null), [receipt, setReceipt] = useState<{
        key: string;
        value: ProductRoutingReceipt;
    } | null>(null), [busy, setBusy] = useState<string | null>(null);
    const order = { kind: 'order' as const, id: transactionId }, key = JSON.stringify([uid, transactionId, scope, nativeAdmission?.key, context.focusRevision, readRevision]);
    const privateAdmission = !!nativeAdmission && nativeAdmission.uid === uid && nativeAdmission.scope === scope && nativeAdmission.context.kind === 'order' && nativeAdmission.context.id === transactionId && nativeAdmission.parcelCapability === 'product_review_parcel_v1';
    const allowed = context.focused && (scope === 'own' || privateAdmission && authenticated === key);
    const guardSelection = () => { context.capture(); assertSelection?.(); if (interaction.current !== readRevision)
        throw new Error('La sélection de lecture a changé.'); if (scope === 'admin') {
        if (!privateAdmission || !nativeAdmission)
            throw new Error('La lecture privée actuelle doit être qualifiée.');
        nativeAdmission.assertCurrent();
    } };
    const journal = useQuery({ queryKey: ['product-routing-journal', uid, transactionId, context.focusRevision], enabled: context.focused, staleTime: 0, gcTime: 0, retry: false, queryFn: () => { const op = context.capture(); return ProductRoutingReviewJournal.pending(uid, transactionId, () => context.assertCurrent(op)); } });
    const pending = context.focused && journal.isSuccess && !journal.isFetching && !journal.isError ? journal.data : null;
    const source = useQuery({ queryKey: ['product-routing-source', key], enabled: allowed, staleTime: 0, gcTime: 0, retry: false, structuralSharing: false, queryFn: () => { const op = context.capture(); return ProductRoutingReviewService.preview(uid, order, scope, () => { context.assertCurrent(op); guardSelection(); }); } });
    const raw = allowed && source.isSuccess && !source.isFetching && !source.isError ? source.data : null;
    const candidate = raw && (scope === 'own' || nativeAdmission && raw.sourceHash === nativeAdmission.sourceHash && raw.corpusHash === nativeAdmission.corpusHash) ? raw : null;
    const history = useInfiniteQuery({ queryKey: ['product-routing-history', key, candidate?.sourceHash, candidate?.corpusHash], enabled: !!candidate && allowed, staleTime: 0, gcTime: 0, retry: false, initialPageParam: null as {
            lastId: string;
        } | null,
        queryFn: async ({ pageParam }) => { const op = context.capture(), assertCurrent = () => { context.assertCurrent(op); guardSelection(); }; if (!candidate)
            throw new Error('Relisez les sources actuelles.'); const page = await ProductRoutingReviewService.history(uid, order, scope, pageParam, assertCurrent); assertCurrent(); const latest = await ProductRoutingReviewService.preview(uid, order, scope, assertCurrent); assertCurrent(); if (!productReviewEqual([latest.sourceHash, latest.semanticSourceHash, latest.corpusHash, latest.membersHash, latest.caseVersion], [candidate.sourceHash, candidate.semanticSourceHash, candidate.corpusHash, candidate.membersHash, candidate.caseVersion]))
            throw new Error('Les sources ont changé pendant la lecture de l’historique.'); return page; }, getNextPageParam: page => page.nextCursor ?? undefined });
    const current = candidate && !history.isError && !history.isFetching ? candidate : null;
    const rows = allowed && current && history.isSuccess && !history.isFetching && !history.isError ? history.data.pages.flatMap(page => page.entries) : [];
    const ids = rows.map(entryId), coherent = new Set(ids).size === ids.length && ids.every((id, i) => i === 0 || id > ids[i - 1]);
    const refresh = () => { try {
        context.capture();
        assertSelection?.();
        const next = ++interaction.current;
        setReadRevision(next);
        setAuthenticated(null);
        void journal.refetch();
    }
    catch { /* Inactive. */ } };
    const changed = () => { try {
        context.capture();
        void client.invalidateQueries({ queryKey: ['product-routing-journal', uid, transactionId] });
        void client.invalidateQueries({ queryKey: ['product-routing-source'] });
        void client.invalidateQueries({ queryKey: ['product-review-source'] });
    }
    catch { /* Old callback. */ } };
    const perform = async (mode: 'observe' | 'resume' | 'neutralize' | 'acknowledge') => {
        if (!pending || lock.current)
            return;
        let op;
        try {
            op = context.start();
        }
        catch {
            return;
        }
        if (!op)
            return;
        lock.current = true;
        setBusy(key);
        setNotice(null);
        let nativeFence: (() => void) | null = null;
        const assertCurrent = () => { context.assertCurrent(op); nativeFence?.(); };
        const verifyNew = async () => { if (!PRODUCT_ROUTING_REVIEW_ENABLED)
            throw new Error('Les nouvelles instructions restent en préparation. Le propre reçu peut être relu ou l’intention neutralisée.'); if (!privateAdmission || scope !== 'admin' || !nativeAdmission)
            throw new Error('La reprise non engagée demande une lecture opérateur actuelle du même corpus.'); nativeFence = () => { guardSelection(); nativeAdmission.assertCurrent(); }; assertCurrent(); await nativeAdmission.revalidate(); assertCurrent(); const fresh = await ProductRoutingReviewService.preview(uid, order, 'admin', assertCurrent); assertCurrent(); if (!productReviewEqual([fresh.sourceHash, fresh.semanticSourceHash, fresh.corpusHash, fresh.membersHash, fresh.caseVersion], [pending.command.sourceHash, pending.command.semanticSourceHash, pending.command.corpusHash, pending.command.membersHash, pending.command.caseVersion]))
            throw new Error('Les sources d’origine ont changé ; ne les remplacez pas dans cette même intention.'); };
        try {
            const value = mode === 'resume' ? await ProductRoutingReviewJournal.resume(pending, assertCurrent, verifyNew) : mode === 'neutralize' ? await ProductRoutingReviewJournal.neutralize(pending, assertCurrent) : mode === 'acknowledge' ? await ProductRoutingReviewJournal.acknowledge(pending, assertCurrent) : await ProductRoutingReviewJournal.observe(pending, assertCurrent);
            assertCurrent();
            setReceipt({ key, value });
            changed();
        }
        catch (error) {
            try {
                assertCurrent();
                setNotice({ key, text: error instanceof Error ? error.message : 'Le même reçu doit être relu.' });
                void journal.refetch();
            }
            catch { /* A changed selection cannot receive a new-intention callback. */ }
        }
        finally {
            context.finish(op);
            lock.current = false;
            try { assertCurrent(); setBusy(null); }
            catch { /* Own servicing remains independent until a NEW source fence is installed. */ }
        }
    };
    const ownReceipt = receipt?.key === key && receipt.value.requestId === pending?.requestId ? receipt.value : null;
    const renderItem = useCallback(({ item }: {
        item: HistoryEntry;
    }) => <View style={styles.section}>{item.qualification === 'unknown' ? <Text style={styles.caption}>Instruction historique non qualifiée ; aucune permission actuelle n’en est déduite.</Text> : <>
    <Text style={styles.body}>{item.decision.action === 'maintain_review' ? 'Maintien historique de la revue de routage' : 'Instruction historique de clôture de la seule revue de routage'} · {recordedAt(item.decision.recordedAt)}.</Text><Text selectable style={styles.body}>{item.decision.partyMessage}</Text>
    {item.decision.command ? <><Text selectable style={styles.body}>{item.decision.command.privateNote}</Text><Text style={styles.caption}>Limites examinées : {item.decision.command.evidenceLimitations}.</Text></> : null}
    <Text style={styles.caption}>Cette ligne conserve les sources d’origine ; elle ne qualifie ni la permission actuelle de transport ni un règlement financier ou une récupération physique.</Text>
  </>}</View>, []);
    return <View style={styles.section}><Text accessibilityRole="header" style={styles.title}>Acheminement et corrections rapportées</Text>
    <Text style={styles.caption}>Les déclarations, le contrat et la route native de l’étiquette sont distincts. L’examen du routage ne promet aucune interception et ne décide ni frais, fonds, modification de contrat/label ou récupération physique.</Text>
    {journal.isError ? <><Text accessibilityRole="alert" style={styles.caption}>Le journal privé doit être relu avant toute nouvelle instruction.</Text><Button variant="secondary" disabled={!context.focused} onPress={() => { try {
        context.capture();
        void journal.refetch();
    }
    catch { /* Inactive. */ } }}>Relire mon journal de routage</Button></> : null}
    {pending ? <View style={styles.section}><Text selectable style={styles.caption}>Intention conservée : {pending.requestId} · commande {pending.context.id}.</Text><Text selectable style={styles.body}>{pending.command.partyMessage}</Text>
      <Text style={styles.caption}>La même intention garde tous ses hash, son texte et son corpus d’origine. Les anciens propres reçus se relisent avant toute admission ou rôle actuel.</Text>
      <Button variant="secondary" disabled={busy === key} onPress={() => { void perform('observe'); }}>Relire exactement cette instruction</Button>
      <ProductRoutingReauthentication render={renderReauthentication} uid={uid} sourceKey={`product-routing-resume:${key}:${pending.requestId}`} disabled={busy === key} parcel onVerified={() => { try {
                context.capture();
            }
            catch { /* Old verification. */ } } } />
      <Button variant="secondary" disabled={busy === key} onPress={() => { void perform('resume'); }}>Reprendre la même intention et ses sources</Button>
      <Button variant="secondary" disabled={busy === key} onPress={() => { void perform('neutralize'); }}>Neutraliser l’intention non engagée</Button>
      {ownReceipt ? <Text style={styles.caption}>{ownReceipt.state === 'committed' ? 'Instruction enregistrée pour ses seules sources historiques ; aucune autorisation globale n’en est déduite.' : ownReceipt.state === 'not_executed' ? `Instruction non exécutée : ${ownReceipt.reason}.` : 'Aucun reçu natif enregistré ; le résultat reste inconnu.'}</Text> : null}
      {ownReceipt && ownReceipt.state !== 'unrecorded' ? <Button variant="secondary" disabled={busy === key} onPress={() => { void perform('acknowledge'); }}>Relire le reçu frais et terminer le suivi local</Button> : null}
    </View> : null}
    {scope === 'admin' ? <ProductRoutingReauthentication render={renderReauthentication} uid={uid} sourceKey={`product-routing-reader:${key}`} disabled={!privateAdmission || !context.focused || source.isFetching} parcel onVerified={() => { try {
            guardSelection();
            setAuthenticated(key);
        }
        catch { /* Old verification. */ } } } /> : null}
    {current ? <>
      <Text style={styles.body}>{current.guardQualification === 'native_current_routing_signals' ? 'Les observations requérant une revue sont rattachées au dossier natif courant.' : 'La garde courante de routage reste inconnue ou aucune observation nécessitant une revue n’est qualifiée.'}</Text>
      {current.observations.map(observation => <View key={observation.contributionId} style={styles.section}><Text selectable style={styles.caption}>Constat natif {observation.contributionId}.</Text><ProductRoutingStatementSummary statement={observation.statement}/></View>)}
      {!current.observations.length ? <Text style={styles.caption}>Aucun constat de routage qualifié n’est visible dans cette portée. Cette lecture ne certifie pas un trajet physique ou un historique exhaustif.</Text> : null}
      {current.nativeRoutes ? <ProductParcelOperatorRoutes routes={current.nativeRoutes}/> : null}
      <Text style={styles.body}>{current.currentDecision.qualification === 'native_current_decision' ? 'Instruction de routage qualifiée pour les sources courantes.' : current.currentDecision.qualification === 'historical_sources_changed' ? 'Instruction historique : les sources, le corpus ou l’habilitation ont changé.' : current.currentDecision.qualification === 'unrecorded' ? 'Aucune instruction de routage native enregistrée.' : 'Applicabilité de l’instruction inconnue.'}</Text>
      {current.currentDecision.decision ? <Text selectable style={styles.body}>{current.currentDecision.decision.partyMessage}</Text> : null}
      <Text style={styles.caption}>{current.releaseAllowedByRoutingOnly ? 'La seule garde de routage ne retient pas actuellement la progression. Toutes les autres gardes et autorisations restent à qualifier.' : 'Cette lecture n’établit pas une levée de la seule garde de routage.'} Aucun contrat, label, frais, stock ou paiement n’est modifié par cet affichage.</Text>
      {scope === 'admin' && nativeAdmission ? <ProductRoutingDecisionForm uid={uid} preview={current} nativeAdmission={nativeAdmission} assertSelection={guardSelection} disabled={!journal.isSuccess || journal.isFetching || journal.isError || !!pending || busy === key} renderReauthentication={renderReauthentication} onRecorded={changed}/> : null}
      <Text accessibilityRole="header" style={styles.title}>Historique distinct de l’état courant</Text>
      {coherent && rows.length ? <View style={styles.viewport}><FlashList data={rows} keyExtractor={entryId} renderItem={renderItem} nestedScrollEnabled/></View> : null}
      {history.isError || !coherent ? <Text style={styles.caption}>L’historique ou sa source actuelle doivent être relus ; les anciennes lignes sont masquées.</Text> : history.isFetching ? <Text style={styles.caption}>Lecture native de l’historique…</Text> : !rows.length ? <Text style={styles.caption}>Aucune instruction qualifiée visible dans ces pages. L’historique n’est pas certifié exhaustif.</Text> : null}
      {coherent && history.hasNextPage && !history.isError ? <Button variant="secondary" disabled={history.isFetching} onPress={() => { try {
            guardSelection();
            void history.fetchNextPage();
        }
        catch { /* Old selection. */ } }}>Lire les instructions suivantes</Button> : null}
    </> : source.isError || raw && !current ? <Text accessibilityRole="alert" style={styles.caption}>La lecture privée et le corpus courant ne concordent pas. Les nouvelles instructions sont masquées ; les propres reçus restent accessibles.</Text> : <Text style={styles.caption}>Le dossier privé de routage reste à qualifier.</Text>}
    <Button variant="secondary" disabled={!context.focused || busy === key} onPress={refresh}>Relire explicitement les sources de routage</Button>
    {notice?.key === key ? <Text accessibilityRole="alert" style={styles.caption}>{notice.text}</Text> : null}
  </View>;
}
const styles = StyleSheet.create({ section: { gap: spacing.sm, paddingVertical: spacing.sm }, title: { ...typography.body, color: colors.foreground }, body: { ...typography.bodySmall, color: colors.foreground }, caption: { ...typography.caption, color: colors.muted }, viewport: { height: spacing['4xl'] * 6 } });
