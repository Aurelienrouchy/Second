/**
 * Settings Main Page
 */

import Constants from 'expo-constants';
import { AuthService } from '@/services/authService';
import { UserService } from '@/services/userService';
import { useUser } from '@/contexts/AuthContext';
import { colors, fonts, spacing, radius } from '@/constants/theme';
import { Text, Label, Caption } from '@/components/ui';
import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import React, { useEffect, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, View } from 'react-native';
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
    <Pressable style={({ pressed }) => [styles.settingItem, pressed && { opacity: 0.7 }]} onPress={onPress}>
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
    </Pressable>
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
  const user = useUser();
  const authProvider = AuthService.getAuthProvider();
  const hasPassword = AuthService.hasPasswordProvider();
  const isEmailVerified = AuthService.isEmailVerified();
  const [isAdmin, setIsAdmin] = useState(false);

  useEffect(() => {
    if (!user?.id) return;
    let cancelled = false;
    UserService.isUserAdmin(user.id).then((result) => {
      if (!cancelled) setIsAdmin(result);
    });
    return () => { cancelled = true; };
  }, [user?.id]);

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
            subtitle="Modifier votre adresse email"
            onPress={() => router.push('/settings/email')}
          />
          {hasPassword && !isEmailVerified && (
            <SettingItem
              icon="shield-checkmark-outline"
              title="Vérifier mon email"
              subtitle="Votre email n'est pas encore vérifié"
              onPress={() => router.push('/settings/verify-email')}
            />
          )}
          <SettingItem
            icon="call-outline"
            title="Numéro de téléphone"
            onPress={() => router.push('/settings/phone')}
          />
          {hasPassword && (
            <SettingItem
              icon="lock-closed-outline"
              title="Mot de passe"
              onPress={() => router.push('/settings/password')}
            />
          )}
          {!hasPassword && (
            <SettingItem
              icon="key-outline"
              title="Ajouter un mot de passe"
              subtitle="Associer un email et mot de passe"
              onPress={() => router.push('/settings/add-password')}
            />
          )}
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

        {/* Administration (admin only) */}
        {isAdmin && (
          <SettingSection title="Administration">
            <SettingItem
              icon="shield-checkmark-outline"
              title="Administration"
              subtitle="Gestion des boutiques et utilisateurs"
              onPress={() => router.push('/admin/shops')}
            />
          </SettingSection>
        )}

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

        {/* Version */}
        <View style={styles.versionContainer}>
          <Caption>Version {Constants.expoConfig?.version ?? '1.0.0'}</Caption>
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
  versionContainer: {
    alignItems: 'center',
    marginTop: spacing.lg,
    paddingBottom: spacing.lg,
  },
});
