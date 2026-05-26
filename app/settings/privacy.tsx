/**
 * Privacy Settings
 */

import { useUser } from '@/contexts/AuthContext';
import { UserService } from '@/services/userService';
import { colors, fonts, spacing, radius } from '@/constants/theme';
import { Text, Caption, Label } from '@/components/ui';
import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import React from 'react';
import {
  Alert,
  Pressable,
  ScrollView,
  StyleSheet,
  Switch,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Skeleton } from '@/components/ui/Skeleton';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';

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
}

const DEFAULT_PRIVACY: PrivacySettings = {
  showProfilePhoto: true,
};

export default function PrivacySettingsScreen() {
  const router = useRouter();
  const user = useUser();
  const queryClient = useQueryClient();

  const { data: privacySettings = DEFAULT_PRIVACY, isLoading } = useQuery({
    queryKey: ['userPrivacyPreferences', user?.id],
    queryFn: async () => {
      const preferences = await UserService.getUserPreferences(user!.id);
      return {
        showProfilePhoto: preferences?.privacy?.showProfilePhoto ?? true,
      };
    },
    enabled: !!user?.id,
    staleTime: 10 * 60 * 1000,
  });

  const { mutate: savePreferences } = useMutation({
    mutationFn: (updates: Partial<PrivacySettings>) => {
      const newPrivacy = {
        showProfilePhoto: updates.showProfilePhoto ?? privacySettings.showProfilePhoto,
      };
      return UserService.updateUserPreferences(user!.id, { privacy: newPrivacy });
    },
    onMutate: async (updates: Partial<PrivacySettings>) => {
      await queryClient.cancelQueries({ queryKey: ['userPrivacyPreferences', user?.id] });
      const previousSettings = queryClient.getQueryData<PrivacySettings>(
        ['userPrivacyPreferences', user?.id]
      );
      queryClient.setQueryData(
        ['userPrivacyPreferences', user?.id],
        (old: PrivacySettings | undefined) => ({
          ...(old ?? DEFAULT_PRIVACY),
          ...updates,
        })
      );
      return { previousSettings };
    },
    onError: (_error, _updates, context) => {
      if (context?.previousSettings) {
        queryClient.setQueryData(
          ['userPrivacyPreferences', user?.id],
          context.previousSettings
        );
      }
      Alert.alert('Erreur', 'Impossible d\'enregistrer la modification');
    },
  });

  if (isLoading) {
    return (
      <SafeAreaView style={styles.container} edges={['bottom']}>
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
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.container} edges={['bottom']}>
      <ScrollView
        style={styles.scrollView}
        contentContainerStyle={styles.content}
        showsVerticalScrollIndicator={false}
      >
        {/* Privacy Settings */}
        <View style={styles.settingsList}>
          <View style={[styles.settingItem, styles.settingItemLast]}>
            <View style={styles.settingInfo}>
              <Text variant="body" style={styles.settingTitle}>Afficher ma photo de profil</Text>
              <Caption>Rendre ma photo visible aux autres utilisateurs</Caption>
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
    </SafeAreaView>
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
