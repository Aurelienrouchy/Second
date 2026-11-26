/**
 * Privacy Settings
 */

import { useAuthenticatedSession } from '@/hooks/useAuth';
import { useShippingPurchaseContext } from '@/hooks/useShippingPurchaseContext';
import { getAuthSessionGeneration, useAuthStore } from '@/store/authStore';
import { MarketingConsentService } from '@/services/marketingConsentService';
import { ArticlePrivacyService } from '@/services/articlePrivacyService';
import { setAnalyticsEnabled, track } from '@/lib/analytics';
import { UserService } from '@/services/userService';
import { UserPreferences } from '@/types';
import { colors, fonts, spacing, radius } from '@/constants/theme';
import { Text, Caption, Label, ScreenHeader, Button, Input, Avatar } from '@/components/ui';
import { Ionicons } from '@expo/vector-icons';
import { useRouter, type Href } from 'expo-router';
import React, { useState } from 'react';
import {
  Alert,
  Pressable,
  ScrollView,
  StyleSheet,
  Switch,
  View,
} from 'react-native';
import { Skeleton } from '@/components/ui/Skeleton';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { APP_LOCALE } from '@/constants/locale';

interface RgpdItemProps {
  icon: keyof typeof Ionicons.glyphMap;
  iconColor: string;
  title: string;
  description: string;
  onPress: () => void;
  isLast?: boolean;
}

const RgpdItem = ({ icon, iconColor, title, description, onPress, isLast }: RgpdItemProps) => (
  <Pressable
    style={({ pressed }) => [styles.rgpdItem, isLast && styles.rgpdItemLast, pressed && { opacity: 0.7 }]}
    onPress={onPress}
  >
    <View style={styles.rgpdItemLeft}>
      <View style={[styles.rgpdIcon, { backgroundColor: `${iconColor}15` }]}>
        <Ionicons name={icon} size={20} color={iconColor} />
      </View>
      <View style={styles.rgpdItemText}>
        <Text variant="body" style={styles.rgpdItemTitle}>{title}</Text>
        <Caption>{description}</Caption>
      </View>
    </View>
    <Ionicons name="chevron-forward" size={20} color={colors.muted} />
  </Pressable>
);

interface PrivacySettings {
  showProfilePhoto: boolean;
  aiProfilingConsent: boolean;
  analyticsConsent: boolean;
}

// Privacy-by-default (Loi 25 art. 9.1, LCAP) : tous les défauts sont OFF.
// Source de vérité partagée : UserService.PRIVACY_DEFAULTS.
// analyticsConsent suit le modèle produit OPT-OUT — voir COPY_ANALYTICS.
const DEFAULT_PRIVACY: PrivacySettings = {
  showProfilePhoto: UserService.PRIVACY_DEFAULTS.showProfilePhoto,
  aiProfilingConsent: UserService.PRIVACY_DEFAULTS.aiProfilingConsent,
  analyticsConsent: true,
};

const COPY_AI = {
  title: 'Recommandations personnalisées par IA',
  description:
    "Pour vous suggérer des articles adaptés à vos goûts, Seconde peut utiliser les articles que vous consultez et aimez ainsi que vos recherches. Ce choix est désactivé par défaut et peut être modifié à tout moment. Il est distinct de l'aide IA à la création d'annonce, de la recherche par photo et de l'analyse visuelle du catalogue pour les articles similaires, qui fonctionnent indépendamment de ce réglage.",
} as const;

// Statistiques d'usage (analytics produit). Modèle opt-out (activé par défaut) :
// identifiant de compte pseudonyme, désactivable à tout moment.
const COPY_ANALYTICS = {
  title: "Données d'utilisation",
  description:
    "Nous aider à améliorer l'application grâce à des statistiques d'usage associées à un identifiant de compte pseudonyme et, si disponible, à votre pseudo public. Ces données sont traitées par PostHog aux États-Unis par défaut. Elles ne sont pas anonymes. Vous pouvez désactiver la collecte sur l'application et le serveur à tout moment.",
} as const;

const COPY_MARKETING_REVOKE = {
  title: 'Communications marketing',
  description:
    'Autoriser les offres, baisses de prix et nouveautés de Second. Ce choix est facultatif et peut être retiré à tout moment. Les avis concernant vos commandes et vos recours restent distincts.',
} as const;

