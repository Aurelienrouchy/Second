import { useCallback, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { Image } from 'expo-image';
import { FlashList } from '@shopify/flash-list';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useQuery } from '@tanstack/react-query';
import { Button, Checkbox, ScreenHeader } from '@/components/ui';
import { useAuthenticatedUid } from '@/hooks/useAuth';
import { useShippingPurchaseContext } from '@/hooks/useShippingPurchaseContext';
import { getAuthSessionGeneration } from '@/store/authStore';
import { ArticlePrivacyService, newArticlePrivacyRequestId } from '@/services/articlePrivacyService';
import { colors, radius, spacing, typography } from '@/constants/theme';
import { APP_LOCALE } from '@/constants/locale';
import type { ArticlePrivacyWithdrawalAttempt, PrivateArticleAccess, PrivateArticleMediaReference } from '@/types/articlePrivacy';

const reference = (v: unknown): v is string => typeof v === 'string' && /^[A-Za-z0-9_-]{1,128}$/.test(v);
const mediaKey = (media: PrivateArticleMediaReference) => `${media.mediaId}:${media.sourceReferenceHash}`;
const fieldText = (value: unknown) => typeof value === 'string' || typeof value === 'number' ? String(value) : 'Non enregistré';

/** Privacy servicing remains separate from a commercial deletion or new sale. */
export default function ArticlePrivacyScreen() {
  const params = useLocalSearchParams<{ id: string; transactionId?: string; swapId?: string }>();
  const articleId = reference(params.id) ? params.id : null, uid = useAuthenticatedUid(), router = useRouter();
  const validAgreement = (!params.transactionId || reference(params.transactionId)) && (!params.swapId || reference(params.swapId)) &&
    !(params.transactionId && params.swapId);
  const agreementView = !!(params.transactionId || params.swapId);
  const access: PrivateArticleAccess | null = articleId && validAgreement ? { articleId,
    ...(params.transactionId ? { transactionId: params.transactionId } : {}), ...(params.swapId ? { swapId: params.swapId } : {}) } : null;
  const context = useShippingPurchaseContext(JSON.stringify(['article-privacy', access]), uid);
  const scope = JSON.stringify([uid, getAuthSessionGeneration(), access, context.focusRevision]);
  const journal = useQuery({ queryKey: ['article-privacy-journal', scope], enabled: !!uid && !!access && context.focused && !agreementView,
    staleTime: 0, gcTime: 0, retry: false,
    queryFn: () => { const operation = context.capture(); return ArticlePrivacyService.attempts(operation.session.uid, () => context.assertCurrent(operation)); },
  });
  const evidence = useQuery({ queryKey: ['private-article-evidence', scope], enabled: !!uid && !!access && context.focused,
    staleTime: 0, gcTime: 0, retry: false,
    queryFn: () => { const operation = context.capture(); return ArticlePrivacyService.evidence(operation.session.uid, access!, () => context.assertCurrent(operation)); },
  });
  const recorded = evidence.isSuccess && !evidence.isFetching && evidence.data?.state === 'recorded' ? evidence.data : null;
  const contractEvidence = !!recorded && recorded.evidenceScope !== 'owner_dossier';
  const localAttempt = journal.isSuccess && !journal.isFetching ? journal.data?.find(a => a.articleId === articleId) ?? null : null;
  // A locally unknown tuple always has priority. A recovered owner tuple is
  // observed first; no new random intention replaces the native withdrawal.
  const attempt = !agreementView && journal.isSuccess && !journal.isFetching
    ? localAttempt ?? (recorded?.ownerId === uid ? recorded.ownerWithdrawalAttempt : null) : null;
  const receipt = useQuery({ queryKey: ['article-privacy-receipt', scope, attempt?.requestId],
    enabled: !!attempt && context.focused && !agreementView, staleTime: 0, gcTime: 0, retry: false,
    queryFn: () => { const operation = context.capture(); return ArticlePrivacyService.observe(attempt!, () => context.assertCurrent(operation)); },
  });
  const [draft, setDraft] = useState<ArticlePrivacyWithdrawalAttempt | null>(null), [confirmed, setConfirmed] = useState(false);
  const [working, setWorking] = useState(false), [notice, setNotice] = useState(''), [formScope, setFormScope] = useState(scope);
  const [selectedMedia, setSelectedMedia] = useState<PrivateArticleMediaReference | null>(null);
  if (formScope !== scope) { setFormScope(scope); setDraft(null); setConfirmed(false); setWorking(false); setNotice(''); setSelectedMedia(null); }
  const currentSelectedMedia = recorded?.mediaRefs.find(value => value.mediaId === selectedMedia?.mediaId &&
    value.sourceReferenceHash === selectedMedia?.sourceReferenceHash && value.generation === selectedMedia?.generation) ?? null;
  const media = useQuery({ queryKey: ['private-article-bytes', scope, currentSelectedMedia?.mediaId, currentSelectedMedia?.generation, currentSelectedMedia?.sourceReferenceHash],
    enabled: !!uid && !!access && !!currentSelectedMedia && context.focused,
    staleTime: 0, gcTime: 0, retry: false,
    queryFn: () => { const operation = context.capture(); return ArticlePrivacyService.image(operation.session.uid, access!, currentSelectedMedia!, () => context.assertCurrent(operation)); },
  });
  const image = media.isSuccess && !media.isFetching && context.focused && currentSelectedMedia && media.data?.viewerId === uid &&
    media.data.mediaId === currentSelectedMedia.mediaId && media.data.evidenceId === recorded?.evidenceId &&
    media.data.sourceReferenceHash === currentSelectedMedia.sourceReferenceHash && media.data.generation === currentSelectedMedia.generation ? media.data.dataUrl : null;
  const createDraft = () => {
    if (!uid || !articleId || agreementView || working || attempt || !journal.isSuccess || journal.isFetching || evidence.isFetching ||
        !evidence.isSuccess || evidence.data.state !== 'unrecorded' || evidence.data.ownerId !== uid) return;
    try { context.capture(); } catch { return; }
    setDraft({ version: 1, ownerId: uid, articleId, requestId: newArticlePrivacyRequestId() }); setConfirmed(false); setNotice('');
  };
  const execute = async (value: ArticlePrivacyWithdrawalAttempt, recovery: boolean) => {
    if (!uid || value.ownerId !== uid || value.articleId !== articleId || working || agreementView ||
        (!recovery && (!confirmed || draft !== value || attempt || !journal.isSuccess || journal.isFetching))) return;
    const operation = context.start(); if (!operation) return;
    setWorking(true); setNotice(''); setSelectedMedia(null);
    try {
      const response = await ArticlePrivacyService.withdraw(value, () => context.assertCurrent(operation)); context.assertCurrent(operation);
      setDraft(null); setConfirmed(false);
      setNotice(response.state === 'not_executed' ? 'Cette intention n’a effectué aucun retrait : une autre intention était déjà enregistrée. Le serveur confirme sa neutralisation et bloque toute requête tardive avec cette référence. Le résultat de l’autre intention n’est pas attribué à celle-ci.'
        : response.publicWithdrawalComplete ? 'Le serveur confirme le retrait public de cette intention. Les commandes et recours restent distincts ; les copies déjà téléchargées par des tiers ne peuvent pas être rappelées.'
        : response.state === 'needs_review' ? 'Le retrait est enregistré, mais certains médias exigent un examen. Un retrait public complet n’est pas encore confirmé.'
          : 'Le retrait est enregistré et doit encore être poursuivi. Relire observe seulement son état ; une reprise explicite conserve la même intention.');
      await journal.refetch(); context.assertCurrent(operation); await evidence.refetch(); context.assertCurrent(operation);
    } catch {
      if (context.isCurrent(operation)) { setDraft(null); setConfirmed(false); setNotice('Le résultat est inconnu ou à rapprocher. L’intention conservée reste nécessaire ; aucun délai ni absence ne confirme le retrait.'); await journal.refetch(); }
    } finally { if (context.isCurrent(operation)) setWorking(false); context.finish(operation); }
  };
  const acknowledge = async () => {
    if (!attempt || !localAttempt || working || agreementView || receipt.isFetching || !receipt.isSuccess ||
        !(receipt.data.publicWithdrawalComplete || receipt.data.state === 'not_executed')) return;
    const operation = context.start(); if (!operation) return;
    setWorking(true);
    try {
      await ArticlePrivacyService.acknowledge(attempt, () => context.assertCurrent(operation)); context.assertCurrent(operation);
      setNotice(receipt.data.state === 'not_executed' ? 'La non-exécution de cette intention a été relue et acquittée sur cet appareil. Elle n’a effectué aucun retrait et une requête tardive reste bloquée.'
        : 'Le retrait complet a été relu puis acquitté sur cet appareil. La preuve privée reste conservée pour les personnes autorisées.');
      await journal.refetch(); context.assertCurrent(operation);
    } catch { if (context.isCurrent(operation)) setNotice('Le résultat complet ne peut pas être acquitté. L’intention reste conservée.'); }
    finally { if (context.isCurrent(operation)) setWorking(false); context.finish(operation); }
  };
  const refresh = async () => {
    if (working || !uid || !access) return;
    const operation = context.start(); if (!operation) return;
    setWorking(true); setSelectedMedia(null); setDraft(null); setConfirmed(false);
    try { await Promise.all([evidence.refetch(), ...(!agreementView ? [journal.refetch(), ...(attempt ? [receipt.refetch()] : [])] : [])]); context.assertCurrent(operation); }
    catch { if (context.isCurrent(operation)) setNotice('Les preuves actuelles restent à vérifier.'); }
    finally { if (context.isCurrent(operation)) setWorking(false); context.finish(operation); }
  };
  const renderMedia = useCallback(({ item }: { item: PrivateArticleMediaReference }) => <View style={styles.card}>
    <Text style={styles.body}>Copie privée conservée lors du retrait · {Math.ceil(item.size / 1024)} Ko. Les pixels historiques ne sont pas certifiés.</Text>
    <Button variant="secondary" disabled={working || !recorded || evidence.isFetching} onPress={() => setSelectedMedia(item)}>Consulter cette copie privée</Button>
  </View>, [working, recorded, evidence.isFetching]);
  const withdrawal = receipt.isSuccess && !receipt.isFetching && receipt.data?.ownerId === uid ? receipt.data : null;
  const header = <View style={styles.content}>
    <Text style={styles.body}>{agreementView ? contractEvidence ? 'Consultation privée des renseignements figés de votre contrat.'
      : recorded ? 'Consultation autorisée du dossier propriétaire. Ce dossier est distinct des renseignements figés d’un contrat.'
        : 'Le serveur vérifie les droits et la provenance de la consultation privée.'
      : 'Retirer vos informations personnelles du public conserve les références nécessaires aux commandes et aux recours. Cette action est distincte de supprimer une annonce pour la remettre en vente.'}</Text>
    <Text style={styles.caption}>{contractEvidence
      ? 'Les renseignements ci-dessous proviennent uniquement du snapshot figé de votre contrat. La conservation des copies de médias lors du retrait ne date pas ce texte et ne certifie pas les pixels historiques.'
      : recorded ? 'Le dossier du propriétaire conserve l’annonce au moment du retrait. Il ne complète pas les renseignements manquants d’une ancienne commande, ni une déclaration d’hygiène passée.'
        : 'La provenance doit être qualifiée avant l’affichage. Aucun renseignement manquant d’un ancien contrat n’est reconstitué.'}</Text>
    <Text style={styles.caption}>Les copies déjà téléchargées par des tiers ne peuvent pas être rappelées.</Text>
    {!uid || !access ? <Text accessibilityRole="alert" style={styles.notice}>Connexion ou référence valide requise.</Text> : null}
    {notice ? <Text accessibilityRole="alert" style={styles.notice}>{notice}</Text> : null}
    <Button variant="ghost" disabled={working || !uid || !access} onPress={refresh}>Relire les preuves et l’état enregistré</Button>
    <Button variant="ghost" disabled={working} onPress={() => router.push('/settings/help')}>Contacter l’équipe pour ce retrait</Button>
    {journal.isError && !agreementView ? <Text style={styles.notice}>Le journal propriétaire n’est pas lisible. Une nouvelle intention ne sera pas créée.</Text> : null}
    {attempt && !agreementView ? <View style={styles.card}>
      <Text style={styles.title}>{localAttempt ? 'Intention de retrait conservée sur cet appareil' : 'Intention du propriétaire retrouvée dans la preuve native'}</Text><Text selectable style={styles.caption}>{attempt.requestId}</Text>
      <Text style={styles.body}>{withdrawal?.state === 'not_executed' ? 'Cette intention n’a effectué aucun retrait. Une autre était déjà enregistrée ; toute requête tardive de cette intention est bloquée.'
        : withdrawal?.state === 'completed' ? 'Retrait public complet qualifié.' : withdrawal?.state === 'needs_review' ? 'Examen de certains médias nécessaire.'
        : withdrawal?.state === 'pending' ? 'Retrait en cours.' : withdrawal?.state === 'unrecorded' ? 'Intention non retrouvée côté serveur. Elle reste conservée localement.' : 'Résultat à vérifier.'}</Text>
      {withdrawal?.intentCommitted && withdrawal.state !== 'not_executed' ? <Text style={styles.caption}>Médias révoqués : {withdrawal.mediaRevoked}/{withdrawal.mediaTotal} · À examiner : {withdrawal.mediaNeedsReview}</Text> : null}
      <Button variant="secondary" disabled={working} onPress={() => { void receipt.refetch(); }}>Observer cette intention sans relancer le retrait</Button>
      {withdrawal?.state !== 'completed' && withdrawal?.state !== 'not_executed' ? <Button loading={working} disabled={working} onPress={() => execute(attempt, true)}>Reprendre le retrait avec cette même intention</Button> : null}
      {localAttempt && (withdrawal?.publicWithdrawalComplete || withdrawal?.state === 'not_executed') ? <Button variant="secondary" disabled={working} onPress={acknowledge}>
        {withdrawal.state === 'not_executed' ? 'Relire et acquitter cette non-exécution' : 'Relire et acquitter le retrait complet'}</Button> : null}
    </View> : null}
    {!agreementView && !attempt && journal.isSuccess && !journal.isFetching && evidence.isSuccess && evidence.data.state === 'unrecorded' && evidence.data.ownerId === uid ? <Button disabled={working} onPress={createDraft}>Retirer mes informations personnelles</Button> : null}
    {draft ? <View style={styles.card}>
      <Text style={styles.title}>Confirmer le retrait public</Text><Text selectable style={styles.caption}>Annonce : {draft.articleId}{'\n'}Intention : {draft.requestId}</Text>
      <Checkbox checked={confirmed} disabled={working} onToggle={() => setConfirmed(!confirmed)}><Text style={styles.body}>Je demande le retrait public de mes informations et photos. Je comprends que les preuves nécessaires aux commandes et recours restent privées, et que les copies téléchargées par des tiers ne peuvent pas être rappelées.</Text></Checkbox>
      <Button loading={working} disabled={working || !confirmed} onPress={() => execute(draft, false)}>Enregistrer ce retrait</Button>
      <Button variant="ghost" disabled={working} onPress={() => { setDraft(null); setConfirmed(false); }}>Fermer sans envoyer</Button>
    </View> : null}
    {evidence.isError ? <Text style={styles.notice}>Aucune preuve privée actuelle n’a pu être qualifiée. Aucun ancien lien public ne sera affiché comme remplacement.</Text> : null}
    {recorded ? <View style={styles.card}>
      <Text style={styles.title}>{recorded.evidenceScope === 'transaction_contract' ? 'Renseignements figés de votre commande'
        : recorded.evidenceScope === 'swap_contract' ? 'Article figé dans votre accord Troc' : 'Dossier du propriétaire au retrait'}</Text>
      {contractEvidence ? <Text selectable style={styles.caption}>Contrat : {recorded.contractId}. Aucun renseignement de l’annonce actuelle n’est ajouté à ce snapshot.</Text> : null}
      <Text style={styles.caption}>Conservation des médias lors du retrait : {new Date(recorded.capturedAt).toLocaleString(APP_LOCALE)}. Cette date ne prouve ni la date du texte contractuel ni les pixels historiques.</Text>
      <Text selectable style={styles.body}>{contractEvidence ? 'Titre enregistré dans le contrat' : 'Titre de l’annonce au retrait'} : {fieldText(recorded.snapshot.title)}</Text>
      <Text selectable style={styles.body}>{contractEvidence ? 'Description enregistrée dans le contrat' : 'Description de l’annonce au retrait'} : {fieldText(recorded.snapshot.description)}</Text>
      <Text style={styles.body}>{contractEvidence ? 'Prix enregistré dans le contrat' : 'Prix de l’annonce au retrait'} : {fieldText(recorded.snapshot.price)}</Text>
      {recorded.mediaNeedsReview > 0 ? <Text style={styles.notice}>{recorded.mediaNeedsReview} références de médias ne disposent pas d’une copie privée qualifiée actuellement.</Text> : null}
    </View> : null}
    {selectedMedia ? <View style={styles.card}>
      <Text style={styles.title}>Copie privée conservée lors du retrait</Text>
      <Text style={styles.caption}>Sa référence appartient à {contractEvidence ? 'votre contrat' : 'ce dossier propriétaire'}. Les pixels historiques ne sont pas certifiés.</Text>
      {image ? <Image source={{ uri: image }} style={styles.image} contentFit="contain" cachePolicy="none" />
        : <Text style={styles.notice}>{media.isError || !currentSelectedMedia ? 'La copie privée n’est pas actuellement autorisée ou qualifiée par la preuve relue.' : 'Lecture privée authentifiée…'}</Text>}
      <Button variant="ghost" onPress={() => setSelectedMedia(null)}>Fermer cette photo privée</Button>
    </View> : null}
  </View>;
  return <View style={styles.container}><ScreenHeader title="Retrait et preuves privées" onBack={() => router.back()} />
    <FlashList data={recorded?.mediaRefs ?? []} keyExtractor={mediaKey} renderItem={renderMedia} ListHeaderComponent={header} contentContainerStyle={styles.list} />
  </View>;
}

const styles = StyleSheet.create({ container: { flex: 1, backgroundColor: colors.background }, list: { paddingBottom: spacing.xl },
  content: { padding: spacing.md, gap: spacing.md }, card: { padding: spacing.md, marginBottom: spacing.md, gap: spacing.sm,
    backgroundColor: colors.surface, borderRadius: radius.md, borderWidth: 1, borderColor: colors.border },
  title: { ...typography.h2, color: colors.foreground }, body: { ...typography.body, color: colors.foreground },
  caption: { ...typography.caption, color: colors.foregroundSecondary }, notice: { ...typography.bodySmall, color: colors.danger },
  image: { width: '100%', height: spacing['4xl'] * 4, backgroundColor: colors.surfaceWarm },
});
