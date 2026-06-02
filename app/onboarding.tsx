/**
 * Onboarding Screen — Seconde
 * Ecran unique: collecte sexe, tailles vetements (haut + bas), pointure.
 * Multi-select sur toutes les tailles. Tailles visibles immediatement.
 * Grilles adaptees quand "Enfant" est selectionne.
 * Donnees sauvegardees en AsyncStorage + Firebase via saveOnboardingPreferences.
 *
 * Design system: Cormorant Garamond (serif) + Satoshi (sans)
 * Sharp corners on tags. borderRadius 8 on buttons. No emojis.
 */

import { Ionicons } from '@expo/vector-icons';
import AsyncStorage from '@react-native-async-storage/async-storage';
import * as Haptics from 'expo-haptics';
import { router } from 'expo-router';
import React, { useCallback, useState } from 'react';
import {
  Alert,
  Pressable,
  ScrollView,
  Text,
  View,
} from 'react-native';
import Animated, {
  FadeIn,
  FadeInDown,
  FadeInUp,
} from 'react-native-reanimated';
import { SafeAreaView } from 'react-native-safe-area-context';

import { Button } from '@/components/ui';
import { colors } from '@/constants/theme';
import { useUser } from '@/contexts/AuthContext';
import { ONBOARDING_COMPLETED_KEY } from '@/constants/storageKeys';

import { httpsCallable } from 'firebase/functions';
import { functions } from '@/config/firebaseConfig';

import {
  onboardingStyles as styles,
  SexOption,
  SizeChip,
  SEXE_OPTIONS,
  SIZE_SYSTEM_OPTIONS,
  SIZES_ADULT_BOTTOMS_EU,
  SIZES_ADULT_BOTTOMS_US,
  SIZES_ADULT_SHOES_EU,
  SIZES_ADULT_SHOES_US,
  SIZES_ADULT_TOPS_EU,
  SIZES_ADULT_TOPS_US,
  SIZES_KIDS_BOTTOMS_EU,
  SIZES_KIDS_BOTTOMS_US,
  SIZES_KIDS_SHOES_EU,
  SIZES_KIDS_SHOES_US,
  SIZES_KIDS_TOPS_EU,
  SIZES_KIDS_TOPS_US,
  type OnboardingPreferences,
  type SizeSystem,
} from '@/features/onboarding';

// Re-export for backwards compatibility
export type { OnboardingPreferences };

// ─────────────────────────────────────────────────────────
// MAIN SCREEN
// ─────────────────────────────────────────────────────────

