/**
 * Privacy Settings
 * Design System: Luxe Français + Street Energy
 */

import { useAuth } from '@/contexts/AuthContext';
import { UserService } from '@/services/userService';
import { colors, fonts, spacing, radius } from '@/constants/theme';
import { Text, Caption, Label } from '@/components/ui';
import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import React, { useEffect, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  ScrollView,
  StyleSheet,
  Switch,
  TouchableOpacity,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

interface RgpdItemProps {
  icon: keyof typeof Ionicons.glyphMap;
  iconColor: string;
  title: string;
  description: string;
  onPress: () => void;
  isLast?: boolean;
}

const RgpdItem = ({ icon, iconColor, title, description, onPress, isLast }: RgpdItemProps) => (
  <TouchableOpacity
    style={[styles.rgpdItem, isLast && styles.rgpdItemLast]}
    onPress={onPress}
    activeOpacity={0.7}
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
  </TouchableOpacity>
);

export default function PrivacySettingsScreen() {
  const router = useRouter();
  const { user } = useAuth();

  const [showProfilePhoto, setShowProfilePhoto] = useState(true);
  const [allowSearchEngines, setAllowSearchEngines] = useState(false);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    if (user) {
      loadPreferences();
    }
  }, [user]);

  const loadPreferences = async () => {
    try {
      setIsLoading(true);
      if (!user) return;

      const preferences = await UserService.getUserPreferences(user.id);
      if (preferences?.privacy) {
        setShowProfilePhoto(preferences.privacy.showProfilePhoto ?? true);
        setAllowSearchEngines(preferences.privacy.allowSearchEngines ?? false);
      }
    } catch (error) {
      console.error('Error loading privacy preferences:', error);
    } finally {
      setIsLoading(false);
    }
  };

  const savePreferences = async (updates: { showProfilePhoto?: boolean; allowSearchEngines?: boolean }) => {
    if (!user) return;

    const newPrivacy = {
      showProfilePhoto: updates.showProfilePhoto ?? showProfilePhoto,
      allowSearchEngines: updates.allowSearchEngines ?? allowSearchEngines,
    };

    try {
      await UserService.updateUserPreferences(user.id, { privacy: newPrivacy });
    } catch (error) {
      console.error('Error saving privacy preferences:', error);
      Alert.alert('Erreur', 'Impossible d\'enregistrer la modification');
    }
  };

  if (isLoading) {
    return (
      <SafeAreaView style={styles.container} edges={['bottom']}>
        <View style={styles.loadingContainer}>
          <ActivityIndicator size="large" color={colors.primary} />
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
          <View style={styles.settingItem}>
            <View style={styles.settingInfo}>
              <Text variant="body" style={styles.settingTitle}>Afficher ma photo de profil</Text>
              <Caption>Rendre ma photo visible aux autres utilisateurs</Caption>
            </View>
            <Switch
              value={showProfilePhoto}
              onValueChange={(value) => {
                setShowProfilePhoto(value);
                savePreferences({ showProfilePhoto: value });
              }}
              trackColor={{ false: colors.border, true: colors.primary }}
              thumbColor={colors.white}
              ios_backgroundColor={colors.border}
            />
          </View>

          <View style={[styles.settingItem, styles.settingItemLast]}>
            <View style={styles.settingInfo}>
              <Text variant="body" style={styles.settingTitle}>Référencement</Text>
              <Caption>Permettre aux moteurs de recherche de trouver mon profil</Caption>
            </View>
            <Switch
              value={allowSearchEngines}
              onValueChange={(value) => {
                setAllowSearchEngines(value);
                savePreferences({ allowSearchEngines: value });
              }}
              trackColor={{ false: colors.border, true: colors.primary }}
              thumbColor={colors.white}
              ios_backgroundColor={colors.border}
            />
          </View>
        </View>

        {/* RGPD Section */}
        <Label style={styles.sectionHeader}>Vos droits RGPD</Label>
        <View style={styles.rgpdSection}>
          <RgpdItem
            icon="download-outline"
            iconColor={colors.primary}
            title="Exporter mes données"
            description="Télécharger une copie de vos données (Art. 20)"
            onPress={() => router.push('/settings/export-data')}
          />
          <RgpdItem
            icon="trash-outline"
            iconColor={colors.danger}
            title="Supprimer mon compte"
            description="Droit à l'effacement de vos données (Art. 17)"
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
  loadingContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
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
