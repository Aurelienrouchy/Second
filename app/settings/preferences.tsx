/**
 * User Preferences Settings Page
 */

import BrandSelectionSheet, {
  BrandSelectionSheetRef,
} from '@/components/search/BrandSelectionSheet';
import { useUser } from '@/contexts/AuthContext';
import { UserService } from '@/services/userService';
import { colors, fonts, spacing, radius } from '@/constants/theme';
import { Text, Label, Caption, ScreenHeader } from '@/components/ui';
import { Button } from '@/components/ui';
import { Skeleton } from '@/components/ui/Skeleton';
import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  Alert,
  Pressable,
  ScrollView,
  StyleSheet,
  View,
} from 'react-native';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { useQuery, useMutation } from '@tanstack/react-query';

// Tailles vêtements (lettres)
const CLOTHING_SIZES = ['XS', 'S', 'M', 'L', 'XL', 'XXL'];
// Tailles chaussures (numériques)
const SHOE_SIZES = ['35', '36', '37', '38', '39', '40', '41', '42', '43', '44', '45', '46'];

export default function PreferencesScreen() {
  const router = useRouter();
  const user = useUser();
  const brandSelectionRef = useRef<BrandSelectionSheetRef>(null);
  const [selectedSizes, setSelectedSizes] = useState<string[]>([]);
  const [selectedShoeSizes, setSelectedShoeSizes] = useState<string[]>([]);
  const [selectedBrands, setSelectedBrands] = useState<string[]>([]);
  const [isFormInitialized, setIsFormInitialized] = useState(false);

  const { data: preferences, isLoading } = useQuery({
    queryKey: ['userPreferences', user?.id],
    queryFn: () => UserService.getUserPreferences(user!.id),
    enabled: !!user?.id,
    staleTime: 10 * 60 * 1000,
  });

  // Sync fetched preferences into local form state. Clothing sizes live in
  // preferences.sizes; shoe sizes are persisted separately in
  // preferences.shoesSizes (written by the onboarding callable) and were
  // previously never read back here.
  useEffect(() => {
    if (preferences && !isFormInitialized) {
      setSelectedSizes(preferences.sizes || []);
      setSelectedShoeSizes(preferences.shoesSizes || []);
      setSelectedBrands(preferences.favoriteBrands || []);
      setIsFormInitialized(true);
    }
  }, [preferences, isFormInitialized]);

  const { mutate: handleSave, isPending: isSaving } = useMutation({
    mutationFn: () =>
      UserService.updateUserPreferences(user!.id, {
        sizes: selectedSizes,
        // shoesSizes is persisted alongside sizes (same shape as the onboarding
        // callable), now typed on UserPreferences.
        shoesSizes: selectedShoeSizes,
        favoriteBrands: selectedBrands,
      }),
    onSuccess: () => {
      Alert.alert('Succès', 'Vos préférences ont été enregistrées', [
        { text: 'OK', onPress: () => router.back() },
      ]);
    },
    onError: () => {
      Alert.alert('Erreur', "Une erreur est survenue lors de l'enregistrement");
    },
  });

  const toggleSize = useCallback((size: string) => {
    setSelectedSizes((prev) =>
      prev.includes(size) ? prev.filter((s) => s !== size) : [...prev, size]
    );
  }, []);

  const toggleShoeSize = useCallback((size: string) => {
    setSelectedShoeSizes((prev) =>
      prev.includes(size) ? prev.filter((s) => s !== size) : [...prev, size]
    );
  }, []);

  const handleBrandConfirm = useCallback((brands: string[]) => {
    setSelectedBrands(brands);
  }, []);

  if (isLoading) {
    return (
      <View style={styles.container}>
        <ScreenHeader title="Préférences" onBack={() => router.back()} />
        <View style={styles.skeletonContent}>
          <View style={styles.section}>
            <Skeleton width="50%" height={14} />
            <Skeleton width="70%" height={12} style={{ marginTop: spacing.xs }} />
            <View style={styles.skeletonChips}>
              {[0, 1, 2, 3, 4, 5].map((i) => (
                <Skeleton key={i} width={56} height={40} borderRadius={radius.full} />
              ))}
            </View>
          </View>
          <View style={styles.section}>
            <Skeleton width="50%" height={14} />
            <Skeleton width="70%" height={12} style={{ marginTop: spacing.xs }} />
            <View style={styles.skeletonChips}>
              {[0, 1, 2, 3, 4, 5].map((i) => (
                <Skeleton key={i} width={48} height={40} borderRadius={radius.full} />
              ))}
            </View>
          </View>
          <View style={styles.section}>
            <Skeleton width="55%" height={14} />
            <Skeleton width="80%" height={12} style={{ marginTop: spacing.xs }} />
            <Skeleton width="100%" height={48} borderRadius={radius.sm} style={{ marginTop: spacing.md }} />
          </View>
        </View>
      </View>
    );
  }

  return (
    <GestureHandlerRootView style={styles.flex}>
      <View style={styles.container}>
        <ScreenHeader title="Préférences" onBack={() => router.back()} />

        {/* Content */}
        <ScrollView
          style={styles.scrollView}
          contentContainerStyle={styles.content}
          showsVerticalScrollIndicator={false}
        >
          {/* Clothing Sizes Section */}
          <View style={styles.section}>
            <Label style={styles.sectionHeader}>Mes tailles — Vêtements</Label>
            <Caption style={styles.sectionSubtitle}>
              Sélectionnez vos tailles de vêtements
            </Caption>
            <View style={styles.chipsContainer}>
              {CLOTHING_SIZES.map((size) => {
                const isSelected = selectedSizes.includes(size);
                return (
                  <Pressable
                    key={size}
                    style={[styles.chip, isSelected && styles.chipSelected]}
                    onPress={() => toggleSize(size)}
                  >
                    <Text variant="body" style={[styles.chipText, isSelected && styles.chipTextSelected]}>
                      {size}
                    </Text>
                  </Pressable>
                );
              })}
            </View>
          </View>

          {/* Shoe Sizes Section */}
          <View style={styles.section}>
            <Label style={styles.sectionHeader}>Mes tailles — Chaussures</Label>
            <Caption style={styles.sectionSubtitle}>
              Sélectionnez vos pointures
            </Caption>
            <View style={styles.chipsContainer}>
              {SHOE_SIZES.map((size) => {
                const isSelected = selectedShoeSizes.includes(size);
                return (
                  <Pressable
                    key={`shoe_${size}`}
                    style={[styles.chip, isSelected && styles.chipSelected]}
                    onPress={() => toggleShoeSize(size)}
                  >
                    <Text variant="body" style={[styles.chipText, isSelected && styles.chipTextSelected]}>
                      {size}
                    </Text>
                  </Pressable>
                );
              })}
            </View>
          </View>

          {/* Brands Section */}
          <View style={styles.section}>
            <Label style={styles.sectionHeader}>Mes marques préférées</Label>
            <Caption style={styles.sectionSubtitle}>
              Choisissez vos marques favorites pour des recommandations personnalisées
            </Caption>
            <Pressable style={styles.selectorButton} onPress={() => brandSelectionRef.current?.show()}>
              <Ionicons name="pricetag-outline" size={20} color={colors.muted} />
              <Text variant="body" style={styles.selectorButtonText}>
                {selectedBrands.length > 0
                  ? `${selectedBrands.length} marque${selectedBrands.length > 1 ? 's' : ''} sélectionnée${selectedBrands.length > 1 ? 's' : ''}`
                  : 'Sélectionner des marques'}
              </Text>
              <Ionicons name="chevron-forward" size={20} color={colors.muted} />
            </Pressable>
            {selectedBrands.length > 0 && (
              <View style={styles.selectedBrandsContainer}>
                {selectedBrands.slice(0, 5).map((brand) => (
                  <View key={brand} style={styles.brandTag}>
                    <Text variant="bodySmall" style={styles.brandTagText}>{brand}</Text>
                  </View>
                ))}
                {selectedBrands.length > 5 && (
                  <View style={styles.brandTag}>
                    <Text variant="bodySmall" style={styles.brandTagText}>+{selectedBrands.length - 5}</Text>
                  </View>
                )}
              </View>
            )}
          </View>

          {/* Notifications Section */}
          <View style={styles.section}>
            <Label style={styles.sectionHeader}>Notifications</Label>
            <Pressable
              style={({ pressed }) => [styles.notificationLink, pressed && { opacity: 0.7 }]}
              onPress={() => router.push('/settings/notifications')}
            >
              <View style={styles.notificationLinkLeft}>
                <View style={[styles.notificationIcon, { backgroundColor: colors.primaryLight }]}>
                  <Ionicons name="notifications-outline" size={20} color={colors.primary} />
                </View>
                <View>
                  <Text variant="body" style={styles.notificationTitle}>Gérer les notifications</Text>
                  <Caption>Personnalisez vos alertes et rappels</Caption>
                </View>
              </View>
              <Ionicons name="chevron-forward" size={20} color={colors.muted} />
            </Pressable>
          </View>

          {/* Info box */}
          <View style={styles.infoBox}>
            <Ionicons name="information-circle-outline" size={20} color={colors.primary} />
            <Text variant="bodySmall" style={styles.infoText}>
              Vos préférences nous aident à vous proposer des articles qui correspondent à vos goûts.
            </Text>
          </View>
        </ScrollView>

        {/* Footer */}
        <View style={styles.footer}>
          <Button
            variant="primary"
            fullWidth
            loading={isSaving}
            onPress={() => handleSave()}
          >
            Enregistrer
          </Button>
        </View>

        {/* Brand Selection Sheet */}
        <BrandSelectionSheet
          ref={brandSelectionRef}
          selectedBrands={selectedBrands}
          onConfirm={handleBrandConfirm}
        />
      </View>
    </GestureHandlerRootView>
  );
}