export default function PrivacySettingsScreen() {
  const router = useRouter();
  const { uid, identity: user } = useAuthenticatedSession();
  const generation = useAuthStore(getAuthSessionGeneration);
  const marketingContext = useShippingPurchaseContext('marketing-consent', uid);
  const marketingKey = ['marketingConsent', uid, generation, marketingContext.focusRevision];
  const marketingScope = JSON.stringify(marketingKey);
  const [marketingNotice, setMarketingNotice] = useState<{ scope: string; text: string } | null>(null);
  const queryClient = useQueryClient();
  const [articlePrivacyReference, setArticlePrivacyReference] = useState('');
  const [privacyOwnerScope, setPrivacyOwnerScope] = useState(`${uid}:${generation}`);
  if (privacyOwnerScope !== `${uid}:${generation}`) { setPrivacyOwnerScope(`${uid}:${generation}`); setArticlePrivacyReference(''); }
  const withdrawalJournal = useQuery({ queryKey: ['article-privacy-journal-settings', uid, generation, marketingContext.focusRevision],
    enabled: !!uid && marketingContext.focused, staleTime: 0, gcTime: 0, retry: false,
    queryFn: () => { const operation = marketingContext.capture(); return ArticlePrivacyService.attempts(operation.session.uid, () => marketingContext.assertCurrent(operation)); },
  });
  const avatarState = useQuery({ queryKey: ['private-profile-state', uid, generation, marketingContext.focusRevision],
    enabled: !!uid && marketingContext.focused, staleTime: 0, gcTime: 0, retry: false,
    queryFn: () => { const operation = marketingContext.capture(); return ArticlePrivacyService.avatar(operation.session.uid, operation.session.uid,
      () => marketingContext.assertCurrent(operation), undefined, 'observe'); },
  });
  const avatarCopy = useQuery({ queryKey: ['private-profile-bytes', uid, generation, marketingContext.focusRevision, avatarState.data?.evidenceId, avatarState.data?.generation],
    enabled: !!uid && marketingContext.focused && avatarState.isSuccess && !avatarState.isFetching &&
      ['copied', 'revoked'].includes(avatarState.data.state), staleTime: 0, gcTime: 0, retry: false,
    queryFn: () => { const operation = marketingContext.capture(); return ArticlePrivacyService.avatar(operation.session.uid, operation.session.uid,
      () => marketingContext.assertCurrent(operation), undefined, 'read', avatarState.data!.mediaId!); },
  });
  const privateAvatar = avatarState.isSuccess && !avatarState.isFetching && avatarCopy.isSuccess && !avatarCopy.isFetching && marketingContext.focused && avatarCopy.data?.viewerId === uid &&
    avatarCopy.data.ownerId === uid && avatarCopy.data.evidenceId === avatarState.data?.evidenceId && avatarCopy.data.generation === avatarState.data?.generation
    ? avatarCopy.data.dataUrl : null;

  const marketingQuery = useQuery({ queryKey: marketingKey, enabled: !!uid && marketingContext.focused,
    staleTime: 0, gcTime: 0, retry: false,
    queryFn: () => {
      const operation = marketingContext.capture();
      return MarketingConsentService.observe(operation.session.uid, () => marketingContext.assertCurrent(operation));
    },
  });
  const marketingReceipt = marketingQuery.data;
  const marketingGranted = marketingQuery.isSuccess && marketingReceipt?.ownerId === uid &&
    marketingReceipt.consentRecorded && marketingReceipt.consentState === 'granted' && marketingReceipt.enabled === true;

  const { data: privacySettings = DEFAULT_PRIVACY, isLoading } = useQuery({
    queryKey: ['userPrivacyPreferences', user?.id, generation],
    queryFn: async () => {
      const operation = marketingContext.capture();
      const preferences = await UserService.getUserPreferences(user!.id);
      marketingContext.assertCurrent(operation);
      return {
        // Privacy-by-default : absent => false (photo non visible tant que non activée).
        showProfilePhoto:
          preferences?.privacy?.showProfilePhoto ?? UserService.PRIVACY_DEFAULTS.showProfilePhoto,
        // Absent => false (opt-in default).
        aiProfilingConsent:
          preferences?.aiProfilingConsent ?? UserService.PRIVACY_DEFAULTS.aiProfilingConsent,
        // Opt-out : absent => activé (true).
        analyticsConsent: preferences?.analyticsConsent ?? true,
      };
    },
    enabled: !!user?.id && marketingContext.focused,
    staleTime: 10 * 60 * 1000,
  });

  // showProfilePhoto + aiProfilingConsent : écriture client directe (préférences
  // simples). marketingConsent est traité séparément par le callable serveur
  // (voir saveMarketingConsent) — il NE PASSE PLUS par cette mutation.
  const { mutate: savePreferences, isPending: isSavingPreferences } = useMutation({
    mutationFn: async (updates: Partial<PrivacySettings>) => {
      const operation = marketingContext.capture();
      if (user?.id !== operation.session.uid) throw new Error('La session a changé.');
      const preferenceUpdates: Partial<UserPreferences> = {};
      if (updates.showProfilePhoto !== undefined) {
        preferenceUpdates.privacy = {
          showProfilePhoto: updates.showProfilePhoto,
        };
      }
      if (updates.aiProfilingConsent !== undefined) {
        preferenceUpdates.aiProfilingConsent = updates.aiProfilingConsent;
      }
      if (updates.analyticsConsent !== undefined) {
        preferenceUpdates.analyticsConsent = updates.analyticsConsent;
      }
      marketingContext.assertCurrent(operation);
      await UserService.updateUserPreferences(operation.session.uid, preferenceUpdates);
      marketingContext.assertCurrent(operation);
    },
    onMutate: async (updates: Partial<PrivacySettings>) => {
      const operation = marketingContext.capture();
      await queryClient.cancelQueries({ queryKey: ['userPrivacyPreferences', user?.id, generation] });
      marketingContext.assertCurrent(operation);
      const previousSettings = queryClient.getQueryData<PrivacySettings>(
        ['userPrivacyPreferences', user?.id, generation]
      );
      queryClient.setQueryData(
        ['userPrivacyPreferences', user?.id, generation],
        (old: PrivacySettings | undefined) => ({
          ...(old ?? DEFAULT_PRIVACY),
          ...updates,
        })
      );
      return { previousSettings, operation, privacyKey: ['userPrivacyPreferences', user?.id, generation] };
    },
    onSuccess: (_data, updates, context) => {
      if (!context || !marketingContext.isCurrent(context.operation)) return;
      if (updates.analyticsConsent !== undefined) void setAnalyticsEnabled(updates.analyticsConsent);
      if (updates.showProfilePhoto !== undefined) {
        track('privacy_setting_toggled', { setting_key: 'showProfilePhoto', new_value: updates.showProfilePhoto, success: true });
      }
      if (updates.aiProfilingConsent !== undefined) {
        track('privacy_setting_toggled', { setting_key: 'aiProfilingConsent', new_value: updates.aiProfilingConsent, success: true });
      }
    },
    onError: (_error, updates, context) => {
      if (!context || !marketingContext.isCurrent(context.operation)) return;
      if (context?.previousSettings) {
        queryClient.setQueryData(
          context.privacyKey,
          context.previousSettings
        );
      }
      if (updates.showProfilePhoto !== undefined) {
        track('privacy_setting_toggled', { setting_key: 'showProfilePhoto', new_value: updates.showProfilePhoto, success: false });
      }
      if (updates.aiProfilingConsent !== undefined) {
        track('privacy_setting_toggled', { setting_key: 'aiProfilingConsent', new_value: updates.aiProfilingConsent, success: false });
      }
      Alert.alert('Erreur', 'Impossible d\'enregistrer la modification');
    },
  });

  const { mutate: saveMarketingConsent, isPending: isSavingMarketing } = useMutation({
    retry: false,
    mutationFn: async (input: { uid: string; enabled: boolean; operation: ReturnType<typeof marketingContext.capture>; scope: string }) =>
      MarketingConsentService.decide(input.uid, input.enabled, () => marketingContext.assertCurrent(input.operation)),
    onSuccess: (receipt, input) => {
      if (!marketingContext.isCurrent(input.operation) || receipt.ownerId !== input.uid) return;
      // No optimistic grant: only the exact native decision receipt is adopted.
      queryClient.setQueryData(['marketingConsent', input.uid, input.operation.session.generation, input.operation.focusEpoch], receipt);
      track('marketing_consent_changed', { new_value: input.enabled, success: true });
      setMarketingNotice({ scope: input.scope, text: input.enabled ? 'Votre accord marketing est enregistré.' : 'Votre retrait du consentement marketing est enregistré.' });
    },
    onError: (_error, input) => {
      if (!marketingContext.isCurrent(input.operation)) return;
      setMarketingNotice({ scope: input.scope, text: 'Le résultat doit être relu. Aucun nouvel accord ni retrait n’est confirmé dans cet écran.' });
      track('marketing_consent_changed', { new_value: input.enabled, success: false });
    },
    onSettled: (_receipt, _error, input) => {
      marketingContext.finish(input.operation);
      if (!marketingContext.isCurrent(input.operation)) return;
      void queryClient.invalidateQueries({ queryKey: ['marketingConsent', input.uid] });
      void queryClient.invalidateQueries({ queryKey: ['userPrivacyPreferences', input.uid] });
      void queryClient.invalidateQueries({ queryKey: ['userNotificationPreferences', input.uid] });
    },
  });

  const decideMarketing = (enabled: boolean) => {
    if (!uid || isSavingMarketing) return;
    let operation;
    try { operation = marketingContext.start(); } catch { return; }
    if (!operation) return;
    setMarketingNotice(null);
    saveMarketingConsent({ uid: operation.session.uid, enabled, operation, scope: marketingScope });
  };

  if (isLoading) {
    return (
      <View style={styles.container}>
        <ScreenHeader title="Confidentialité" onBack={() => router.back()} />
        <View style={styles.skeletonContent}>
          <View style={styles.settingsList}>
            {[0, 1, 2].map((i) => (
              <View
                key={i}
                style={[
                  styles.settingItem,
                  i === 2 && styles.settingItemLast,
                ]}
              >
                <View style={styles.settingInfo}>
                  <Skeleton width="55%" height={14} />
                  <Skeleton width="70%" height={12} style={{ marginTop: spacing.xs }} />
                </View>
                <Skeleton width={51} height={31} borderRadius={16} />
              </View>
            ))}
          </View>
        </View>
      </View>
    );
  }

  return (
    <View style={styles.container}>
      <ScreenHeader title="Confidentialité" onBack={() => router.back()} />
      <ScrollView
        style={styles.scrollView}
        contentContainerStyle={styles.content}
        showsVerticalScrollIndicator={false}
      >
        {/* Privacy Settings */}
        <View style={styles.settingsList}>
          <View style={styles.settingItem}>
            <View style={styles.settingInfo}>
              <Text variant="body" style={styles.settingTitle}>Afficher ma photo de profil</Text>
              <Caption>Demander la visibilité de ma photo. Désactiver ce choix demande le retrait public ; la fin du traitement doit être confirmée séparément.</Caption>
            </View>
            <Switch
              value={privacySettings.showProfilePhoto}
              onValueChange={(value) => {
                savePreferences({ showProfilePhoto: value });
              }}
              trackColor={{ false: colors.border, true: colors.primary }}
              thumbColor={colors.white}
              ios_backgroundColor={colors.border}
            />
          </View>

          <View style={styles.settingItem}>
            <View style={styles.settingInfo}>
              <Text variant="body" style={styles.settingTitle}>{COPY_AI.title}</Text>
              <Caption>{COPY_AI.description}</Caption>
            </View>
            <Switch
              value={privacySettings.aiProfilingConsent}
              onValueChange={(value) => {
                savePreferences({ aiProfilingConsent: value });
              }}
              trackColor={{ false: colors.border, true: colors.primary }}
              thumbColor={colors.white}
              ios_backgroundColor={colors.border}
            />
          </View>

          <View style={styles.settingItem}>
            <View style={styles.settingInfo}>
              <Text variant="body" style={styles.settingTitle}>{COPY_ANALYTICS.title}</Text>
              <Caption>{COPY_ANALYTICS.description}</Caption>
            </View>
            <Switch
              value={privacySettings.analyticsConsent}
              disabled={isSavingPreferences}
              onValueChange={(value) => {
                // Persiste la préférence (comme les autres toggles simples) et
                // applique immédiatement l'opt-in/opt-out PostHog.
                savePreferences({ analyticsConsent: value });
                if (!value) void setAnalyticsEnabled(false);
              }}
              trackColor={{ false: colors.border, true: colors.primary }}
              thumbColor={colors.white}
              ios_backgroundColor={colors.border}
            />
          </View>

          <View style={[styles.settingItem, styles.settingItemLast]}>
            <View style={styles.settingInfo}>
              <Text variant="body" style={styles.settingTitle}>{COPY_MARKETING_REVOKE.title}</Text>
              <Caption>{COPY_MARKETING_REVOKE.description}</Caption>
              <Caption>{marketingQuery.isPending || marketingQuery.isFetching ? 'Lecture de votre choix enregistré…' : marketingQuery.isError
                ? 'Votre choix ne peut pas être confirmé pour le moment.' : marketingGranted ? 'Accord marketing enregistré.'
                  : marketingReceipt?.consentState === 'withdrawn' ? 'Consentement marketing retiré.'
                    : marketingReceipt?.consentState === 'unqualified' ? 'Ancien état à vérifier. Aucun accord marketing qualifié.'
                      : 'Aucun accord marketing enregistré.'}</Caption>
              {marketingReceipt?.consentRecorded && marketingReceipt.recordedAt ? <Caption>
                Choix enregistré le {new Date(marketingReceipt.recordedAt).toLocaleString(APP_LOCALE)} · version {marketingReceipt.policyVersion}
              </Caption> : null}
              {marketingNotice?.scope === marketingScope ? <Text variant="bodySmall" accessibilityRole="alert">{marketingNotice.text}</Text> : null}
              {!marketingGranted ? <Button variant="secondary" disabled={!uid || isSavingMarketing || !marketingQuery.isSuccess || marketingQuery.isFetching}
                loading={isSavingMarketing} onPress={() => decideMarketing(true)}>Autoriser les communications marketing</Button> : null}
              <Button variant="secondary" disabled={!uid || isSavingMarketing} loading={isSavingMarketing}
                onPress={() => decideMarketing(false)}>Retirer mon consentement marketing</Button>
              <Button variant="ghost" disabled={!uid || isSavingMarketing} onPress={() => { void marketingQuery.refetch(); }}>Relire mon choix</Button>
            </View>
          </View>
        </View>
        <View style={styles.settingsList}>
          <View style={styles.settingItem}>
            <Avatar source={privateAvatar} name={user?.displayName ?? user?.username ?? ''} />
            <View style={styles.settingInfo}>
              <Text variant="body" style={styles.settingTitle}>État privé de votre photo</Text>
              <Caption>{avatarState.isPending || avatarState.isFetching ? 'Lecture de l’état enregistré…'
                : avatarState.isError ? 'Le retrait de la référence ne peut pas être confirmé actuellement. Aucun ancien lien caché n’est réutilisé.'
                  : avatarState.data.publicWithdrawalComplete ? 'Le retrait public de cette référence de photo est confirmé par le serveur.'
                    : avatarState.data.state === 'pending' || avatarState.data.state === 'copied' ? 'Le retrait de cette référence est en cours ; une copie privée peut être disponible.'
                      : avatarState.data.state === 'needs_review' ? 'Cette référence de photo nécessite un examen. Le retrait complet n’est pas confirmé.'
                        : 'Aucun reçu de retrait public qualifié pour cette référence. Votre préférence de visibilité reste un choix distinct.'}</Caption>
              <Caption>{privateAvatar ? 'La copie affichée ici est privée et consultée avec votre compte.' : 'Aucune copie privée qualifiée n’est actuellement affichée ; vos initiales servent de repère.'} Les copies déjà téléchargées par des tiers ne peuvent pas être rappelées.</Caption>
              <Button variant="ghost" disabled={!uid || isSavingPreferences} onPress={() => { void avatarState.refetch(); }}>Relire l’état privé de la photo</Button>
            </View>
          </View>
        </View>
        <View style={styles.settingsList}>
          <View style={styles.settingItem}>
            <View style={styles.settingInfo}>
              <Text variant="body" style={styles.settingTitle}>Retrait des informations d’une annonce</Text>
              <Caption>Une demande de confidentialité est distincte de la suppression commerciale. Vos commandes et recours conservent leurs preuves privées.</Caption>
              <Input label="Référence de l’annonce" value={articlePrivacyReference} autoCapitalize="none" onChangeText={setArticlePrivacyReference} maxLength={128} />
              <Button variant="secondary" disabled={!uid || !/^[A-Za-z0-9_-]{1,128}$/.test(articlePrivacyReference)}
                onPress={() => router.push(`/article/privacy/${encodeURIComponent(articlePrivacyReference)}` as Href)}>Consulter le retrait de cette annonce</Button>
              {withdrawalJournal.isError ? <Caption>Le journal de retrait n’est pas actuellement lisible. Aucune intention inconnue n’a été effacée.</Caption> : null}
              {withdrawalJournal.isSuccess && !withdrawalJournal.isFetching ? withdrawalJournal.data.map(attempt => <Button key={attempt.articleId} variant="ghost"
                onPress={() => router.push(`/article/privacy/${encodeURIComponent(attempt.articleId)}` as Href)}>Reprendre le retrait conservé : {attempt.articleId}</Button>) : null}
            </View>
          </View>
        </View>

        {/* Privacy Rights Section */}
        <Label style={styles.sectionHeader}>Vos droits</Label>
        <View style={styles.rgpdSection}>
          <RgpdItem
            icon="download-outline"
            iconColor={colors.primary}
            title="Exporter mes données"
            description="Télécharger une copie de vos données personnelles"
            onPress={() => router.push('/settings/export-data')}
          />
          <RgpdItem
            icon="trash-outline"
            iconColor={colors.danger}
            title="Supprimer mon compte"
            description="Droit à l'effacement de vos données personnelles"
            onPress={() => router.push('/settings/delete-account')}
          />
          <RgpdItem
            icon="document-text-outline"
            iconColor={colors.foregroundSecondary}
            title="Politique de confidentialité"
            description="Comment nous utilisons vos données"
            onPress={() => router.push('/settings/privacy-policy')}
          />
          <RgpdItem
            icon="person-remove-outline"
            iconColor={colors.foregroundSecondary}
            title="Utilisateurs bloqués"
            description="Gérer les utilisateurs que vous avez bloqués"
            onPress={() => router.push('/settings/blocked-users')}
            isLast
          />
        </View>

        {/* Info Box */}
        <View style={styles.infoBox}>
          <Ionicons name="shield-checkmark-outline" size={20} color={colors.success} />
          <Text variant="bodySmall" style={styles.infoText}>
            Nous prenons votre vie privée au sérieux. Vos données personnelles ne sont jamais vendues à des tiers.
          </Text>
        </View>
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.background,
  },
  skeletonContent: {
    padding: spacing.md,
  },
  scrollView: {
    flex: 1,
  },
  content: {
    padding: spacing.md,
    paddingBottom: spacing.xl,
  },
  settingsList: {
    backgroundColor: colors.surface,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.borderLight,
    overflow: 'hidden',
    marginBottom: spacing.lg,
  },
  settingItem: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    padding: spacing.md,
    borderBottomWidth: 1,
    borderBottomColor: colors.borderLight,
  },
  settingItemLast: {
    borderBottomWidth: 0,
  },
  settingInfo: {
    flex: 1,
    marginRight: spacing.md,
  },
  settingTitle: {
    fontFamily: fonts.sansMedium,
    marginBottom: 2,
  },
  sectionHeader: {
    color: colors.foregroundSecondary,
    marginBottom: spacing.sm,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },
  rgpdSection: {
    backgroundColor: colors.surface,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.borderLight,
    overflow: 'hidden',
    marginBottom: spacing.lg,
  },
  rgpdItem: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    padding: spacing.md,
    borderBottomWidth: 1,
    borderBottomColor: colors.borderLight,
  },
  rgpdItemLast: {
    borderBottomWidth: 0,
  },
  rgpdItemLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    flex: 1,
  },
  rgpdIcon: {
    width: 36,
    height: 36,
    borderRadius: radius.sm,
    justifyContent: 'center',
    alignItems: 'center',
    marginRight: spacing.md,
  },
  rgpdItemText: {
    flex: 1,
  },
  rgpdItemTitle: {
    fontFamily: fonts.sansMedium,
    marginBottom: 2,
  },
  infoBox: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: spacing.sm,
    backgroundColor: colors.successLight,
    padding: spacing.md,
    borderRadius: radius.sm,
  },
  infoText: {
    flex: 1,
    color: colors.foreground,
  },
});
