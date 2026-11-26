import { useCallback, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { FlashList } from '@shopify/flash-list';
import { useInfiniteQuery } from '@tanstack/react-query';
import { Button } from '@/components/ui';
import { AccountRelationshipReauthentication } from '@/components/AccountRelationshipReauthentication';
import { ACCOUNT_RELATIONSHIP_INVENTORY_ENABLED } from '@/config/featureFlags';
import { useLabelLifecycleContext } from '@/hooks/useLabelLifecycleContext';
import { getAuthSessionGeneration } from '@/store/authStore';
import { AccountRelationshipReviewService as Service, isRelationshipInventorySourceChanged, relationshipFailure, relationshipId } from '@/services/accountRelationshipReviewService';
import { productReviewEqual } from '@/services/productReviewService';
import { createRelationshipInteraction } from '@/utils/accountRelationshipPresentation';
import { SWAP_TOPUP_STATUS_LABELS } from '@/utils/swapTopUpCheckoutPresentation';
import { formatPriceWithCurrency } from '@/utils/formatPrice';
import type { RelationshipInventoryV2Cursor, RelationshipInventoryV2Row, RelationshipInventoryRow, RelationshipReference, RelationshipReauthentication, RelationshipOrder, RelationshipInventoryPurchaseRow } from '@/types/accountRelationshipReview';
import { colors, spacing, typography } from '@/constants/theme';

type InventoryObservation = {key: string; row: RelationshipInventoryV2Row; readAt: string};
const keyExtractor = (item: InventoryObservation) => item.key;
const statusLabels: Record<RelationshipInventoryRow['status'], string> = {
  proposed: 'proposé', payment_pending: 'paiement en attente', accepted: 'accepté', photos_pending: 'photos en attente', shipping: 'expédition',
  completed: 'terminé', cancelled: 'annulé', declined: 'refusé', expired: 'expiré', disputed: 'litige', unknown: 'inconnu',
};
const purchaseStatusLabels: Record<RelationshipInventoryPurchaseRow['status'], string> = {pending_payment: 'paiement en attente', meetup_pending: 'remise à organiser', meetup_confirmed: 'remise convenue',
  meetup_completed: 'remise terminée', paid: 'payé dans la source', label_created: 'étiquette créée', shipped: 'expédié', delivered: 'livraison signalée', completed: 'terminé', return_requested: 'retour demandé',
  delivery_failed: 'livraison échouée', lost: 'perdu', cancelled: 'annulé', disputed: 'litige', refund_in_progress: 'remboursement en cours', refund_action_required: 'remboursement à examiner', refunded: 'remboursement enregistré', unknown: 'inconnu'};

/** Read-only native inventory. Checkout remains behind its separate current review. */
export function AccountRelationshipInventory({uid, decisionReference, sourceKey, assertSelection, renderReauthentication, onSelectOrder}: {
  uid: string; decisionReference: RelationshipReference; sourceKey: string; assertSelection: () => void; renderReauthentication?: RelationshipReauthentication;
  onSelectOrder?: (order: RelationshipOrder, decisionReference: RelationshipReference, selectedInDecision: boolean, assertCurrent: () => void) => void;
}) {
  const frame = useLabelLifecycleContext(`relationship-inventory:${sourceKey}:${JSON.stringify(decisionReference)}`, uid);
  const [interaction] = useState(createRelationshipInteraction), [revision, setRevision] = useState(0), [authenticated, setAuthenticated] = useState<string | null>(null);
  const key = JSON.stringify([uid, getAuthSessionGeneration(), decisionReference, sourceKey, frame.focusRevision, revision]);
  const choice = interaction.capture();
  const currentChoice = () => {frame.capture(); assertSelection(); choice();};
  const allowed = ACCOUNT_RELATIONSHIP_INVENTORY_ENABLED && frame.focused && authenticated === key;
  const inventory = useInfiniteQuery({queryKey: ['account-relationship-inventory', key], enabled: allowed,
    staleTime: 0, gcTime: 0, retry: false, structuralSharing: false, initialPageParam: null as RelationshipInventoryV2Cursor | null,
    queryFn: async ({pageParam}) => {
      const operation = frame.capture(), current = () => {frame.assertCurrent(operation); assertSelection(); choice();};
      current(); if (!ACCOUNT_RELATIONSHIP_INVENTORY_ENABLED) throw relationshipFailure();
      const value = await Service.inventoryV2(uid, decisionReference, pageParam ? {sourceHash: pageParam.sourceHash} : null, pageParam, current);
      current(); return value;
    }, getNextPageParam: page => page.nextCursor ?? undefined});
  const pages = allowed && inventory.isSuccess && !inventory.isFetching && !inventory.isError ? inventory.data.pages : [];
  const coherent = pages.every(page => productReviewEqual(page.source, pages[0].source));
  const observations = coherent ? pages.flatMap((page, index) => page.rows.map(row => ({key: `${index}:${row.kind}:${row.id}`, row, readAt: page.readAt}))) : [];
  const restart = () => {try {
    currentChoice(); interaction.invalidate(); setAuthenticated(null); setRevision(value => value + 1);
  } catch { /* A replacement selection cannot restart this private reader. */ }};
  const renderRow = useCallback(({item}: {item: InventoryObservation}) => {
    const row = item.row;
    const select = () => {try {
      currentChoice(); const op = frame.capture();
      const current = () => {frame.assertCurrent(op); assertSelection(); choice();}; current();
      onSelectOrder?.({kind: row.kind, id: row.id}, decisionReference, row.selectedInDecision && !row.newNativeReviewRequired, current);
    } catch { /* A stale inventory row cannot change the native review scope. */ }};
    if (row.kind === 'purchase') return <View style={styles.section}>
      <Text selectable style={styles.body}>Achat {row.id} · statut dans cette source : {purchaseStatusLabels[row.status]}.</Text>
      <Text style={styles.caption}>Sens natif : {row.direction === 'first_to_second' ? 'première partie vers seconde partie' : 'seconde partie vers première partie'} · page lue le {item.readAt} · créé {row.createdAt ?? 'date inconnue'}.</Text>
      <Text selectable style={styles.caption}>Origine : {row.source.originQualification === 'native_agreement' ? 'accord natif' : row.source.originQualification === 'native_proposal' ? 'proposition native' : 'inconnue'} · révision {row.source.revision ?? 'inconnue'} · source {row.source.sourceHash}.</Text>
      <Text style={styles.body}>{row.selectedInDecision ? 'Achat présent dans la décision sélectionnée.' : 'Achat absent de la portée de cette décision.'} {row.newNativeReviewRequired ? 'Un nouvel examen natif est requis avant toute neutralisation.' : 'Le parcours séparé relira la décision et la capacité externe exacte.'}</Text>
      <Text style={styles.caption}>Total enregistré : {row.purchase.totalCents === null || row.purchase.currency !== 'CAD' ? 'inconnu' : `${formatPriceWithCurrency(row.purchase.totalCents / 100)} CAD`} · portion portefeuille : {row.purchase.walletCents === null || row.purchase.currency !== 'CAD' ? 'inconnue' : `${formatPriceWithCurrency(row.purchase.walletCents / 100)} CAD`}.</Text>
      <Text style={styles.caption}>Référence prestataire : {row.purchase.paymentReferenceQualification === 'native_reference_present' ? 'présente, résultat inconnu' : row.purchase.paymentReferenceQualification === 'reference_absent_outcome_unknown' ? 'absente, résultat inconnu' : 'mal formée, résultat inconnu'}.</Text>
      <Text style={styles.caption}>Observation locale : {row.payment.state === 'neutralization_observed' ? 'neutralisation observée' : row.payment.state === 'native_manual_protocol_recorded' ? 'protocole manuel natif enregistré' : row.payment.state === 'legacy_exposure_requires_review' ? 'ancienne exposition à examiner' : 'inconnue'}. L’état prestataire actuel, les fonds et la possession ne sont pas vérifiés.</Text>
      {onSelectOrder ? <Button variant="secondary" disabled={!relationshipId(row.id)} onPress={select}>{row.selectedInDecision && !row.newNativeReviewRequired ? 'Examiner la capacité historique de cet achat' : 'Préparer un nouvel examen natif avec cet achat'}</Button> : null}
    </View>;
    return <View style={styles.section}>
      <Text selectable style={styles.body}>Troc {row.swapId} · statut dans cette source : {statusLabels[row.status]}.</Text>
      <Text style={styles.caption}>Sens natif : {row.direction === 'first_to_second' ? 'première partie vers seconde partie' : 'seconde partie vers première partie'} · page lue le {item.readAt}.</Text>
      <Text style={styles.caption}>Créé : {row.createdAt ?? 'date inconnue'} · accepté : {row.acceptedAt ?? 'date inconnue'}.</Text>
      <Text selectable style={styles.caption}>Origine : {row.source.originQualification === 'native_agreement' ? 'accord natif' : row.source.originQualification === 'native_proposal' ? 'proposition native, distincte d’un accord' : 'inconnue'} · révision {row.source.revision ?? 'inconnue'} · source {row.source.sourceHash} · origine {row.source.originHash ?? 'inconnue'}.</Text>
      <Text style={styles.body}>{row.selectedInDecision ? 'Troc présent dans la décision sélectionnée.' : 'Troc absent de la portée de cette décision.'} {row.newNativeReviewRequired ? 'Un nouvel examen natif explicite est requis avant tout recours au parcours de neutralisation.' : 'La portée native est liée à cette décision ; le parcours séparé relira encore son autorité et ses sources avant toute opération.'}</Text>
      <Text style={styles.caption}>Complément déclaré : {row.topUp.qualification === 'native_declared' && row.topUp.baseCents !== null ? `${formatPriceWithCurrency(row.topUp.baseCents / 100)} CAD, à la charge déclarée de la ${row.topUp.payerRole === 'first_party' ? 'première' : 'seconde'} partie` : 'montant et payeur inconnus'}.</Text>
      <Text style={styles.caption}>Référence de paiement : {row.topUp.paymentReferenceQualification === 'native_reference_present' ? 'présence d’une référence dans le document natif, sans preuve de résultat' : row.topUp.paymentReferenceQualification === 'reference_absent_outcome_unknown' ? 'absente ; résultat inconnu' : 'mal formée ; résultat inconnu'}.</Text>
      <Text style={styles.caption}>Observation locale : {row.payment.state === 'native_manual_protocol_recorded' ? 'protocole manuel natif enregistré' : row.payment.state === 'neutralization_observed' ? 'neutralisation observée' : row.payment.state === 'legacy_exposure_requires_review' ? 'ancienne exposition à réexaminer' : 'situation inconnue'} · statut prestataire conservé : {SWAP_TOPUP_STATUS_LABELS[row.payment.providerStatus]} · date {row.payment.providerObservedAt ?? 'inconnue'}.</Text>
      <Text style={styles.caption}>{row.payment.externalConfirmationPrevented ? 'La prévention de confirmation externe était qualifiée dans cette observation locale.' : 'Aucune prévention de confirmation externe n’est qualifiée dans cette observation.'} L’état prestataire actuel n’est pas vérifié et aucun paiement ou règlement n’est autorisé par cette ligne.</Text>
      {onSelectOrder ? <Button variant="secondary" disabled={!relationshipId(row.id)} onPress={select}>{row.selectedInDecision && !row.newNativeReviewRequired ? 'Examiner ce Troc dans sa décision native' : 'Préparer un nouvel examen natif avec ce Troc'}</Button> : null}
    </View>;
  }, [frame, assertSelection, choice, onSelectOrder, decisionReference, currentChoice]);
  return <View style={styles.section}>
    <Text accessibilityRole="header" style={styles.body}>Inventaire privé des achats et Trocs de cette paire</Text>
    <Text selectable style={styles.caption}>Décision native {decisionReference.id} · version {decisionReference.version}. La paire est dérivée de sa preuve ; aucun identifiant de membre n’est saisi.</Text>
    <Text style={styles.caption}>Ces pages sont des lectures successives, sans instantané commun. Les anciens documents dont les parties ne sont pas identifiables et les intentions présentes seulement chez le prestataire restent inconnus. Aucune fin de pagination ne certifie une couverture exhaustive ni la résolution globale des expositions.</Text>
    <Text style={styles.caption}>Quatre parcours sont lus successivement : achats dans les deux sens, puis Trocs dans les deux sens. Cette liste n’élargit aucune décision et ne neutralise aucun paiement. Une référence absente doit être ajoutée à une nouvelle portée et faire l’objet d’un nouvel examen natif.</Text>
    {!ACCOUNT_RELATIONSHIP_INVENTORY_ENABLED ? <Text style={styles.caption}>Ce lecteur d’inventaire est en préparation. Les autres sources et les propres reçus restent accessibles séparément.</Text> : <AccountRelationshipReauthentication render={renderReauthentication} uid={uid} sourceKey={`relationship-inventory-reader:${key}`} parcel disabled={!frame.focused || inventory.isFetching} onVerified={() => {try {currentChoice(); setAuthenticated(key);} catch { /* No stale reauthentication can open a private page. */ }}}/>}
    {pages.length && coherent ? <>
      <Text selectable style={styles.caption}>Source d’inventaire {pages[0].source.sourceHash} · révision paire {pages[0].source.pairRevision ?? 'inconnue'} · version {pages[0].source.pairVersion ?? 'inconnue'} · {pages[0].source.qualification === 'native_pair_current' ? 'paire native actuelle qualifiée' : 'décision historique, paire actuelle inconnue'}.</Text>
      {pages.map((page, index) => <Text key={index} style={styles.caption}>Page {page.coverage.kind === 'purchase' ? 'achats' : 'Trocs'} lue le {page.readAt} · {page.coverage.direction === 'first_to_second' ? 'premier sens' : 'second sens'} · {page.coverage.inspected} documents inspectés dans cette page, {page.rows.length} lignes de la paire visibles. {page.coverage.directionTailReached ? 'Fin de ce sens observée lors de cette lecture ; aucune exhaustivité globale.' : 'Ce sens comporte une page suivante.'}</Text>)}
      {observations.length ? <View style={styles.viewport}><FlashList data={observations} keyExtractor={keyExtractor} renderItem={renderRow} nestedScrollEnabled/></View> : <Text style={styles.caption}>Aucune ligne de cette paire visible dans les pages lues. Les documents filtrés font progresser le curseur ; cette absence ne démontre ni absence de Troc ni absence d’exposition.</Text>}
    </> : inventory.isError || !coherent ? <Text accessibilityRole="alert" style={styles.caption}>{isRelationshipInventorySourceChanged(inventory.error) ? 'La source de la paire, de la décision ou de son autorité a changé. Les anciennes pages sont masquées. Recommencez depuis la première page après réauthentification.' : 'La lecture privée ne peut pas être qualifiée. Les anciennes pages sont masquées ; relisez la source après vérification de votre habilitation.'}</Text> : ACCOUNT_RELATIONSHIP_INVENTORY_ENABLED ? <Text style={styles.caption}>{inventory.isFetching ? 'Lecture privée de la page et de sa source exacte…' : 'Confirmez votre identité opérateur pour lire la première page.'}</Text> : null}
    {allowed && inventory.hasNextPage && !inventory.isError && coherent ? <Button variant="secondary" disabled={inventory.isFetching} onPress={() => {try {currentChoice(); void inventory.fetchNextPage({cancelRefetch: false});} catch { /* No stale next-page request. */ }}}>Lire la page ou le sens suivant, même après une page visible vide</Button> : null}
    {ACCOUNT_RELATIONSHIP_INVENTORY_ENABLED ? <Button variant="secondary" disabled={!frame.focused} onPress={restart}>Recommencer l’inventaire depuis ses sources actuelles</Button> : null}
  </View>;
}
const styles = StyleSheet.create({section: {gap: spacing.sm, paddingVertical: spacing.sm}, body: {...typography.bodySmall, color: colors.foreground}, caption: {...typography.caption, color: colors.muted}, viewport: {height: spacing['4xl'] * 6}});
