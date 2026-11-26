import {useState} from 'react';
import {StyleSheet, Text, View} from 'react-native';
import {useQuery, useQueryClient} from '@tanstack/react-query';
import {randomUUID} from 'expo-crypto';
import {Button} from '@/components/ui';
import {SellerTaxCommandJournal} from '@/components/SellerTaxCommandJournal';
import {SellerTaxDocumentCard, SELLER_TAX_ASSISTANCE_LABELS} from '@/components/SellerTaxDocumentCard';
import {SellerTaxAdminCommandForm} from '@/components/SellerTaxAdminCommandForm';
import {SellerTaxAnnualCapture} from '@/components/SellerTaxAnnualCapture';
import {SellerTaxPrivateReauthentication} from '@/components/SellerTaxPrivateReauthentication';
import {useLabelLifecycleContext} from '@/hooks/useLabelLifecycleContext';
import {getAuthSessionGeneration} from '@/store/authStore';
import {SellerTaxService, sellerTaxEqual} from '@/services/sellerTaxService';
import {SellerTaxJournal} from '@/services/sellerTaxJournal';
import {SELLER_TAX_COLLECTIONS, SELLER_TAX_ASSISTANCE_REASONS} from '@/types/sellerTax';
import type {SellerTaxCollection, SellerTaxCommand, SellerTaxScope, SellerTaxDocumentReference, SellerTaxResponse, SellerTaxAssistanceReason, SellerTaxCaptureReference} from '@/types/sellerTax';
import {colors, radius, spacing, typography} from '@/constants/theme';

const collectionLabels: Record<SellerTaxCollection, string> = {events: 'Événements', identities: 'Statuts documentaires', snapshots: 'Résumés annuels', declarations: 'Déclarations préparées',
  filings: 'Reçus de dépôt externes', deliveries: 'Remises de copie et déclarations d’accès', assistance: 'Demandes d’aide', credit_notes: 'Notes de crédit', captures: 'Captures annuelles'};
