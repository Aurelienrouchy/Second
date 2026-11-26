import React, { useCallback, useState } from 'react';
import { ScrollView, StyleSheet, Text, View } from 'react-native';
import { useRouter } from 'expo-router';
import { FlashList } from '@shopify/flash-list';
import { Image } from 'expo-image';
import { useQuery } from '@tanstack/react-query';
import { Button, Checkbox, Input, ScreenHeader } from '@/components/ui';
import { AdminContentSafetyPanel, AdminReportEvidence, AdminSectionNav } from '@/features/admin';
import { colors, radius, spacing, typography } from '@/constants/theme';
import { useAuthenticatedUid } from '@/hooks/useAuth';
import { useShippingPurchaseContext } from '@/hooks/useShippingPurchaseContext';
import { getAuthSessionGeneration } from '@/store/authStore';
import { UserService } from '@/services/userService';
import { ARTICLE_AVAILABILITY_BLOCKER_LABELS, ArticleModerationService, newArticleAppealRequestId, sameFavorableArticleInput } from '@/services/articleModerationService';
import { getCallableErrorCode } from '@/utils/callableError';
import type { AdminModerationReport, ArticleModerationAction, TriageReportInput } from '@/types/articleModeration';
import type { FavorableArticleInput, FavorableArticleReceipt } from '@/types/articleModeration';
const keyExtractor = (report: AdminModerationReport) => report.id;
export default function AdminReportsScreen() {
  const uid = useAuthenticatedUid(), router = useRouter();
  const sessionKey = JSON.stringify([uid, getAuthSessionGeneration()]);
  const base = useShippingPurchaseContext('admin-reports', uid);
  const permission = useQuery({ queryKey: ['admin-report-permission', sessionKey, base.focusRevision], queryFn: async () => {
    const operation = base.capture(), allowed = await UserService.isUserAdmin(uid!); base.assertCurrent(operation); return allowed;
  }, enabled: !!uid && base.focused, staleTime: 0, gcTime: 0, retry: false });
  const permitted = permission.data === true && !permission.isFetching && !permission.isError;
  const reports = useQuery({ queryKey: ['admin-reports', sessionKey, base.focusRevision], queryFn: () => {
    const operation = base.capture(); return ArticleModerationService.getReports(uid!, () => base.assertCurrent(operation), true);
  }, enabled: !!uid && base.focused && permitted, staleTime: 0, gcTime: 0, retry: false });
  const referenceHistory = useQuery({ queryKey: ['admin-moderation-references', sessionKey, base.focusRevision], queryFn: () => {
    const operation = base.capture(); return ArticleModerationService.readAdminReferences(uid!, () => base.assertCurrent(operation));
  }, enabled: !!uid && base.focused && permitted, staleTime: 0, gcTime: 0, retry: false });
  const favorableJournal = useQuery({queryKey: ['admin-favorable-article-journal', sessionKey, base.focusRevision],
    enabled: !!uid && base.focused && permitted, staleTime: 0, gcTime: 0, retry: false,
    queryFn: () => {const operation = base.capture(); return ArticleModerationService.readFavorableAttempt(operation.session.uid, () => base.assertCurrent(operation));} });
  const [selectedId, setSelectedId] = useState<string | null>(null), [action, setAction] = useState<ArticleModerationAction>('hold');
  const [ownerMessage, setOwnerMessage] = useState(''), [references, setReferences] = useState(''), [notice, setNotice] = useState('');
  const [confirmation, setConfirmation] = useState<TriageReportInput | null>(null);
  const [uncertain, setUncertain] = useState<TriageReportInput | null>(null), [legacyWorking, setWorking] = useState(false);
  const [favorableBusy, setFavorableBusy] = useState({frame: base.frame, focus: base.focusRevision, value: false});
  const favorableWorking = favorableBusy.frame === base.frame && favorableBusy.focus === base.focusRevision && favorableBusy.value;
  const working = legacyWorking || favorableWorking;
  const [authorityNote, setAuthorityNote] = useState(''), [favorableConfirmation, setFavorableConfirmation] = useState<FavorableArticleInput | null>(null);
  const [favorableReceiptState, setFavorableReceipt] = useState<{frame: symbol; focus: number; value: FavorableArticleReceipt} | null>(null);
  const favorableReceipt = favorableReceiptState?.frame === base.frame && favorableReceiptState.focus === base.focusRevision ? favorableReceiptState.value : null;
  const [neutralizingRequestId, setNeutralizingRequestId] = useState<string | null>(null);
  const [uncertainArticleId, setUncertainArticleId] = useState<string | null>(null);
  const [lastDossier, setLastDossier] = useState<{ articleId: string; decisionId: string; noticesPending: boolean } | null>(null);
  const [formOwner, setFormOwner] = useState(sessionKey);
  if (formOwner !== sessionKey) { setFormOwner(sessionKey); setSelectedId(null); setOwnerMessage(''); setReferences(''); setConfirmation(null); setUncertain(null); setUncertainArticleId(null); setLastDossier(null); setNotice(''); setWorking(false);
    setAuthorityNote(''); setFavorableConfirmation(null); setFavorableReceipt(null); setNeutralizingRequestId(null); }
  const [previousFocus, setPreviousFocus] = useState(base.focusRevision);
  if (previousFocus !== base.focusRevision) { setPreviousFocus(base.focusRevision); setConfirmation(null); setWorking(false); setFavorableConfirmation(null); setNeutralizingRequestId(null); }
  const current = !reports.isError && !reports.isFetching ? reports.data?.reports.find(report => report.id === selectedId) ?? null : null;
  const [photoSelection, setPhotoSelection] = useState<{reportId: string; mediaId: string; sessionKey: string; focusRevision: number; contentHash: string | undefined} | null>(null);
  const photoEvidenceQuery = useQuery({queryKey: ['admin-report-photo-evidence', sessionKey, current?.id, current?.revision, base.focusRevision],
    enabled: !!uid && base.focused && permitted && current?.targetType === 'article', staleTime: 0, gcTime: 0, retry: false,
    queryFn: () => {const operation = base.capture(); return ArticleModerationService.readReportPhotoEvidence(operation.session.uid, current!.id, () => base.assertCurrent(operation));} });
  const photoEvidence = base.focused && permitted && current?.targetType === 'article' && photoEvidenceQuery.isSuccess &&
    !photoEvidenceQuery.isFetching && !photoEvidenceQuery.isError ? photoEvidenceQuery.data : null;
  const selectedPhoto = photoSelection?.reportId === current?.id && photoSelection?.sessionKey === sessionKey &&
    photoSelection?.focusRevision === base.focusRevision && photoSelection?.contentHash === photoEvidence?.contentHash
    ? photoEvidence?.media.find(media => media.mediaId === photoSelection?.mediaId && media.state === 'preserved') ?? null : null;
  const privatePhotoQuery = useQuery({queryKey: ['admin-report-private-photo', sessionKey, current?.id, current?.revision, photoEvidence?.contentHash,
    selectedPhoto?.mediaId, selectedPhoto?.privateGeneration, base.focusRevision], enabled: !!uid && base.focused && permitted && !!photoEvidence && !!selectedPhoto,
    staleTime: 0, gcTime: 0, retry: false, queryFn: () => {const operation = base.capture();
      return ArticleModerationService.readReportPrivatePhoto(operation.session.uid, photoEvidence!, selectedPhoto!.mediaId, () => base.assertCurrent(operation));} });
  const privatePhoto = base.focused && permitted && selectedPhoto && photoEvidence && privatePhotoQuery.isSuccess &&
    !privatePhotoQuery.isFetching && !privatePhotoQuery.isError ? privatePhotoQuery.data : null;
  const observation = useShippingPurchaseContext(JSON.stringify([selectedId, current?.revision, current?.articleReview?.revision, current?.articleReview?.ownerId]), uid);
  const [previousFrame, setPreviousFrame] = useState(observation.frame);
  if (previousFrame !== observation.frame) { setPreviousFrame(observation.frame); setConfirmation(null); setWorking(false); }
  const evidenceReferences = references.split('\n').map(value => value.trim()).filter(Boolean);
  const journalReady = base.focused && favorableJournal.isSuccess && !favorableJournal.isFetching;
  const pendingFavorable = journalReady ? favorableJournal.data : null;
  const favorableBlocked = !journalReady || !!pendingFavorable;
  const favorableSourceQuery = useQuery({queryKey: ['admin-favorable-article-source', sessionKey, selectedId, current?.articleReview?.articleId,
    current?.revision, current?.articleReview?.revision, base.focusRevision], enabled: !!uid && base.focused && permitted && !!current?.articleReview,
    staleTime: 0, gcTime: 0, retry: false, queryFn: () => {
      const operation = base.capture(); return ArticleModerationService.readFavorableSource(operation.session.uid, current!.articleReview!.articleId,
        current!.id, () => base.assertCurrent(operation));
    } });
  const favorableSource = base.focused && favorableSourceQuery.isSuccess && !favorableSourceQuery.isFetching && !favorableSourceQuery.isError ? favorableSourceQuery.data : null;
  const favorableCandidate: FavorableArticleInput | null = favorableSource ? {articleId: favorableSource.articleId, reportId: favorableSource.reportId,
    expectedOwnerId: favorableSource.expectedOwnerId, expectedDecisionId: favorableSource.expectedDecisionId,
    expectedModerationDecisionId: favorableSource.expectedModerationDecisionId, expectedArticleRevision: favorableSource.expectedArticleRevision,
    expectedReportRevision: favorableSource.expectedReportRevision, expectedModerationRevision: favorableSource.expectedModerationRevision,
    expectedAppealId: favorableSource.expectedAppealId, expectedAppealRevision: favorableSource.expectedAppealRevision,
    requestId: favorableConfirmation?.requestId ?? '', action: 'approve', ownerMessage: ownerMessage.trim(), authorityNote: authorityNote.trim(), evidenceReferences} : null;
  const favorableConfirmationCurrent = !!favorableConfirmation && !!favorableCandidate && sameFavorableArticleInput(favorableConfirmation, favorableCandidate);
  const validDecision = current?.articleReview?.ownerId && ownerMessage.trim().length > 0 && ownerMessage.trim().length <= 2000 &&
    evidenceReferences.length >= 1 && evidenceReferences.length <= 10 && evidenceReferences.every(value => value.length <= 500);
  const confirmationCurrent = confirmation && current?.id === confirmation.reportId && (!confirmation.articleDecision || (
    confirmation.articleDecision.expectedReportRevision === current.revision && confirmation.articleDecision.expectedArticleRevision === current.articleReview?.revision &&
    confirmation.articleDecision.expectedOwnerId === current.articleReview?.ownerId));
  const select = useCallback((id: string) => {
    if (working || uncertain || favorableBlocked) return;
    setSelectedId(id); setOwnerMessage(''); setReferences(''); setAuthorityNote(''); setConfirmation(null); setFavorableConfirmation(null); setNotice(''); setAction('hold');
  }, [working, uncertain, favorableBlocked]);
  const renderItem = useCallback(({ item }: { item: AdminModerationReport }) => <Button variant="secondary" disabled={working || !!uncertain || favorableBlocked}
    onPress={() => select(item.id)}>{`${item.id} · ${item.status}${item.ownerAppeal ? ' · contestation propriétaire' : ''}`}</Button>, [working, uncertain, favorableBlocked, select]);
  const execute = async (input: TriageReportInput, recovery: boolean) => {
    if (!uid || !permitted || working || favorableBlocked || (!recovery && (!confirmationCurrent || reports.isFetching))) return;
    let operation;
    const context = recovery ? base : observation;
    try { operation = context.start(); } catch { return; }
    if (!operation) return;
    const affectedArticleId = current?.articleReview?.articleId ?? (recovery ? uncertainArticleId : null);
    setWorking(true); setNotice('');
    try {
      const response = await ArticleModerationService.triage(uid, input, () => context.assertCurrent(operation)); context.assertCurrent(operation);
      setUncertain(null); setConfirmation(null);
      setNotice(response.superseded ? 'Cette décision a déjà été enregistrée puis remplacée. Relisez le dossier actuel.'
        : input.articleDecision ? 'Décision enregistrée. Relisez le dossier ; aucune restauration de vente n’a été demandée.' : 'Signalement traité. Cette action seule ne modifie pas l’annonce.');
      if (affectedArticleId && response.decisionId && !response.superseded) {
        setLastDossier({ articleId: affectedArticleId, decisionId: response.decisionId, noticesPending: response.noticesPending === true });
        try {
          await ArticleModerationService.rememberAdminReference(uid, { articleId: affectedArticleId, decisionId: response.decisionId }, () => context.assertCurrent(operation));
          context.assertCurrent(operation);
        } catch { if (context.isCurrent(operation)) setNotice('Décision enregistrée. La référence locale ne peut pas être conservée ; le dossier reste accessible par sa référence d’annonce.'); }
        if (response.noticesPending === true && context.isCurrent(operation)) {
          try {
            const notices = await ArticleModerationService.continueOrderNotices(uid, affectedArticleId, response.decisionId, () => context.assertCurrent(operation));
            context.assertCurrent(operation);
            setLastDossier({ articleId: affectedArticleId, decisionId: response.decisionId, noticesPending: notices.noticesPending });
          } catch { if (context.isCurrent(operation)) setNotice('Décision enregistrée. Les avis aux parties restent à poursuivre depuis le dossier des commandes.'); }
        }
      }
      setUncertainArticleId(null);
      await reports.refetch(); context.assertCurrent(operation);
    } catch (error) {
      if (!context.isCurrent(operation)) return;
      const code = getCallableErrorCode(error);
      setConfirmation(null);
      if (code === 'aborted' || ['invalid-argument', 'permission-denied', 'failed-precondition', 'not-found', 'unauthenticated', 'already-exists'].includes(code ?? '')) {
        setUncertain(null); setNotice('Le dossier ou les droits ont changé. Relisez les sources et confirmez une décision actuelle. Votre saisie est conservée.');
        await reports.refetch();
      } else { setUncertain(input); setUncertainArticleId(affectedArticleId); setNotice('La réponse reste à vérifier. Reprenez exactement la décision précédente avant une autre action.'); }
    } finally { if (context.isCurrent(operation)) setWorking(false); context.finish(operation); }
  };
  const prepareDecision = () => {
    if (!current?.articleReview?.ownerId || !validDecision || working || uncertain || favorableBlocked || reports.isFetching) return;
    setConfirmation({ reportId: current.id, outcome: action === 'hold' ? 'reviewed' : 'resolved', articleDecision: {
      action, expectedArticleRevision: current.articleReview.revision, expectedReportRevision: current.revision,
      expectedOwnerId: current.articleReview.ownerId, ownerMessage: ownerMessage.trim(), evidenceReferences } });
  };
  const validFavorable = !!favorableCandidate && !!validDecision && authorityNote.trim().length > 0 && authorityNote.trim().length <= 2000;
  const prepareFavorable = () => {
    if (!favorableCandidate || !validFavorable || working || uncertain || favorableBlocked || reports.isFetching) return;
    setConfirmation(null); setFavorableReceipt(null); setNeutralizingRequestId(null);
    setFavorableConfirmation({...favorableCandidate, requestId: newArticleAppealRequestId(), evidenceReferences: [...evidenceReferences]});
  };
  const executeFavorable = async (mode: 'confirm' | 'observe' | 'neutralize' | 'acknowledge', recovery = false) => {
    if (!uid || !permitted || working || !journalReady || uncertain) return;
    const input = recovery ? pendingFavorable?.payload : favorableConfirmation;
    if (!input || !recovery && (mode !== 'confirm' || !favorableConfirmationCurrent || pendingFavorable) ||
      mode === 'neutralize' && neutralizingRequestId !== input.requestId) return;
    let operation;
    try {operation = base.start();} catch {return;}
    if (!operation) return;
    setFavorableBusy({frame: base.frame, focus: base.focusRevision, value: true}); setNotice('');
    try {
      const result = mode === 'acknowledge' ? await ArticleModerationService.acknowledgeFavorable(operation.session.uid, input, () => base.assertCurrent(operation)) :
        await ArticleModerationService.reviewFavorable(operation.session.uid, input, mode, () => base.assertCurrent(operation), recovery);
      base.assertCurrent(operation); setFavorableReceipt({frame: base.frame, focus: base.focusRevision, value: result});
      setFavorableConfirmation(null); setNeutralizingRequestId(null);
      setNotice(result.outcome === 'approved' ? 'Un motif a fait l’objet d’une décision favorable enregistrée. La réactivation, les autres restrictions et les commandes restent des résultats distincts.' :
        result.outcome === 'not_executed' ? 'Cette intention n’a pas été exécutée. Son reçu natif empêche son exécution tardive ; les décisions existantes restent conservées.' :
        'Aucun reçu exact n’est visible. Cette absence n’acquitte pas l’intention : observez-la, reprenez le même tuple ou demandez sa neutralisation explicite.');
      await Promise.all([favorableJournal.refetch(), reports.refetch(), ...(selectedId ? [favorableSourceQuery.refetch()] : [])]); base.assertCurrent(operation);
    } catch (error) {if (base.isCurrent(operation)) {setNotice(error instanceof Error ? error.message : 'L’intention favorable reste à vérifier.'); await favorableJournal.refetch();}}
    finally {if (base.isCurrent(operation)) setFavorableBusy({frame: base.frame, focus: base.focusRevision, value: false}); base.finish(operation);}
  };
  const contentSafety = <AdminContentSafetyPanel permitted={permitted && base.focused}
    selection={permitted && base.focused && current && typeof current.targetId === 'string' && (current.targetType === 'review' || current.targetType === 'message')
      ? {targetType: current.targetType, targetId: current.targetId, reportId: current.id} : null} />;
  const header = <View style={styles.content}>
    {contentSafety}
    <Text style={styles.body}>Signalements en attente et examinés, y compris les contestations. Une clôture de signalement seule ne modifie pas une annonce. Les décisions et pièces restent privées.</Text>
    <Button variant="secondary" disabled={working} onPress={() => router.push('/admin/moderated-orders')}>Rechercher les commandes d’une annonce modérée</Button>
    {lastDossier ? <View style={styles.card}>
      <Text selectable style={styles.body}>Dossier de l’annonce : {lastDossier.articleId}</Text>
      {lastDossier.noticesPending ? <Text style={styles.notice}>Des avis aux parties restent à poursuivre. Le dossier reste accessible après clôture du signalement.</Text> : null}
      <Button variant="secondary" disabled={working} onPress={() => router.push({ pathname: '/admin/moderated-orders', params: { articleId: lastDossier.articleId } })}>Ouvrir ses commandes et les avis</Button>
    </View> : null}
    {referenceHistory.data?.length ? <View style={styles.card}><Text style={styles.title}>Dossiers conservés sur cet appareil</Text>
      {referenceHistory.data.map(reference => <Button key={reference.articleId} variant="ghost" disabled={working}
        onPress={() => router.push({ pathname: '/admin/moderated-orders', params: { articleId: reference.articleId } })}>{reference.articleId}</Button>)}</View> : null}
    <Button variant="ghost" disabled={working} onPress={() => { setConfirmation(null); void permission.refetch(); void reports.refetch(); }}>Actualiser les dossiers</Button>
    {notice ? <Text accessibilityRole="alert" style={styles.notice}>{notice}</Text> : null}
    {uncertain ? <View style={styles.card}><Text style={styles.body}>Décision précédente à vérifier : {uncertain.reportId} · {uncertain.articleDecision?.ownerMessage ?? uncertain.outcome}</Text>
      <Button loading={working} disabled={working || !permitted} onPress={() => { void execute(uncertain, true); }}>Vérifier la décision précédente</Button></View> : null}
    {favorableJournal.isError ? <View style={styles.card}><Text style={styles.notice}>La lecture de l’intention favorable conservée a échoué. Relisez-la avant une autre décision.</Text>
      <Button variant="secondary" disabled={working} onPress={() => { void favorableJournal.refetch(); }}>Relire l’intention conservée</Button></View> : !journalReady ? <Text style={styles.body}>Lecture de l’intention favorable conservée…</Text> : null}
    {pendingFavorable ? <View style={styles.card}>
      <Text style={styles.title}>Intention favorable d’origine à rapprocher</Text>
      <Text style={styles.body}>Les actions ci-dessous utilisent exactement cette intention conservée, même si le dossier actuel ou la saisie ont changé. Observer ne l’exécute pas ; l’absence d’un reçu ne l’annule pas.</Text>
      <Text selectable style={styles.caption}>Requête : {pendingFavorable.payload.requestId}{'\n'}Article : {pendingFavorable.payload.articleId}{'\n'}Signalement : {pendingFavorable.payload.reportId}{'\n'}Propriétaire : {pendingFavorable.payload.expectedOwnerId}{'\n'}Motif à lever : {pendingFavorable.payload.expectedDecisionId}{'\n'}Décision privée attendue : {pendingFavorable.payload.expectedModerationDecisionId}{'\n'}Versions article / signalement / modération :{'\n'}{pendingFavorable.payload.expectedArticleRevision}{'\n'}{pendingFavorable.payload.expectedReportRevision}{'\n'}{pendingFavorable.payload.expectedModerationRevision}{'\n'}Contestation : {pendingFavorable.payload.expectedAppealId ?? 'aucune'} · version : {pendingFavorable.payload.expectedAppealRevision ?? 'aucune'}</Text>
      <Text style={styles.body}>Motif propriétaire d’origine : {pendingFavorable.payload.ownerMessage}</Text>
      <Text style={styles.body}>Justification privée d’origine : {pendingFavorable.payload.authorityNote}</Text>
      <Text selectable style={styles.caption}>Preuves privées d’origine : {pendingFavorable.payload.evidenceReferences.join('\n')}</Text>
      <Button variant="secondary" disabled={working || !permitted} onPress={() => { void executeFavorable('observe', true); }}>Observer cette intention exacte</Button>
      {(!favorableReceipt || favorableReceipt.requestId !== pendingFavorable.payload.requestId || favorableReceipt.outcome === 'unrecorded') ? <>
        <Button disabled={working || !permitted} onPress={() => { void executeFavorable('confirm', true); }}>Confirmer la reprise de cette même intention</Button>
        {neutralizingRequestId !== pendingFavorable.payload.requestId ? <Button variant="secondary" disabled={working || !permitted}
          onPress={() => setNeutralizingRequestId(pendingFavorable.payload.requestId)}>Examiner la neutralisation de cette intention</Button> : <>
          <Text style={styles.body}>La neutralisation demande un reçu natif empêchant une exécution tardive si aucun effet n’a été enregistré. Une décision déjà enregistrée sera relue ; elle ne sera pas annulée par cette action.</Text>
          <Button disabled={working || !permitted} onPress={() => { void executeFavorable('neutralize', true); }}>Confirmer la neutralisation native de cette intention</Button>
          <Button variant="ghost" disabled={working} onPress={() => setNeutralizingRequestId(null)}>Conserver l’intention à vérifier</Button>
        </>}
      </> : <Button disabled={working || !permitted} onPress={() => { void executeFavorable('acknowledge', true); }}>Relire le reçu natif et acquitter le journal local</Button>}
    </View> : null}
    {favorableReceipt ? <View style={styles.card}>
      <Text style={styles.title}>{favorableReceipt.outcome === 'approved' ? 'Décision favorable enregistrée' : favorableReceipt.outcome === 'not_executed' ? 'Intention non exécutée et neutralisée' : 'Reçu exact non observé'}</Text>
      <Text selectable style={styles.caption}>Requête : {favorableReceipt.requestId}{'\n'}Décision : {favorableReceipt.decisionId}{'\n'}Empreinte de l’intention : {favorableReceipt.payloadHash}</Text>
      {favorableReceipt.outcome === 'unrecorded' ? <Text style={styles.body}>Cette observation ne certifie ni une absence d’effet ni une annulation. Le journal reste conservé.</Text> : <>
        <Text style={styles.body}>Motif propriétaire enregistré : {favorableReceipt.ownerMessage}</Text><Text selectable style={styles.caption}>Date du reçu : {favorableReceipt.decidedAt}</Text>
        {favorableReceipt.superseded ? <Text style={styles.notice}>Une décision privée ultérieure existe. Ce reçu décrit uniquement l’intention d’origine.</Text> : null}
        {favorableReceipt.outcome === 'approved' ? <>
          <Text selectable style={styles.caption}>Motif levé : {favorableReceipt.liftedDecisionId}{'\n'}Contestation examinée : {favorableReceipt.reviewedAppealId ?? 'aucune contestation clôturée par ce reçu'}</Text>
          <Text style={styles.body}>{favorableReceipt.listingReactivated ? 'La remise en visibilité a été enregistrée à la date de cette décision.' : 'La décision favorable a été enregistrée, avec remise en visibilité bloquée à cette date.'} L’état actuel doit être relu dans le dossier de l’annonce.</Text>
          {favorableReceipt.availabilityBlockers?.map(blocker => <Text key={blocker} style={styles.body}>{ARTICLE_AVAILABILITY_BLOCKER_LABELS[blocker] ?? `Condition à examiner : ${blocker}`}</Text>)}
          {favorableReceipt.remainingRestrictionDecisionIds?.map(restriction => <Text key={restriction} selectable style={styles.caption}>Restriction restant à cette date : {restriction}</Text>)}
          <Text style={styles.body}>{favorableReceipt.notificationCommitted ? 'L’avis propriétaire est enregistré dans le rail de notification.' : 'L’enregistrement de l’avis reste à vérifier.'} Sa réception sur appareil et sa lecture ne sont pas attestées.</Text>
        </> : <Text style={styles.body}>{favorableReceipt.reason === 'source_changed' ? 'Les sources ont changé avant l’effet.' : 'La neutralisation explicite a été enregistrée avant l’effet.'} Le reçu bloque cette intention tardive et conserve les autres décisions.</Text>}
      </>}
      <Text style={styles.body}>Ce reçu ne certifie ni authenticité ni droits de vente. Il n’accorde aucune permission sur les fonds ou la progression des commandes.</Text>
    </View> : null}
    {current ? <><AdminReportEvidence report={current} favorableSource={favorableSource} />
      {current.targetType === 'article' ? <View style={styles.card}>
        <Button variant="secondary" disabled={!base.focused || !permitted || reports.isFetching || reports.isError} onPress={() => {
          try {const op = base.capture(); base.assertCurrent(op); router.push({pathname: '/admin/product-reviews', params: {contextKind: 'article_report', contextId: current.id}} as never);} catch { /* Native destination requalifies operator access. */ }
        }}>Ouvrir le dossier privé d’examen du produit</Button>
        <Text style={styles.title}>Capture privée de l’annonce signalée</Text>
        <Text style={styles.body}>Ce contenu décrit la version examinée lors du signalement. La conservation des pixels ne certifie ni l’authenticité ni les droits sur les photos.</Text>
        {photoEvidenceQuery.isFetching ? <Text style={styles.body}>Lecture de la capture native…</Text> : photoEvidenceQuery.isError ? <Text style={styles.notice}>La preuve photo ne peut pas être qualifiée. Aucune image publique de remplacement n’est affichée.</Text> : null}
        {photoEvidence ? <>
          <Text style={styles.body}>Conservation : {photoEvidence.conservation === 'historical_unknown' ? 'source historique inconnue' : photoEvidence.conservation === 'preserved' ? 'photos conservées' : photoEvidence.conservation === 'pending' ? 'en attente de conservation' : 'rapprochement nécessaire'}.</Text>
          {photoEvidence.snapshot ? <>
            <Text style={styles.body}>Titre signalé : {typeof photoEvidence.snapshot.title === 'string' ? photoEvidence.snapshot.title : 'non renseigné'}</Text>
            <Text style={styles.body}>Description signalée : {typeof photoEvidence.snapshot.description === 'string' ? photoEvidence.snapshot.description : 'non renseignée'}</Text>
            <Text style={styles.body}>Prix annoncé : {typeof photoEvidence.snapshot.price === 'number' ? `${photoEvidence.snapshot.price} $` : 'inconnu'} · État : {typeof photoEvidence.snapshot.condition === 'string' ? photoEvidence.snapshot.condition : 'inconnu'}</Text>
            <Text selectable style={styles.caption}>Article : {photoEvidence.articleId}{'\n'}Version signalée : {photoEvidence.articleRevision}{'\n'}Empreinte : {photoEvidence.contentHash}{'\n'}Capture : {photoEvidence.capturedAt}</Text>
          </> : <Text style={styles.body}>Aucune capture native qualifiée. L’annonce actuelle ne remplace pas la version alléguée.</Text>}
          {photoEvidence.media.map(media => <View key={media.mediaId}>
            <Text style={styles.caption}>Photo {media.index + 1} : {media.state === 'preserved' ? 'conservée' : media.state === 'pending' ? 'conservation en attente' : 'à rapprocher'}{media.reason ? ` · ${media.reason}` : ''}</Text>
            {media.state === 'preserved' ? <Button variant="secondary" disabled={working || privatePhotoQuery.isFetching}
              onPress={() => setPhotoSelection({reportId: current.id, mediaId: media.mediaId, sessionKey, focusRevision: base.focusRevision, contentHash: photoEvidence.contentHash})}>Consulter cette photo privée</Button> : null}
          </View>)}
          {privatePhotoQuery.isFetching ? <Text style={styles.body}>Lecture privée autorisée…</Text> : privatePhotoQuery.isError && selectedPhoto ? <Text style={styles.notice}>La photo privée ne peut plus être lue avec cette capture. Relisez le dossier.</Text> : null}
          {privatePhoto ? <Image key={`${privatePhoto.mediaId}:${privatePhoto.generation}`} source={{uri: privatePhoto.dataUrl}} style={styles.privatePhoto}
            cachePolicy="none" contentFit="contain" accessibilityLabel={`Photo privée conservée ${selectedPhoto!.index + 1}`} /> : null}
        </> : null}
        <Button variant="ghost" disabled={working || photoEvidenceQuery.isFetching} onPress={() => {setPhotoSelection(null); void photoEvidenceQuery.refetch();}}>Relire la capture privée</Button>
      </View> : null}
      {current.articleReview ? <>
        {current.articleReview.currentDecision ? <Button variant="secondary" disabled={working}
          onPress={() => router.push({ pathname: '/admin/moderated-orders', params: { articleId: current.articleReview!.articleId } })}>Consulter les commandes liées à cette décision</Button> : null}
        <Checkbox checked={action === 'hold'} disabled={working || !!uncertain || favorableBlocked} onToggle={() => { setAction('hold'); setConfirmation(null); setFavorableConfirmation(null); }} accessibilityLabel="Mettre l’article en examen"><Text style={styles.body}>Mettre l’article en examen</Text></Checkbox>
        <Checkbox checked={action === 'reject'} disabled={working || !!uncertain || favorableBlocked} onToggle={() => { setAction('reject'); setConfirmation(null); setFavorableConfirmation(null); }} accessibilityLabel="Retirer l’article de la vente"><Text style={styles.body}>Retirer l’article de la vente</Text></Checkbox>
        <Input label="Motif communiqué uniquement au propriétaire" hint="Expliquez la décision sans identité du signaleur ni pièce personnelle. Les références restent dans le champ privé." value={ownerMessage} multiline maxLength={2000} disabled={working || !!uncertain || favorableBlocked} onChangeText={value => { setOwnerMessage(value); setConfirmation(null); setFavorableConfirmation(null); }} />
        <Input label="Références de preuve privées — une par ligne" hint="1 à 10 références, 500 caractères chacune. Aucune pièce personnelle dans le motif propriétaire." value={references} multiline disabled={working || !!uncertain || favorableBlocked} onChangeText={value => { setReferences(value); setConfirmation(null); setFavorableConfirmation(null); }} />
        <Button disabled={!validDecision || working || !!uncertain || favorableBlocked || reports.isFetching} onPress={prepareDecision}>Vérifier la décision sur l’article</Button>
        <Text style={styles.title}>Examen favorable d’un motif précis</Text>
        <Text style={styles.body}>La levée vise uniquement la restriction présentée par la source native. Les autres allégations et décisions sont conservées ; seule la contestation sélectionnée peut être examinée.</Text>
        {favorableSourceQuery.isError ? <><Text style={styles.notice}>La source exacte de la levée ne peut pas être confirmée.</Text>
          <Button variant="secondary" disabled={working || favorableBlocked} onPress={() => { setFavorableConfirmation(null); void favorableSourceQuery.refetch(); }}>Relire la source de la levée</Button></> : favorableSourceQuery.isFetching ? <Text style={styles.body}>Lecture des versions natives de la restriction…</Text> : null}
        <Input label="Justification de l’examen — privée administrateur" hint="Précisez l’autorité et les sources motivant la levée. Ce texte ne sera pas communiqué au propriétaire." value={authorityNote} multiline maxLength={2000}
          disabled={working || !!uncertain || favorableBlocked} onChangeText={value => {setAuthorityNote(value); setFavorableConfirmation(null);}} />
        <Button disabled={!validFavorable || working || !!uncertain || favorableBlocked || reports.isFetching} onPress={prepareFavorable}>Vérifier la levée de ce motif</Button>
      </> : null}
      <Text style={styles.body}>Triage seul du signalement, sans décision sur l’annonce :</Text>
      {(['reviewed', 'resolved', 'dismissed'] as const).map(outcome => <Button key={outcome} variant="secondary" disabled={working || !!uncertain || favorableBlocked || reports.isFetching}
        onPress={() => {setFavorableConfirmation(null); setConfirmation({ reportId: current.id, outcome });}}>{outcome === 'reviewed' ? 'Conserver en examen' : outcome === 'resolved' ? 'Clore le signalement' : 'Écarter le signalement'}</Button>)}
    </> : null}
    {confirmation ? <View style={styles.card}><Text style={styles.title}>Confirmer l’enregistrement</Text>
      <Text style={styles.body}>{confirmation.articleDecision ? `${confirmation.articleDecision.action === 'reject' ? 'Retrait de l’article' : 'Examen de l’article'} · ${confirmation.articleDecision.ownerMessage}` : `Triage seul : ${confirmation.outcome}`}</Text>
      {confirmation.articleDecision ? <Text selectable style={styles.caption}>Références : {confirmation.articleDecision.evidenceReferences.join('\n')}</Text> : null}
      {!confirmationCurrent ? <Text style={styles.notice}>La source a changé. Actualisez et relisez le dossier.</Text> : null}
      <Button disabled={!confirmationCurrent || working || !!uncertain || favorableBlocked || reports.isFetching} onPress={() => { void execute(confirmation, false); }}>Confirmer cette décision actuelle</Button>
      <Button variant="ghost" disabled={working} onPress={() => setConfirmation(null)}>Revenir à la saisie</Button>
    </View> : null}
    {favorableConfirmation ? <View style={styles.card}>
      <Text style={styles.title}>Confirmer cette levée motivée</Text>
      <Text selectable style={styles.caption}>Article : {favorableConfirmation.articleId} · signalement : {favorableConfirmation.reportId}{'\n'}Propriétaire : {favorableConfirmation.expectedOwnerId}{'\n'}Motif précis à lever : {favorableConfirmation.expectedDecisionId}{'\n'}Requête : {favorableConfirmation.requestId}{'\n'}Contestation sélectionnée : {favorableConfirmation.expectedAppealId ?? 'aucune'}</Text>
      <Text style={styles.body}>Motif communiqué au propriétaire : {favorableConfirmation.ownerMessage}</Text><Text style={styles.body}>Justification privée : {favorableConfirmation.authorityNote}</Text>
      <Text selectable style={styles.caption}>Références privées : {favorableConfirmation.evidenceReferences.join('\n')}</Text>
      <Text style={styles.body}>Confirmer enregistre cette intention avant tout appel. La décision favorable et la remise en visibilité sont évaluées séparément. Aucune permission sur les commandes ou les fonds n’est accordée.</Text>
      {!favorableConfirmationCurrent ? <Text style={styles.notice}>La source ou la saisie a changé. Relisez et préparez une nouvelle confirmation avant envoi.</Text> : null}
      <Button disabled={!favorableConfirmationCurrent || working || !!uncertain || favorableBlocked || reports.isFetching} onPress={() => {void executeFavorable('confirm');}}>Confirmer la levée de ce motif précis</Button>
      <Button variant="ghost" disabled={working} onPress={() => setFavorableConfirmation(null)}>Revenir à la saisie</Button>
    </View> : null}
    {reports.isError ? <Text style={styles.notice}>Impossible de relire les signalements.</Text> : reports.isPending ? <Text style={styles.body}>Lecture des signalements…</Text>
      : reports.data?.reports.length === 0 ? <Text style={styles.body}>Aucun signalement ouvert dans cette lecture.</Text> : null}
  </View>;
  return <View style={styles.container}><ScreenHeader title="Signalements et contestations" onBack={() => router.back()} /><AdminSectionNav />
    {!uid || permission.isPending || permission.isFetching ? <ScrollView contentContainerStyle={styles.content}><Text style={styles.body}>Vérification des droits…</Text>{contentSafety}</ScrollView> : !permitted ? <ScrollView contentContainerStyle={styles.content}>
      <Text style={styles.notice}>Impossible de confirmer les droits administrateur.</Text><Button onPress={() => { void permission.refetch(); }}>Réessayer</Button>
      {contentSafety}
    </ScrollView> : <FlashList data={reports.isError ? [] : reports.data?.reports ?? []} renderItem={renderItem} keyExtractor={keyExtractor} ListHeaderComponent={header} contentContainerStyle={styles.content} />}
  </View>;
}
const styles = StyleSheet.create({ container: { flex: 1, backgroundColor: colors.background }, content: { padding: spacing.md, gap: spacing.md },
  card: { padding: spacing.md, borderRadius: radius.md, backgroundColor: colors.surfaceWarm, gap: spacing.sm }, title: { ...typography.h3, color: colors.foreground },
  body: { ...typography.body, color: colors.foregroundSecondary }, notice: { ...typography.body, color: colors.danger }, caption: { ...typography.caption, color: colors.muted },
  privatePhoto: {width: '100%', aspectRatio: 1, backgroundColor: colors.surface} });
