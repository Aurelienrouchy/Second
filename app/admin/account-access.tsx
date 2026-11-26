import { useCallback, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { FlashList } from '@shopify/flash-list';
import { useInfiniteQuery, useQuery } from '@tanstack/react-query';
import { useRouter } from 'expo-router';
import { randomUUID } from 'expo-crypto';
import { Button, Input, ScreenHeader } from '@/components/ui';
import { AdminSectionNav, type AccountAccessAdminItem } from '@/features/admin';
import { AccountAccessAdminService } from '@/features/admin/services/accountAccessAdminService';
import { useAuthenticatedUid } from '@/hooks/useAuth';
import { useShippingPurchaseContext } from '@/hooks/useShippingPurchaseContext';
import { getAuthSessionGeneration } from '@/store/authStore';
import { APP_LOCALE } from '@/constants/locale';
import { colors, radius, spacing, typography } from '@/constants/theme';

const keyExtractor = (item: AccountAccessAdminItem) => item.reference;
const recordedDate = (iso: string) => new Date(iso).toLocaleString(APP_LOCALE, {timeZone: 'America/Toronto'});
const referencePattern = /^access_[a-f0-9]{64}$/;

export default function AccountAccessAdminScreen() {
  const uid = useAuthenticatedUid(), router = useRouter(), generation = getAuthSessionGeneration();
  const scope = JSON.stringify([uid, generation]);
  const context = useShippingPurchaseContext(`account-access-admin:${scope}`, uid);
  // A new screen instance cannot reuse a prior admin's restored private cache.
  const [readInstance] = useState(() => randomUUID());
  const [lookup, setLookup] = useState(''), [selectedReference, setSelectedReference] = useState<string | null>(null);
  const [formScope, setFormScope] = useState(scope);
  if (formScope !== scope) {setFormScope(scope); setLookup(''); setSelectedReference(null);}
  const readable = !!uid && context.focused;
  const list = useInfiniteQuery({queryKey: ['account-access-admin-list', readInstance, scope, context.focusRevision], enabled: readable,
    staleTime: 0, gcTime: 0, retry: false, initialPageParam: undefined as string | undefined,
    queryFn: ({pageParam}) => {const operation = context.capture();
      return AccountAccessAdminService.list(operation.session.uid, pageParam, () => context.assertCurrent(operation));},
    getNextPageParam: page => page.hasMore ? page.cursor ?? undefined : undefined});
  const listReady = readable && list.isSuccess && !list.isFetching && !list.isError;
  const detail = useQuery({queryKey: ['account-access-admin-detail', readInstance, scope, selectedReference, context.focusRevision],
    enabled: readable && !!selectedReference && listReady, staleTime: 0, gcTime: 0, retry: false,
    queryFn: () => {const operation = context.capture();
      return AccountAccessAdminService.detail(operation.session.uid, selectedReference!, () => context.assertCurrent(operation));} });
  const selected = listReady && selectedReference && detail.isSuccess && !detail.isFetching && !detail.isError && detail.data.item.reference === selectedReference
    ? detail.data.item : null;
  const rows = listReady ? list.data.pages.flatMap(page => page.items) : [];
  const choose = useCallback((reference: string) => {
    try {context.capture();} catch {return;}
    if (!referencePattern.test(reference)) return;
    setSelectedReference(reference);
  }, [context.frame, context.focusRevision]);
  const renderItem = useCallback(({item}: {item: AccountAccessAdminItem}) => <View style={styles.card}>
    <Text style={styles.title}>{item.state === 'received' ? 'Dépôt de prise de contact enregistré' : 'Intention neutralisée'}</Text>
    <Text selectable style={styles.caption}>Référence : {item.reference}</Text>
    <Text style={styles.body}>Enregistré le {recordedDate(item.recordedAt)} (heure du Québec).</Text>
    {item.state === 'received' ? <Text selectable style={styles.body}>Contact déclaré, non vérifié : {item.command.replyEmail}</Text>
      : <Text style={styles.body}>Aucune demande de contact n’a été créée par cette intention.</Text>}
    <Button variant="secondary" onPress={() => choose(item.reference)}>Consulter ce dépôt privé</Button>
  </View>, [choose]);
  const refresh = () => {
    try {context.capture();} catch {return;}
    void list.refetch();
    if (selectedReference) void detail.refetch();
  };
  return <View style={styles.container}>
    <ScreenHeader title="Prises de contact pour l’accès au compte" onBack={() => router.back()} />
    <AdminSectionNav />
    <FlashList data={rows} keyExtractor={keyExtractor} renderItem={renderItem} contentContainerStyle={styles.content}
      ListHeaderComponent={<View style={styles.section}>
        <Text style={styles.body}>Dépôts reçus depuis le formulaire public d’aide à la connexion. Les contacts et récits sont déclarés par l’expéditeur ; ils ne prouvent ni son identité ni ses droits sur un compte.</Text>
        <Text style={styles.caption}>Seuls les moyens Firebase déjà liés permettent de reprendre accès au compte. Seconde ne propose aucune récupération manuelle par opérateur : ne réattribuez pas un compte, ne remplacez pas ses moyens de connexion et ne communiquez pas ses fonds, commandes ou renseignements au contact déclaré. Un numéro de téléphone de profil n’est pas un moyen de connexion.</Text>
        <Text style={styles.caption}>Si tous les moyens liés sont perdus, le compte ne peut pas être réattribué. Les obligations sur les fonds, commandes, conservation et recours restent distinctes. Cette consultation n’enregistre aucun traitement humain et n’envoie aucun message.</Text>
        {!uid ? <Text style={styles.body}>Votre accès administratif actuel doit être confirmé.</Text> : null}
        <Input label="Référence exacte d’un dépôt déjà connue" value={lookup} onChangeText={setLookup} autoCapitalize="none" maxLength={71} disabled={!listReady} />
        <Button variant="secondary" disabled={!listReady || !referencePattern.test(lookup.trim())} onPress={() => choose(lookup.trim())}>Lire cette référence privée</Button>
        <Button variant="secondary" disabled={!readable || list.isFetching || detail.isFetching} onPress={refresh}>Relire les dépôts actuels</Button>
        {list.isError ? <Text accessibilityRole="alert" style={styles.body}>La file privée ou les droits actuels ne peuvent pas être confirmés. Aucun dépôt conservé en mémoire n’est affiché.</Text> : null}
        {selectedReference ? <View style={styles.card}>
          <Text style={styles.title}>Détail privé du dépôt</Text>
          {!listReady ? <Text style={styles.body}>Lecture privée à confirmer…</Text> : detail.isFetching ? <Text style={styles.body}>Relecture du dépôt…</Text>
            : detail.isError ? <Text accessibilityRole="alert" style={styles.body}>Ce dépôt ne peut pas être relu avec votre accès actuel. Aucun récit antérieur n’est affiché.</Text> : null}
          {selected ? <>
            <Text selectable style={styles.caption}>Référence : {selected.reference}</Text>
            <Text style={styles.body}>Enregistré le {recordedDate(selected.recordedAt)} (heure du Québec).</Text>
            {selected.state === 'received' ? <>
              <Text style={styles.title}>Contact déclaré, non vérifié</Text><Text selectable style={styles.body}>{selected.command.replyEmail}</Text>
              <Text style={styles.title}>Récit original déclaré</Text><Text selectable style={styles.body}>{selected.command.narrative}</Text>
              <Text style={styles.caption}>Ce dépôt reste distinct d’une vérification d’identité ou d’une réponse de l’équipe. La consultation seule ne change pas son état.</Text>
            </> : <Text style={styles.body}>Cette intention a été neutralisée avant le dépôt. Aucun contact ni récit à traiter n’est présent.</Text>}
          </> : null}
          <Button variant="ghost" onPress={() => {try {context.capture(); setSelectedReference(null);} catch { /* Stale session. */ }}}>Fermer ce détail</Button>
        </View> : null}
        <Text style={styles.title}>Dépôts privés enregistrés</Text>
      </View>}
      ListEmptyComponent={<Text style={styles.body}>{list.isFetching ? 'Lecture des dépôts…' : listReady ? 'Aucun dépôt visible dans cette page.' : 'La lecture privée reste à confirmer.'}</Text>}
      ListFooterComponent={readable && !list.isError && list.hasNextPage ? <Button variant="secondary" disabled={list.isFetching}
        onPress={() => {try {context.capture(); void list.fetchNextPage();} catch { /* Stale session. */ }}}>Lire la page suivante</Button> : null} />
  </View>;
}
const styles = StyleSheet.create({container: {flex: 1, backgroundColor: colors.background}, content: {padding: spacing.md},
  section: {gap: spacing.md, marginBottom: spacing.md}, card: {gap: spacing.sm, padding: spacing.md, marginBottom: spacing.md,
    borderWidth: StyleSheet.hairlineWidth, borderColor: colors.border, borderRadius: radius.md},
  title: {...typography.body, color: colors.foreground}, body: {...typography.bodySmall, color: colors.foreground}, caption: {...typography.caption, color: colors.muted} });
