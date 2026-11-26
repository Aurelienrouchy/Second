import {useState} from 'react';
import {StyleSheet, Text, View} from 'react-native';
import {Button} from '@/components/ui';
import type {GlobalFinancialPage, GlobalFinancialPrivateReport} from '@/types/globalFinancialReconciliation';
import {colors, spacing, typography} from '@/constants/theme';

const cents = (n: number | null, currency: 'CAD' | null = 'CAD') => n === null ? 'inconnu' : currency === 'CAD' ? `${n} cents CAD (${(n / 100).toFixed(2)} $)` : `${n} cents — devise inconnue`;
const controlLabels = {incomplete: 'Contrôle incomplet', unknown: 'Contrôle non qualifié : preuves ou faits inconnus', mismatch: 'Écart constaté', balanced: 'Équilibre qualifié au point observé'};
const controlStages = {opening: 'composantes initiales', sources: 'sources natives', events: 'liens des événements', components: 'liens des composantes', complete: 'contrôle terminé'};
const verified = (value: boolean) => value ? 'vérifié' : 'non vérifié';
const stateLabels = {active: 'En cours', waiting_provider: 'Lecture prestataire à reprendre', waiting_native_capture: 'Lecture au point natif indisponible', budget_exhausted: 'Limite documentaire atteinte', sealed: 'Rapport documentaire scellé'};
export function AdminGlobalFinancialReportView({report, page}: {report: GlobalFinancialPrivateReport; page: GlobalFinancialPage | null}) {
  const [offset, setOffset] = useState(0), safeOffset = offset < report.groups.length ? offset : 0;
  const coverage = report.coverage, closing = report.openingClosing, flow = closing.providerFlowComparison, statement = closing.statement, control = report.controlBalance;
  return <View style={styles.section}>
    <Text accessibilityRole="header" style={styles.body}>{stateLabels[report.state]} · version {report.version} · phase {report.nextPhase}</Text>
    <Text selectable style={styles.caption}>Rapport : {report.runReference.runId}{'\n'}Empreinte de portée : {report.runReference.scopeHash}</Text>
    <Text selectable style={styles.body}>Compte {report.scope.accountId} · plateforme {report.scope.platformAccountId} · {report.scope.livemode ? 'réel' : 'test'} · CAD</Text>
    <Text style={styles.caption}>{new Date(report.scope.period.fromSeconds * 1000).toISOString()} inclus → {new Date(report.scope.period.toSeconds * 1000).toISOString()} exclu.</Text>
    {report.scope.connectedReference ? <Text selectable style={styles.caption}>Compte connecté lié par {report.scope.connectedReference.kind} : {report.scope.connectedReference.id}. Les autres comptes restent hors de ce rapport.</Text> : null}
    <Text style={styles.body}>Couverture des sources</Text>
    <Text style={styles.caption}>Sources natives : {coverage.native.sources} références, {coverage.native.pages} pages, parcours {coverage.native.closed ? 'terminé' : 'incomplet'} ; {coverage.native.cursor.pendingChildren} sous-collections en attente.</Text>
    <Text style={styles.caption}>Prestataire : {coverage.provider.movements} mouvements, {coverage.provider.pages} pages, parcours {coverage.provider.closed ? 'terminé' : 'incomplet'}.</Text>
    <Text style={styles.caption}>Contrelecture : {coverage.audit.pages} pages, étape {coverage.audit.stage}, parcours {coverage.audit.closed ? 'terminé' : 'incomplet'}.</Text>
    <Text style={styles.body}>Inconnus : {coverage.unknownFacts} · sources modifiées : {coverage.changedSources}</Text>
    {coverage.nativeCapture ? <>
      <Text style={styles.body}>Point commun des sources natives connues : {coverage.nativeCapture.state === 'captured_known_sources_complete' ? 'parcours et contrelecture terminés' : coverage.nativeCapture.state === 'read_time_unavailable' ? 'lecture indisponible' : 'capture en cours'}.</Text>
      <Text selectable style={styles.caption}>Point Firestore immuable : secondes {coverage.nativeCapture.readTime.seconds} · nanosecondes {coverage.nativeCapture.readTime.nanoseconds}. Les pages natives, sous-collections, liens et comptes de référence utilisent ce point. L’habilitation et les lectures Stripe restent actuelles.</Text>
      <Text accessibilityRole={coverage.nativeCapture.periodCoveredByNativeCapture ? undefined : 'alert'} style={styles.caption}>{coverage.nativeCapture.periodCoveredByNativeCapture ? 'Le point natif couvre la fin de la période choisie.' : 'La fin de la période choisie n’est pas couverte par ce point natif. Le rapport ne couvre donc pas toute cette période.'}</Text>
      {coverage.nativeCapture.lastFailureReason ? <Text selectable accessibilityRole="alert" style={styles.caption}>Motif natif : {coverage.nativeCapture.lastFailureReason}. Conservez ce rapport, ce point et le même identifiant de commande. Le curseur demeure celui du dernier reçu ; le point ne peut pas être remplacé et aucune lecture en direct ne prend le relais.</Text> : null}
      <Text style={styles.caption}>{control ? 'Le point commun des sources est distinct des preuves indépendantes du contrôle de balance détaillées ci-dessous. Terminer les pages ou sceller ne donne aucun droit de reprise ou de restauration.' : 'Ce parcours donne une cohérence temporelle aux seules sources connues. L’époque externe, le drainage des écrivains et le jeu complet de sources restent non qualifiés. Terminer les pages ou sceller ce rapport ne prouve pas le solde global et ne certifie aucune restauration.'}</Text>
    </> : <Text style={styles.caption}>Lecture en direct, sans photographie exhaustive à une date commune. L’époque externe, le drainage des écrivains et le jeu complet de sources restent non qualifiés. Terminer les pages ou sceller ce rapport ne prouve pas le solde global.</Text>}
    {control ? <View style={styles.section}>
      <Text accessibilityRole="header" style={styles.body}>Contrôle de balance indépendant · {controlLabels[control.qualification]}</Text>
      <Text style={styles.caption}>Étape : {controlStages[control.stage]} · {control.sourceCount} sources · {control.effectCount} effets · {control.components} composantes · {control.events} événements · {control.unknownFacts} faits inconnus.</Text>
      <Text style={styles.caption}>Ensemble des sources {verified(control.sourceSetVerified)} · ensemble prestataire {verified(control.providerSetVerified)} · drainage des écrivains {verified(control.writerDrainVerified)}.</Text>
      <Text selectable style={styles.caption}>Empreinte de la preuve indépendante : {control.anchorHash ?? 'inconnue'}. Les preuves doivent être qualifiées côté serveur ; une borne saisie ou un solde nul ne les remplace pas.</Text>
      {control.lastFailureReason ? <Text selectable accessibilityRole="alert" style={styles.caption}>Reprise de commande : {control.lastFailureReason}. Conservez le même identifiant, le même point et le même curseur. Le reçu de commande reste distinct du résultat historique ci-dessous ; aucune page suivante n’est lancée automatiquement.</Text> : null}
      {control.issues.map(issue => <Text selectable key={issue} style={styles.caption}>Fait ou écart à examiner : {issue}</Text>)}
      {control.result ? <>
        <Text style={styles.body}>Résultat au point natif : {controlLabels[control.result.qualification]}</Text>
        <Text style={styles.caption}>Écarts de composantes : {control.result.componentMismatches} · écarts d’événements : {control.result.eventMismatches} · mouvements prestataire sans lien : {control.result.unmatchedProviderMovements}. Des erreurs opposées restent des écarts, même si leur somme est nulle.</Text>
        {control.result.compartments.map(compartment => <View key={compartment.balanceType} style={styles.group}>
          <Text style={styles.body}>Compte {report.scope.accountId} · compartiment {compartment.balanceType} · CAD</Text>
          <Text style={styles.caption}>Stock initial B0 : {cents(compartment.openingBalanceCents)} · stock final B1 : {cents(compartment.closingBalanceCents)}.</Text>
          <Text style={styles.caption}>Flux prestataire net : {cents(compartment.providerNetCents)} · écart de flux B1 − B0 − flux : {cents(compartment.flowDifferenceCents)}.</Text>
          <Text style={styles.caption}>Obligations L : {cents(compartment.liabilitiesCents)} · créances R : {cents(compartment.receivablesCents)} · fonds propres K : {cents(compartment.ownFundsCents)}.</Text>
          <Text style={styles.body}>Écart de balance B1 + R − L − K : {cents(compartment.residualCents)}.</Text>
          <Text style={styles.caption}>Ces valeurs appartiennent à ce seul compte et compartiment. Un chiffre observé ne qualifie pas les composantes inconnues ; aucun total entre comptes n’est proposé.</Text>
        </View>)}
      </> : <Text style={styles.caption}>Résultat encore indisponible. Les stocks et les écarts ne sont pas remplacés par zéro. Avancez explicitement une seule page à la fois.</Text>}
      <Text style={styles.caption}>Même qualifié, ce contrôle reste borné au compte, à la période et au point observés. Il n’autorise aucun mouvement prestataire, déblocage de fonds, reprise ou restauration. Il ne certifie ni arrivée bancaire, ni période fiscale, ni statut légal.</Text>
    </View> : null}
    {report.scope.coverageMode === 'complete_known_sources_v1' ? report.effectiveLimits ? <>
      <Text style={styles.body}>Limites effectives du parcours complet des sources connues</Text>
      <Text style={styles.caption}>Aucun plafond total de pages natives, prestataire ou de contrelecture, de sources, de références ou de tentatives de lecture par commande. Chaque action demeure bornée à {report.effectiveLimits.perCall.nativePageSize} sources natives ou {report.effectiveLimits.perCall.providerPageSize} mouvements, avec {report.effectiveLimits.perCall.externalPages} page externe au plus.</Text>
      <Text style={styles.caption}>Autres limites : {report.effectiveLimits.maxPageBytes} octets par page, {report.effectiveLimits.maxRunBytes} octets de projection, {report.effectiveLimits.maxGroups} groupes, {report.effectiveLimits.maxClaimsPerReference} liens par référence, {report.effectiveLimits.maxMovementIdsPerReference} identifiants de mouvements par référence et {report.effectiveLimits.maxPendingChildren} sous-collections en attente. Compteurs entiers sûrs jusqu’à {report.effectiveLimits.safeIntegerMaximum}. Aucune boucle automatique.</Text>
    </> : <Text style={styles.caption}>Les limites effectives de ce parcours complet ne sont pas qualifiées dans cette projection. Aucun ancien plafond n’est présenté comme sa politique actuelle.</Text>
      : <Text style={styles.caption}>Limites V1 : {report.limits.nativePageSize} sources / {report.limits.providerPageSize} mouvements par page ; {report.limits.maxSources} sources, {report.limits.maxNativePages} pages natives, {report.limits.maxProviderPages} pages prestataire et {report.limits.maxAuditPages} pages de contrelecture au maximum.</Text>}
    <Text style={styles.body}>Bornes et relevé</Text>
    <Text style={styles.caption}>Bornes saisies : {closing.qualification === 'declared_unverified' ? 'déclarées, non vérifiées' : 'inconnues'}. Époque saisie : {report.scope.epoch ? `${report.scope.epoch.id} — non vérifiée` : 'aucune'}.</Text>
    {closing.provided ? (['opening', 'closing'] as const).flatMap(side => closing.provided![side].map(boundary => <Text selectable key={`${side}:${boundary.balanceType}`} style={styles.caption}>{side === 'opening' ? 'Ouverture' : 'Clôture'} {boundary.balanceType} : disponible {cents(boundary.availableCents)}, en attente {cents(boundary.pendingCents)} · preuve {boundary.evidenceReference.reference} / {boundary.evidenceReference.contentHash}</Text>)) : null}
    <Text style={styles.caption}>Relevé prestataire : {statement?.qualification === 'native_provider_statement' ? 'source native qualifiée pour ce compte et cette période' : 'non qualifié ou absent'}.</Text>
    {statement?.reason ? <Text selectable style={styles.caption}>Motif : {statement.reason}</Text> : null}
    {statement?.summary ? <Text style={styles.body}>Ouverture {cents(statement.summary.openingCents)} · activité {cents(statement.summary.activityNetCents)} · versements {cents(statement.summary.payoutNetCents)} · clôture {cents(statement.summary.closingCents)}.</Text> : null}
    <Text style={styles.body}>{flow.qualification === 'observed_provider_flow_matches_statement' ? 'Flux prestataire observés concordants avec le relevé' : 'Concordance des flux prestataire non qualifiée'}</Text>
    <Text style={styles.caption}>Net observé {cents(flow.observedNetCents)} · net du relevé {cents(flow.statementNetCents)} · écart {cents(flow.differenceCents)}. {flow.reason ?? ''}</Text>
    <Text style={styles.caption}>Cette comparaison concerne les flux du seul compte observé. Elle ne certifie ni le rapprochement des portefeuilles, ni le solde global, ni une arrivée bancaire ou une période fiscale.</Text>
    <Text style={styles.body}>Groupes de mouvements prestataire</Text>
    <Text style={styles.caption}>Portefeuilles et ledger : cents. Écritures platform_ledger : dollars, convertis explicitement en cents pour la lecture. Registre fiscal parallèle, revenus et mouvements Stripe restent distincts ; aucune somme entre ces registres n’est proposée.</Text>
    {report.groups.slice(safeOffset, safeOffset + 10).map(g => <View key={g.groupHash} style={styles.group}>
      <Text style={styles.body}>{g.balanceType ?? 'compartiment inconnu'} · {g.status ?? 'état inconnu'} · {g.type ?? 'type inconnu'} · {g.reportingCategory ?? 'catégorie inconnue'}</Text>
      <Text style={styles.caption}>{g.movements} mouvements · brut {cents(g.amountCents)} · frais {cents(g.feeCents)} · net {cents(g.netCents)}.</Text>
      {g.qualification === 'unknown_arithmetic_overflow' ? <Text style={styles.caption}>Couverture arithmétique inconnue : ces chiffres ne constituent pas un total qualifié.</Text> : null}
    </View>)}
    <Text style={styles.caption}>Groupes affichés : {report.groups.length ? safeOffset + 1 : 0}–{Math.min(safeOffset + 10, report.groups.length)} / {report.groups.length}. Prestataire uniquement.</Text>
    {safeOffset > 0 ? <Button variant="secondary" onPress={() => setOffset(Math.max(0, safeOffset - 10))}>Groupes précédents</Button> : null}
    {safeOffset + 10 < report.groups.length ? <Button variant="secondary" onPress={() => setOffset(safeOffset + 10)}>Groupes suivants</Button> : null}
    {page ? <View style={styles.section}><Text style={styles.body}>Page documentaire {page.sequence} · {page.phase}</Text>
      <Text selectable style={styles.caption}>{page.reference.id} · {page.reference.contentHash} · {page.createdAt}</Text>
      <Text style={styles.caption}>Cette page locale contient au plus dix entrées. Elle ne représente pas tout le rapport et n’en prouve pas l’exhaustivité.</Text>
      {page.entries.length === 0 ? <Text style={styles.caption}>Page sans entrée ; la couverture globale reste celle du rapport.</Text> : null}
      {page.entries.map(entry => <View key={entry.entryId} style={styles.group}>
        <Text selectable style={styles.body}>{entry.kind} · {entry.qualification} · {entry.providerMovementId ?? entry.source?.path ?? entry.entryId}</Text>
        <Text selectable style={styles.caption}>{entry.reasonCodes.join(' · ') || 'Aucun motif inconnu dans cette entrée.'}</Text>
        <Text style={styles.caption}>Montant {cents(entry.amountCents, entry.currency)}, frais {cents(entry.feeCents, entry.currency)}, net {cents(entry.netCents, entry.currency)} · {entry.balanceType ?? 'compartiment inconnu'} · {entry.type ?? 'type inconnu'}.</Text>
        {entry.contractReferences.map(reference => <Text selectable key={reference} style={styles.caption}>Lien natif : {reference}</Text>)}
      </View>)}
    </View> : null}
  </View>;
}
const styles = StyleSheet.create({section: {gap: spacing.sm, paddingVertical: spacing.sm}, group: {gap: spacing.xs, paddingVertical: spacing.sm, borderBottomWidth: StyleSheet.hairlineWidth, borderColor: colors.border}, body: {...typography.bodySmall, color: colors.foreground}, caption: {...typography.caption, color: colors.muted}});
