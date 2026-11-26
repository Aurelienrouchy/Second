import { useState, type ReactNode } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { FlashList } from '@shopify/flash-list';
import { useInfiniteQuery, useQuery } from '@tanstack/react-query';
import { Button } from '@/components/ui';
import { AccountRelationshipReauthentication } from '@/components/AccountRelationshipReauthentication';
import { AccountRelationshipOrderSelection } from '@/components/AccountRelationshipOrderSelection';
import { AccountRelationshipCommandForm } from '@/components/AccountRelationshipCommandForm';
import { AccountRelationshipEntry } from '@/components/AccountRelationshipEntry';
import { AccountRelationshipInventory } from '@/components/AccountRelationshipInventory';
import { useLabelLifecycleContext } from '@/hooks/useLabelLifecycleContext';
import { getAuthSessionGeneration } from '@/store/authStore';
import { AccountRelationshipReviewService as Service, compareRelationshipIds, isRelationshipContext, relationshipFailure } from '@/services/accountRelationshipReviewService';
import { productReviewEqual } from '@/services/productReviewService';
import { createRelationshipInteraction, RELATIONSHIP_STATEMENT } from '@/utils/accountRelationshipPresentation';
import type { RelationshipContext, RelationshipHistoryEntry, RelationshipOrder, RelationshipReference, RelationshipReauthentication, RelationshipScope } from '@/types/accountRelationshipReview';
import { colors, spacing, typography } from '@/constants/theme';

