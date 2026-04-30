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
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import Animated, {
  FadeIn,
  FadeInDown,
  FadeInUp,
  useAnimatedStyle,
  useSharedValue,
  withSpring,
} from 'react-native-reanimated';
import { SafeAreaView } from 'react-native-safe-area-context';

import { Button } from '@/components/ui';
import { colors, fonts, radius, spacing, typography, animations } from '@/constants/theme';
import { useAuth } from '@/contexts/AuthContext';
import { ONBOARDING_COMPLETED_KEY } from '@/constants/storageKeys';

import { httpsCallable } from 'firebase/functions';
import { functions } from '@/config/firebaseConfig';

// ─────────────────────────────────────────────────────────
// TYPES
// ─────────────────────────────────────────────────────────

export interface OnboardingPreferences {
  sex: 'femme' | 'homme' | 'les-deux' | 'enfant';
  sizesTop: string[];
  sizesBottom: string[];
  sizesShoes: string[];
}

// ─────────────────────────────────────────────────────────
// DATA — Tailles reelles (marche canadien / Montreal)
// ─────────────────────────────────────────────────────────

type SizeSystem = 'US' | 'EU';

const SIZE_SYSTEM_OPTIONS: { id: SizeSystem; label: string }[] = [
  { id: 'US', label: 'US' },
  { id: 'EU', label: 'EU' },
];

const SEXE_OPTIONS: { id: OnboardingPreferences['sex']; label: string }[] = [
  { id: 'femme', label: 'Femme' },
  { id: 'homme', label: 'Homme' },
  { id: 'les-deux', label: 'Les deux' },
  { id: 'enfant', label: 'Enfant' },
];

// Adulte — Tailles US (canadiennes)
const SIZES_ADULT_TOPS_US = ['XXS', 'XS', 'S', 'M', 'L', 'XL', 'XXL', '3XL'];
const SIZES_ADULT_BOTTOMS_US = ['24', '25', '26', '27', '28', '29', '30', '31', '32', '33', '34', '36', '38', '40'];
const SIZES_ADULT_SHOES_US = [
  '5', '5.5', '6', '6.5', '7', '7.5', '8', '8.5',
  '9', '9.5', '10', '10.5', '11', '11.5', '12', '13',
];

// Adulte — Tailles EU
const SIZES_ADULT_TOPS_EU = ['XXS', 'XS', 'S', 'M', 'L', 'XL', 'XXL', '3XL'];
const SIZES_ADULT_BOTTOMS_EU = ['32', '34', '36', '38', '40', '42', '44', '46', '48', '50', '52'];
const SIZES_ADULT_SHOES_EU = [
  '35', '35.5', '36', '36.5', '37', '37.5', '38', '38.5',
  '39', '39.5', '40', '40.5', '41', '42', '43', '44', '45', '46',
];

// Enfant — Tailles US (canadiennes)
const SIZES_KIDS_TOPS_US = [
  '2T', '3T', '4T', '5', '6', '6X', '7', '8',
  '10', '12', '14', '16',
];
const SIZES_KIDS_BOTTOMS_US = [
  '2T', '3T', '4T', '5', '6', '6X', '7', '8',
  '10', '12', '14', '16',
];
const SIZES_KIDS_SHOES_US = [
  '5C', '6C', '7C', '8C', '9C', '10C', '11C', '12C', '13C',
  '1Y', '2Y', '3Y', '4Y', '5Y', '6Y', '7Y',
];

// Enfant — Tailles EU
const SIZES_KIDS_TOPS_EU = [
  '2 ans', '3 ans', '4 ans', '5 ans', '6 ans', '8 ans',
  '10 ans', '12 ans', '14 ans', '16 ans',
];
const SIZES_KIDS_BOTTOMS_EU = [
  '2 ans', '3 ans', '4 ans', '5 ans', '6 ans', '8 ans',
  '10 ans', '12 ans', '14 ans', '16 ans',
];
const SIZES_KIDS_SHOES_EU = [
  '20', '21', '22', '23', '24', '25', '26', '27',
  '28', '29', '30', '31', '32', '33', '34', '35',
];

// ─────────────────────────────────────────────────────────
// COMPONENTS
// ─────────────────────────────────────────────────────────