const styles = StyleSheet.create({
  flex: {
    flex: 1,
  },
  container: {
    flex: 1,
    backgroundColor: colors.background,
  },
  skeletonContent: {
    padding: spacing.md,
  },
  skeletonChips: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.sm,
    marginTop: spacing.md,
  },
  scrollView: {
    flex: 1,
  },
  content: {
    padding: spacing.md,
    paddingBottom: spacing.xl,
  },
  section: {
    marginBottom: spacing.xl,
  },
  sectionHeader: {
    color: colors.foregroundSecondary,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
    marginBottom: spacing.xs,
  },
  sectionSubtitle: {
    color: colors.foregroundSecondary,
    marginBottom: spacing.md,
  },
  chipsContainer: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.sm,
  },
  chip: {
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.md,
    borderRadius: radius.full,
    backgroundColor: colors.borderLight,
    borderWidth: 1.5,
    borderColor: colors.transparent,
  },
  chipSelected: {
    backgroundColor: colors.primaryLight,
    borderColor: colors.primary,
  },
  chipText: {
    fontFamily: fonts.sansMedium,
    color: colors.foreground,
  },
  chipTextSelected: {
    color: colors.primary,
  },
  selectorButton: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: spacing.md,
    backgroundColor: colors.surface,
    borderRadius: radius.sm,
    borderWidth: 1,
    borderColor: colors.borderLight,
    gap: spacing.md,
  },
  selectorButtonText: {
    flex: 1,
    color: colors.foreground,
  },
  selectedBrandsContainer: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.sm,
    marginTop: spacing.md,
  },
  brandTag: {
    backgroundColor: colors.primaryLight,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    borderRadius: radius.full,
  },
  brandTagText: {
    fontFamily: fonts.sansMedium,
    color: colors.primary,
  },
  notificationLink: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    backgroundColor: colors.surface,
    borderRadius: radius.md,
    padding: spacing.md,
    borderWidth: 1,
    borderColor: colors.borderLight,
  },
  notificationLinkLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    flex: 1,
  },
  notificationIcon: {
    width: 36,
    height: 36,
    borderRadius: radius.sm,
    justifyContent: 'center',
    alignItems: 'center',
  },
  notificationTitle: {
    fontFamily: fonts.sansMedium,
    marginBottom: 2,
  },
  infoBox: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: spacing.sm,
    backgroundColor: colors.primaryLight,
    padding: spacing.md,
    borderRadius: radius.sm,
  },
  infoText: {
    flex: 1,
    color: colors.foreground,
  },
  footer: {
    padding: spacing.md,
    borderTopWidth: 1,
    borderTopColor: colors.borderLight,
  },
});
