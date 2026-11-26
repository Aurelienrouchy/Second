import { useCallback, useEffect, useRef, useState } from 'react';
import { AppState, StyleSheet, Text, View } from 'react-native';
import { FlashList } from '@shopify/flash-list';
import { useQuery } from '@tanstack/react-query';
import { useRouter } from 'expo-router';
import { Button, Checkbox, Input, ScreenHeader } from '@/components/ui';
import { AdminSectionNav } from '@/features/admin';
import { colors, radius, spacing, typography } from '@/constants/theme';
import { APP_LOCALE } from '@/constants/locale';
import { useAuthenticatedUid } from '@/hooks/useAuth';
import { useShippingPurchaseContext } from '@/hooks/useShippingPurchaseContext';
import { getAuthSessionGeneration } from '@/store/authStore';
import { staleTradeOperation } from '@/services/tradeOperation';
import { PrivacyIncidentService, newPrivacyIncidentRequestId, validPrivacyExternalDate, privacyIncidentCanAcknowledge, privacyIncidentCanResume } from '@/services/privacyIncidentService';
import type { PrivacyCAIChannel, PrivacyIncidentAttempt, PrivacyIncidentRecord, PrivacyIncidentSeverity, PrivacyIncidentStatus, PrivacyIncidentReceipt, PrivacyOwnCommandReceipt } from '@/types/privacyIncident';

const incidentKey = (incident: PrivacyIncidentRecord) => incident.id;
const reference = (value: string) => /^[A-Za-z0-9_-]{1,200}$/.test(value);
const lines = (value: string) => [...new Set(value.split('\n').map(line => line.trim()).filter(Boolean))].sort();
const severityLabels: Record<PrivacyIncidentSeverity, string> = { low: 'Faible', medium: 'Moyen', high: 'Élevé', critical: 'Critique' };
const statusLabels: Record<PrivacyIncidentStatus, string> = { open: 'Ouvert', investigating: 'En examen', contained: 'Contenu', resolved: 'Résolu' };
const channelLabels: Record<PrivacyCAIChannel, string> = { cai_secure_form: 'Formulaire sécurisé CAI', registered_mail: 'Courrier recommandé', email: 'Courriel', other: 'Autre canal externe' };
const formatDate = (value: string | null) => value ? new Date(value).toLocaleString(APP_LOCALE) : 'Date non qualifiée';

function receiptSummary(receipt: PrivacyIncidentReceipt | PrivacyOwnCommandReceipt): string {
  if (receipt.protocol === 'privacy_own_command_receipt_v1') {
    if (receipt.state === 'unrecorded') return 'Cette commande était absente lors de la lecture. Son identité est conservée ; cette seule lecture ne la neutralise pas.';
    if (receipt.state === 'not_executed') return 'Cette intention exacte a été neutralisée avant exécution. Son reçu peut être relu puis acquitté.';
    if (receipt.opaque) return 'Votre commande est enregistrée. Ce reçu ne donne aucun accès au dossier privé et ne confirme ni achèvement des avis ni envoi ou réception par la CAI.';
    if (receipt.receipt) return receiptSummary(receipt.receipt);
    return 'Le résultat complet reste à qualifier.';
  }
  if (receipt.opaque === true) return 'Votre commande est enregistrée. Le reçu opaque ne confirme aucun nombre de destinataires ni achèvement des avis ; aucun envoi ou réception par la CAI n’est certifié.';
  if (receipt.protocol === 'privacy_user_notices_v1') return 'Le reçu des avis a été relu. Son état qualifié figure dans le journal sous autorisation actuelle ; la réception sur un appareil et la lecture ne sont pas prouvées.';
  return receipt.protocol === 'privacy_cai_external_v1' ? 'La déclaration documentée de l’action externe a été enregistrée. L’application n’a rien envoyé à la CAI et ne certifie pas sa réception.'
    : 'Incident enregistré avec sa référence déterministe. Aucune obligation légale ni notification n’est déduite de sa création.';
}