const entryId = (v: RelationshipHistoryEntry) => v.qualification === 'unknown' ? v.entryId : v.entry.reference.id;
type HistoryRow = {entry: RelationshipHistoryEntry; onSelect?: (reference: RelationshipReference) => void};
const historyRowId = (item: HistoryRow) => entryId(item.entry);
const renderHistoryRow = ({item}: {item: HistoryRow}) => <View style={styles.section}>{item.entry.qualification === 'unknown' ? <Text style={styles.caption}>Entrée historique non qualifiée ; son absence de preuve ne certifie ni absence de restriction ni absence de recours.</Text> : <AccountRelationshipEntry entry={item.entry.entry} onSelect={item.onSelect}/>}</View>;
export function AccountRelationshipPanel({uid, scope, supportRequestId, initialOrder = null, decisionReference = null, assertSelection, renderReauthentication, renderLegacySwapTopUp, renderLegacyPurchase}: {
  uid: string; scope: RelationshipScope; supportRequestId: string; initialOrder?: RelationshipOrder | null;
  decisionReference?: RelationshipReference | null; assertSelection?: () => void; renderReauthentication?: RelationshipReauthentication;
  renderLegacySwapTopUp?: (state: {swapId: string; relationshipReference: RelationshipReference; assertCurrent: () => void}) => ReactNode;
  renderLegacyPurchase?: (state: {transactionId: string; relationshipReference: RelationshipReference; sourceKey: string; assertCurrent: () => void}) => ReactNode;
}) {
  const frame = useLabelLifecycleContext(`account-relationship:${scope}:${supportRequestId}:${JSON.stringify(decisionReference)}`, uid);
  const [interaction] = useState(createRelationshipInteraction), [revision, setRevision] = useState(0);
  const key = JSON.stringify([uid, getAuthSessionGeneration(), scope, supportRequestId, decisionReference, frame.focusRevision]);
  const [draft, setDraft] = useState<{key: string; orders: RelationshipOrder[]} | null>(null);
  const orders = draft?.key === key ? draft.orders : initialOrder ? [initialOrder] : [];
  const [selected, setSelected] = useState<{key: string; revision: number; context: RelationshipContext | null; reference: RelationshipReference | null} | null>(null);
  const [authenticated, setAuthenticated] = useState<string | null>(null);
  const [inventoryInteraction] = useState(createRelationshipInteraction);
  const [inventoryDecision, setInventoryDecision] = useState<{key: string; reference: RelationshipReference; revision: number} | null>(null);
  const [purchaseInteraction] = useState(createRelationshipInteraction);
  const [purchaseSelection, setPurchaseSelection] = useState<{key: string; transactionId: string; reference: RelationshipReference; revision: number; assertInventoryCurrent: () => void} | null>(null);
  const [inventoryNotice, setInventoryNotice] = useState<{key: string; text: string} | null>(null);
  const selection = selected?.key === key ? selected : decisionReference ? {key, revision, context: null, reference: decisionReference} : null;
  const sourceKey = JSON.stringify([key, selection, revision]);
  const choice = interaction.capture();
  const currentChoice = () => {frame.capture(); assertSelection?.(); choice();};
  const inventoryChoice = inventoryInteraction.capture();
  const purchaseChoice = purchaseInteraction.capture();
  const chooseInventory = (reference: RelationshipReference) => {try {
    currentChoice(); inventoryInteraction.invalidate(); purchaseInteraction.invalidate(); setPurchaseSelection(null); setInventoryDecision(old => ({key: sourceKey, reference, revision: (old?.revision ?? 0) + 1}));
  } catch { /* Only a currently displayed native decision can select an inventory. */ }};
  const allowed = !!selection && frame.focused && (scope === 'own' || authenticated === sourceKey);
  const source = useQuery({queryKey: ['account-relationship-source', sourceKey], enabled: allowed, staleTime: 0, gcTime: 0, retry: false, structuralSharing: false,
    queryFn: async () => {
      if (!selection) throw relationshipFailure(); const op = frame.capture(), current = () => {frame.assertCurrent(op); currentChoice();};
      const value = await Service.read(uid, scope, selection.context, selection.reference, 'preview', null, current); current();
      if (value.context.supportRequestId !== supportRequestId) throw relationshipFailure(); return value;
    }});
  const candidate = allowed && source.isSuccess && !source.isFetching && !source.isError ? source.data : null;
  const history = useInfiniteQuery({queryKey: ['account-relationship-history', sourceKey, candidate?.source], enabled: !!candidate && allowed,
    staleTime: 0, gcTime: 0, retry: false, structuralSharing: false, initialPageParam: null as {lastId: string} | null,
    queryFn: async ({pageParam}) => {
      if (!candidate || !selection) throw relationshipFailure(); const op = frame.capture(), current = () => {frame.assertCurrent(op); currentChoice();};
      const value = await Service.read(uid, scope, selection.context, selection.reference, 'history', pageParam, current); current();
      if (!productReviewEqual([value.context, value.source, value.ownScopes, value.accounts, value.pairRestriction, value.orderReviews, value.legacyPaymentReview], [candidate.context, candidate.source, candidate.ownScopes, candidate.accounts, candidate.pairRestriction, candidate.orderReviews, candidate.legacyPaymentReview])) throw new Error('Les sources ou la version de la paire ont changé. Relisez explicitement le dossier.');
      return value;
    }, getNextPageParam: page => page.nextCursor ?? undefined});
  const current = candidate && history.isSuccess && !history.isFetching && !history.isError ? candidate : null;
  const rows = current ? history.data?.pages.flatMap(page => page.entries) ?? [] : [];
  const ids = rows.map(entryId), coherent = ids.every((id, i) => i === 0 || compareRelationshipIds(id, ids[i - 1]) > 0);
  const inventoryReferences = current && coherent ? [current.selectedDecision?.action === 'record_review' ? current.selectedDecision.reference : null, current.pairRestriction?.reference ?? null,
    ...rows.flatMap(row => row.qualification === 'native_relationship_entry' && row.entry.action === 'record_review' ? [row.entry.reference] : [])]
    .filter((reference): reference is RelationshipReference => reference !== null).filter((reference, index, all) => all.findIndex(other => productReviewEqual(other, reference)) === index) : [];
  const edit = () => {try {frame.capture(); assertSelection?.(); interaction.invalidate(); purchaseInteraction.invalidate(); setPurchaseSelection(null); setSelected(null); setAuthenticated(null); setRevision(n => n + 1);} catch { /* No stale selection. */ }};
  const chooseOrders = (value: RelationshipOrder[]) => {edit(); setDraft({key, orders: value});};
  const read = () => {try {
    frame.capture(); assertSelection?.(); const context = {supportRequestId, orders}; if (!isRelationshipContext(context)) return;
    interaction.invalidate(); setAuthenticated(null); setRevision(n => n + 1); setSelected({key, revision: revision + 1, context, reference: null});
  } catch { /* No unqualified private lookup. */ }};
  const selectDecision = (reference: RelationshipReference) => {try {
    currentChoice(); interaction.invalidate(); setAuthenticated(null); setRevision(n => n + 1); setSelected({key, revision: revision + 1, context: null, reference});
  } catch { /* Old history never selects a new decision. */ }};
  const refresh = () => {try {
    currentChoice(); interaction.invalidate(); setAuthenticated(null); setRevision(n => n + 1);
    if (selection) setSelected({...selection, revision: revision + 1});
  } catch { /* No refresh can borrow a stale source admission. */ }};
  const historyRows: HistoryRow[] = rows.map(entry => ({entry, onSelect: entry.qualification === 'native_relationship_entry' && scope === 'own' && entry.entry.context.supportRequestId === supportRequestId ? selectDecision : undefined}));
  const purchaseKey = JSON.stringify([sourceKey, current?.source]);
  const selectInventoryOrder = (order: RelationshipOrder, reference: RelationshipReference, selectedInDecision: boolean, assertInventoryCurrent: () => void) => {
    try {
      currentChoice(); inventoryChoice(); assertInventoryCurrent(); purchaseInteraction.invalidate();
      if (!selectedInDecision) {
        setPurchaseSelection(null);
        if (orders.length >= 10 && !orders.some(value => productReviewEqual(value, order))) {setInventoryNotice({key, text: 'La portée contient déjà dix références. Retirez une référence avant de préparer ce nouvel examen.'}); return;}
        chooseOrders(orders.some(value => productReviewEqual(value, order)) ? orders : [...orders, order]);
        setInventoryNotice({key, text: 'Cette référence prépare une nouvelle portée. Relisez ses sources puis consignez un nouvel examen natif explicite ; l’ancienne décision n’est pas élargie.'}); return;
      }
      if (order.kind === 'purchase') setPurchaseSelection(old => ({key: purchaseKey, transactionId: order.id, reference, revision: (old?.revision ?? 0) + 1, assertInventoryCurrent}));
      else {setPurchaseSelection(null); selectDecision(reference);}
    } catch { /* A replaced row cannot open a new private capability. */ }
  };
  return <View style={styles.section}><Text accessibilityRole="header" style={styles.title}>Examen des liens entre comptes</Text>
    <Text style={styles.body}>{RELATIONSHIP_STATEMENT}</Text>
    <Text style={styles.caption}>Le support, les commandes et les opérations déjà engagées restent des parcours distincts. Cet examen ne fusionne aucun compte, ne compare pas automatiquement les noms, adresses ou coordonnées bancaires, et n’accorde ni ban global, remboursement ou confiscation.</Text>
    {inventoryNotice?.key === key ? <Text accessibilityRole="alert" style={styles.caption}>{inventoryNotice.text}</Text> : null}
    {!decisionReference ? <><AccountRelationshipOrderSelection sourceKey={key} orders={orders} onEdit={edit} onChange={chooseOrders} disabled={!frame.focused}/>
      <Button variant="secondary" disabled={!frame.focused || !orders.length} onPress={read}>Lire les sources natives de ces références exactes</Button></> : <Text selectable style={styles.caption}>Référence adressée à qualifier : {decisionReference.id} · version {decisionReference.version}. Aucun contenu du ticket d’un autre membre n’est ouvert.</Text>}
    {scope === 'admin' && selection ? <AccountRelationshipReauthentication render={renderReauthentication} uid={uid} sourceKey={`relationship-reader:${sourceKey}`} parcel disabled={!frame.focused || source.isFetching} onVerified={() => {try {currentChoice(); setAuthenticated(sourceKey);} catch { /* A stale provider callback grants no private read. */ }}}/> : null}
    {current && coherent ? <>
      <Text selectable style={styles.caption}>Dossier natif {current.context.supportRequestId} · version paire {current.source.version ?? 'inconnue'}.</Text>
      <Text style={styles.body}>{current.source.qualification === 'native_current' ? 'Les sources sélectionnées sont qualifiées pour leur version actuelle.' : 'Les sources actuelles restent inconnues ou incomplètes. Un reçu historique n’établit aucune permission actuelle.'}</Text>
      {current.ticket ? <><Text style={styles.body}>Ticket d’origine · version {current.ticket.version} · reçu {current.ticket.receivedAt}</Text><Text selectable style={styles.body}>{current.ticket.narrative}</Text></> : null}
      {current.accounts?.map(account => <View key={account.declaredAccountId} style={styles.section}><Text selectable style={styles.body}>Compte natif : {account.declaredAccountId}</Text><Text style={styles.caption}>Document utilisateur {account.userDocumentState} · admissibilité {account.eligibilityDocumentState} · activité enregistrée {account.activeFieldState} · fermeture {account.closureRecordState}. Ces seules données ne prouvent pas un lien entre personnes.</Text><Text selectable style={styles.caption}>Révisions {account.userRevision ?? 'inconnue'} / {account.eligibilityRevision ?? 'inconnue'} · source {account.sourceHash}</Text></View>)}
      {current.orders.map(order => <View key={`${order.kind}/${order.id}`} style={styles.section}><Text selectable style={styles.body}>{order.kind === 'purchase' ? 'Achat' : 'Troc'} · {order.id}</Text><Text style={styles.caption}>Origine : {order.originQualification === 'native_agreement' ? 'accord natif qualifié' : order.originQualification === 'native_proposal' ? 'proposition native, distincte d’un accord' : 'inconnue'} · révision {order.revision ?? 'inconnue'}.</Text></View>)}
      {current.legacyPaymentReview.orders.length ? <View style={styles.section}><Text style={styles.body}>Intentions de paiement Troc déjà engagées : portée sélectionnée</Text>
        {current.legacyPaymentReview.orders.map(row => <View key={row.order.id} style={styles.section}><Text selectable style={styles.caption}>Troc {row.order.id} : {row.state === 'native_manual_protocol_recorded' ? 'protocole manuel natif enregistré' : row.state === 'neutralization_observed' ? 'neutralisation observée' : row.state === 'legacy_exposure_requires_review' ? 'ancienne exposition à réexaminer' : 'situation inconnue'}.</Text>
          <Text style={styles.caption}>{row.externalConfirmationPrevented ? 'La qualification native indique une prévention de confirmation externe pour cette seule intention.' : 'Aucune prévention de confirmation externe n’est qualifiée.'}{row.providerObservedAt ? ` Observation prestataire : ${row.providerObservedAt}.` : ' Aucune date d’observation prestataire qualifiée.'}</Text></View>)}
        <Text style={styles.caption}>Cette lecture couvre uniquement les Trocs projetés ({current.legacyPaymentReview.coverage.selectedSwapCount}). Elle ne certifie pas l’exhaustivité des paiements de la paire et ne donne aucune autorisation de paiement.</Text>
      </View> : null}
      {scope === 'admin' && current.source.qualification === 'native_current' && current.pairRestriction?.blocked === true ? current.legacyPaymentReview.orders.filter(row => row.state === 'legacy_exposure_requires_review' && current.orders.some(order => order.kind === 'swap' && order.id === row.order.id)).map(row => <View key={JSON.stringify([row.order.id, current.source.sourceHash, current.pairRestriction!.reference])} style={styles.section}>
        <Text style={styles.caption}>L’examen de l’ancien paiement est lié à cette restriction native exacte. Le serveur vérifiera que vous êtes son auteur actuellement habilité avant toute lecture ou neutralisation opérateur.</Text>
        {renderLegacySwapTopUp?.({swapId: row.order.id, relationshipReference: current.pairRestriction!.reference, assertCurrent: currentChoice})}
      </View>) : null}
      {current.ownScopes ? <><Text style={styles.body}>Vos nouveaux engagements avec cette paire : {current.ownScopes.newEngagements === 'restricted_by_review' ? 'restriction de revue enregistrée' : current.ownScopes.newEngagements === 'no_own_restriction' ? 'aucune restriction propre à cet examen' : 'situation inconnue'}.</Text>
        {current.ownScopes.orderReleaseReviews.map(row => <Text key={`${row.order.kind}/${row.order.id}`} selectable style={styles.caption}>{row.order.id} : {row.state === 'retained_for_review' ? 'revue de libération maintenue' : row.state === 'no_own_review' ? 'aucune revue propre à cet examen' : 'revue de libération inconnue'}.</Text>)}
        <Text style={styles.caption}>L’absence de restriction propre à cet examen ne vaut pas permission globale. Les autres gardes et opérations déjà engagées restent à qualifier séparément.</Text></> : scope === 'own' ? <Text style={styles.caption}>Votre situation actuelle ne peut pas être qualifiée ; seule la décision historique éventuellement affichée reste lisible.</Text> : null}
      {scope === 'admin' ? <><Text style={styles.caption}>Garde paire dans la source : {current.source.qualification !== 'native_current' ? 'inconnue' : current.pairRestriction?.blocked ? 'restriction des nouveaux engagements' : 'aucune restriction propre'}. Cette qualification ne vaut pas permission globale.</Text>
        {Object.values(current.orderReviews ?? {}).filter(review => current.orders.some(order => order.kind === review.order.kind && order.id === review.order.id)).map(review => <Text key={`${review.order.kind}/${review.order.id}`} selectable style={styles.caption}>{review.order.id} : {current.source.qualification !== 'native_current' ? 'qualification inconnue' : review.blocked ? 'revue de libération maintenue' : 'revue propre close'}. Référence {review.reference.id}.</Text>)}</> : null}
      {current.selectedDecision ? <AccountRelationshipEntry entry={current.selectedDecision}/> : null}
      <Text accessibilityRole="header" style={styles.title}>Historique accessible, distinct des gardes actuelles</Text>
      {rows.length ? <View style={styles.viewport}><FlashList data={historyRows} keyExtractor={historyRowId} renderItem={renderHistoryRow} nestedScrollEnabled/></View> : <Text style={styles.caption}>Aucune entrée qualifiée visible dans ces pages. Cette lecture n’est pas une certification d’absence ou d’exhaustivité.</Text>}
      {history.hasNextPage ? <Button variant="secondary" disabled={history.isFetching} onPress={() => {try {currentChoice(); void history.fetchNextPage();} catch { /* Old selection. */ }}}>Lire les entrées suivantes, même après une page visible vide</Button> : null}
      {scope === 'admin' ? <View style={styles.section}><Text style={styles.body}>Choisir une décision native pour l’inventaire privé de sa paire</Text>
        {inventoryReferences.map(reference => <Button key={reference.id} variant="secondary" onPress={() => chooseInventory(reference)}>Choisir l’inventaire lié à la décision {reference.id} · version {reference.version}</Button>)}
        {!inventoryReferences.length ? <Text style={styles.caption}>Aucune décision opérateur native qualifiée n’est disponible dans cette portée et ces pages. Aucun inventaire n’est déduit d’identifiants de comptes.</Text> : null}
        {inventoryDecision?.key === sourceKey ? <AccountRelationshipInventory key={JSON.stringify([sourceKey, current.source, inventoryDecision.reference, inventoryDecision.revision])} uid={uid} decisionReference={inventoryDecision.reference} sourceKey={JSON.stringify([sourceKey, current.source])}
          assertSelection={() => {currentChoice(); inventoryChoice();}} renderReauthentication={renderReauthentication} onSelectOrder={selectInventoryOrder}/> : null}
        {inventoryDecision?.key === sourceKey && purchaseSelection?.key === purchaseKey ? <View key={JSON.stringify([purchaseKey, purchaseSelection.transactionId, purchaseSelection.reference, purchaseSelection.revision])} style={styles.section}>
          {renderLegacyPurchase?.({transactionId: purchaseSelection.transactionId, relationshipReference: purchaseSelection.reference,
            sourceKey: JSON.stringify([purchaseKey, purchaseSelection.revision]), assertCurrent: () => {currentChoice(); inventoryChoice(); purchaseChoice(); purchaseSelection.assertInventoryCurrent();}})}
        </View> : null}
      </View> : null}
      <AccountRelationshipCommandForm key={sourceKey} uid={uid} preview={current} assertSelection={currentChoice} onRecorded={refresh} renderReauthentication={renderReauthentication}/>
    </> : source.isError || history.isError || !coherent ? <Text accessibilityRole="alert" style={styles.caption}>Le dossier privé ou ses versions ne peuvent pas être qualifiés. Les nouvelles instructions et les anciennes sources sont masquées ; le journal propre reste accessible séparément. Relisez les sources exactes.</Text> : <Text style={styles.caption}>{source.isFetching || history.isFetching ? 'Lecture native du dossier et de ses références…' : 'Choisissez une portée explicite et faites qualifier ses sources.'}</Text>}
    {selection ? <Button variant="secondary" disabled={!frame.focused} onPress={refresh}>Relire explicitement cette portée et ses sources</Button> : null}
  </View>;
}
const styles = StyleSheet.create({section: {gap: spacing.sm, paddingVertical: spacing.sm}, title: {...typography.body, color: colors.foreground}, body: {...typography.bodySmall, color: colors.foreground}, caption: {...typography.caption, color: colors.muted}, viewport: {height: spacing['4xl'] * 6}});
