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
import { router, useFocusEffect } from 'expo-router';
import React, { useCallback, useState } from 'react';
import {
  Alert,
  BackHandler,
  Platform,
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
import { track } from '@/lib/analytics';
import { useUser } from '@/hooks/useAuth';
import { ONBOARDING_COMPLETED_KEY, ONBOARDING_PREFERENCES_KEY } from '@/constants/storageKeys';

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

  // VALIDER requires a sex selection (backend contract requires a valid sex)
  // plus at least one size selected.
  const hasAnything =
    !!sex && (sizesTop.length > 0 || sizesBottom.length > 0 || sizesShoes.length > 0);

  const toggleSize = useCallback((
    setter: React.Dispatch<React.SetStateAction<string[]>>,
    current: string[],
    value: string,
    category: 'top' | 'bottom' | 'shoes',
  ) => {
    const selected = !current.includes(value);
    setter(selected ? [...current, value] : current.filter(x => x !== value));
    track('onboarding_preference_changed', {
      field: 'size',
      value,
      selected,
      category,
    });
  }, []);

  const handleSizeSystemChange = useCallback((newSystem: SizeSystem) => {
    if (newSystem === sizeSystem) return;
    const hasSelections = sizesTop.length > 0 || sizesBottom.length > 0 || sizesShoes.length > 0;
    const fromSystem = sizeSystem;
    const doSwitch = () => {
      setSizeSystem(newSystem);
      setSizesTop([]);
      setSizesBottom([]);
      setSizesShoes([]);
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
      track('onboarding_preference_changed', {
        field: 'size_system',
        value: newSystem,
        from_system: fromSystem,
        to_system: newSystem,
        system_change_confirmed: true,
        sizes_reset: hasSelections,
      });
    };
    if (hasSelections) {
      Alert.alert(
        'Changer de système',
        'Vos sélections de tailles seront réinitialisées. Continuer ?',
        [
          {
            text: 'Annuler',
            style: 'cancel',
            onPress: () =>
              track('onboarding_preference_changed', {
                field: 'size_system',
                value: newSystem,
                from_system: fromSystem,
                to_system: newSystem,
                system_change_confirmed: false,
                sizes_reset: false,
              }),
          },
          { text: 'Continuer', onPress: doSwitch },
        ]
      );
    } else {
      doSwitch();
    }
  }, [sizeSystem, sizesTop.length, sizesBottom.length, sizesShoes.length]);

  const handleSexChange = useCallback((newSex: OnboardingPreferences['sex']) => {
    const willDeselect = sex === newSex;
    const sizesReset =
      (sex === 'enfant' && newSex !== 'enfant') || (sex !== 'enfant' && newSex === 'enfant');
    // Reset sizes when switching to/from enfant
    if (sizesReset) {
      setSizesTop([]);
      setSizesBottom([]);
      setSizesShoes([]);
    }
    setSex(prev => prev === newSex ? null : newSex);
    track('onboarding_preference_changed', {
      field: 'sex',
      value: newSex,
      selected: !willDeselect,
      sizes_reset: sizesReset,
    });
  }, [sex]);

  const handleSkip = useCallback(async (step: 'welcome' | 'form') => {
    track('onboarding_skipped', {
      step,
      sex_selected: !!sex,
      sizes_selected_count: sizesTop.length + sizesBottom.length + sizesShoes.length,
    });
    await AsyncStorage.setItem(ONBOARDING_COMPLETED_KEY, 'true');
    router.replace('/(tabs)');
  }, [sex, sizesTop.length, sizesBottom.length, sizesShoes.length]);

  const handleValidate = useCallback(async () => {
    // hasAnything guarantees a sex selection; the early return keeps the
    // backend contract (sex is a required, validated field) honoured.
    if (!hasAnything || !sex || isSaving) return;

    setIsSaving(true);
    track('onboarding_completed', {
      sex_value: sex,
      sizes_top_count: sizesTop.length,
      sizes_bottom_count: sizesBottom.length,
      sizes_shoes_count: sizesShoes.length,
      size_system: sizeSystem,
    });
    try {
      const preferences: OnboardingPreferences = {
        sex,
        sizesTop,
        sizesBottom,
        sizesShoes,
      };

      // Save to AsyncStorage for immediate use
      await AsyncStorage.setItem(ONBOARDING_PREFERENCES_KEY, JSON.stringify(preferences));
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
        const persist = async (): Promise<boolean> => {
          try {
            await savePrefs(payload);
            return true;
          } catch (err) {
            if (__DEV__) console.error('Error saving onboarding preferences to Firebase:', err);
            return false;
          }
        };

        let attemptNumber = 1;
        let saved = await persist();
        while (!saved) {
          const retry = await new Promise<boolean>(resolve => {
            Alert.alert(
              'Échec de l’enregistrement',
              'Tes préférences n’ont pas pu être enregistrées. Réessayer ?',
              [
                { text: 'Plus tard', style: 'cancel', onPress: () => resolve(false) },
                { text: 'Réessayer', onPress: () => resolve(true) },
              ]
            );
          });
          track('onboarding_save_failed', { retry_chosen: retry, attempt_number: attemptNumber });
          if (!retry) break;
          attemptNumber += 1;
          saved = await persist();
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

  // Android hardware back on the form screen returns to the welcome step
  // (instead of leaving onboarding) and preserves the current selections.
  useFocusEffect(
    useCallback(() => {
      if (Platform.OS !== 'android' || showWelcome) return;
      const subscription = BackHandler.addEventListener('hardwareBackPress', () => {
        setShowWelcome(true);
        return true;
      });
      return () => subscription.remove();
    }, [showWelcome])
  );

  // ─── Welcome screen ───
  if (showWelcome) {
    return (
      <SafeAreaView style={styles.safeArea} testID="onboarding-welcome">
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
              testID="onboarding-continue"
            >
              CONTINUER
            </Button>
            <Pressable onPress={() => handleSkip('welcome')} style={styles.skipButton} testID="onboarding-skip">
              <Text style={styles.skipText}>Passer</Text>
            </Pressable>
          </Animated.View>
        </View>
      </SafeAreaView>
    );
  }

  // ─── Form screen ───
  return (
    <SafeAreaView style={styles.safeArea} testID="onboarding-form">
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
          <Pressable onPress={() => handleSkip('form')} style={styles.skipButton} hitSlop={12} testID="onboarding-skip-form">
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
                  onPress={() => toggleSize(setSizesTop, sizesTop, s, 'top')}
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
                  onPress={() => toggleSize(setSizesBottom, sizesBottom, s, 'bottom')}
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
                  onPress={() => toggleSize(setSizesShoes, sizesShoes, s, 'shoes')}
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
            testID="onboarding-submit"
          >
            VALIDER
          </Button>
        </View>
      </View>
    </SafeAreaView>
  );
}

