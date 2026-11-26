import {StyleSheet, Text, View} from 'react-native';
import {useQuery} from '@tanstack/react-query';
import {Button} from '@/components/ui';
import {SellerTaxService} from '@/services/sellerTaxService';
import {useLabelLifecycleContext} from '@/hooks/useLabelLifecycleContext';
import {getAuthSessionGeneration} from '@/store/authStore';
import {colors, spacing, typography} from '@/constants/theme';
import type {SellerTaxCaptureReference, SellerTaxCommand, SellerTaxScope} from '@/types/sellerTax';

export function SellerTaxAnnualCapture({uid, scope, version, reference, disabled, onCommand, onUse}: {
  uid: string; scope: SellerTaxScope; version: number; reference: SellerTaxCaptureReference | null; disabled: boolean;
  onCommand: (command: SellerTaxCommand) => void; onUse: (reference: SellerTaxCaptureReference | null) => void;
}) {
  const context = useLabelLifecycleContext(`seller-tax-capture:${JSON.stringify([scope, reference, version])}`, uid), generation = getAuthSessionGeneration();
  const query = useQuery({queryKey: ['seller-tax-capture', uid, generation, scope, version, reference, context.focusRevision],
    enabled: context.focused && reference !== null, staleTime: 0, gcTime: 0, retry: false, structuralSharing: false,
    queryFn: () => {const op = context.capture(); if (!reference) throw new Error('Capture native requise.'); return SellerTaxService.capture(uid, scope, reference, () => context.assertCurrent(op));}});
  const capture = reference && context.focused && query.isSuccess && !query.isFetching && !query.isError ? query.data : null;
  return <View style={styles.section}>
    <Text style={styles.title}>Capture annuelle à un instant natif</Text>
    <Text style={styles.caption}>Une nouvelle capture conserve un point de lecture pendant une heure. Chaque instruction examine au plus une page de dix sources ; continuez explicitement jusqu’à la fin. Aucun plafond de 500 sources n’est appliqué à cette capture.</Text>
    <Button variant="secondary" disabled={disabled} onPress={() => onCommand({action: 'annual_capture_prepare', expectedVersion: version})}>Créer un nouveau point de capture annuel</Button>
    {!reference ? <Text style={styles.caption}>Lisez la catégorie « Captures annuelles » puis sélectionnez une référence native pour reprendre sa progression.</Text> : !capture ? <Text style={styles.caption}>{query.isError ? 'Le point, sa méthode ou vos droits actuels ne peuvent pas être confirmés. Aucune ancienne capture n’est présentée comme utilisable.' : 'Lecture de la capture actuelle…'}</Text> : <>
      <Text style={styles.body}>Point natif : {new Date(capture.readTime.seconds * 1000 + capture.readTime.nanoseconds / 1e6).toLocaleString('fr-CA', {timeZone: 'UTC'})} UTC. Méthode annuelle : {capture.context.timeZone === 'unqualified' ? 'inconnue' : capture.context.timeZone}.</Text>
      <Text style={styles.body}>État : {capture.status === 'complete' ? 'ensemble natif parcouru' : capture.status === 'unavailable' ? 'point expiré ou indisponible' : 'capture en cours'}. Pages : {capture.pages} · Sources distinctes : {capture.sourcesInspected} · Sources inconnues : {capture.unknownSources} · Autres années : {capture.otherYearSources}.</Text>
      <Text style={styles.caption}>L’ensemble natif connu reste distinct de l’univers légal des opérations. La capture ne certifie ni un dépôt fiscal, ni les données externes, ni une restauration ou un état financier global.</Text>
      {capture.status === 'capturing' ? <Button variant="secondary" disabled={disabled} onPress={() => {
        try {context.capture(); if (!query.isFetching && !query.isError && query.data === capture) onCommand({action: 'annual_capture_advance', expectedVersion: version, captureReference: capture.reference});} catch {/* Current native point only. */}
      }}>Examiner une page de cette capture</Button> : capture.status === 'complete' ? <>
        <Text style={styles.caption}>{capture.summary?.qualification === 'unknown' ? 'Des faits restent inconnus ; aucun total annuel connu n’est déduit de cette capture.' : 'Les montants sont qualifiés uniquement pour les sources natives connues à ce point.'}</Text>
        <Button variant="secondary" disabled={disabled} onPress={() => {try {context.capture(); if (!query.isFetching && !query.isError && query.data === capture) onCommand({action: 'snapshot', expectedVersion: version, captureReference: capture.reference});} catch {/* Current native point only. */}}}>Enregistrer un résumé de cette capture complète</Button>
        {scope.access === 'admin' ? <Button variant="ghost" disabled={disabled} onPress={() => {try {context.capture(); if (!query.isFetching && !query.isError && query.data === capture) onUse(capture.reference);} catch {/* No stale preparation. */}}}>Utiliser cette capture pour la préparation documentaire</Button> : null}
      </> : <Text style={styles.caption}>Ce point ne peut plus avancer. Un nouveau point exige le bouton explicite de création et une nouvelle commande ; l’ancien suivi est conservé.</Text>}
    </>}
    {reference ? <Button variant="ghost" disabled={disabled || query.isFetching} onPress={() => {onUse(null); void query.refetch();}}>Relire le point et retirer son choix de préparation</Button> : null}
  </View>;
}
const styles = StyleSheet.create({section: {gap: spacing.sm}, title: {...typography.body, color: colors.foreground},
  body: {...typography.bodySmall, color: colors.foreground}, caption: {...typography.caption, color: colors.muted}});