const AnimatedPressable = Animated.createAnimatedComponent(Pressable);

interface SizeChipProps {
  label: string;
  selected: boolean;
  onPress: () => void;
}

function SizeChip({ label, selected, onPress }: SizeChipProps) {
  const scale = useSharedValue(1);

  const animatedStyle = useAnimatedStyle(() => ({
    transform: [{ scale: scale.value }],
  }));

  const handlePressIn = useCallback(() => {
    scale.value = withSpring(0.92, animations.spring.snappy);
  }, [scale]);

  const handlePressOut = useCallback(() => {
    scale.value = withSpring(1, animations.spring.bouncy);
  }, [scale]);

  const handlePress = useCallback(() => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    onPress();
  }, [onPress]);

  return (
    <AnimatedPressable
      style={[
        styles.sizeChip,
        selected && styles.sizeChipSelected,
        animatedStyle,
      ]}
      onPressIn={handlePressIn}
      onPressOut={handlePressOut}
      onPress={handlePress}
    >
      <Text style={[
        styles.sizeChipText,
        selected && styles.sizeChipTextSelected,
      ]}>
        {label}
      </Text>
    </AnimatedPressable>
  );
}

interface SexOptionProps {
  label: string;
  selected: boolean;
  onPress: () => void;
}

function SexOption({ label, selected, onPress }: SexOptionProps) {
  const scale = useSharedValue(1);

  const animatedStyle = useAnimatedStyle(() => ({
    transform: [{ scale: scale.value }],
  }));

  const handlePressIn = useCallback(() => {
    scale.value = withSpring(0.95, animations.spring.snappy);
  }, [scale]);

  const handlePressOut = useCallback(() => {
    scale.value = withSpring(1, animations.spring.bouncy);
  }, [scale]);

  const handlePress = useCallback(() => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    onPress();
  }, [onPress]);

  return (
    <AnimatedPressable
      style={[
        styles.sexOption,
        selected && styles.sexOptionSelected,
        animatedStyle,
      ]}
      onPressIn={handlePressIn}
      onPressOut={handlePressOut}
      onPress={handlePress}
    >
      <Text style={[
        styles.sexOptionText,
        selected && styles.sexOptionTextSelected,
      ]}>
        {label}
      </Text>
    </AnimatedPressable>
  );
}

// ─────────────────────────────────────────────────────────
// MAIN SCREEN
// ─────────────────────────────────────────────────────────