export function SellerTaxDossierPanel({uid, scope, newCommandsEnabled = true, qualifySubject, sourceId}: {
  uid: string; scope: SellerTaxScope; newCommandsEnabled?: boolean; qualifySubject?: () => Promise<void>; sourceId?: string;
}) {
  const [privateReadsPaused, setPrivateReadsPaused] = useState(false);
  const scopeKey = JSON.stringify(scope), generation = getAuthSessionGeneration(), context = useLabelLifecycleContext(`seller-tax:${scopeKey}:${privateReadsPaused ? 'paused' : 'read'}`, uid), client = useQueryClient();
  const [collection, setCollection] = useState<SellerTaxCollection>(scope.subject === 'operator' ? 'identities' : 'events'), [cursor, setCursor] = useState<string | null>(null);
  const [reasonCode, setReason] = useState<SellerTaxAssistanceReason>('missing_copy');
  const [selection, setSelection] = useState<{version: number; reference: SellerTaxDocumentReference} | null>(null);
  const [captureReference, setCaptureReference] = useState<SellerTaxCaptureReference | null>(null);
  const [preparationCapture, setPreparationCapture] = useState<{version: number; reference: SellerTaxCaptureReference} | null>(null);
  const [work, setWork] = useState({frame: context.frame, focus: context.focusRevision, busy: false, message: ''});
  const workCurrent = work.frame === context.frame && work.focus === context.focusRevision, busy = workCurrent && work.busy;
  const caseKey = ['seller-tax-dossier', uid, generation, scopeKey, context.focusRevision];
  const dossier = useQuery({queryKey: caseKey, enabled: context.focused && !privateReadsPaused, staleTime: 0, gcTime: 0, retry: false, structuralSharing: false,
    queryFn: () => {const op = context.capture(); return SellerTaxService.observe(uid, scope, () => context.assertCurrent(op));}});
  const operatorScope: SellerTaxScope = {access: 'admin', subject: 'operator', ownerId: null, year: scope.year};
  const operatorKey = ['seller-tax-operator-admission', uid, generation, scope.year, context.focusRevision];
  const operator = useQuery({queryKey: operatorKey, enabled: context.focused && scope.access === 'admin' && scope.subject === 'seller', staleTime: 0, gcTime: 0, retry: false, structuralSharing: false,
    queryFn: () => {const op = context.capture(); return SellerTaxService.observe(uid, operatorScope, () => context.assertCurrent(op));}});
  const operatorReadReady = scope.access !== 'admin' || scope.subject === 'operator' || operator.isSuccess && !operator.isFetching && !operator.isError && !operator.data.caseView.opaque;
  const ready = context.focused && !privateReadsPaused && dossier.isSuccess && !dossier.isFetching && !dossier.isError && !dossier.data.caseView.opaque && operatorReadReady;
  const currentCase = ready && dossier.data && !dossier.data.caseView.opaque ? dossier.data.caseView : null;
  const version = currentCase?.version ?? null;
  const slot = useQuery({queryKey: ['seller-tax-journal-slot', uid, generation, context.focusRevision], enabled: context.focused, staleTime: 0, gcTime: 0, retry: false,
    queryFn: () => {const op = context.capture(); return SellerTaxJournal.read(uid, () => context.assertCurrent(op));}});
  const pageKey = ['seller-tax-page', uid, generation, scopeKey, collection, cursor, context.focusRevision, version];
  const page = useQuery({queryKey: pageKey, enabled: ready, staleTime: 0, gcTime: 0, retry: false, structuralSharing: false,
    queryFn: () => {const op = context.capture(); return SellerTaxService.page(uid, scope, collection, cursor, () => context.assertCurrent(op));}});
  const pageReady = ready && page.isSuccess && !page.isFetching && !page.isError && !page.data.caseView.opaque && page.data.caseView.version === version;
  const canCommand = ready && !page.isError && newCommandsEnabled && !busy && slot.isSuccess && !slot.isFetching && !slot.isError && slot.data === null;
  const entries = pageReady ? page.data.page?.entries ?? [] : [];
  const operatorView = scope.subject === 'operator' ? currentCase?.operator : operatorReadReady && operator.data && !operator.data.caseView.opaque ? operator.data.caseView.operator : null;
  const operatorQualified = operatorView?.status === 'documented_reporting_operator' && operatorView.identityAvailable;
  const selectedDeclaration = selection?.version === version ? selection.reference : currentCase?.lastDeclaration ?? null;
  const refresh = async () => {
    const op = context.capture();
    await Promise.allSettled([dossier.refetch(), slot.refetch(), ...(scope.access === 'admin' && scope.subject === 'seller' ? [operator.refetch()] : []), ...(scope.subject === 'seller' ? [page.refetch()] : [])]);
    context.assertCurrent(op);
    setPrivateReadsPaused(false);
  };
  const submit = async (command: SellerTaxCommand, expectedPage?: SellerTaxResponse) => {
    if (!canCommand || version === null || command.expectedVersion !== version) return;
    let op; try {op = context.start();} catch {return;} if (!op) return;
    const nativeProjection = dossier.data, operatorProjection = operator.data;
    const guard = () => context.assertCurrent(op);
    const verifySource = () => {
      guard();
      if (client.getQueryData(caseKey) !== nativeProjection || scope.access === 'admin' && scope.subject === 'seller' && client.getQueryData(operatorKey) !== operatorProjection ||
          expectedPage && client.getQueryData(pageKey) !== expectedPage) throw new Error('La projection fiscale a changé.');
    };
    setWork({frame: context.frame, focus: context.focusRevision, busy: true, message: ''});
    try {
      verifySource(); if (qualifySubject) {await qualifySubject(); verifySource();}
      const fresh = await SellerTaxService.observe(uid, scope, guard); verifySource();
      if (fresh.caseView.opaque || fresh.caseView.version !== version) throw new Error('Le dossier fiscal a changé.');
      if ('captureReference' in command && command.captureReference) {
        const capture = await SellerTaxService.capture(uid, scope, command.captureReference, guard); verifySource();
        if (command.action !== 'annual_capture_advance' && capture.status !== 'complete') throw new Error('La capture doit être complète et actuelle.');
      }
      if (scope.access === 'admin' && ['identity_record', 'evidence_event'].includes(command.action)) {
        const freshOperator = await SellerTaxService.observe(uid, operatorScope, guard); verifySource();
        if (freshOperator.caseView.opaque || freshOperator.caseView.operator?.status !== 'documented_reporting_operator' || !freshOperator.caseView.operator.identityAvailable ||
            !operatorProjection || operatorProjection.caseView.opaque || !sellerTaxEqual(freshOperator.caseView.operator, operatorProjection.caseView.operator)) throw new Error('L’exploitant fiscal doit être requalifié.');
      }
      const attempt = await SellerTaxService.attempt(uid, scope, randomUUID(), command, guard); verifySource();
      const response = await SellerTaxJournal.submit(attempt, guard, verifySource); guard();
      setWork({frame: context.frame, focus: context.focusRevision, busy: true, message: response.commandReceipt?.status === 'completed'
        ? 'L’acte documentaire est enregistré. Relisez et terminez son suivi exact avant une autre commande.' : 'La commande reste à observer avec sa référence exacte.'});
    } catch {if (context.isCurrent(op)) setWork({frame: context.frame, focus: context.focusRevision, busy: true,
      message: 'La commande, sa source ou son résultat reste à vérifier. Une intention enregistrée est conservée ; relisez son suivi exact avant une autre action.'});}
    finally {
      if (context.isCurrent(op)) {
        await Promise.allSettled([client.invalidateQueries({queryKey: ['seller-tax-local-command', uid]}), client.invalidateQueries({queryKey: ['seller-tax-journal-slot', uid]}),
          client.invalidateQueries({queryKey: ['seller-tax-dossier', uid]}), client.invalidateQueries({queryKey: ['seller-tax-page', uid]})]);
        if (context.isCurrent(op)) setWork(previous => ({...previous, busy: false}));
      }
      context.finish(op);
    }
  };
  return <View style={styles.section}>
    <SellerTaxCommandJournal uid={uid}/>
    {scope.access === 'owner' ? <SellerTaxPrivateReauthentication uid={uid} sourceKey={scopeKey} active={context.focused} onStart={() => setPrivateReadsPaused(true)}/> : null}
    <View style={styles.card}>
      <Text style={styles.title}>Dossier fiscal documentaire · {scope.year}</Text>
      <Text style={styles.caption}>Les faits fiscaux, l’inscription TPS/TVQ et l’acceptation d’un dépôt officiel ne sont pas certifiés par cette consultation. Aucun montant inconnu n’est remplacé par zéro.</Text>
      {!context.focused ? <Text style={styles.body}>Relisez le dossier depuis la page active et la session actuelle.</Text> : dossier.isError || page.isError || !operatorReadReady && operator.isError
        ? <Text style={styles.body}>Le dossier privé ou les droits actuels ne peuvent pas être confirmés. Les projections antérieures sont masquées.</Text> : !ready ? <Text style={styles.body}>Lecture des sources actuelles…</Text> : null}
      {currentCase && !page.isError ? <>
        <Text style={styles.body}>Version native : {currentCase.version} · Création : {currentCase.createdAt === null ? 'aucun enregistrement du dossier dans cette lecture' : `${new Date(currentCase.createdAt).toLocaleString('fr-CA', {timeZone: 'UTC'})} UTC`}.</Text>
        <Text style={styles.body}>Pages de sources : {currentCase.scan.pages} · {currentCase.scan.closed ? 'parcours terminé lors de cette lecture' : 'parcours incomplet'} · {currentCase.scan.issues.length ? 'des sources restent à rapprocher' : 'aucun problème signalé dans ce parcours limité'}. Aucune exhaustivité à un instant donné n’est garantie.</Text>
        {scope.access === 'admin' ? <Text style={styles.caption}>Exploitant annuel : {operatorQualified ? 'éléments documentaires présents, sans certification externe' : 'qualification ou finalité de collecte manquante'}. Le coffre et sa qualification restent soumis aux vérifications du serveur.</Text> : null}
        {slot.isError ? <Text style={styles.caption}>Le journal ne peut pas être confirmé ; aucune nouvelle commande n’est proposée.</Text> : slot.data ? <Text style={styles.caption}>Terminez le suivi exact de l’intention déjà conservée avant une autre commande.</Text> : null}
        {!newCommandsEnabled ? <Text style={styles.caption}>Confirmez à nouveau votre identité et la source sélectionnée avant un nouvel acte administratif. L’historique et vos reçus restent distincts.</Text> : null}
        {scope.subject === 'seller' ? <>
          <SellerTaxAnnualCapture uid={uid} scope={scope} version={currentCase.version} reference={captureReference} disabled={!canCommand}
            onCommand={command => {void submit(command);}} onUse={reference => setPreparationCapture(reference ? {version: currentCase.version, reference} : null)}/>
          <Button variant="secondary" disabled={!canCommand || currentCase.scan.closed} onPress={() => {void submit({action: 'scan', expectedVersion: currentCase.version});}}>Examiner une page bornée de sources</Button>
          <Button variant="secondary" disabled={!canCommand} onPress={() => {void submit({action: 'snapshot', expectedVersion: currentCase.version});}}>Enregistrer un résumé limité aux événements enregistrés</Button>
          {scope.access === 'owner' ? <View style={styles.section}>
            <Text style={styles.title}>Demander une aide fiscale</Text>
            <Text style={styles.caption}>Choisissez uniquement un motif. Ne fournissez aucun identifiant fiscal, nom, adresse, date de naissance ou document dans ce parcours.</Text>
            {SELLER_TAX_ASSISTANCE_REASONS.map(reason => <Button key={reason} variant={reasonCode === reason ? 'secondary' : 'ghost'} disabled={!canCommand} onPress={() => setReason(reason)}>{SELLER_TAX_ASSISTANCE_LABELS[reason]}</Button>)}
            <Button disabled={!canCommand} onPress={() => {void submit({action: 'assistance', expectedVersion: currentCase.version, reasonCode});}}>Enregistrer cette demande d’aide fiscale</Button>
          </View> : null}
        </> : null}
        {scope.access === 'admin' ? <SellerTaxAdminCommandForm key={`${scopeKey}:${currentCase.version}`} scope={scope} version={currentCase.version}
          disabled={!canCommand} operatorQualified={operatorQualified} declaration={selectedDeclaration} sourceId={sourceId}
          captureReference={preparationCapture?.version === currentCase.version ? preparationCapture.reference : null} onCommand={command => {void submit(command);}}/> : null}
      </> : null}
      <Button variant="ghost" disabled={busy || !context.focused || dossier.isFetching || page.isFetching} onPress={() => {void refresh().catch(() => undefined);}}>Relire le dossier fiscal actuel</Button>
      {workCurrent && work.message && context.focused ? <Text style={styles.caption}>{work.message}</Text> : null}
    </View>
    <View style={styles.card}>
      <Text style={styles.title}>Historique documentaire par page</Text>
      {SELLER_TAX_COLLECTIONS.filter(value => scope.subject === 'seller' || value === 'identities').map(value => <Button key={value} variant={value === collection ? 'secondary' : 'ghost'} disabled={!ready || busy}
        onPress={() => {try {context.capture(); setCollection(value); setCursor(null);} catch {/* Current source only. */}}}>{collectionLabels[value]}</Button>)}
      {ready && page.isError ? <Text style={styles.body}>Cette page privée ne peut pas être confirmée. Aucun ancien document n’est affiché.</Text> : !pageReady ? <Text style={styles.body}>La page doit être relue et correspondre à la version actuelle du dossier.</Text> : <>
        <Text style={styles.caption}>{page.data.page?.inspected ?? 0} lignes inspectées dans cette page. Une page locale ne représente pas tout l’historique ni toute l’année.</Text>
        {!entries.length ? <Text style={styles.body}>Aucun document visible dans cette page de cette catégorie.</Text> : null}
        {entries.map(entry => <SellerTaxDocumentCard key={entry.reference.id} {...entry} access={scope.access} version={version!} disabled={!canCommand} uid={uid} scope={scope}
          qualifySource={() => {const op = context.capture(); context.assertCurrent(op); if (!pageReady || client.getQueryData(pageKey) !== page.data || client.getQueryState(pageKey)?.fetchStatus === 'fetching') throw new Error('La page a changé.');}}
          onSelectCapture={reference => {try {context.capture(); if (client.getQueryData(pageKey) !== page.data || !pageReady) return; setCaptureReference(reference); setPreparationCapture(null);} catch {/* Native page only. */}}}
          onCommand={command => {void submit(command, page.data);}} onSelectDeclaration={scope.access === 'admin' ? reference => {
            try {context.capture(); if (client.getQueryData(pageKey) !== page.data || version === null) return; setSelection({version, reference});} catch {/* A stale page cannot select a document. */}
          } : undefined}/>)}
        {page.data.page?.hasMore ? <Button variant="secondary" disabled={busy} onPress={() => {
          try {context.capture(); if (client.getQueryData(pageKey) === page.data && page.data.page?.nextCursor) setCursor(page.data.page.nextCursor);} catch {/* Native cursor only. */}
        }}>Lire la prochaine page native</Button> : null}
        {cursor !== null ? <Button variant="ghost" disabled={busy} onPress={() => {try {context.capture(); setCursor(null);} catch {/* Current frame only. */}}}>Revenir à la première page</Button> : null}
      </>}
      <Button variant="ghost" disabled={!ready || page.isFetching || busy} onPress={() => {try {context.capture(); void page.refetch();} catch {/* Current frame only. */}}}>Relire cette page documentaire</Button>
    </View>
  </View>;
}
const styles = StyleSheet.create({section: {gap: spacing.md}, card: {gap: spacing.sm, padding: spacing.md, borderWidth: StyleSheet.hairlineWidth, borderColor: colors.border, borderRadius: radius.md},
  title: {...typography.body, color: colors.foreground}, body: {...typography.bodySmall, color: colors.foreground}, caption: {...typography.caption, color: colors.muted}});
