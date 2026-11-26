import { useCallback, useMemo, useRef, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { useLocalSearchParams, useRouter, type Href } from 'expo-router';
import { useInfiniteQuery, useQuery } from '@tanstack/react-query';
import { FlashList } from '@shopify/flash-list';
import { Button, Checkbox, Input, ScreenHeader } from '@/components/ui';
import { AdminFinancialReauthentication, AdminSectionNav } from '@/features/admin';
import { colors, radius, spacing, typography } from '@/constants/theme';
import { useAuthenticatedUid } from '@/hooks/useAuth';
import { useLabelLifecycleContext } from '@/hooks/useLabelLifecycleContext';
import { getAuthSessionGeneration } from '@/store/authStore';
import { UserService } from '@/services/userService';
import { ArticleModerationService, isOrderContinuationInput, newArticleAppealRequestId } from '@/services/articleModerationService';
import type { ModeratedOrder, OrderContinuationInput, OrderModerationInput, OrderModerationReceipt } from '@/types/articleModeration';
import type { ProductReviewEvidenceReference } from '@/types/productReviewEvidence';

function createContinuationInteraction() {
  let revision = 0;
  return {invalidate: () => {revision++;}, capture: () => {
    const expected = revision;
    return () => {if (revision !== expected) throw new Error('Le formulaire ou la source a changé. Relisez avant de confirmer.');};
  }};
}
const orderKey = (order: ModeratedOrder) => order.id;
const validArticleId = (value: string) => !!value.trim() && !value.includes('/') && value === value.trim();
const evidenceType = {received_item_photo: 'Photo déclarée du produit reçu', supporting_document_image: 'Image de document déclaré', expertise_image: 'Image déclarée d’expertise'};
const evidenceRole = {buyer: 'Acheteur', seller: 'Vendeur', reporter: 'Signaleur'};
const evidenceText = (references: string[] | ProductReviewEvidenceReference[]) => references.map(reference => typeof reference === 'string' ? reference
  : `${evidenceType[reference.typeDeclared]} · ${evidenceRole[reference.actorRole]} ${reference.actorId} · ${reference.id}`).join('\n');
const receiptText = (receipt: OrderModerationReceipt) => 'protocol' in receipt
  ? receipt.state === 'committed' ? 'Instruction enregistrée. La liaison documentaire est technique ; les autres statuts du dossier restent à examiner.'
    : receipt.state === 'absent' ? 'Aucun reçu exact observé. Cette absence ne prouve pas la non-exécution ; conservez l’intention ou neutralisez ses effets futurs.'
      : 'Reçu natif de non-exécution ou de neutralisation confirmé. Les effets futurs de cette intention sont bloqués.'
  : 'Reçu historique exact confirmé. Il n’accorde aucune nouvelle autorisation de continuer.';

/** An instruction affects only this order's moderation pause, never its money. */
export default function AdminModeratedOrdersScreen() {
  const params = useLocalSearchParams<{ articleId?: string }>(), router = useRouter(), uid = useAuthenticatedUid();
  const sessionKey = JSON.stringify([uid, getAuthSessionGeneration()]);
  const [articleId, setArticleId] = useState(typeof params.articleId === 'string' ? params.articleId : '');
  const [lookup, setLookup] = useState(articleId), [selectedId, setSelectedId] = useState<string | null>(null);
  const [action, setAction] = useState<'pause' | 'continue'>('pause');
  const [message, setMessage] = useState(''), [authorityNote, setAuthorityNote] = useState('');
  const [selectedEvidence, setSelectedEvidence] = useState<string[]>([]);
  const [confirmation, setConfirmation] = useState<{input: OrderContinuationInput; interaction: ReturnType<typeof createContinuationInteraction>} | null>(null);
  const [notice, setNotice] = useState(''), [working, setWorking] = useState(false), [readVersion, setReadVersion] = useState(0);
  const [verifiedKey, setVerifiedKey] = useState<string | null>(null), [pendingNotices, setPendingNotices] = useState<boolean | null>(null);
  const inFlight = useRef(false);
  const base = useLabelLifecycleContext(JSON.stringify(['admin-moderated-orders', articleId]), uid);
  const formKey = JSON.stringify([sessionKey, articleId, base.focusRevision]);
  const [formScope, setFormScope] = useState(formKey);
  if (formScope !== formKey) {
    setFormScope(formKey); setSelectedId(null); setMessage(''); setAuthorityNote(''); setSelectedEvidence([]);
    setAction('pause'); setConfirmation(null); setVerifiedKey(null); setNotice(''); setWorking(false); setPendingNotices(null);
  }
  const permission = useQuery({queryKey: ['admin-order-moderation-permission', sessionKey, base.focusRevision],
    queryFn: async () => {const operation = base.capture(); const allowed = await UserService.isUserAdmin(uid!); base.assertCurrent(operation); return allowed;},
    enabled: !!uid && base.focused, staleTime: 0, gcTime: 0, retry: false});
  const permitted = permission.data === true && !permission.isError && !permission.isFetching;
  // SDK-owned local discovery and receipts do not depend on current role, profile, or source availability.
  const references = useQuery({queryKey: ['admin-moderation-references', sessionKey, base.focusRevision],
    queryFn: () => {const operation = base.capture(); return ArticleModerationService.readAdminReferences(uid!, () => base.assertCurrent(operation));},
    enabled: !!uid && base.focused, staleTime: 0, gcTime: 0, retry: false});
  const journal = useQuery({queryKey: ['admin-order-moderation-attempt', sessionKey, articleId, base.focusRevision],
    queryFn: () => {const operation = base.capture(); return ArticleModerationService.readOrderAttempt(uid!, articleId, () => base.assertCurrent(operation));},
    enabled: !!uid && base.focused && validArticleId(articleId), staleTime: 0, gcTime: 0, retry: false});
  const orders = useInfiniteQuery({queryKey: ['admin-moderated-orders', sessionKey, articleId, base.focusRevision], initialPageParam: null as string | null,
    queryFn: async ({pageParam}) => {
      const operation = base.capture(), assertCurrent = () => base.assertCurrent(operation);
      const page = await ArticleModerationService.getModeratedOrders(uid!, articleId, pageParam, assertCurrent);
      try {await ArticleModerationService.rememberAdminReference(uid!, {articleId, decisionId: page.decisionId}, assertCurrent);}
      catch {assertCurrent(); setNotice('Le dossier est accessible ; sa référence locale ne peut pas être conservée.');}
      assertCurrent(); void references.refetch(); return page;
    },
    getNextPageParam: page => page.nextCursor ?? undefined,
    enabled: !!uid && permitted && base.focused && validArticleId(articleId), staleTime: 0, gcTime: 0, retry: false});
  const allOrders = useMemo(() => {
    const items = new Map<string, ModeratedOrder>();
    for (const page of orders.data?.pages ?? []) for (const order of page.orders) items.set(order.id, order);
    return [...items.values()];
  }, [orders.data]);
  const decisionIds = new Set(orders.data?.pages.map(page => page.decisionId) ?? []);
  const decisionId = decisionIds.size === 1 ? orders.data?.pages[0]?.decisionId ?? null : null;
  const sourcesReady = permitted && base.focused && !!decisionId && !orders.isError && !orders.isFetching && journal.isSuccess && !journal.isFetching;
  const current = sourcesReady ? allOrders.find(order => order.id === selectedId) ?? null : null, attempt = journal.data;
  const reauthKey = JSON.stringify([sessionKey, articleId, current?.id, current?.revision, decisionId, readVersion, base.focusRevision]);
  const recentVerified = verifiedKey === reauthKey;
  const preview = useQuery({queryKey: ['admin-order-continuation-preview', reauthKey],
    queryFn: () => {const operation = base.capture(); return ArticleModerationService.previewOrderContinuation(uid!, current!.id, () => base.assertCurrent(operation));},
    enabled: !!uid && !!current && permitted && base.focused && recentVerified && action === 'continue' && !attempt,
    staleTime: 0, gcTime: 0, retry: false});
  const nativePreview = recentVerified && preview.isSuccess && !preview.isFetching && !preview.isError && preview.data.articleId === articleId &&
    preview.data.transactionId === current?.id && preview.data.expectedOrderRevision === current.revision && preview.data.expectedArticleDecisionId === decisionId ? preview.data : null;
  const evidenceReferences = nativePreview?.evidenceReferences.filter(reference => selectedEvidence.includes(reference.id)) ?? [];
  const validForm = !!current?.paymentEvidence && current.moderation?.sourceQualified === true && recentVerified && !!message.trim() && message.trim().length <= 2000 &&
    !!authorityNote.trim() && authorityNote.trim().length <= 2000 && (action === 'pause' || nativePreview?.canContinue === true &&
      !!nativePreview.source && evidenceReferences.length > 0 && evidenceReferences.length === selectedEvidence.length);
  // Every render binds callbacks to the exact form and observations; event handlers invalidate synchronously before setState.
  const interactionKey = JSON.stringify([formKey, permitted, sourcesReady, current?.revision, decisionId, action, message, authorityNote, selectedEvidence,
    verifiedKey, readVersion, orders.dataUpdatedAt, orders.isFetching, journal.dataUpdatedAt, journal.isFetching, preview.dataUpdatedAt, preview.isFetching, preview.data]);
  const [interactionFrame, setInteractionFrame] = useState(() => ({key: interactionKey, interaction: createContinuationInteraction()}));
  let activeFrame = interactionFrame;
  if (interactionFrame.key !== interactionKey) {
    interactionFrame.interaction.invalidate();
    activeFrame = {key: interactionKey, interaction: createContinuationInteraction()}; setInteractionFrame(activeFrame);
    if (confirmation) setConfirmation(null);
  }
  const interaction = activeFrame.interaction, assertInteraction = interaction.capture();
  const invalidate = useCallback(() => {interaction.invalidate(); setConfirmation(null);}, [interaction, setConfirmation]);
  const confirmationCurrent = !!confirmation && confirmation.interaction === interaction && validForm && sourcesReady && !attempt &&
    confirmation.input.transactionId === current?.id && confirmation.input.expectedOrderRevision === current.revision && confirmation.input.expectedArticleDecisionId === decisionId;
  const noticesPending = pendingNotices ?? orders.data?.pages.some(page => page.noticesPending) ?? false;
  const openArticle = (next: string) => {
    if (inFlight.current || !validArticleId(next)) return;
    try {assertInteraction(); base.capture();} catch {return;}
    invalidate(); setArticleId(next); setLookup(next); setSelectedId(null); setVerifiedKey(null); setSelectedEvidence([]);
  };
  const selectOrder = useCallback((id: string) => {
    if (inFlight.current || attempt) return;
    try {assertInteraction(); base.capture();} catch {return;}
    invalidate(); setSelectedId(id); setMessage(''); setAuthorityNote(''); setSelectedEvidence([]); setAction('pause'); setVerifiedKey(null); setNotice('');
  }, [attempt, assertInteraction, base, invalidate, setSelectedId, setMessage, setAuthorityNote, setSelectedEvidence, setAction, setVerifiedKey, setNotice]);
  const renderOrder = useCallback(({item}: {item: ModeratedOrder}) => <View style={styles.card}>
    <Text selectable style={styles.title}>Commande {item.id}</Text>
    <Text style={styles.body}>Statut enregistré : {item.status ?? 'inconnu'} · {item.deliveryType ?? 'mode inconnu'}</Text>
    <Text style={styles.body}>Paiement observé : {item.paymentEvidence ? 'oui' : 'non'} · Étiquette existante : {item.hasLabel ? 'oui' : 'non'} · Fonds déjà libérés : {item.fundsReleased ? 'oui' : 'non'}</Text>
    <Text style={styles.body}>{item.moderation?.action === 'continue' ? 'Instruction de continuation enregistrée' : 'Examen de modération'}</Text>
    {item.moderation?.otherBlockers.length ? <Text style={styles.caption}>Autres dossiers à traiter séparément : {item.moderation.otherBlockers.join(', ')}</Text> : null}
    <Button variant="secondary" disabled={working || !!attempt || !item.paymentEvidence || item.moderation?.sourceQualified !== true}
      onPress={() => selectOrder(item.id)}>Examiner cette commande</Button>
  </View>, [working, attempt, selectOrder]);
  const refreshSources = async () => {
    if (inFlight.current) return;
    let operation;
    try {assertInteraction(); operation = base.start();} catch {return;}
    if (!operation) return;
    invalidate(); setVerifiedKey(null); setSelectedEvidence([]); setReadVersion(value => value + 1); inFlight.current = true; setWorking(true);
    try {
      await Promise.all([references.refetch(), ...(validArticleId(articleId) ? [journal.refetch(), ...(permitted ? [orders.refetch()] : [])] : [])]); base.assertCurrent(operation);
      setPendingNotices(null);
    } catch {if (base.isCurrent(operation)) setNotice('Les sources ne peuvent pas être relues actuellement.');}
    finally {inFlight.current = false; if (base.isCurrent(operation)) setWorking(false); base.finish(operation);}
  };
  const continueNotices = async () => {
    if (!uid || !permitted || !decisionId || inFlight.current) return;
    let operation;
    try {assertInteraction(); operation = base.start();} catch {return;}
    if (!operation) return;
    invalidate(); inFlight.current = true; setWorking(true);
    try {
      const response = await ArticleModerationService.continueOrderNotices(uid, articleId, decisionId, () => base.assertCurrent(operation));
      base.assertCurrent(operation); setPendingNotices(response.noticesPending);
      setNotice(response.superseded ? 'La décision a changé. Relisez le dossier actuel.' : response.noticesPending
        ? 'Une page d’avis a été traitée. Poursuivez les pages restantes.' : 'Le parcours des avis est terminé. Cela ne prouve pas leur lecture par les parties.');
      await orders.refetch(); base.assertCurrent(operation);
    } catch {if (base.isCurrent(operation)) setNotice('L’envoi des avis reste à vérifier. Reprenez la même décision.');}
    finally {inFlight.current = false; if (base.isCurrent(operation)) setWorking(false); base.finish(operation);}
  };
  const prepare = () => {
    if (!uid || !current || !decisionId || !validForm || inFlight.current || attempt || !sourcesReady) return;
    try {assertInteraction(); base.capture();} catch {return;}
    const input: OrderContinuationInput = {operation: 'reviewOrderModeration', capability: 'order_moderation_continuation_v1', expectedUid: uid,
      expectedAdminUid: uid, articleId, transactionId: current.id, requestId: newArticleAppealRequestId(), expectedOrderRevision: current.revision,
      expectedArticleDecisionId: decisionId, action, message: message.trim(), authorityNote: authorityNote.trim(),
      evidenceReferences: action === 'continue' ? evidenceReferences.map(reference => ({...reference})) : [], continuationProof: action === 'continue' ? nativePreview!.source : null};
    setConfirmation({input, interaction});
  };
  const review = async (input: OrderModerationInput, mode: 'execute' | 'observe' | 'neutralize') => {
    if (!uid || inFlight.current || mode === 'execute' && (!permitted || !confirmationCurrent || confirmation?.input !== input)) return;
    let operation;
    try {assertInteraction(); operation = base.start();} catch {return;}
    if (!operation) return;
    const assertCurrent = () => {base.assertCurrent(operation); if (mode === 'execute') assertInteraction();};
    inFlight.current = true; setWorking(true); setNotice('');
    try {
      const response = await ArticleModerationService.reviewOrder(uid, articleId, input, assertCurrent, mode);
      assertCurrent(); setConfirmation(null); setNotice(receiptText(response));
    } catch {
      if (base.isCurrent(operation)) {setConfirmation(null); setNotice('Le résultat reste à vérifier dans le journal. Une erreur ne prouve ni refus durable ni non-exécution.');}
    } finally {
      inFlight.current = false;
      if (base.isCurrent(operation)) {setWorking(false); void journal.refetch();}
      base.finish(operation);
    }
  };
  const acknowledge = async () => {
    if (!uid || inFlight.current || !attempt) return;
    let operation;
    try {assertInteraction(); operation = base.start();} catch {return;}
    if (!operation) return;
    invalidate(); inFlight.current = true; setWorking(true);
    try {
      await ArticleModerationService.acknowledgeOrderAttempt(uid, articleId, attempt.payload.requestId, () => base.assertCurrent(operation));
      base.assertCurrent(operation); setSelectedId(null); setVerifiedKey(null); setSelectedEvidence([]);
      await Promise.all([journal.refetch(), ...(permitted ? [orders.refetch()] : [])]); base.assertCurrent(operation);
    } catch {if (base.isCurrent(operation)) setNotice('Aucun résultat natif définitif ne permet encore d’acquitter cette intention.');}
    finally {inFlight.current = false; if (base.isCurrent(operation)) setWorking(false); base.finish(operation);}
  };
  const header = <View style={styles.content}>
    <Text style={styles.body}>Les instructions de modération et les décisions financières sont distinctes. Votre propre journal SDK reste consultable si l’accès opérateur ou la source actuelle est indisponible.</Text>
    {!permitted ? <View><Text style={styles.notice}>Les droits actuels ne sont pas confirmés pour de nouvelles instructions.</Text>
      <Button variant="secondary" disabled={working || permission.isFetching} onPress={() => {invalidate(); void permission.refetch();}}>Relire les droits</Button></View> : null}
    <Input label="Référence de l’annonce" value={lookup} disabled={working} onChangeText={value => {invalidate(); setLookup(value);}} autoCapitalize="none" />
    <Button variant="secondary" disabled={!validArticleId(lookup) || working} onPress={() => openArticle(lookup)}>Ouvrir le dossier de cette annonce</Button>
    {references.data?.length ? <View style={styles.card}><Text style={styles.title}>Références privées conservées sur cet appareil</Text>
      {references.data.map(reference => <Button key={reference.articleId} variant="ghost" disabled={working} onPress={() => openArticle(reference.articleId)}>{reference.articleId}</Button>)}</View> : null}
    {references.isError ? <Text style={styles.notice}>Les références locales ne sont pas lisibles. La recherche par référence reste disponible.</Text> : null}
    {articleId ? <Text selectable style={styles.caption}>Annonce : {articleId}</Text> : null}
    <Button variant="ghost" disabled={working} onPress={() => {void refreshSources();}}>Relire les sources et mon journal</Button>
    {notice ? <Text accessibilityRole="alert" style={styles.notice}>{notice}</Text> : null}
    {orders.isError ? <Text style={styles.notice}>Le dossier opérateur actuel n’a pas pu être confirmé. Votre journal exact reste indépendant de cette lecture.</Text> : null}
    {decisionIds.size > 1 ? <Text style={styles.notice}>La décision a changé entre les pages. Relisez toutes les pages avant une instruction.</Text> : null}
    {journal.isError ? <Text style={styles.notice}>Le journal ne peut pas être relu. Aucune nouvelle instruction ne sera envoyée.</Text> : null}
    {noticesPending && permitted && decisionId ? <View style={styles.card}><Text style={styles.title}>Avis aux parties à poursuivre</Text>
      <Text style={styles.body}>La diffusion se fait par pages de 25 commandes. Une restriction s’applique même si les avis restent à envoyer.</Text>
      <Button disabled={working || orders.isError || orders.isFetching} loading={working} onPress={() => {void continueNotices();}}>Traiter la prochaine page d’avis</Button></View> : null}
    {attempt ? <View style={styles.card}><Text selectable style={styles.title}>Demande conservée : {attempt.payload.transactionId}</Text>
      <Text style={styles.body}>Action : {attempt.payload.action === 'continue' ? 'continuer' : 'pause'} · Message : {attempt.payload.message}</Text>
      <Text selectable style={styles.caption}>Note privée : {attempt.payload.authorityNote}{'\n'}Pièces : {evidenceText(attempt.payload.evidenceReferences) || 'Aucune pièce requise pour la pause.'}</Text>
      {attempt.receipt ? <Text style={styles.body}>{receiptText(attempt.receipt)}</Text> : <Text style={styles.notice}>Résultat inconnu. Relisez le reçu natif exact ; une ancienne erreur locale n’est pas une preuve de non-exécution.</Text>}
      {!isOrderContinuationInput(attempt.payload) ? <Text style={styles.caption}>Intention historique : cette vérification observe uniquement l’ancienne demande avec son contenu original. Elle ne réexécute aucune continuation.</Text> : null}
      <Button loading={working} disabled={working} onPress={() => {void review(attempt.payload, 'observe');}}>Relire le reçu exact</Button>
      {isOrderContinuationInput(attempt.payload) ? <Button variant="secondary" disabled={working} onPress={() => {void review(attempt.payload, 'neutralize');}}>Neutraliser les effets futurs de cette intention</Button> : null}
      <Button variant="secondary" disabled={working} onPress={() => {void acknowledge();}}>Relire le reçu définitif et acquitter</Button>
    </View> : null}
    {current && !attempt ? <View style={styles.card}><Text selectable style={styles.title}>Instruction pour {current.id}</Text>
      <Checkbox checked={action === 'pause'} disabled={working} onToggle={() => {invalidate(); setAction('pause'); setSelectedEvidence([]);}}><Text style={styles.body}>Maintenir une pause de modération</Text></Checkbox>
      <Checkbox checked={action === 'continue'} disabled={working} onToggle={() => {invalidate(); setAction('continue'); setSelectedEvidence([]);}}><Text style={styles.body}>Autoriser la suite de ce dossier de modération</Text></Checkbox>
      <Input label="Instruction communiquée aux parties" hint="Sans identité du signaleur ni preuve privée." multiline maxLength={2000} value={message} disabled={working}
        onChangeText={value => {invalidate(); setMessage(value);}} />
      <Input label="Motivation de votre intervention — privée" hint="La note ne certifie ni compétence, ni expertise, ni mandat ou droits sur le produit." multiline maxLength={2000} value={authorityNote} disabled={working}
        onChangeText={value => {invalidate(); setAuthorityNote(value);}} />
      <AdminFinancialReauthentication key={reauthKey} uid={uid!} sourceKey={reauthKey} purpose="commercial" parcel disabled={working}
        onVerified={() => {assertInteraction(); base.capture(); invalidate(); setVerifiedKey(reauthKey);}} />
      {recentVerified ? <Text style={styles.caption}>Session récente vérifiée ; le serveur la requalifie avant l’exécution.</Text> : null}
      {action === 'continue' ? <>
        <Button variant="secondary" disabled={working} onPress={() => {try {assertInteraction(); base.capture();} catch {return;} invalidate(); router.push(`/admin/product-reviews?contextKind=order&contextId=${encodeURIComponent(current.id)}` as Href);}}>Examiner les pièces réelles dans le dossier produit</Button>
        <Text style={styles.body}>Examinez les images et contributions dans le dossier produit. La présence de fichiers et leurs empreintes ne vérifient ni leur authenticité, ni une expertise humaine, ni l’autorité juridique de l’opérateur.</Text>
        {preview.isFetching ? <Text style={styles.caption}>Lecture du corpus natif actuel…</Text> : null}
        {preview.isError ? <Text style={styles.notice}>Le corpus actuel ne peut pas être confirmé. Relisez les sources puis vérifiez votre identité.</Text> : null}
        {nativePreview ? <>
          <Text style={styles.caption}>{nativePreview.coverage ? `${nativePreview.coverage.evidenceInspected} pièces examinées dans la source ; corpus courant ${nativePreview.coverage.documentaryCompleteCurrentCaseSet ? 'complet dans la limite de lecture' : 'incomplet'}. L’historique exhaustif n’est pas certifié.` : 'Couverture du corpus inconnue.'}</Text>
          {nativePreview.source ? <Text selectable style={styles.caption}>Dossier {nativePreview.source.caseId} · version {nativePreview.source.caseVersion}</Text> : null}
          {nativePreview.evidenceReferences.map(reference => <Checkbox key={reference.id} checked={selectedEvidence.includes(reference.id)} disabled={working || !nativePreview.canContinue}
            onToggle={() => {try {assertInteraction(); base.capture();} catch {return;} invalidate(); setSelectedEvidence(old => old.includes(reference.id) ? old.filter(id => id !== reference.id) : [...old, reference.id]);}}>
            <Text selectable style={styles.body}>{evidenceText([reference])}{'\n'}Contribution {reference.contributionId} · fichier reçu, génération {reference.generation}</Text>
          </Checkbox>)}
          {!nativePreview.canContinue ? <Text style={styles.notice}>La continuation ne peut pas être qualifiée dans l’état actuel. Une pause reste possible avec la décision native de commande.</Text> : null}
        </> : null}
      </> : <Text style={styles.caption}>La pause n’exige aucun nouveau corpus documentaire.</Text>}
      <Text style={styles.body}>Cette instruction ne ferme pas un litige, ne modifie aucune étiquette existante, n’autorise ni fonds ni stock et ne réactive pas l’annonce.</Text>
      <Button disabled={!validForm || working || !sourcesReady} onPress={prepare}>Vérifier l’instruction</Button>
    </View> : null}
    {confirmation && confirmationCurrent ? <View style={styles.card}><Text style={styles.title}>Confirmer l’instruction actuelle</Text>
      <Text style={styles.body}>{confirmation.input.action === 'continue' ? 'Continuer' : 'Pause'} · {confirmation.input.transactionId}{'\n'}{confirmation.input.message}</Text>
      <Text selectable style={styles.caption}>Motivation privée : {confirmation.input.authorityNote}{'\n'}Pièces natives sélectionnées : {evidenceText(confirmation.input.evidenceReferences) || 'Aucune (pause).'}</Text>
      <Button disabled={working} loading={working} onPress={() => {void review(confirmation.input, 'execute');}}>Confirmer cette instruction</Button>
      <Button variant="ghost" disabled={working} onPress={invalidate}>Revenir à la saisie</Button>
    </View> : null}
    {permitted && orders.isPending && articleId ? <Text style={styles.body}>Lecture des commandes…</Text> : null}
  </View>;
  const footer = permitted ? <View style={styles.content}>
    {orders.hasNextPage ? <Button variant="secondary" loading={orders.isFetchingNextPage} disabled={working || orders.isFetching}
      onPress={() => {try {assertInteraction(); base.capture();} catch {return;} invalidate(); void orders.fetchNextPage();}}>Lire les 20 commandes suivantes</Button>
      : orders.isSuccess ? <Text style={styles.caption}>Toutes les pages de cette lecture ont été chargées ({allOrders.length} commandes).</Text> : null}
  </View> : null;
  return <View style={styles.container}><ScreenHeader title="Commandes d’une annonce modérée" onBack={() => router.back()} /><AdminSectionNav />
    {!uid ? <Text style={styles.body}>Connectez-vous pour relire votre propre journal.</Text> : !base.focused ? <Text style={styles.body}>Revenez sur cet écran pour relire ce dossier privé.</Text>
      : <FlashList data={!permitted || orders.isError ? [] : allOrders} renderItem={renderOrder} keyExtractor={orderKey}
        ListHeaderComponent={header} ListFooterComponent={footer} contentContainerStyle={styles.content} />}
  </View>;
}
const styles = StyleSheet.create({container: {flex: 1, backgroundColor: colors.background}, content: {padding: spacing.md, gap: spacing.md},
  card: {padding: spacing.md, borderRadius: radius.md, backgroundColor: colors.surfaceWarm, gap: spacing.sm},
  title: {...typography.h3, color: colors.foreground}, body: {...typography.body, color: colors.foregroundSecondary},
  caption: {...typography.caption, color: colors.muted}, notice: {...typography.body, color: colors.danger}});