export default function OnboardingScreen() {
  const { user } = useAuth();
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
    if (newSystem !== sizeSystem) {
      setSizeSystem(newSystem);
      // Reset selections since size values differ between systems
      setSizesTop([]);
      setSizesBottom([]);
      setSizesShoes([]);
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    }
  }, [sizeSystem]);

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

      // Save to Firebase (non-blocking for guest, blocking for logged-in user)
      const savePrefs = httpsCallable(functions, 'saveOnboardingPreferences');
      savePrefs({
        ...preferences,
        userId: user?.id || null,
      }).catch((err: unknown) => {
        console.error('Error saving onboarding preferences to Firebase:', err);
      });

      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      router.replace('/(tabs)');
    } catch (err) {
      console.error('Error saving onboarding preferences:', err);
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
              Dis-nous en un peu plus sur toi pour personnaliser ton experience.
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
            <Text style={styles.sectionLabel}>SYSTEME DE TAILLE</Text>
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

// ─────────────────────────────────────────────────────────
// STYLES
// ─────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  safeArea: {
    flex: 1,
    backgroundColor: colors.background,
  },

  // ─── Welcome ───
  welcomeContainer: {
    flex: 1,
    justifyContent: 'space-between',
    paddingHorizontal: spacing.lg,
    backgroundColor: colors.cream,
  },
  welcomeContent: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
  },
  welcomeLabel: {
    fontFamily: fonts.sansMedium,
    fontSize: typography.labelUppercase.fontSize,
    letterSpacing: typography.labelUppercase.letterSpacing,
    textTransform: 'uppercase',
    color: colors.rust,
    marginBottom: 20,
  },
  welcomeTitle: {
    fontFamily: fonts.displayBold,
    fontSize: 48,
    color: colors.charcoal,
    letterSpacing: -1,
  },
  welcomeDivider: {
    width: 48,
    height: 1,
    backgroundColor: colors.rust,
    marginVertical: 20,
  },
  welcomeSubtitle: {
    fontFamily: fonts.sans,
    fontSize: 14,
    lineHeight: 22,
    color: colors.muted,
    textAlign: 'center',
    maxWidth: 260,
  },
  welcomeActions: {
    paddingBottom: 40,
    gap: 4,
    alignItems: 'center',
  },

  // ─── Form ───
  container: {
    flex: 1,
  },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: spacing.sm,
    height: 48,
  },
  backButton: {
    width: 44,
    height: 44,
    justifyContent: 'center',
    alignItems: 'center',
  },
  skipButton: {
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
  },
  skipText: {
    fontFamily: fonts.sans,
    fontSize: 13,
    color: colors.muted,
    letterSpacing: 0.3,
  },
  scrollView: {
    flex: 1,
  },
  scrollContent: {
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.xs,
    paddingBottom: spacing.xl,
  },
  formTitle: {
    fontFamily: fonts.displaySemiBold,
    fontSize: 28,
    color: colors.charcoal,
    letterSpacing: -0.5,
    lineHeight: 34,
    marginBottom: spacing.lg,
  },

  // ─── Sections ───
  sectionLabel: {
    fontFamily: fonts.sansMedium,
    fontSize: typography.labelUppercase.fontSize,
    letterSpacing: typography.labelUppercase.letterSpacing,
    textTransform: 'uppercase',
    color: colors.muted,
    marginBottom: 10,
  },
  sectionHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 10,
  },
  sectionSelection: {
    fontFamily: fonts.sans,
    fontSize: typography.caption.fontSize,
    color: colors.rust,
    maxWidth: 180,
  },
  sizeSection: {
    marginTop: spacing.lg,
  },

  // ─── Sex options ───
  sexRow: {
    flexDirection: 'row',
    gap: 8,
  },
  sexOption: {
    flex: 1,
    height: 48,
    justifyContent: 'center',
    alignItems: 'center',
    borderWidth: 1,
    borderColor: colors.borderStrong,
    backgroundColor: 'transparent',
    borderRadius: 0, // Sharp corners per Tag.tsx
  },
  sexOptionSelected: {
    backgroundColor: colors.charcoal,
    borderColor: colors.charcoal,
  },
  sexOptionText: {
    fontFamily: fonts.sans,
    fontSize: 13,
    letterSpacing: 0.3,
    color: colors.charcoal,
  },
  sexOptionTextSelected: {
    color: colors.white,
  },

  // ─── Size system toggle ───
  sizeSystemRow: {
    flexDirection: 'row',
    gap: 8,
  },
  sizeSystemOption: {
    flex: 1,
    height: 40,
    justifyContent: 'center',
    alignItems: 'center',
    borderWidth: 1,
    borderColor: colors.borderStrong,
    backgroundColor: 'transparent',
    borderRadius: 0,
  },
  sizeSystemOptionSelected: {
    backgroundColor: colors.charcoal,
    borderColor: colors.charcoal,
  },
  sizeSystemText: {
    fontFamily: fonts.sansMedium,
    fontSize: 13,
    letterSpacing: 0.5,
    color: colors.charcoal,
  },
  sizeSystemTextSelected: {
    color: colors.white,
  },

  // ─── Size chips ───
  chipGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
  },
  sizeChip: {
    minWidth: 48,
    height: 42,
    paddingHorizontal: 12,
    justifyContent: 'center',
    alignItems: 'center',
    borderWidth: 1,
    borderColor: colors.borderStrong,
    backgroundColor: 'transparent',
    borderRadius: 0, // Sharp corners per Tag.tsx design system
  },
  sizeChipSelected: {
    backgroundColor: colors.charcoal,
    borderColor: colors.charcoal,
  },
  sizeChipText: {
    fontFamily: fonts.sans,
    fontSize: 12,
    letterSpacing: 0.3,
    color: colors.charcoal,
  },
  sizeChipTextSelected: {
    color: colors.white,
  },

  // ─── Bottom CTA ───
  bottomCTA: {
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.md,
    paddingBottom: 28,
    borderTopWidth: 1,
    borderTopColor: colors.border,
  },
});
