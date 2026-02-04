/**
 * Settings Main Page
 * Design System: Luxe Français + Street Energy
 */

import { useAuth } from '@/contexts/AuthContext';
import { colors, fonts, spacing, radius, typography } from '@/constants/theme';
import { Text, Label, Caption } from '@/components/ui';
import { Button } from '@/components/ui';
import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import React from 'react';
import { Alert, ScrollView, StyleSheet, TouchableOpacity, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

type SettingItemProps = {
  icon: keyof typeof Ionicons.glyphMap;
  title: string;
  subtitle?: string;
  onPress: () => void;
  variant?: 'default' | 'danger';
};

const SettingItem = ({ icon, title, subtitle, onPress, variant = 'default' }: SettingItemProps) => {
  const isDanger = variant === 'danger';

  return (
    <TouchableOpacity style={styles.settingItem} onPress={onPress} activeOpacity={0.7}>
      <View style={styles.settingLeft}>
        <View style={[
          styles.iconContainer,
          isDanger && styles.iconContainerDanger
        ]}>
          <Ionicons
            name={icon}
            size={20}
            color={isDanger ? colors.danger : colors.primary}
          />
        </View>
        <View style={styles.settingTextContainer}>
          <Text
            variant="body"
            style={[styles.settingTitle, isDanger && styles.settingTitleDanger]}
          >
            {title}
          </Text>
          {subtitle && (
            <Caption style={styles.settingSubtitle}>{subtitle}</Caption>
          )}
        </View>
      </View>
      <Ionicons name="chevron-forward" size={20} color={colors.muted} />
    </TouchableOpacity>
  );
};

const SettingSection = ({ title, children }: { title: string; children: React.ReactNode }) => (
  <View style={styles.section}>
    <Label style={styles.sectionHeader}>{title}</Label>
    <View style={styles.sectionContent}>
      {children}
    </View>
  </View>
);

export default function SettingsScreen() {
  const router = useRouter();
  const { signOut } = useAuth();

  const handleSignOut = async () => {
    Alert.alert(
      "Déconnexion",
      "Êtes-vous sûr de vouloir vous déconnecter ?",
      [
        { text: "Annuler", style: "cancel" },
        {
          text: "Déconnexion",
          style: "destructive",
          onPress: async () => {
            try {
              await signOut();
              router.replace('/(tabs)/profile');
            } catch (error) {
              console.error('Error signing out:', error);
            }
          }
        }
      ]
    );
  };

  return (
    <SafeAreaView style={styles.container} edges={['bottom']}>
      <ScrollView
        style={styles.scrollView}
        showsVerticalScrollIndicator={false}
        contentContainerStyle={styles.scrollContent}
      >
        {/* Compte */}
        <SettingSection title="Compte">
          <SettingItem
            icon="person-outline"
            title="Détails du profil"
            subtitle="Photo, nom, bio"
            onPress={() => router.push('/settings/profile-details')}
          />
          <SettingItem
            icon="mail-outline"
            title="Email"
            onPress={() => router.push('/settings/email')}
          />
          <SettingItem
            icon="shield-checkmark-outline"
            title="Vérifier l'email"
            subtitle="Sécurisez votre compte"
            onPress={() => router.push('/settings/verify-email')}
          />
          <SettingItem
            icon="call-outline"
            title="Numéro de téléphone"
            onPress={() => router.push('/settings/phone')}
          />
          <SettingItem
            icon="lock-closed-outline"
            title="Mot de passe"
            onPress={() => router.push('/settings/password')}
          />
        </SettingSection>

        {/* Envoi & Livraison */}
        <SettingSection title="Envoi & Livraison">
          <SettingItem
            icon="location-outline"
            title="Mon adresse"
            subtitle="Gérer l'adresse de livraison"
            onPress={() => router.push('/settings/address')}
          />
          <SettingItem
            icon="cube-outline"
            title="Options de livraison"
            onPress={() => router.push('/settings/shipping-options')}
          />
        </SettingSection>

        {/* Personnalisation */}
        <SettingSection title="Personnalisation">
          <SettingItem
            icon="options-outline"
            title="Mes préférences"
            subtitle="Tailles, marques, localisation"
            onPress={() => router.push('/settings/preferences')}
          />
        </SettingSection>

        {/* Paiements */}
        <SettingSection title="Paiements">
          <SettingItem
            icon="card-outline"
            title="Moyens de paiement"
            onPress={() => router.push('/settings/payments')}
          />
          <SettingItem
            icon="wallet-outline"
            title="Mon porte-monnaie"
            onPress={() => router.push('/seller-balance')}
          />
        </SettingSection>

        {/* Notifications & Confidentialité */}
        <SettingSection title="Notifications & Confidentialité">
          <SettingItem
            icon="notifications-outline"
            title="Notifications"
            onPress={() => router.push('/settings/notifications')}
          />
          <SettingItem
            icon="shield-outline"
            title="Confidentialité"
            onPress={() => router.push('/settings/privacy')}
          />
        </SettingSection>

        {/* Assistance */}
        <SettingSection title="Assistance">
          <SettingItem
            icon="help-circle-outline"
            title="Centre d'aide"
            onPress={() => router.push('/settings/help')}
          />
          <SettingItem
            icon="information-circle-outline"
            title="À propos"
            onPress={() => router.push('/settings/about')}
          />
        </SettingSection>

        {/* Zone de danger */}
        <SettingSection title="Zone de danger">
          <SettingItem
            icon="trash-outline"
            title="Supprimer mon compte"
            subtitle="Supprimer définitivement toutes vos données"
            onPress={() => router.push('/settings/delete-account')}
            variant="danger"
          />
        </SettingSection>

        {/* Logout Button */}
        <View style={styles.logoutSection}>
          <Button
            variant="danger"
            fullWidth
            onPress={handleSignOut}
          >
            Se déconnecter
          </Button>
        </View>

        {/* Version */}
        <View style={styles.versionContainer}>
          <Caption>Version 1.0.0</Caption>
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
  scrollView: {
    flex: 1,
  },
  scrollContent: {
    paddingBottom: spacing.xl,
  },
  section: {
    marginTop: spacing.lg,
  },
  sectionHeader: {
    color: colors.foregroundSecondary,
    marginBottom: spacing.sm,
    paddingHorizontal: spacing.md,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },
  sectionContent: {
    backgroundColor: colors.surface,
    borderTopWidth: 1,
    borderBottomWidth: 1,
    borderColor: colors.borderLight,
  },
  settingItem: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: spacing.md,
    paddingHorizontal: spacing.md,
    backgroundColor: colors.surface,
    borderBottomWidth: 1,
    borderBottomColor: colors.borderLight,
  },
  settingLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    flex: 1,
  },
  iconContainer: {
    width: 36,
    height: 36,
    borderRadius: radius.sm,
    backgroundColor: colors.primaryLight,
    justifyContent: 'center',
    alignItems: 'center',
    marginRight: spacing.md,
  },
  iconContainerDanger: {
    backgroundColor: colors.dangerLight,
  },
  settingTextContainer: {
    flex: 1,
  },
  settingTitle: {
    fontFamily: fonts.sansMedium,
  },
  settingTitleDanger: {
    color: colors.danger,
  },
  settingSubtitle: {
    marginTop: 2,
  },
  logoutSection: {
    marginTop: spacing.xl,
    paddingHorizontal: spacing.md,
  },
  versionContainer: {
    alignItems: 'center',
    marginTop: spacing.lg,
    paddingBottom: spacing.lg,
  },
});
