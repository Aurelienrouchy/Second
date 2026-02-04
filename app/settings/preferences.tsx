/**
 * User Preferences Settings Page
 * Design System: Luxe Français + Street Energy
 */

import BrandSelectionSheet, {
  BrandSelectionSheetRef,
} from '@/components/search/BrandSelectionSheet';
import { useAuth } from '@/contexts/AuthContext';
import { UserService } from '@/services/userService';
import { colors, fonts, spacing, radius } from '@/constants/theme';
import { Text, Label, Caption } from '@/components/ui';
import { Button } from '@/components/ui';
import { Ionicons } from '@expo/vector-icons';
import * as Location from 'expo-location';
import { Stack, useRouter } from 'expo-router';
import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Pressable,
  ScrollView,
  StyleSheet,
  Switch,
  View,
} from 'react-native';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { SafeAreaView } from 'react-native-safe-area-context';

// Common sizes for quick selection
const COMMON_SIZES = ['XS', 'S', 'M', 'L', 'XL', 'XXL'];

export default function PreferencesScreen() {
  const router = useRouter();
  const { user } = useAuth();
  const brandSelectionRef = useRef<BrandSelectionSheetRef>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  const [selectedSizes, setSelectedSizes] = useState<string[]>([]);
  const [selectedBrands, setSelectedBrands] = useState<string[]>([]);
  const [location, setLocation] = useState<{
    latitude: number;
    longitude: number;
    city: string;
  } | null>(null);
  const [isLoadingLocation, setIsLoadingLocation] = useState(false);
  const [notificationPrefs, setNotificationPrefs] = useState({
    email: true,
    push: true,
    newMessages: true,
    newOrders: true,
    priceDrops: true,
    articleFavorited: true,
    swapZoneReminder: true,
    offerReceived: true,
    offerResponse: true,
  });

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
      if (preferences) {
        setSelectedSizes(preferences.sizes || []);
        setSelectedBrands(preferences.favoriteBrands || []);
        setLocation(preferences.location || null);
        if (preferences.notifications) {
          setNotificationPrefs({
            email: preferences.notifications.email ?? true,
            push: preferences.notifications.push ?? true,
            newMessages: preferences.notifications.newMessages ?? true,
            newOrders: preferences.notifications.newOrders ?? true,
            priceDrops: preferences.notifications.priceDrops ?? true,
            articleFavorited: preferences.notifications.articleFavorited ?? true,
            swapZoneReminder: preferences.notifications.swapZoneReminder ?? true,
            offerReceived: preferences.notifications.offerReceived ?? true,
            offerResponse: preferences.notifications.offerResponse ?? true,
          });
        }
      }
    } catch (error) {
      console.error('Error loading preferences:', error);
    } finally {
      setIsLoading(false);
    }
  };

  const handleSave = async () => {
    if (!user) return;

    setIsSaving(true);
    try {
      await UserService.updateUserPreferences(user.id, {
        sizes: selectedSizes,
        favoriteBrands: selectedBrands,
        location: location || undefined,
        notifications: notificationPrefs,
      });

      Alert.alert('Succès', 'Vos préférences ont été enregistrées', [
        { text: 'OK', onPress: () => router.back() },
      ]);
    } catch (error) {
      console.error('Error saving preferences:', error);
      Alert.alert('Erreur', "Une erreur est survenue lors de l'enregistrement");
    } finally {
      setIsSaving(false);
    }
  };

  const toggleNotificationPref = useCallback((key: keyof typeof notificationPrefs) => {
    setNotificationPrefs((prev) => ({
      ...prev,
      [key]: !prev[key],
    }));
  }, []);

  const toggleSize = useCallback((size: string) => {
    setSelectedSizes((prev) =>
      prev.includes(size) ? prev.filter((s) => s !== size) : [...prev, size]
    );
  }, []);

  const handleBrandConfirm = useCallback((brands: string[]) => {
    setSelectedBrands(brands);
  }, []);

  const handleGetLocation = async () => {
    setIsLoadingLocation(true);
    try {
      const { status } = await Location.requestForegroundPermissionsAsync();
      if (status !== 'granted') {
        Alert.alert('Permission refusée', "L'accès à la localisation est nécessaire");
        return;
      }

      const currentLocation = await Location.getCurrentPositionAsync({});
      const [reverseGeocode] = await Location.reverseGeocodeAsync({
        latitude: currentLocation.coords.latitude,
        longitude: currentLocation.coords.longitude,
      });

      setLocation({
        latitude: currentLocation.coords.latitude,
        longitude: currentLocation.coords.longitude,
        city: reverseGeocode?.city || reverseGeocode?.subregion || 'Ma position',
      });
    } catch (error) {
      console.error('Error getting location:', error);
      Alert.alert('Erreur', 'Impossible de récupérer votre position');
    } finally {
      setIsLoadingLocation(false);
    }
  };

  const clearLocation = () => {
    setLocation(null);
  };

  if (isLoading) {
    return (
      <SafeAreaView style={styles.container} edges={['bottom']}>
        <Stack.Screen options={{ title: 'Préférences' }} />
        <View style={styles.loadingContainer}>
          <ActivityIndicator size="large" color={colors.primary} />
          <Text variant="body" style={styles.loadingText}>Chargement...</Text>
        </View>
      </SafeAreaView>
    );
  }

  return (
    <GestureHandlerRootView style={styles.flex}>
      <SafeAreaView style={styles.container} edges={['bottom']}>
        <Stack.Screen options={{ title: 'Préférences' }} />

        {/* Content */}
        <ScrollView
          style={styles.scrollView}
          contentContainerStyle={styles.content}
          showsVerticalScrollIndicator={false}
        >
          {/* Sizes Section */}
          <View style={styles.section}>
            <Label style={styles.sectionHeader}>Mes tailles</Label>
            <Caption style={styles.sectionSubtitle}>
              Sélectionnez vos tailles pour voir des articles qui vous correspondent
            </Caption>
            <View style={styles.chipsContainer}>
              {COMMON_SIZES.map((size) => {
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

          {/* Location Section */}
          <View style={styles.section}>
            <Label style={styles.sectionHeader}>Ma localisation</Label>
            <Caption style={styles.sectionSubtitle}>
              Activez la localisation pour voir les articles près de chez vous
            </Caption>
            {location ? (
              <View style={styles.locationCard}>
                <View style={styles.locationInfo}>
                  <Ionicons name="location" size={24} color={colors.primary} />
                  <Text variant="body" style={styles.locationText}>{location.city}</Text>
                </View>
                <Pressable onPress={clearLocation} hitSlop={10}>
                  <Ionicons name="close-circle" size={24} color={colors.muted} />
                </Pressable>
              </View>
            ) : (
              <Pressable
                style={styles.selectorButton}
                onPress={handleGetLocation}
                disabled={isLoadingLocation}
              >
                {isLoadingLocation ? (
                  <ActivityIndicator size="small" color={colors.primary} />
                ) : (
                  <Ionicons name="location-outline" size={20} color={colors.muted} />
                )}
                <Text variant="body" style={styles.selectorButtonText}>
                  {isLoadingLocation ? 'Localisation en cours...' : 'Activer la localisation'}
                </Text>
                <Ionicons name="chevron-forward" size={20} color={colors.muted} />
              </Pressable>
            )}
          </View>

          {/* Notifications Section */}
          <View style={styles.section}>
            <Label style={styles.sectionHeader}>Notifications rapides</Label>
            <Caption style={styles.sectionSubtitle}>
              Choisissez les notifications que vous souhaitez recevoir
            </Caption>

            <View style={styles.notificationsList}>
              <View style={styles.notificationItem}>
                <View style={styles.notificationInfo}>
                  <View style={[styles.notificationIcon, { backgroundColor: colors.dangerLight }]}>
                    <Ionicons name="heart-outline" size={20} color={colors.danger} />
                  </View>
                  <View style={styles.notificationTextContainer}>
                    <Text variant="body" style={styles.notificationTitle}>Articles favoris</Text>
                    <Caption>Quand quelqu'un ajoute ton article en favori</Caption>
                  </View>
                </View>
                <Switch
                  value={notificationPrefs.articleFavorited}
                  onValueChange={() => toggleNotificationPref('articleFavorited')}
                  trackColor={{ false: colors.border, true: colors.primary }}
                  thumbColor={colors.white}
                  ios_backgroundColor={colors.border}
                />
              </View>

              <View style={styles.notificationItem}>
                <View style={styles.notificationInfo}>
                  <View style={[styles.notificationIcon, { backgroundColor: colors.successLight }]}>
                    <Ionicons name="pricetag-outline" size={20} color={colors.success} />
                  </View>
                  <View style={styles.notificationTextContainer}>
                    <Text variant="body" style={styles.notificationTitle}>Baisses de prix</Text>
                    <Caption>Quand un article en favoris baisse de prix</Caption>
                  </View>
                </View>
                <Switch
                  value={notificationPrefs.priceDrops}
                  onValueChange={() => toggleNotificationPref('priceDrops')}
                  trackColor={{ false: colors.border, true: colors.primary }}
                  thumbColor={colors.white}
                  ios_backgroundColor={colors.border}
                />
              </View>

              <View style={styles.notificationItem}>
                <View style={styles.notificationInfo}>
                  <View style={[styles.notificationIcon, { backgroundColor: colors.warningLight }]}>
                    <Ionicons name="cube-outline" size={20} color={colors.warning} />
                  </View>
                  <View style={styles.notificationTextContainer}>
                    <Text variant="body" style={styles.notificationTitle}>Swap Zone</Text>
                    <Caption>Rappel 3 jours avant l'événement</Caption>
                  </View>
                </View>
                <Switch
                  value={notificationPrefs.swapZoneReminder}
                  onValueChange={() => toggleNotificationPref('swapZoneReminder')}
                  trackColor={{ false: colors.border, true: colors.primary }}
                  thumbColor={colors.white}
                  ios_backgroundColor={colors.border}
                />
              </View>

              <View style={[styles.notificationItem, styles.notificationItemLast]}>
                <View style={styles.notificationInfo}>
                  <View style={[styles.notificationIcon, { backgroundColor: colors.primaryLight }]}>
                    <Ionicons name="cash-outline" size={20} color={colors.primary} />
                  </View>
                  <View style={styles.notificationTextContainer}>
                    <Text variant="body" style={styles.notificationTitle}>Propositions d'achat</Text>
                    <Caption>Quand tu reçois une offre</Caption>
                  </View>
                </View>
                <Switch
                  value={notificationPrefs.offerReceived}
                  onValueChange={() => toggleNotificationPref('offerReceived')}
                  trackColor={{ false: colors.border, true: colors.primary }}
                  thumbColor={colors.white}
                  ios_backgroundColor={colors.border}
                />
              </View>
            </View>
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
            onPress={handleSave}
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
      </SafeAreaView>
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
  loadingContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    gap: spacing.md,
  },
  loadingText: {
    color: colors.foregroundSecondary,
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
  locationCard: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    padding: spacing.md,
    backgroundColor: colors.primaryLight,
    borderRadius: radius.sm,
    borderWidth: 1.5,
    borderColor: colors.primary,
  },
  locationInfo: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
  },
  locationText: {
    fontFamily: fonts.sansMedium,
    color: colors.foreground,
  },
  notificationsList: {
    backgroundColor: colors.surface,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.borderLight,
    overflow: 'hidden',
  },
  notificationItem: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    padding: spacing.md,
    borderBottomWidth: 1,
    borderBottomColor: colors.borderLight,
  },
  notificationItemLast: {
    borderBottomWidth: 0,
  },
  notificationInfo: {
    flexDirection: 'row',
    alignItems: 'center',
    flex: 1,
    marginRight: spacing.md,
  },
  notificationIcon: {
    width: 36,
    height: 36,
    borderRadius: radius.sm,
    justifyContent: 'center',
    alignItems: 'center',
    marginRight: spacing.md,
  },
  notificationTextContainer: {
    flex: 1,
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
