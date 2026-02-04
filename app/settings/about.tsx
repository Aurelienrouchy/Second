/**
 * About Settings
 * Design System: Luxe Français + Street Energy
 */

import { Ionicons } from '@expo/vector-icons';
import { Stack, useRouter } from 'expo-router';
import React from 'react';
import {
  ScrollView,
  StyleSheet,
  TouchableOpacity,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { colors, fonts, spacing, radius, typography } from '@/constants/theme';
import { Text, Caption } from '@/components/ui';

interface LinkItemProps {
  icon: keyof typeof Ionicons.glyphMap;
  title: string;
  onPress: () => void;
  isLast?: boolean;
}

const LinkItem = ({ icon, title, onPress, isLast }: LinkItemProps) => (
  <TouchableOpacity
    style={[styles.linkItem, isLast && styles.linkItemLast]}
    onPress={onPress}
    activeOpacity={0.7}
  >
    <View style={styles.linkLeft}>
      <View style={styles.linkIconContainer}>
        <Ionicons name={icon} size={20} color={colors.foregroundSecondary} />
      </View>
      <Text variant="body">{title}</Text>
    </View>
    <Ionicons name="chevron-forward" size={20} color={colors.muted} />
  </TouchableOpacity>
);

export default function AboutSettingsScreen() {
  const router = useRouter();

  return (
    <SafeAreaView style={styles.container} edges={['bottom']}>
      <Stack.Screen options={{ title: 'À propos' }} />

      <ScrollView
        style={styles.scrollView}
        contentContainerStyle={styles.content}
        showsVerticalScrollIndicator={false}
      >
        {/* Logo Section */}
        <View style={styles.logoSection}>
          <View style={styles.logoContainer}>
            <Text style={styles.logoText}>S</Text>
          </View>
          <Text style={styles.appName}>Seconde</Text>
          <Caption style={styles.tagline}>La mode responsable, en toute simplicité</Caption>
          <View style={styles.versionBadge}>
            <Text variant="bodySmall" style={styles.versionText}>Version 1.0.0 (Build 1)</Text>
          </View>
        </View>

        {/* Links Section */}
        <View style={styles.linksContainer}>
          <LinkItem
            icon="document-text-outline"
            title="Conditions Générales d'Utilisation"
            onPress={() => router.push('/settings/terms')}
          />
          <LinkItem
            icon="shield-checkmark-outline"
            title="Politique de Confidentialité"
            onPress={() => router.push('/settings/privacy-policy')}
          />
          <LinkItem
            icon="information-circle-outline"
            title="Mentions Légales"
            onPress={() => router.push('/settings/legal-notice')}
            isLast
          />
        </View>

        {/* Made With Love */}
        <View style={styles.madeWithLove}>
          <Ionicons name="heart" size={16} color={colors.danger} />
          <Caption style={styles.madeWithLoveText}>Fait avec amour à Paris</Caption>
        </View>

        {/* Copyright */}
        <Caption style={styles.copyright}>
          © 2025 Seconde. Tous droits réservés.
        </Caption>
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
  content: {
    padding: spacing.md,
    paddingBottom: spacing.xl,
    alignItems: 'center',
  },
  logoSection: {
    alignItems: 'center',
    marginVertical: spacing['2xl'],
  },
  logoContainer: {
    width: 80,
    height: 80,
    borderRadius: radius.md,
    backgroundColor: colors.primary,
    justifyContent: 'center',
    alignItems: 'center',
    marginBottom: spacing.md,
  },
  logoText: {
    ...typography.h1,
    fontFamily: fonts.serifBold,
    fontSize: 48,
    color: colors.white,
  },
  appName: {
    ...typography.h1,
    fontFamily: fonts.serifSemiBold,
    color: colors.foreground,
    marginBottom: spacing.xs,
  },
  tagline: {
    color: colors.foregroundSecondary,
    marginBottom: spacing.md,
  },
  versionBadge: {
    backgroundColor: colors.borderLight,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    borderRadius: radius.full,
  },
  versionText: {
    color: colors.foregroundSecondary,
  },
  linksContainer: {
    width: '100%',
    backgroundColor: colors.surface,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.borderLight,
    overflow: 'hidden',
    marginBottom: spacing.xl,
  },
  linkItem: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    padding: spacing.md,
    borderBottomWidth: 1,
    borderBottomColor: colors.borderLight,
  },
  linkItemLast: {
    borderBottomWidth: 0,
  },
  linkLeft: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  linkIconContainer: {
    width: 36,
    height: 36,
    borderRadius: radius.sm,
    backgroundColor: colors.borderLight,
    justifyContent: 'center',
    alignItems: 'center',
    marginRight: spacing.md,
  },
  madeWithLove: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    marginBottom: spacing.md,
  },
  madeWithLoveText: {
    color: colors.foregroundSecondary,
  },
  copyright: {
    color: colors.muted,
  },
});