export default function OnboardingScreen() {
  const user = useUser();
  const [showWelcome, setShowWelcome] = useState(true);
  const [sex, setSex] = useState<OnboardingPreferences['sex'] | null>(null);
  const [sizeSystem, setSizeSystem] = useState<SizeSystem>('US');
  const [sizesTop, setSizesTop] = useState<string[]>([]);
  const [sizesBottom, setSizesBottom] = useState<string[]>([]);
  const [sizesShoes, setSizesShoes] = useState<string[]>([]);
  const [isSaving, setIsSaving] = useState(false);

  const isKid = sex === 'enfant';
  const isEU = sizeSystem === 'EU';
  const currentTops = isKid
    ? (isEU ? SIZES_KIDS_TOPS_EU : SIZES_KIDS_TOPS_US)
    : (isEU ? SIZES_ADULT_TOPS_EU : SIZES_ADULT_TOPS_US);
  const currentBottoms = isKid
    ? (isEU ? SIZES_KIDS_BOTTOMS_EU : SIZES_KIDS_BOTTOMS_US)
    : (isEU ? SIZES_ADULT_BOTTOMS_EU : SIZES_ADULT_BOTTOMS_US);
  const currentShoes = isKid
    ? (isEU ? SIZES_KIDS_SHOES_EU : SIZES_KIDS_SHOES_US)
    : (isEU ? SIZES_ADULT_SHOES_EU : SIZES_ADULT_SHOES_US);

  const hasAnything = sex || sizesTop.length > 0 || sizesBottom.length > 0 || sizesShoes.length > 0;

  const toggleSize = useCallback((
    setter: React.Dispatch<React.SetStateAction<string[]>>,
    current: string[],
    value: string,
  ) => {
    setter(current.includes(value) ? current.filter(x => x !== value) : [...current, value]);
  }, []);

  const handleSizeSystemChange = useCallback((newSystem: SizeSystem) => {
    if (newSystem === sizeSystem) return;
    const hasSelections = sizesTop.length > 0 || sizesBottom.length > 0 || sizesShoes.length > 0;
    const doSwitch = () => {
      setSizeSystem(newSystem);
      setSizesTop([]);
      setSizesBottom([]);
      setSizesShoes([]);
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    };
    if (hasSelections) {
      Alert.alert(
        'Changer de système',
        'Vos sélections de tailles seront réinitialisées. Continuer ?',
        [
          { text: 'Annuler', style: 'cancel' },
          { text: 'Continuer', onPress: doSwitch },
        ]
      );
    } else {
      doSwitch();
    }
  }, [sizeSystem, sizesTop.length, sizesBottom.length, sizesShoes.length]);

  const handleSexChange = useCallback((newSex: OnboardingPreferences['sex']) => {
    // Reset sizes when switching to/from enfant
    if ((sex === 'enfant' && newSex !== 'enfant') || (sex !== 'enfant' && newSex === 'enfant')) {
      setSizesTop([]);
      setSizesBottom([]);
      setSizesShoes([]);
    }
    setSex(prev => prev === newSex ? null : newSex);
  }, [sex]);

  const handleSkip = useCallback(async () => {
    await AsyncStorage.setItem(ONBOARDING_COMPLETED_KEY, 'true');
    router.replace('/(tabs)');
  }, []);

  const handleValidate = useCallback(async () => {
    if (!hasAnything || isSaving) return;

    setIsSaving(true);
    try {
      const preferences: OnboardingPreferences = {
        sex: sex || 'femme',
        sizesTop,
        sizesBottom,
        sizesShoes,
      };

      // Save to AsyncStorage for immediate use
      await AsyncStorage.setItem('@onboarding_preferences', JSON.stringify(preferences));
      await AsyncStorage.setItem(ONBOARDING_COMPLETED_KEY, 'true');

      // Save to Firebase
      const savePrefs = httpsCallable(functions, 'saveOnboardingPreferences');
      const payload = {
        ...preferences,
        userId: user?.id || null,
      };

      if (user) {
        // Logged-in user: await persistence so prefs are not silently lost.
        // On failure, surface a retry (AsyncStorage already holds the prefs).
        try {
          await savePrefs(payload);
        } catch (err) {
          if (__DEV__) console.error('Error saving onboarding preferences to Firebase:', err);
          setIsSaving(false);
          Alert.alert(
            'Échec de l’enregistrement',
            'Tes préférences n’ont pas pu être enregistrées. Réessayer ?',
            [
              { text: 'Plus tard', style: 'cancel', onPress: () => router.replace('/(tabs)') },
              { text: 'Réessayer', onPress: () => { void handleValidate(); } },
            ]
          );
          return;
        }
      } else {
        // Guest: fire-and-forget, prefs live in AsyncStorage until sign-in.
        savePrefs(payload).catch((err: unknown) => {
          if (__DEV__) console.error('Error saving onboarding preferences to Firebase:', err);
        });
      }

      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      router.replace('/(tabs)');
    } catch (err) {
      if (__DEV__) console.error('Error saving onboarding preferences:', err);
      // Still navigate even if save fails
      router.replace('/(tabs)');
    } finally {
      setIsSaving(false);
    }
  }, [hasAnything, isSaving, sex, sizesTop, sizesBottom, sizesShoes, user]);

  // ─── Welcome screen ───
  if (showWelcome) {
    return (
      <SafeAreaView style={styles.safeArea}>
        <View style={styles.welcomeContainer}>
          <View style={styles.welcomeContent}>
            <Animated.Text
              entering={FadeInDown.duration(500).delay(100)}
              style={styles.welcomeLabel}
            >
              BIENVENUE SUR
            </Animated.Text>
            <Animated.Text
              entering={FadeInDown.duration(500).delay(200)}
              style={styles.welcomeTitle}
            >
              Seconde
            </Animated.Text>
            <Animated.View
              entering={FadeIn.duration(400).delay(400)}
              style={styles.welcomeDivider}
            />
            <Animated.Text
              entering={FadeInDown.duration(500).delay(350)}
              style={styles.welcomeSubtitle}
            >
              Dis-nous en un peu plus sur toi pour personnaliser ton expérience.
            </Animated.Text>
          </View>
          <Animated.View
            entering={FadeInUp.duration(500).delay(500)}
            style={styles.welcomeActions}
          >
            <Button
              fullWidth
              onPress={() => setShowWelcome(false)}
            >
              CONTINUER
            </Button>
            <Pressable onPress={handleSkip} style={styles.skipButton}>
              <Text style={styles.skipText}>Passer</Text>
            </Pressable>
          </Animated.View>
        </View>
      </SafeAreaView>
    );
  }

  // ─── Form screen ───
  return (
    <SafeAreaView style={styles.safeArea}>
      <View style={styles.container}>
        {/* Header */}
        <View style={styles.header}>
          <Pressable
            onPress={() => setShowWelcome(true)}
            style={styles.backButton}
            hitSlop={12}
          >
            <Ionicons name="chevron-back" size={22} color={colors.charcoal} />
          </Pressable>
          <Pressable onPress={handleSkip} style={styles.skipButton} hitSlop={12}>
            <Text style={styles.skipText}>Passer</Text>
          </Pressable>
        </View>

        {/* Scrollable form */}
        <ScrollView
          style={styles.scrollView}
          contentContainerStyle={styles.scrollContent}
          showsVerticalScrollIndicator={false}
        >
          <Animated.Text
            entering={FadeInDown.duration(400).delay(50)}
            style={styles.formTitle}
          >
            Parle-nous de toi
          </Animated.Text>

          {/* Sexe */}
          <Animated.View entering={FadeInDown.duration(400).delay(100)}>
            <Text style={styles.sectionLabel}>JE CHERCHE POUR</Text>
            <View style={styles.sexRow}>
              {SEXE_OPTIONS.map(opt => (
                <SexOption
                  key={opt.id}
                  label={opt.label}
                  selected={sex === opt.id}
                  onPress={() => handleSexChange(opt.id)}
                />
              ))}
            </View>
          </Animated.View>

          {/* Size system toggle */}
          <Animated.View entering={FadeInDown.duration(400).delay(130)} style={styles.sizeSection}>
            <Text style={styles.sectionLabel}>SYSTÈME DE TAILLE</Text>
            <View style={styles.sizeSystemRow}>
              {SIZE_SYSTEM_OPTIONS.map(opt => (
                <Pressable
                  key={opt.id}
                  style={[
                    styles.sizeSystemOption,
                    sizeSystem === opt.id && styles.sizeSystemOptionSelected,
                  ]}
                  onPress={() => handleSizeSystemChange(opt.id)}
                >
                  <Text style={[
                    styles.sizeSystemText,
                    sizeSystem === opt.id && styles.sizeSystemTextSelected,
                  ]}>
                    {opt.label}
                  </Text>
                </Pressable>
              ))}
            </View>
          </Animated.View>

          {/* Taille du haut */}
          <Animated.View entering={FadeInDown.duration(400).delay(150)} style={styles.sizeSection}>
            <View style={styles.sectionHeader}>
              <Text style={styles.sectionLabel}>TAILLE DU HAUT</Text>
              {sizesTop.length > 0 && (
                <Text style={styles.sectionSelection}>{sizesTop.join(', ')}</Text>
              )}
            </View>
            <View style={styles.chipGrid}>
              {currentTops.map(s => (
                <SizeChip
                  key={s}
                  label={s}
                  selected={sizesTop.includes(s)}
                  onPress={() => toggleSize(setSizesTop, sizesTop, s)}
                />
              ))}
            </View>
          </Animated.View>

          {/* Taille du bas */}
          <Animated.View entering={FadeInDown.duration(400).delay(200)} style={styles.sizeSection}>
            <View style={styles.sectionHeader}>
              <Text style={styles.sectionLabel}>TAILLE DU BAS</Text>
              {sizesBottom.length > 0 && (
                <Text style={styles.sectionSelection}>{sizesBottom.join(', ')}</Text>
              )}
            </View>
            <View style={styles.chipGrid}>
              {currentBottoms.map(s => (
                <SizeChip
                  key={s}
                  label={s}
                  selected={sizesBottom.includes(s)}
                  onPress={() => toggleSize(setSizesBottom, sizesBottom, s)}
                />
              ))}
            </View>
          </Animated.View>

          {/* Pointure */}
          <Animated.View entering={FadeInDown.duration(400).delay(250)} style={styles.sizeSection}>
            <View style={styles.sectionHeader}>
              <Text style={styles.sectionLabel}>POINTURE</Text>
              {sizesShoes.length > 0 && (
                <Text style={styles.sectionSelection}>{sizesShoes.join(', ')}</Text>
              )}
            </View>
            <View style={styles.chipGrid}>
              {currentShoes.map(s => (
                <SizeChip
                  key={s}
                  label={s}
                  selected={sizesShoes.includes(s)}
                  onPress={() => toggleSize(setSizesShoes, sizesShoes, s)}
                />
              ))}
            </View>
          </Animated.View>
        </ScrollView>

        {/* Bottom CTA */}
        <View style={styles.bottomCTA}>
          <Button
            fullWidth
            onPress={handleValidate}
            disabled={!hasAnything}
            loading={isSaving}
          >
            VALIDER
          </Button>
        </View>
      </View>
    </SafeAreaView>
  );
}

