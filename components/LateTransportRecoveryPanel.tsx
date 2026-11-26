import { type ReactNode, useCallback, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { FlashList } from '@shopify/flash-list';
import { useInfiniteQuery, useQuery } from '@tanstack/react-query';
import { randomUUID } from 'expo-crypto';
import { Button } from '@/components/ui';
import { LateTransportRecoveryStatement } from '@/components/LateTransportRecoveryStatement';
import { ProductReviewCasePanel } from '@/components/ProductReviewCasePanel';
import { useLabelLifecycleContext } from '@/hooks/useLabelLifecycleContext';
import { LateTransportRecoveryService } from '@/services/lateTransportRecoveryService';
import { LateTransportRecoveryJournal } from '@/services/lateTransportRecoveryJournal';
import { productReviewEqual } from '@/services/productReviewService';
import { colors, spacing, typography } from '@/constants/theme';
import { APP_LOCALE } from '@/constants/locale';
import type { LateTransportScope } from '@/types/lateTransportIncident';
import type { RecoveryHistoryEntry, RecoverySource } from '@/types/lateTransportRecovery';
import type { ProductPhysicalDocumentaryAdmission } from '@/types/productPhysicalReview';
const rowKey = (r: RecoveryHistoryEntry) => r.entryId;
const date = (v: string) => new Date(v).toLocaleString(APP_LOCALE, { timeZone: 'America/Toronto' });
export interface RecoveryPanelProps {
    uid: string;
    transactionId: string;
    incidentId: string;
    scope: LateTransportScope;
    assertSelection?: () => void;
    renderReauthentication?: (props: {
        uid: string;
        sourceKey: string;
        disabled: boolean;
        onVerified: () => void;
        parcel?: boolean;
    }) => ReactNode;
    renderDecision?: (props: {
        uid: string;
        source: RecoverySource;
        nativeAdmission: ProductPhysicalDocumentaryAdmission | null;
        assertSelection?: () => void;
        disabled: boolean;
        onRecorded: () => void;
    }) => ReactNode;
}
export function LateTransportRecoveryPanel({ uid, transactionId, incidentId, scope, renderReauthentication, renderDecision, assertSelection }: RecoveryPanelProps) {
    const context = useLabelLifecycleContext(`recovery-source:${scope}:${transactionId}:${incidentId}`, uid), [instance] = useState(() => randomUUID());
    const key = JSON.stringify([uid, transactionId, incidentId, scope, context.focusRevision, instance]), [authenticated, setAuthenticated] = useState<string | null>(null);
    const allowed = context.focused && (scope === 'owner' || authenticated === key);
    const journal = useQuery({ queryKey: ['late-transport-recovery', uid, 'journal', scope, context.focusRevision], enabled: context.focused, staleTime: 0, gcTime: 0, retry: false,
        queryFn: () => { const op = context.capture(); return LateTransportRecoveryJournal.read(uid, scope, () => context.assertCurrent(op)); } });
    const query = useQuery({ queryKey: ['late-transport-recovery', uid, 'source', key], enabled: allowed, staleTime: 0, gcTime: 0, retry: false, structuralSharing: false,
        queryFn: () => { const op = context.capture(); return LateTransportRecoveryService.source(uid, transactionId, incidentId, scope, () => {context.assertCurrent(op); assertSelection?.();}); } });
    const source = allowed && query.isSuccess && !query.isFetching && !query.isError ? query.data : null;
    const history = useInfiniteQuery({ queryKey: ['late-transport-recovery', uid, 'history', key, source?.source], enabled: !!source && allowed, staleTime: 0, gcTime: 0, retry: false, initialPageParam: null as string | null,
        queryFn: ({ pageParam }) => { const op = context.capture(); return LateTransportRecoveryService.history(uid, transactionId, incidentId, scope, pageParam, () => {context.assertCurrent(op); assertSelection?.();}); }, getNextPageParam: page => page.cursor ?? undefined });
    const pages = allowed && history.isSuccess && !history.isFetching && !history.isError ? history.data.pages : [];
    const rows = pages.flatMap(page => page.items), coherent = !!source && pages.every(page => productReviewEqual(page.source.source, source.source)) && rows.every((r, i) => i === 0 || r.entryId > rows[i - 1].entryId);
    const disabled = !source || !allowed || !journal.isSuccess || journal.isFetching || journal.isError || !!journal.data;
    const renderItem = useCallback(({ item }: {
        item: RecoveryHistoryEntry;
    }) => <View style={styles.section}><Text selectable style={styles.caption}>{item.entryId}</Text>
    {item.qualification === 'historical_unknown' ? <Text style={styles.caption}>Enregistrement historique non qualifié. Aucun droit actuel n’en est déduit.</Text> : <>
      <Text style={styles.body}>{item.action === 'statement' ? 'Déclaration personnelle enregistrée' : item.action === 'complete_own_review' ? 'Achèvement historique de la seule revue de récupération' : 'Maintien historique de l’examen'} · {date(item.recordedAt)}.</Text>
      {item.partyMessage ? <Text style={styles.body}>{item.partyMessage}</Text> : null}
      {item.command?.action === 'statement' ? <Text style={styles.body}>{item.command.narrative}</Text> : null}
      <Text style={styles.caption}>Cet enregistrement historique n’accorde aucune permission actuelle et ne prouve aucune réception bancaire ou physique.</Text>
    </>}
  </View>, []);
    return <View style={styles.section}>
    <Text accessibilityRole="header" style={styles.title}>Récupération physique après remboursement</Text>
    <Text style={styles.caption}>L’observation du transporteur, les déclarations des parties et l’examen de l’équipe restent distincts. Aucun scan ne crée automatiquement une dette, un retour, un nouvel envoi ou un remboursement.</Text>
    {scope === 'admin' ? renderReauthentication?.({ uid, sourceKey: `recovery-reader:${key}`, disabled: !context.focused || query.isFetching, parcel: true, onVerified: () => { try {
            context.capture();
            assertSelection?.();
            setAuthenticated(key);
        }
        catch { /* Old verification. */ } } }) : null}
    {source ? <>
      <Text selectable style={styles.caption}>Article {source.articleId} · incident {incidentId}</Text>
      <Text style={styles.body}>{source.qualification === 'native_context' ? 'Contexte natif qualifié lors de cette lecture.' : 'Contexte courant incomplet ou inconnu ; aucune disponibilité ne peut être déduite.'}</Text>
      <Text style={styles.caption}>{source.statementSetComplete ? 'Les références des déclarations conservées sont qualifiées.' : 'Les références déclaratives sont incomplètes ou inconnues.'} {source.documentaryComplete ? 'Corpus documentaire complet selon sa lecture native.' : 'Corpus documentaire incomplet ou non qualifié.'}</Text>
      {source.statements.map(statement => <View key={statement.role} style={styles.section}>
        <Text style={styles.body}>{statement.role === 'seller' ? 'Vendeur' : 'Acheteur'} : {statement.possession === 'held_by_me' ? 'déclare détenir l’article' : statement.possession === 'not_held_by_me' ? 'déclare ne pas détenir l’article' : 'possession inconnue'} ; {statement.restitution === 'returned_to_seller_declared' ? 'retour au vendeur déclaré' : statement.restitution === 'retained_by_buyer_declared' ? 'conservation par l’acheteur déclarée' : statement.restitution === 'not_returned_declared' ? 'article non restitué déclaré' : 'restitution inconnue'}.</Text>
        <Text style={styles.caption}>{statement.occurredAt ? `Date déclarée : ${date(statement.occurredAt)}.` : 'Date de restitution déclarée inconnue.'} Enregistrement : {date(statement.recordedAt)}. {statement.currentBusinessContext ? 'Déclaration rattachée au contexte courant.' : 'Déclaration historique ; le contexte a changé.'}</Text>
        {statement.narrative ? <Text selectable style={styles.body}>{statement.narrative}</Text> : null}
      </View>)}
      {!source.statements.length ? <Text style={styles.caption}>Aucune déclaration courante qualifiée n’est visible. L’absence d’une partie ne vaut pas accord.</Text> : null}
      {source.currentDecision ? <><Text style={styles.body}>{source.currentDecision.ownReviewComplete ? 'La seule revue de récupération est achevée pour les sources actuellement qualifiées.' : source.currentDecision.qualification === 'historical_or_changed' ? 'L’instruction est historique ou ses sources/habilitations ont changé.' : 'La revue de récupération reste à examiner.'}</Text><Text style={styles.body}>{source.currentDecision.partyMessage}</Text></> : <Text style={styles.caption}>Aucune instruction actuelle qualifiée de récupération.</Text>}
      <Text style={styles.caption}>L’achèvement ne change ni le stock, ni les fonds, ni l’étiquette. Le propriétaire doit demander séparément une nouvelle mise en vente, avec toutes les vérifications encore applicables. Il ne s’agit pas d’une certification de possession ou de propriété.</Text>
      {scope === 'owner' ? <LateTransportRecoveryStatement key={JSON.stringify([key, source.source])} uid={uid} source={source} disabled={disabled} assertSelection={assertSelection}/> : <ProductReviewCasePanel uid={uid} context={{ kind: 'order', id: transactionId }} scope="admin" parcel material={false} renderReauthentication={renderReauthentication} renderLateTransportRecovery={nativeAdmission => renderDecision?.({ uid, source, nativeAdmission, disabled, assertSelection, onRecorded: () => { void query.refetch(); void journal.refetch(); } })}/>}
      <Text accessibilityRole="header" style={styles.title}>Historique distinct de l’état courant</Text>
      {coherent && rows.length ? <View style={styles.viewport}><FlashList data={rows} keyExtractor={rowKey} renderItem={renderItem} nestedScrollEnabled/></View> : null}
      {history.isError || pages.length && !coherent ? <Text style={styles.caption}>L’historique et la source courante ne concordent pas ; relisez le dossier.</Text> : !rows.length ? <Text style={styles.caption}>Aucune entrée qualifiée visible dans cette page. Cette lecture ne certifie pas l’absence d’autres entrées.</Text> : null}
      {coherent && history.hasNextPage ? <Button variant="secondary" disabled={history.isFetching} onPress={() => { try {
            context.capture();
            assertSelection?.();
            void history.fetchNextPage();
        }
        catch { /* Inactive. */ } }}>Lire les entrées suivantes</Button> : null}
    </> : query.isError ? <Text accessibilityRole="alert" style={styles.caption}>Ce parcours reste en préparation ou ses sources privées ne sont pas qualifiées. Aucune instruction de récupération n’est autorisée par cette lecture.</Text> : <Text style={styles.caption}>La lecture privée du dossier reste à confirmer.</Text>}
    <Button variant="secondary" disabled={!allowed || query.isFetching} onPress={() => { try {
        context.capture();
        assertSelection?.();
        void query.refetch();
    }
    catch { /* Inactive. */ } }}>Relire le dossier courant de récupération</Button>
  </View>;
}
const styles = StyleSheet.create({ section: { gap: spacing.sm, paddingVertical: spacing.sm }, title: { ...typography.body, color: colors.foreground }, body: { ...typography.bodySmall, color: colors.foreground }, caption: { ...typography.caption, color: colors.muted }, viewport: { height: spacing['4xl'] * 5 } });
