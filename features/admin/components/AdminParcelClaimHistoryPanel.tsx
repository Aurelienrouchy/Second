import { useCallback, useRef, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { FlashList } from '@shopify/flash-list';
import { useInfiniteQuery } from '@tanstack/react-query';
import { Button } from '@/components/ui';
import { colors, spacing, typography } from '@/constants/theme';
import { useLabelLifecycleContext } from '@/hooks/useLabelLifecycleContext';
import { ParcelClaimHistoryService, compareParcelClaimIds, parcelClaimHistoryError } from '@/services/parcelClaimHistoryService';
import { productReviewEqual } from '@/services/productReviewService';
import type { ParcelClaimHistoryEntry, ParcelClaimHistoryReference } from '@/types/parcelClaimHistory';
import { AdminFinancialReauthentication } from './AdminFinancialReauthentication';
import { AdminParcelClaimHistoryRow } from './AdminParcelClaimHistoryRow';
const keyExtractor = (entry: ParcelClaimHistoryEntry) => entry.disputeId;
type PageParam = {
    cursor: {
        lastId: string;
    } | null;
    expectedSource: ParcelClaimHistoryReference | null;
};
export function AdminParcelClaimHistoryPanel({ uid, transactionId, disputeId, selectionKey, assertSelection, enabled }: {
    uid: string;
    transactionId: string;
    disputeId: string;
    selectionKey: string;
    assertSelection: () => void;
    enabled: boolean;
}) {
    const context = useLabelLifecycleContext(`parcel-claim-history:${selectionKey}`, uid), interaction = useRef(0);
    const [revision, setRevision] = useState(0), [authenticated, setAuthenticated] = useState<string | null>(null);
    const key = JSON.stringify([uid, transactionId, disputeId, selectionKey, revision, context.focusRevision]);
    const allowed = enabled && context.focused && authenticated === key;
    const history = useInfiniteQuery({ queryKey: ['admin-parcel-claim-history', key], enabled: allowed, staleTime: 0, gcTime: 0, retry: false, structuralSharing: false,
        initialPageParam: { cursor: null, expectedSource: null } as PageParam,
        queryFn: ({ pageParam }) => { const op = context.capture(); const assertCurrent = () => { context.assertCurrent(op); assertSelection(); if (interaction.current !== revision)
            throw new Error('Le choix ou la lecture ont changé.'); }; assertCurrent(); return ParcelClaimHistoryService.read(uid, transactionId, disputeId, pageParam.cursor, pageParam.expectedSource, assertCurrent); },
        getNextPageParam: page => page.nextCursor ? { cursor: page.nextCursor, expectedSource: { transactionId: page.source.transactionId, disputeId: page.source.disputeId, sourceHash: page.source.sourceHash } } : undefined });
    const ready = allowed && history.isSuccess && !history.isFetching && !history.isError, pages = ready ? history.data.pages : [], source = pages[0]?.source, origin = pages[0]?.selectedOrigin;
    const entries = pages.flatMap(page => page.entries), coherent = !!source && pages.every(page => productReviewEqual(page.source, source) && productReviewEqual(page.selectedOrigin, origin)) && entries.every((entry, index) => index === 0 || compareParcelClaimIds(entry.disputeId, entries[index - 1].disputeId) > 0);
    const reset = () => { try {
        context.capture();
        assertSelection();
        const next = ++interaction.current;
        setRevision(next);
        setAuthenticated(null);
    }
    catch { /* Old selection. */ } };
    const renderItem = useCallback(({ item }: {
        item: ParcelClaimHistoryEntry;
    }) => <AdminParcelClaimHistoryRow entry={item}/>, []);
    const failure = parcelClaimHistoryError(history.error);
    return <View style={styles.section}>
    <Text accessibilityRole="header" style={styles.title}>Historique contextualisé des non-réceptions déclarées</Text>
    <Text selectable style={styles.caption}>Dossier sélectionné {disputeId} · commande {transactionId}.</Text>
    <Text style={styles.body}>Cette lecture compare des déclarations et leurs suites documentées. Une répétition ne prouve aucune fraude et n’autorise ni refus, sanction, remboursement ou remise en vente.</Text>
    <AdminFinancialReauthentication key={key} uid={uid} sourceKey={`parcel-claim-history-reader:${key}`} purpose="commercial" parcel disabled={!enabled || !context.focused || history.isFetching} onVerified={() => { try {
        context.capture();
        assertSelection();
        if (interaction.current === revision)
            setAuthenticated(key);
    }
    catch { /* Old identity or selection. */ } }}/>
    {history.isError ? <Text accessibilityRole="alert" style={styles.caption}>{failure === 'source_changed' ? 'Le dossier sélectionné a changé. Toutes les anciennes pages sont masquées ; recommencez depuis sa source actuelle.' : failure === 'not_exposed' ? 'Cette consultation privée reste en préparation. Aucune donnée comparative n’est admise.' : 'Le rôle, la session ou le contexte privé ne peuvent plus être qualifiés. Toutes les anciennes pages sont masquées.'}</Text> : null}
    {ready && coherent ? <>
      <Text style={styles.caption}>Lecture limitée aux documents associés par leur champ acheteur natif. Les anciens dossiers sans ce champ restent inconnus. Le total des plaintes est inconnu et aucune exhaustivité n’est établie.</Text>
      <Text style={styles.caption}>L’origine du dossier sélectionné est {origin ? 'rattachée à un reçu natif' : 'inconnue'}. Les reprises ne sont pas comptées comme des plaintes distinctes.</Text>
      {entries.length ? <View style={styles.viewport}><FlashList data={entries} keyExtractor={keyExtractor} renderItem={renderItem} nestedScrollEnabled/></View> : <Text style={styles.caption}>Aucune ligne visible dans les pages inspectées. Des documents peuvent avoir été filtrés ; cette absence ne démontre aucun historique vierge.</Text>}
      {history.hasNextPage ? <Button variant="secondary" disabled={history.isFetching} onPress={() => { try {
            context.capture();
            assertSelection();
            if (interaction.current !== revision)
                return;
            void history.fetchNextPage();
        }
        catch { /* Old selection. */ } }}>Poursuivre les documents suivants, même après une page vide</Button> : <Text style={styles.caption}>Fin de cette requête limitée ; les historiques non associés restent inconnus.</Text>}
    </> : ready ? <Text accessibilityRole="alert" style={styles.caption}>Les pages ne concordent plus avec la même source sélectionnée. Recommencez la lecture pour ne pas mélanger les contextes.</Text> : history.isFetching ? <Text style={styles.caption}>Lecture privée des sources natives…</Text> : null}
    <Button variant="secondary" disabled={!enabled || !context.focused} onPress={reset}>Recommencer depuis la source actuelle</Button>
  </View>;
}
const styles = StyleSheet.create({ section: { gap: spacing.sm, paddingVertical: spacing.md }, title: { ...typography.body, color: colors.foreground }, body: { ...typography.bodySmall, color: colors.foreground }, caption: { ...typography.caption, color: colors.muted }, viewport: { height: spacing['4xl'] * 7 } });