/** Private operator register. No severity choice makes an automatic legal decision. */
export default function AdminPrivacyIncidentsScreen() {
  const router = useRouter(), uid = useAuthenticatedUid();
  const sessionKey = JSON.stringify([uid, getAuthSessionGeneration()]);
  const [activity, setActivity] = useState(() => ({ state: AppState.currentState, revision: 0 }));
  const activeFrame = useRef(activity);
  useEffect(() => {
    const changed = (state: typeof AppState.currentState) => {
      if (state === activeFrame.current.state) return;
      const next = { state, revision: activeFrame.current.revision + 1 };
      activeFrame.current = next; setActivity(next);
    };
    const subscription = AppState.addEventListener('change', changed); changed(AppState.currentState);
    return () => subscription.remove();
  }, []);
  const [authorityBlocked, setAuthorityBlocked] = useState(false);
  const [lookup, setLookup] = useState(''), [incidentId, setIncidentId] = useState<string | null>(null);
  const base = useShippingPurchaseContext(JSON.stringify(['admin-privacy-incidents', incidentId, activity.revision]), uid);
  type Operation = { base: ReturnType<typeof base.capture>; activityRevision: number };
  const active = (revision: number) => {
    if (AppState.currentState !== 'active' || activeFrame.current.state !== 'active' || activeFrame.current.revision !== revision) throw staleTradeOperation();
  };
  const assertCurrent = (operation: Operation) => { active(operation.activityRevision); base.assertCurrent(operation.base); };
  const focused = base.focused && activity.state === 'active' && AppState.currentState === 'active';
  const focusRevision = JSON.stringify([base.focusRevision, activity.revision]);
  const context = {
    capture: (): Operation => { active(activity.revision); return { base: base.capture(), activityRevision: activity.revision }; },
    start: (): Operation | null => { try { active(activity.revision); const operation = base.start(); return operation ? { base: operation, activityRevision: activity.revision } : null; } catch { return null; } },
    assertCurrent,
    isCurrent: (operation: Operation) => { try { assertCurrent(operation); return true; } catch { return false; } },
    finish: (operation: Operation) => base.finish(operation.base),
  };
  const scope = JSON.stringify([sessionKey, incidentId, focusRevision]);
  const permission = useQuery({ queryKey: ['admin-privacy-permission', sessionKey, focusRevision],
    enabled: !!uid && focused, staleTime: 0, gcTime: 0, retry: false,
    queryFn: () => { const operation = context.capture(); return PrivacyIncidentService.permission(operation.base.session.uid, () => context.assertCurrent(operation)); },
  });
  const permitted = permission.data === true && !permission.isError && !permission.isFetching && !authorityBlocked;
  const incidents = useQuery({ queryKey: ['admin-privacy-incidents', sessionKey, incidentId, focusRevision, permission.dataUpdatedAt],
    enabled: !!uid && permitted && focused, staleTime: 0, gcTime: 0, retry: false,
    queryFn: () => { const operation = context.capture(); return PrivacyIncidentService.read(operation.base.session.uid, incidentId, () => context.assertCurrent(operation)); },
  });
  const journal = useQuery({ queryKey: ['admin-privacy-journal', sessionKey, focusRevision, incidentId],
    enabled: !!uid && focused, staleTime: 0, gcTime: 0, retry: false,
    queryFn: () => { const operation = context.capture(); return PrivacyIncidentService.journal(operation.base.session.uid, () => context.assertCurrent(operation)); },
  });
  const sourceReady = permitted && focused && incidents.isSuccess && !incidents.isFetching && journal.isSuccess && !journal.isFetching;
  const current = sourceReady && incidentId ? incidents.data?.find(value => value.id === incidentId) ?? null : null;
  const pending = focused && journal.isSuccess && !journal.isFetching ? journal.data : null;
  const [type, setType] = useState(''), [description, setDescription] = useState(''), [affectedUsers, setAffectedUsers] = useState('');
  const [affectedFields, setAffectedFields] = useState(''), [measures, setMeasures] = useState('');
  const [severity, setSeverity] = useState<PrivacyIncidentSeverity>('medium'), [status, setStatus] = useState<PrivacyIncidentStatus>('open');
  const [messageVersion, setMessageVersion] = useState(''), [message, setMessage] = useState('');
  const [notifiedAt, setNotifiedAt] = useState(''), [channel, setChannel] = useState<PrivacyCAIChannel>('cai_secure_form');
  const [caiReference, setCAIReference] = useState(''), [evidenceReference, setEvidenceReference] = useState('');
  const [action, setAction] = useState<'notice' | 'cai' | null>(null), [createOpen, setCreateOpen] = useState(false);
  const [confirmation, setConfirmation] = useState<PrivacyIncidentAttempt | null>(null), [confirmed, setConfirmed] = useState(false);
  const [notice, setNotice] = useState(''), [working, setWorking] = useState(false), [formScope, setFormScope] = useState(scope);
  if (formScope !== scope) {
    setFormScope(scope); setAuthorityBlocked(false); setConfirmation(null); setConfirmed(false); setWorking(false); setNotice(''); setAction(null); setCreateOpen(false);
    setType(''); setDescription(''); setAffectedUsers(''); setAffectedFields(''); setMeasures(''); setSeverity('medium'); setStatus('open');
    setMessageVersion(''); setMessage(''); setNotifiedAt(''); setChannel('cai_secure_form'); setCAIReference(''); setEvidenceReference('');
  }
  const blocked = working || !!pending || !sourceReady;
  const refresh = async () => {
    if (!uid || working || !focused) return;
    const operation = context.start(); if (!operation) return;
    setWorking(true); setConfirmation(null); setConfirmed(false);
    try {
      const access = await permission.refetch(); context.assertCurrent(operation);
      setAuthorityBlocked(access.data !== true || access.isError);
      await journal.refetch(); context.assertCurrent(operation);
    }
    catch { if (context.isCurrent(operation)) setNotice('Les sources actuelles ne peuvent pas être confirmées.'); }
    finally { if (context.isCurrent(operation)) setWorking(false); context.finish(operation); }
  };
  const openIncident = useCallback((id: string | null) => {
    if (working || id !== null && !reference(id)) return;
    setIncidentId(id); setLookup(id ?? '');
  }, [working]);
  const renderIncident = useCallback(({ item }: { item: PrivacyIncidentRecord }) => <View style={styles.card}>
    <Text selectable style={styles.title}>{item.type ?? 'Type à qualifier'}</Text>
    <Text selectable style={styles.caption}>{item.id}</Text>
    <Text style={styles.body}>{item.status ? statusLabels[item.status] : 'Statut à qualifier'} · Risque évalué par l’opérateur : {item.severity ? severityLabels[item.severity] : 'à qualifier'}</Text>
    <Text style={styles.caption}>Détection enregistrée : {formatDate(item.detectedAt)}</Text>
    <Button variant="secondary" disabled={working} onPress={() => openIncident(item.id)}>Examiner ce dossier privé</Button>
  </View>, [working, openIncident]);
  const prepare = (kind: PrivacyIncidentAttempt['kind']) => {
    if (!uid || blocked) return;
    try { context.capture(); } catch { return; }
    const identity = { expectedAdminUid: uid, requestId: newPrivacyIncidentRequestId() };
    let attempt: PrivacyIncidentAttempt;
    if (kind === 'create') {
      const affectedUserIds = lines(affectedUsers), affectedDataFields = lines(affectedFields);
      if (!type.trim() || type.trim().length > 100 || !description.trim() || description.trim().length > 10000 ||
          affectedUserIds.length > 1000 || !affectedUserIds.every(reference) || affectedDataFields.length > 100 ||
          affectedDataFields.some(field => field.length > 100) || measures.trim().length > 4000) return;
      attempt = { version: 1, kind, payload: { ...identity, type: type.trim(), description: description.trim(), severity,
        status, affectedUserIds, affectedDataFields, measures: measures.trim() } };
    } else if (kind === 'notice') {
      if (!current || !current.affectedUserIds.length || !/^[A-Za-z0-9_-]{1,64}$/.test(messageVersion) || !message.trim() || message.trim().length > 4000) return;
      attempt = { version: 1, kind, payload: { ...identity, incidentId: current.id, messageVersion, message: message.trim() } };
    } else {
      if (!current || !validPrivacyExternalDate(notifiedAt) ||
          !caiReference.trim() || !evidenceReference.trim()) {
        setNotice('Une date UTC canonique d’une action déjà effectuée, une référence externe et une référence de preuve privée sont requises.'); return;
      }
      attempt = { version: 1, kind, payload: { ...identity, incidentId: current.id, notifiedAt, channel,
        caiReference: caiReference.trim(), evidenceReference: evidenceReference.trim() } };
    }
    setConfirmation(attempt); setConfirmed(false); setNotice('');
  };
  const execute = async (attempt: PrivacyIncidentAttempt, recovery: boolean) => {
    if (!uid || !permitted || working || !focused || (!recovery && (blocked || !confirmed || confirmation !== attempt))) return;
    const operation = context.start(); if (!operation) return;
    setWorking(true); setNotice('');
    try {
      const receipt = await PrivacyIncidentService.execute(attempt, () => context.assertCurrent(operation)); context.assertCurrent(operation);
      setConfirmation(null); setConfirmed(false);
      setNotice(receiptSummary(receipt));
      if (receipt.opaque === true) setAuthorityBlocked(true);
      await journal.refetch(); context.assertCurrent(operation);
      await permission.refetch(); context.assertCurrent(operation);
    } catch {
      if (context.isCurrent(operation)) {
        setConfirmation(null); setConfirmed(false); setNotice('Résultat à vérifier. L’intention conservée doit être relue et reprise avec la même référence et le même contenu.');
        await journal.refetch();
      }
    } finally { if (context.isCurrent(operation)) setWorking(false); context.finish(operation); }
  };
  const acknowledge = async () => {
    if (!pending || !privacyIncidentCanAcknowledge(pending) || working || !focused) return;
    const operation = context.start(); if (!operation) return;
    setWorking(true);
    try {
      await PrivacyIncidentService.acknowledge(pending.reference, () => context.assertCurrent(operation)); context.assertCurrent(operation);
      setNotice('Le reçu de cette commande a été relu et acquitté localement. Cela ne termine ni n’annule une campagne d’avis et ne certifie aucun envoi à la CAI.');
      await journal.refetch(); context.assertCurrent(operation);
      await permission.refetch(); context.assertCurrent(operation);
    } catch { if (context.isCurrent(operation)) setNotice('Le reçu complet ne peut pas encore être acquitté. Le journal reste conservé.'); }
    finally { if (context.isCurrent(operation)) setWorking(false); context.finish(operation); }
  };
  const inspectPending = async (neutralize = false) => {
    if (!pending || working || !focused) return;
    const operation = context.start(); if (!operation) return;
    setWorking(true); setNotice('');
    try {
      const result = neutralize
        ? await PrivacyIncidentService.neutralize(pending.reference, () => context.assertCurrent(operation))
        : await PrivacyIncidentService.observe(pending.reference, () => context.assertCurrent(operation));
      context.assertCurrent(operation); setNotice(receiptSummary(result));
      if (result.opaque && result.state === 'committed') setAuthorityBlocked(true);
      await journal.refetch(); context.assertCurrent(operation);
    } catch { if (context.isCurrent(operation)) setNotice('La référence exacte reste conservée. Une erreur ou un délai ne prouve ni absence, ni exécution, ni neutralisation.'); }
    finally { if (context.isCurrent(operation)) setWorking(false); context.finish(operation); }
  };
  const clearConfirmation = () => { setConfirmation(null); setConfirmed(false); };
  const noticeReceipt = pending?.receipt?.protocol === 'privacy_user_notices_v1' && pending.receipt.opaque !== true ? pending.receipt : null;
  const canAcknowledge = !!pending && privacyIncidentCanAcknowledge(pending);
  const canResume = !!pending && privacyIncidentCanResume(pending);
  const header = <View style={styles.content}>
    <Text style={styles.body}>Registre privé réservé aux opérateurs autorisés. L’évaluation du risque et des obligations reste humaine. Le message aux membres est préparé séparément : n’y ajoutez aucune coordonnée d’un tiers ni pièce privée du registre.</Text>
    <Text style={styles.caption}>Une action CAI se réalise à l’extérieur de l’application. Ce parcours consigne les faits et la référence de cette action ; il ne désigne aucun responsable des renseignements personnels.</Text>
    <Input label="Référence d’incident" value={lookup} autoCapitalize="none" disabled={working} onChangeText={setLookup} />
    <Button variant="secondary" disabled={working || !reference(lookup)} onPress={() => openIncident(lookup)}>Ouvrir cette référence privée</Button>
    <Button variant="ghost" disabled={working} onPress={() => openIncident(null)}>Consulter les 200 dossiers les plus récents</Button>
    <Button variant="ghost" disabled={working} onPress={refresh}>Relire les droits et mon journal</Button>
    {permission.isError ? <Text accessibilityRole="alert" style={styles.notice}>Les droits administrateur n’ont pas pu être confirmés.</Text> : null}
    {incidents.isError ? <Text accessibilityRole="alert" style={styles.notice}>Les preuves privées ne sont pas actuellement lisibles. Aucune absence ou clôture n’est déduite.</Text> : null}
    {journal.isError ? <Text accessibilityRole="alert" style={styles.notice}>Le journal local ne peut pas être relu. Une nouvelle action reste bloquée.</Text> : null}
    {notice ? <Text accessibilityRole="alert" style={styles.notice}>{notice}</Text> : null}
    {pending ? <View style={styles.card}>
      <Text style={styles.title}>Intention conservée</Text>
      <Text selectable style={styles.caption}>Référence : {pending.reference.requestId}</Text>
      <Text style={styles.body}>Action : {pending.reference.kind === 'create' ? 'Créer le dossier' : pending.reference.kind === 'cai' ? 'Documenter une action CAI externe' : 'Enregistrer les avis aux membres'}</Text>
      <Text selectable style={styles.caption}>Incident : {pending.reference.incidentId}</Text>
      {!pending.receipt && !pending.proof ? <Text style={styles.notice}>Résultat inconnu. Une absence, un délai ou une erreur ne permet pas d’abandonner cette intention.</Text> : null}
      {pending.proof?.state === 'unrecorded' ? <Text style={styles.notice}>La commande était absente lors de la dernière lecture. Cette observation ne bloque pas une exécution tardive. Seule une neutralisation native confirmée peut la rendre inexécutable.</Text> : null}
      {pending.proof?.state === 'not_executed' ? <Text style={styles.body}>Cette intention a été neutralisée avant son exécution. Le reçu ne concerne que cette référence.</Text> : null}
      {permitted && noticeReceipt ? <Text style={styles.body}>{noticeReceipt.inAppCommittedCount}/{noticeReceipt.total} avis enregistrés · {noticeReceipt.pendingCount} restants. {noticeReceipt.transportIntentCount} intentions de transport enregistrées ; réception et lecture non prouvées.</Text> : null}
      {pending.receipt?.protocol === 'privacy_incident_creation_v1' ? <Text selectable style={styles.body}>Incident créé : {pending.receipt.incidentId} · {formatDate(pending.receipt.createdAt)}</Text> : null}
      {permitted && pending.receipt?.protocol === 'privacy_cai_external_v1' && pending.receipt.opaque !== true ? <Text style={styles.body}>Action externe déclarée le {formatDate(pending.receipt.notifiedAt)}. Envoi par l’application : aucun.</Text> : null}
      {pending.version === 2 || !permitted || pending.receipt?.opaque === true ? <Text style={styles.caption}>Suivi de votre propre commande seulement. Aucun corps privé, destinataire ni achèvement des avis n’est établi. Un acquittement local ne termine ni n’annule la campagne et ne permet pas de la reprendre depuis cette référence.</Text> : null}
      <Button loading={working} disabled={working} onPress={() => inspectPending()}>Relire le reçu exact sans exécuter</Button>
      {pending.version === 1 && pending.proof?.state === 'unrecorded' ? <Button variant="secondary" disabled={working} onPress={() => inspectPending(true)}>Neutraliser cette intention encore absente</Button> : null}
      {canResume && permitted && pending.attempt ? <Button variant="secondary" disabled={working} onPress={() => { if (pending.attempt) void execute(pending.attempt, true); }}>{noticeReceipt ? 'Reprendre les avis manquants avec la même intention' : 'Exécuter cette intention exacte relue absente'}</Button> : null}
      {canAcknowledge ? <Button variant="secondary" disabled={working} onPress={acknowledge}>Relire et acquitter le reçu de ma commande</Button> : null}
    </View> : null}
    {current ? <View style={styles.card}>
      <Text style={styles.title}>Dossier privé : {current.type ?? 'Type à qualifier'}</Text>
      <Text selectable style={styles.caption}>{current.id}</Text>
      <Text selectable style={styles.body}>{current.description ?? 'Description à qualifier'}</Text>
      <Text style={styles.body}>Risque humain : {current.severity ? severityLabels[current.severity] : 'à qualifier'} · Statut : {current.status ? statusLabels[current.status] : 'à qualifier'}</Text>
      <Text selectable style={styles.body}>Personnes identifiées : {current.affectedUserIds.join(', ') || 'Aucune liste établie'}</Text>
      <Text selectable style={styles.body}>Champs concernés : {current.affectedDataFields.join(', ') || 'À établir'}</Text>
      <Text selectable style={styles.body}>Mesures consignées : {current.measures || 'À établir'}</Text>
      <Text style={styles.body}>CAI : {current.caiNotificationState === 'external_action_documented' ? 'Action externe documentée' : current.caiNotificationState === 'historical_unqualified' ? 'Déclaration historique sans preuve qualifiée' : 'Aucune action externe documentée'}</Text>
      {current.caiNotificationReceipt ? <Text selectable style={styles.caption}>{channelLabels[current.caiNotificationReceipt.channel]} · {formatDate(current.caiNotificationReceipt.notifiedAt)}{ '\n' }Référence externe : {current.caiNotificationReceipt.caiReference}{ '\n' }Référence de preuve privée : {current.caiNotificationReceipt.evidenceReference}{ '\n' }Aucun envoi par l’application ; réception CAI non certifiée.</Text> : null}
      <Text style={styles.body}>Avis membres : {current.userNotificationState === 'in_app_committed' ? 'Tous les avis de cette campagne enregistrés dans l’application' : current.userNotificationState === 'pending_or_unqualified' ? 'Campagne à poursuivre ou rapprocher' : current.userNotificationState === 'historical_unqualified' ? 'Ancienne déclaration sans preuve de livraison' : 'Aucune campagne enregistrée'}. Réception sur un appareil et lecture non prouvées.</Text>
      <Button variant="secondary" disabled={blocked || !current.affectedUserIds.length} onPress={() => { setAction('notice'); clearConfirmation(); }}>Préparer les avis aux personnes identifiées</Button>
      <Button variant="secondary" disabled={blocked} onPress={() => { setAction('cai'); clearConfirmation(); }}>Consigner une action CAI déjà effectuée</Button>
    </View> : null}
    {incidentId && sourceReady && !current ? <Text style={styles.notice}>Ce dossier n’a pas été trouvé par sa référence directe. Cela ne résout aucune intention conservée.</Text> : null}
    {current && action === 'notice' && !pending ? <View style={styles.card}>
      <Text style={styles.title}>Avis aux membres concernés</Text>
      <Text style={styles.body}>Le serveur fige cette version, son message et la liste vérifiée. Chaque reprise traite au plus 50 avis manquants, sans créer une nouvelle campagne. Vérifiez humainement les destinataires et le contenu avant de confirmer.</Text>
      <Input label="Version du message" hint="Identifiant explicite, lettres/chiffres/tiret : ex. avis_20261013_v1" value={messageVersion} maxLength={64} autoCapitalize="none" disabled={blocked} onChangeText={value => { setMessageVersion(value); clearConfirmation(); }} />
      <Input label="Message destiné aux membres" hint="N’incluez aucune donnée d’autres membres ni pièce privée." value={message} multiline maxLength={4000} disabled={blocked} onChangeText={value => { setMessage(value); clearConfirmation(); }} />
      <Button disabled={blocked || !/^[A-Za-z0-9_-]{1,64}$/.test(messageVersion) || !message.trim()} onPress={() => prepare('notice')}>Examiner le message et la version</Button>
    </View> : null}
    {current && action === 'cai' && !pending ? <View style={styles.card}>
      <Text style={styles.title}>Action externe déjà effectuée</Text>
      <Text style={styles.body}>Consignez la date réelle, le canal, la référence obtenue et une référence de preuve privée. L’application ne contacte pas la CAI.</Text>
      <Input label="Date réelle en UTC" hint="Format : 2026-10-13T14:30:00.000Z" value={notifiedAt} maxLength={40} autoCapitalize="none" disabled={blocked} onChangeText={value => { setNotifiedAt(value); clearConfirmation(); }} />
      {(Object.keys(channelLabels) as PrivacyCAIChannel[]).map(value => <Checkbox key={value} checked={channel === value} disabled={blocked} onToggle={() => { setChannel(value); clearConfirmation(); }}><Text style={styles.body}>{channelLabels[value]}</Text></Checkbox>)}
      <Input label="Référence externe" value={caiReference} maxLength={500} disabled={blocked} onChangeText={value => { setCAIReference(value); clearConfirmation(); }} />
      <Input label="Référence de preuve — privée" hint="Référence du dossier ou document conservé, sans joindre le contenu sensible." value={evidenceReference} maxLength={2000} disabled={blocked} onChangeText={value => { setEvidenceReference(value); clearConfirmation(); }} />
      <Button disabled={blocked || !notifiedAt || !caiReference.trim() || !evidenceReference.trim()} onPress={() => prepare('cai')}>Examiner cette déclaration d’action externe</Button>
    </View> : null}
    {sourceReady && !incidentId ? <Button variant="secondary" disabled={blocked} onPress={() => { setCreateOpen(!createOpen); clearConfirmation(); }}>{createOpen ? 'Fermer le formulaire' : 'Consigner un nouvel incident'}</Button> : null}
    {sourceReady && createOpen && !pending && !incidentId ? <View style={styles.card}>
      <Text style={styles.title}>Faits et évaluation humaine</Text>
      <Input label="Type d’incident" value={type} maxLength={100} disabled={blocked} onChangeText={value => { setType(value); clearConfirmation(); }} />
      <Input label="Faits connus et limites de l’enquête" value={description} multiline maxLength={10000} disabled={blocked} onChangeText={value => { setDescription(value); clearConfirmation(); }} />
      <Text style={styles.body}>Risque évalué par l’opérateur</Text>
      {(Object.keys(severityLabels) as PrivacyIncidentSeverity[]).map(value => <Checkbox key={value} checked={severity === value} disabled={blocked} onToggle={() => { setSeverity(value); clearConfirmation(); }}><Text style={styles.body}>{severityLabels[value]}</Text></Checkbox>)}
      <Text style={styles.body}>Statut de l’enquête</Text>
      {(Object.keys(statusLabels) as PrivacyIncidentStatus[]).map(value => <Checkbox key={value} checked={status === value} disabled={blocked} onToggle={() => { setStatus(value); clearConfirmation(); }}><Text style={styles.body}>{statusLabels[value]}</Text></Checkbox>)}
      <Input label="Identifiants des membres concernés" hint="Un UID par ligne ; laissez vide si la liste n’est pas encore établie." value={affectedUsers} multiline disabled={blocked} onChangeText={value => { setAffectedUsers(value); clearConfirmation(); }} />
      <Input label="Champs de données concernés" hint="Un nom de champ par ligne. Ne recopiez pas les valeurs des données." value={affectedFields} multiline disabled={blocked} onChangeText={value => { setAffectedFields(value); clearConfirmation(); }} />
      <Input label="Mesures prises ou en cours" value={measures} multiline maxLength={4000} disabled={blocked} onChangeText={value => { setMeasures(value); clearConfirmation(); }} />
      <Button disabled={blocked || !type.trim() || !description.trim()} onPress={() => prepare('create')}>Examiner le nouvel incident</Button>
    </View> : null}
    {sourceReady && confirmation ? <View style={styles.card}>
      <Text style={styles.title}>Confirmation avant enregistrement</Text>
      <Text selectable style={styles.caption}>Intention : {confirmation.payload.requestId}</Text>
      {confirmation.kind === 'create' ? <><Text style={styles.body}>Incident : {confirmation.payload.type}{'\n'}Risque humain : {severityLabels[confirmation.payload.severity]}{ '\n' }{confirmation.payload.affectedUserIds.length} membres identifiés.</Text><Text selectable style={styles.body}>{confirmation.payload.description}</Text></>
        : confirmation.kind === 'notice' ? <><Text style={styles.body}>Incident : {confirmation.payload.incidentId} · Version : {confirmation.payload.messageVersion}</Text><Text selectable style={styles.body}>{confirmation.payload.message}</Text></>
          : <Text selectable style={styles.body}>Incident : {confirmation.payload.incidentId}{'\n'}Action réelle : {confirmation.payload.notifiedAt}{'\n'}Canal : {channelLabels[confirmation.payload.channel]}{'\n'}Référence : {confirmation.payload.caiReference}{'\n'}Preuve privée : {confirmation.payload.evidenceReference}</Text>}
      <Checkbox checked={confirmed} disabled={working} onToggle={() => setConfirmed(!confirmed)}><Text style={styles.body}>{confirmation.kind === 'notice'
        ? 'J’ai vérifié les personnes concernées et approuvé ce message. Je demande son enregistrement dans l’application.'
        : confirmation.kind === 'cai' ? 'Cette action externe a réellement été effectuée et sa preuve est conservée. Je consigne cette déclaration.'
          : 'J’ai vérifié les faits consignés et l’évaluation humaine. Je demande la création de ce dossier privé.'}</Text></Checkbox>
      <Button loading={working} disabled={!confirmed || blocked} onPress={() => execute(confirmation, false)}>Enregistrer cette intention</Button>
      <Button variant="ghost" disabled={working} onPress={clearConfirmation}>Fermer sans envoyer</Button>
    </View> : null}
    {permitted && !incidentId ? <Text style={styles.caption}>Cette liste est limitée aux 200 dossiers récents. Une liste vide ne prouve pas l’absence d’un incident ancien. Utilisez sa référence pour une lecture directe.</Text> : null}
  </View>;
  return <View style={styles.container}><ScreenHeader title="Confidentialité" onBack={() => router.back()} />{permitted ? <AdminSectionNav /> : null}
    <FlashList data={incidentId || !sourceReady ? [] : incidents.data ?? []} keyExtractor={incidentKey} renderItem={renderIncident}
      ListHeaderComponent={header} contentContainerStyle={styles.list} keyboardShouldPersistTaps="handled" />
  </View>;
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.background },
  list: { paddingBottom: spacing.xl },
  content: { padding: spacing.md, gap: spacing.md },
  card: { padding: spacing.md, marginHorizontal: spacing.md, marginBottom: spacing.md, gap: spacing.sm,
    backgroundColor: colors.surface, borderRadius: radius.md, borderWidth: 1, borderColor: colors.border },
  title: { ...typography.h2, color: colors.foreground },
  body: { ...typography.body, color: colors.foreground },
  caption: { ...typography.caption, color: colors.foregroundSecondary },
  notice: { ...typography.bodySmall, color: colors.danger },
});
