import React, { useState } from 'react';
import { ScrollView, StyleSheet, Text, View } from 'react-native';
import { Redirect, useLocalSearchParams, useRouter } from 'expo-router';
import { useQuery } from '@tanstack/react-query';
import { Button, Input, ScreenHeader } from '@/components/ui';
import { APP_LOCALE } from '@/constants/locale';
import { colors, radius, spacing, typography } from '@/constants/theme';
import { useAuthenticatedUid } from '@/hooks/useAuth';
import { useShippingPurchaseContext } from '@/hooks/useShippingPurchaseContext';
import { getAuthSessionGeneration } from '@/store/authStore';
import { ARTICLE_AVAILABILITY_BLOCKER_LABELS, ArticleModerationService, newArticleAppealRequestId } from '@/services/articleModerationService';
import type { ArticleAppealInput } from '@/types/articleModeration';
const dateLabel = (value: string | null) => value && Number.isFinite(new Date(value).getTime()) ? new Date(value).toLocaleString(APP_LOCALE) : 'Date non communiquée';
export default function OwnerArticleDecisionScreen() {
  const params = useLocalSearchParams<{ id?: string }>(), router = useRouter(), uid = useAuthenticatedUid();
  const articleId = typeof params.id === 'string' ? params.id : '';
  const dossier = useShippingPurchaseContext(`owner-article-decision:${articleId}`, uid);
  const sessionKey = JSON.stringify([uid, getAuthSessionGeneration(), articleId]);
  const [formOwner, setFormOwner] = useState(sessionKey);
  const [reason, setReason] = useState(''), [notice, setNotice] = useState('');
  const [confirmation, setConfirmation] = useState<{ decisionId: string; reason: string; focus: number } | null>(null);
  const [working, setWorking] = useState(false);
  if (formOwner !== sessionKey) { setFormOwner(sessionKey); setReason(''); setNotice(''); setConfirmation(null); setWorking(false); }
  const [previousFocus, setPreviousFocus] = useState(dossier.focusRevision);
  if (previousFocus !== dossier.focusRevision) { setPreviousFocus(dossier.focusRevision); setWorking(false); setConfirmation(null); }
  const decisionQuery = useQuery({ queryKey: ['owner-article-decision', sessionKey, dossier.focusRevision], queryFn: () => {
    const operation = dossier.capture();
    return ArticleModerationService.readDecision(uid!, articleId, () => dossier.assertCurrent(operation));
  }, enabled: !!uid && !!articleId && dossier.focused, staleTime: 0, gcTime: 0, retry: false });
  const attemptQuery = useQuery({ queryKey: ['owner-article-appeal', sessionKey, dossier.focusRevision], queryFn: () => {
    const operation = dossier.capture();
    return ArticleModerationService.readAttempt(uid!, articleId, () => dossier.assertCurrent(operation));
  }, enabled: !!uid && !!articleId && dossier.focused, staleTime: 0, gcTime: 0, retry: false });
  const current = dossier.focused && decisionQuery.isSuccess && !decisionQuery.isFetching ? decisionQuery.data?.decision ?? null : null;
  const pending = dossier.focused && attemptQuery.isSuccess && !attemptQuery.isFetching ? attemptQuery.data ?? null : null;
  const currentConfirmation = confirmation && current?.id === confirmation.decisionId && confirmation.reason === reason.trim() &&
    confirmation.focus === dossier.focusRevision && !decisionQuery.isFetching && !decisionQuery.isError;
  const send = async (payload: ArticleAppealInput, recovery: boolean) => {
    if (!uid || working) return;
    let operation;
    try { operation = dossier.start(); } catch { return; }
    if (!operation) return;
    const assertCurrent = () => dossier.assertCurrent(operation);
    setWorking(true); setNotice('');
    try {
      const response = await ArticleModerationService.contest(uid, payload, assertCurrent, recovery); assertCurrent();
      setNotice(response.replay ? 'La contestation précédente a été retrouvée. Relisez la décision actuelle.' : 'Contestation reçue pour examen. Elle ne rétablit pas la vente de l’article.');
      setConfirmation(null);
      await Promise.all([attemptQuery.refetch(), decisionQuery.refetch()]); assertCurrent();
    } catch (error) {
      if (!dossier.isCurrent(operation)) return;
      await Promise.all([attemptQuery.refetch(), decisionQuery.refetch()]);
      if (!dossier.isCurrent(operation)) return;
      setConfirmation(null);
      setNotice(error instanceof Error ? error.message : 'La réponse reste à vérifier. Votre motif est conservé.');
    } finally { if (dossier.isCurrent(operation)) setWorking(false); dossier.finish(operation); }
  };
  const acknowledge = async () => {
    if (!uid || !pending?.receipt || working) return;
    let operation;
    try { operation = dossier.start(); } catch { return; }
    if (!operation) return;
    const assertCurrent = () => dossier.assertCurrent(operation);
    setWorking(true);
    try {
      const refreshed = await decisionQuery.refetch(); assertCurrent();
      if (refreshed.isError) throw refreshed.error;
      await ArticleModerationService.acknowledge(uid, articleId, pending.payload.requestId, assertCurrent); assertCurrent();
      await attemptQuery.refetch(); assertCurrent(); setNotice('Décision relue. Une contestation reçue reste soumise à l’examen de notre équipe.');
    } catch (error) { if (dossier.isCurrent(operation)) setNotice(error instanceof Error ? error.message : 'La réception reste à vérifier.'); }
    finally { if (dossier.isCurrent(operation)) setWorking(false); dossier.finish(operation); }
  };
  if (!uid) return <Redirect href="/(tabs)/profile" />;
  return <View style={styles.container}><ScreenHeader title="Décision privée sur l’article" onBack={() => router.back()} />
    <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
      <Text selectable style={styles.caption}>Article : {articleId}</Text>
      <Text style={styles.body}>Le motif ci-dessous est réservé au propriétaire. Une contestation demande un nouvel examen ; elle ne rétablit pas l’article et ne change pas vos commandes ou vos fonds.</Text>
      {notice ? <Text accessibilityRole="alert" style={styles.notice}>{notice}</Text> : null}
      {attemptQuery.isPending ? <Text style={styles.body}>Lecture de la tentative précédente…</Text> : attemptQuery.isError ? <>
        <Text style={styles.notice}>Impossible de relire la contestation conservée. Aucun nouvel envoi n’est permis.</Text>
        <Button onPress={() => { void attemptQuery.refetch(); }}>Relire la tentative précédente</Button>
      </> : pending ? <View style={styles.card}>
        <Text style={styles.title}>{pending.receipt ? 'Contestation reçue' : 'Vérifier la contestation précédente'}</Text>
        <Text selectable style={styles.caption}>Décision contestée : {pending.payload.decisionId}</Text><Text style={styles.body}>{pending.payload.reason}</Text>
        <Text style={styles.body}>{pending.receipt ? 'Cette contestation est enregistrée. Consultez la décision actuelle pour connaître la suite.' : 'La reprise utilise le même motif et la même référence. Aucun nouvel envoi distinct n’est créé.'}</Text>
        <Button disabled={working} loading={working} onPress={() => { void (pending.receipt ? acknowledge() : send(pending.payload, true)); }}>
          {pending.receipt ? 'Relire la décision actuelle' : 'Vérifier la contestation précédente'}
        </Button>
      </View> : null}
      {decisionQuery.isPending || decisionQuery.isFetching ? <Text style={styles.body}>Lecture de la décision…</Text> : decisionQuery.isError ? <>
        <Text style={styles.notice}>Impossible de lire cette décision privée.</Text><Button onPress={() => { void decisionQuery.refetch(); }}>Relire la décision</Button>
      </> : !current ? <Text style={styles.body}>Aucune décision motivée n’a été communiquée par ce dossier. Contactez notre équipe si l’article reste indisponible.</Text> : <View style={styles.card}>
        <Text style={styles.title}>{current.action === 'reject' ? 'Article retiré de la vente' : current.action === 'approve' ? current.favorableRecorded ? 'Décision favorable enregistrée' : 'Décision favorable à qualifier' : 'Article en examen'}</Text>
        <Text style={styles.body}>{current.ownerMessage}</Text><Text style={styles.caption}>{dateLabel(current.decidedAt)}</Text>
        {current.action === 'approve' ? <>
          {current.favorableRecorded ? <>
            <Text style={styles.body}>Cette décision lève un motif précis. Les autres décisions et allégations restent conservées. Elle ne certifie ni l’authenticité de l’article ni vos droits de vente.</Text>
            {current.liftedDecision ? <View style={styles.card}>
              <Text style={styles.title}>Motif antérieur examiné</Text>
              <Text style={styles.body}>{current.liftedDecision.action === 'reject' ? 'Retrait antérieur' : 'Examen antérieur'} · {current.liftedDecision.ownerMessage ?? 'Motif historique non communiqué'}</Text>
              <Text selectable style={styles.caption}>Décision : {current.liftedDecision.id} · {dateLabel(current.liftedDecision.decidedAt)}</Text>
              {!current.liftedDecision.sourceQualified ? <Text style={styles.body}>L’historique de ce motif reste à qualifier par notre équipe.</Text> : null}
            </View> : <Text style={styles.body}>Le détail du motif antérieur n’est pas qualifié dans cette lecture. Contactez notre équipe pour le rapprochement.</Text>}
            <Text style={styles.body}>{current.reviewedAppealId ? 'La contestation référencée ci-dessous a été examinée par cette décision. Les autres demandes restent distinctes.' : 'Ce reçu ne constate la clôture d’aucune contestation sélectionnée.'}</Text>
            {current.reviewedAppealId ? <Text selectable style={styles.caption}>Contestation examinée : {current.reviewedAppealId}</Text> : null}
            <Text style={styles.body}>{current.listingReactivated ? 'La remise en visibilité a été enregistrée à la date de cette décision.' : 'La remise en visibilité restait bloquée à la date de cette décision.'} Ce résultat historique ne remplace pas l’état actuel ci-dessous.</Text>
            {current.availabilityBlockers?.map(blocker => <Text key={blocker} style={styles.body}>{ARTICLE_AVAILABILITY_BLOCKER_LABELS[blocker] ?? `Condition à examiner avec notre équipe : ${blocker}`}</Text>)}
            {typeof current.remainingRestrictionCount === 'number' && current.remainingRestrictionCount > 0 ? <Text style={styles.body}>Autres restrictions présentes lors de cette décision : {current.remainingRestrictionCount}.</Text> : null}
          </> : <Text style={styles.body}>L’historique disponible ne qualifie pas cette décision comme une levée native de restriction. Notre équipe doit rapprocher le dossier ; aucune remise en visibilité n’est attestée par cette mention seule.</Text>}
          {current.currentListingState ? <View style={styles.card}>
            <Text style={styles.title}>État de l’annonce dans cette lecture</Text>
            <Text style={styles.body}>{current.currentListingState.isActive === null ? 'Visibilité actuelle non qualifiée.' : current.currentListingState.isActive ? 'Annonce actuellement indiquée active.' : 'Annonce actuellement indiquée inactive.'}</Text>
            <Text style={styles.body}>{current.currentListingState.isSold === null ? 'État de vente actuel non qualifié.' : current.currentListingState.isSold ? 'Article actuellement indiqué vendu.' : 'Article actuellement indiqué non vendu.'}</Text>
            <Text style={styles.caption}>Modération affichée : {current.currentListingState.moderationStatus ?? 'non renseignée'}</Text>
          </View> : null}
          <Text style={styles.body}>La disponibilité pour une nouvelle vente doit être confirmée par son parcours habituel. Cette décision ne débloque pas la progression d’une commande et ne modifie pas les fonds.</Text>
        </> : null}
        {current.appealStatus === 'pending' ? <Text style={styles.body}>Contestation en cours d’examen · {dateLabel(current.appealReceivedAt)}</Text> : null}
        {!pending && attemptQuery.isSuccess && !attemptQuery.isFetching && current.appealStatus !== 'pending' ? <>
          <Input label="Pourquoi demandez-vous un nouvel examen ?" value={reason} multiline maxLength={2000} disabled={working}
            onChangeText={value => { setReason(value); setConfirmation(null); }} />
          <Button disabled={working || !reason.trim() || decisionQuery.isFetching} onPress={() => setConfirmation({ decisionId: current.id, reason: reason.trim(), focus: dossier.focusRevision })}>Vérifier ma contestation</Button>
          {confirmation ? <View style={styles.card}><Text style={styles.body}>{confirmation.reason}</Text>
            {!currentConfirmation ? <Text style={styles.notice}>La décision a changé. Relisez-la et confirmez de nouveau votre demande.</Text> : null}
            <Button disabled={!currentConfirmation || working} onPress={() => {
              if (!currentConfirmation || !confirmation) return;
              void send({ operation: 'contestArticleDecision', articleId, decisionId: confirmation.decisionId,
                requestId: newArticleAppealRequestId(), reason: confirmation.reason }, false);
            }}>Confirmer l’envoi de la contestation</Button></View> : null}
        </> : null}
      </View>}
      <Button variant="ghost" disabled={working} onPress={() => { setConfirmation(null); void decisionQuery.refetch(); }}>Actualiser la décision</Button>
      <Button variant="ghost" onPress={() => router.push('/settings/help')}>Contacter notre équipe</Button>
    </ScrollView>
  </View>;
}
const styles = StyleSheet.create({ container: { flex: 1, backgroundColor: colors.background }, content: { padding: spacing.lg, gap: spacing.md },
  card: { padding: spacing.md, borderRadius: radius.md, backgroundColor: colors.surfaceWarm, gap: spacing.sm },
  title: { ...typography.h3, color: colors.foreground }, body: { ...typography.body, color: colors.foregroundSecondary },
  caption: { ...typography.caption, color: colors.muted }, notice: { ...typography.body, color: colors.danger } });
