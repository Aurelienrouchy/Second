import React from 'react';
import { View, Text, Pressable, StyleSheet, Linking } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { colors, fonts, spacing, radius } from '@/constants/theme';

interface PermissionDeniedProps {
  onGalleryPress: () => void;
}

export const PermissionDenied = React.memo(function PermissionDenied({
  onGalleryPress,
}: PermissionDeniedProps) {
  return (
    <View style={styles.permissionDenied}>
      <View style={styles.permissionIconCircle}>
        <Ionicons name="camera-outline" size={32} color={colors.muted} />
      </View>
      <Text style={styles.permissionTitle}>Accès caméra requis</Text>
      <Text style={styles.permissionText}>
        Pour prendre des photos de vos articles, autorisez l'accès à la caméra
        dans les réglages.
      </Text>

      <Pressable
        style={styles.settingsButton}
        onPress={() => Linking.openSettings()}
      >
        <Ionicons name="settings-outline" size={18} color={colors.cream} />
        <Text style={styles.settingsButtonText}>OUVRIR LES RÉGLAGES</Text>
      </Pressable>

      <Text style={styles.orText}>ou</Text>

      <Pressable style={styles.galleryFallbackButton} onPress={onGalleryPress}>
        <Ionicons name="images-outline" size={20} color={colors.rust} />
        <Text style={styles.galleryFallbackText}>
          Sélectionner depuis la galerie
        </Text>
      </Pressable>
    </View>
  );
});

const styles = StyleSheet.create({
  permissionDenied: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    padding: 32,
    backgroundColor: colors.surfaceWarm,
  },
  permissionIconCircle: {
    width: 72,
    height: 72,
    borderRadius: 36,
    backgroundColor: 'rgba(26, 24, 20, 0.04)',
    justifyContent: 'center',
    alignItems: 'center',
    marginBottom: spacing.md,
  },
  permissionTitle: {
    fontFamily: fonts.displaySemiBold,
    fontSize: 22,
    lineHeight: 28,
    color: colors.charcoal,
    marginBottom: spacing.sm,
  },
  permissionText: {
    fontFamily: fonts.sans,
    fontSize: 14,
    lineHeight: 22,
    color: colors.muted,
    textAlign: 'center',
    marginBottom: spacing.lg,
  },
  settingsButton: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    backgroundColor: colors.charcoal,
    paddingHorizontal: 24,
    paddingVertical: 14,
    borderRadius: radius.sm,
  },
  settingsButtonText: {
    fontFamily: fonts.sansMedium,
    color: colors.cream,
    fontSize: 11,
    letterSpacing: 2.16,
  },
  orText: {
    fontFamily: fonts.sans,
    fontSize: 13,
    color: colors.muted,
    marginVertical: 16,
  },
  galleryFallbackButton: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingVertical: 12,
  },
  galleryFallbackText: {
    fontFamily: fonts.sansMedium,
    fontSize: 14,
    color: colors.rust,
  },
});
