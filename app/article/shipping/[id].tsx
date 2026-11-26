import React, { useRef, useState } from 'react';
import { ActivityIndicator, Alert, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { CancelledError, useQuery, useQueryClient } from '@tanstack/react-query';
import { randomUUID } from 'expo-crypto';
import { Button, ScreenHeader } from '@/components/ui';
import { colors, radius, spacing, typography } from '@/constants/theme';
import { PAYMENTS_ENABLED, SHIPPING_LISTINGS_ENABLED } from '@/config/featureFlags';
import { useAuthenticatedUid } from '@/hooks/useAuth';
import { useLabelLifecycleContext } from '@/hooks/useLabelLifecycleContext';
import { getAuthSessionGeneration } from '@/store/authStore';
import { ArticlesService } from '@/services/articlesService';
import { ShippingParcelService, type ShippingParcelAutomaticChoice } from '@/services/shippingParcelService';
import { automaticShippingFamilyProfile } from '@/functions/src/shared/automaticShippingEstimate';
import { SellerShippingAddressService } from '@/services/sellerShippingAddressService';
import { StripeAccountService } from '@/features/wallet/services/stripeAccountService';
import { canReceiveBuyerPayments } from '@/features/wallet/utils/stripeRequirements';
import { hasCurrentOrdinaryShippingDeclaration, ordinaryPhysicalAddress } from '@/utils/ordinaryShippingAddress';

export default function ArticleShippingScreen() {
  const router = useRouter(), client = useQueryClient();
  const { id, returnChatId: returnChatParam } = useLocalSearchParams<{ id: string; returnChatId?: string }>();
  const returnChatId = typeof returnChatParam === 'string' && /^[A-Za-z0-9_-]{1,200}$/.test(returnChatParam) ? returnChatParam : null;
  const articleId = typeof id === 'string' ? id : '';
  const uid = useAuthenticatedUid(), generation = getAuthSessionGeneration();
  const context = useLabelLifecycleContext(`article-shipping:${articleId}`, uid);
  const sourceKey = JSON.stringify([uid, generation, articleId, context.focusRevision]);
  const queryKey = ['article-shipping-preparation', sourceKey];
  const readCurrent = async <T,>(signal: AbortSignal, read: (assertCurrent: () => void) => Promise<T>): Promise<T> => {
    try {
      if (signal.aborted) throw new CancelledError({revert: true});
      const operation = context.capture();
      const assertCurrent = () => {
        if (signal.aborted) throw new CancelledError({revert: true});
        context.assertCurrent(operation);
      };
      const result = await read(assertCurrent);
      assertCurrent();
      return result;
    } catch (error) {
      if (signal.aborted || error && typeof error === 'object' && 'code' in error && error.code === 'client/stale-operation') {
        throw new CancelledError({revert: true});
      }
      throw error;
    }
  };
  const paymentAccount = useQuery({
    queryKey: ['article-shipping-payment-account', uid, generation, articleId, context.focusRevision],
    enabled: !!uid && context.focused && PAYMENTS_ENABLED, staleTime: 0, gcTime: 0, retry: false,
    queryFn: ({signal}) => readCurrent(signal, current => StripeAccountService.getAccountStatus(uid!, current)),
  });
  const preparation = useQuery({ queryKey, enabled: !!uid && !!articleId && context.focused && SHIPPING_LISTINGS_ENABLED,
    staleTime: 0, gcTime: 0, retry: false,
    queryFn: ({signal}) => readCurrent(signal, async current => {
      const article = await ArticlesService.getArticleById(articleId); current();
      if (!article || article.sellerId !== uid) throw new Error('Cette préparation est réservée au propriétaire de l’annonce.');
      const [parcel, origin] = await Promise.all([
        ShippingParcelService.read(uid!, articleId, current), SellerShippingAddressService.read(uid!, current),
      ]); current();
      const physical = ordinaryPhysicalAddress(origin.selected);
      const originReady = !!physical && physical.province === 'QC' && typeof origin.selected?.name === 'string' &&
        !!origin.selected.name.trim() && await hasCurrentOrdinaryShippingDeclaration(origin.selected);
      current(); return { article, parcel, origin, originReady };
    }),
  });
  const [inputOwner, setInputOwner] = useState(sourceKey);
  const [saving, setSaving] = useState(false);
  const [notice, setNotice] = useState('');
  const attempt = useRef<{source: string; version: number; profileKey: string; requestId: string} | null>(null);
  if (inputOwner !== sourceKey) {
    setInputOwner(sourceKey); setSaving(false); setNotice('');
  }
  const data = preparation.data;
  const recommendation = data?.parcel.recommendation;
  const familyChanged = data?.parcel.profileVersion === 2 && recommendation?.profileVersion === 2 &&
    data.parcel.profileFamily !== recommendation.profileFamily;
  const needsPreparation = data?.parcel.status === 'missing' || familyChanged;
  const profile: ShippingParcelAutomaticChoice | null = recommendation?.profileVersion === 2
    ? {profileVersion: 2, profileFamily: recommendation.profileFamily, profileSize: recommendation.profileSize}
    : recommendation?.profileSize ?? null;
  const profileKey = profile ? JSON.stringify(profile) : '';
  const storedFamily = data?.parcel.profileFamily ? automaticShippingFamilyProfile(data.parcel.profileFamily) : null;
  const displayEstimate = needsPreparation && data?.article.isSold !== true
    ? recommendation?.profileVersion === 2 ? recommendation : null
    : storedFamily;
  const currentSource = () => {
    const state = client.getQueryState(queryKey);
    if (!data || !context.focused || state?.status !== 'success' || state.fetchStatus !== 'idle' || state.isInvalidated || state.data !== data) {
      throw new Error('Actualisez la préparation avant de continuer.');
    }
  };
  const save = async () => {
    if (!uid || !data || !profile || !needsPreparation || !canEdit || !SHIPPING_LISTINGS_ENABLED) return;
    let operation;
    try { currentSource(); operation = context.start(); } catch (error) {
      Alert.alert('Préparation à actualiser', error instanceof Error ? error.message : 'Réessayez dans un instant.'); return;
    }
    if (!operation) return;
    const current = () => {context.assertCurrent(operation); currentSource();};
    setSaving(true); setNotice('');
    try {
      // Retry only this exact versioned profile. The server requalifies it
      // against the listing before recording a new preparation.
      if (!attempt.current || attempt.current.source !== sourceKey || attempt.current.version !== data.parcel.version || attempt.current.profileKey !== profileKey) {
        attempt.current = {source: sourceKey, version: data.parcel.version, profileKey, requestId: randomUUID()};
      }
      await ShippingParcelService.saveAutomatic(uid, articleId, data.parcel.version, attempt.current.requestId, profile, current);
      context.assertCurrent(operation);
      const refreshed = await preparation.refetch(); context.assertCurrent(operation);
      if (refreshed.isError) throw refreshed.error;
      attempt.current = null;
      setNotice(refreshed.data?.originReady ? 'Le colis et l’adresse d’envoi sont enregistrés.' : 'Le colis est enregistré. Ajoutez l’adresse d’envoi pour permettre aux acheteurs d’obtenir un tarif.');
    } catch (error) {
      if (!context.isCurrent(operation)) return;
      setNotice(error instanceof Error ? error.message : 'La préparation n’a pas pu être confirmée. Réessayez dans un instant.');
    } finally { if (context.isCurrent(operation)) setSaving(false); context.finish(operation); }
  };
  const canEdit = !!data && context.focused && !preparation.isFetching && !preparation.isError && data.article.isSold !== true && !saving;

  return <View style={styles.container}>
    <ScreenHeader title="Préparer l’expédition" onBack={() => router.back()} />
      <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
        {!uid ? <Text style={styles.body}>Connectez-vous au compte vendeur pour préparer cet envoi.</Text>
          : !SHIPPING_LISTINGS_ENABLED ? <Text style={styles.body}>La préparation des expéditions n’est pas disponible.</Text>
          : preparation.isPending ? <ActivityIndicator color={colors.primary} />
          : preparation.isError ? <View style={styles.section}>
            <Text style={styles.body}>{preparation.error instanceof Error ? preparation.error.message : 'La préparation est indisponible.'}</Text>
            <Button variant="secondary" onPress={() => { void preparation.refetch(); }}>Réessayer</Button>
          </View> : data ? <>
            <Text style={styles.title}>{data.article.title}</Text>
            {returnChatId ? <Text style={styles.body}>Préparez votre expédition pour permettre à l’acheteur de payer.</Text> : null}
            {PAYMENTS_ENABLED ? <View style={styles.section}>
              <Text style={styles.heading}>Recevoir mes ventes</Text>
              <Text style={styles.body}>{paymentAccount.isFetching ? 'Vérification du compte de paiement…'
                : paymentAccount.isError ? 'Le statut du compte reste à vérifier.'
                  : canReceiveBuyerPayments(paymentAccount.data) ? 'Votre compte est prêt à recevoir les paiements des acheteurs.'
                    : paymentAccount.data?.hasAccount ? 'Consultez les renseignements demandés pour terminer votre configuration.'
                      : 'Configurez votre compte pour que les acheteurs puissent payer cette annonce.'}</Text>
              <Button variant="secondary" disabled={saving} onPress={() => router.push({pathname: '/settings/stripe-onboarding', params: {from: 'shipping-preparation', articleId,
                intent: paymentAccount.data?.hasAccount ? 'manage' : 'setup'}})}>
                {paymentAccount.data?.hasAccount ? 'Consulter mon compte de paiement' : 'Configurer mon compte de paiement'}
              </Button>
            </View> : null}
            <View style={styles.section}>
              <Text style={styles.heading}>Adresse d’envoi</Text>
              <Text style={styles.body}>{data.originReady && data.origin.selected
                ? `${String(data.origin.selected.street)}\n${String(data.origin.selected.city)}, QC ${String(data.origin.selected.postalCode)}`
                : 'Ajoutez l’adresse au Québec depuis laquelle vous expédierez le colis.'}</Text>
              <Button variant="secondary" disabled={saving} onPress={() => router.push({ pathname: '/settings/address', params: { purpose: 'shipping_origin', from: 'shipping-preparation', articleId } })}>
                {data.originReady ? 'Modifier l’adresse' : 'Ajouter l’adresse d’envoi'}
              </Button>
            </View>
            <View style={styles.section}>
              <Text style={styles.heading}>{displayEstimate || needsPreparation ? 'Colis estimé' : 'Colis enregistré'}</Text>
              {displayEstimate ? <Text style={styles.format}>{displayEstimate.label}</Text> : needsPreparation ? <Text style={styles.body}>Format estimé pour cet article</Text> : null}
              {data.article.isSold ? <Text style={styles.caption}>Le colis de cette commande est déjà enregistré.</Text> : null}
              {needsPreparation && !data.article.isSold ? <Button loading={saving} disabled={!canEdit || !profile} onPress={() => { void save(); }}>{familyChanged ? 'Actualiser mon colis' : 'Préparer mon colis'}</Button> : null}
            </View>
            {notice ? <Text accessibilityLiveRegion="polite" style={styles.body}>{notice}</Text> : null}
            <Button variant="secondary" disabled={saving} onPress={() => {
              try {context.capture();} catch {return;}
              if (returnChatId) router.replace({pathname: '/chat/[id]', params: {id: returnChatId}});
              else router.replace({ pathname: '/article/[id]', params: { id: articleId } });
            }}>{returnChatId ? 'Revenir à la conversation' : 'Voir mon annonce'}</Button>
          </> : null}
      </ScrollView>
  </View>;
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.background },
  content: { padding: spacing.lg, gap: spacing.lg, paddingBottom: spacing['3xl'] },
  title: { ...typography.h2, color: colors.foreground }, heading: { ...typography.h3, color: colors.foreground },
  body: { ...typography.body, color: colors.foregroundSecondary }, caption: { ...typography.caption, color: colors.muted },
  section: { gap: spacing.md, padding: spacing.lg, borderRadius: radius.md, borderWidth: StyleSheet.hairlineWidth, borderColor: colors.border, backgroundColor: colors.surface },
  format: {...typography.h2, color: colors.foreground},
});
