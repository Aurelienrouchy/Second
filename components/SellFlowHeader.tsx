/**
 * Sell Flow Header Component
 * Design System: Luxe Français + Street Energy
 */

import React from 'react';
import { View, TouchableOpacity, StyleSheet, Alert } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import StepIndicator from './StepIndicator';
import SaveIndicator from './SaveIndicator';
import { colors, fonts, spacing } from '@/constants/theme';

interface SellFlowHeaderProps {
  currentStep: 1 | 2 | 3 | 4;
  onBack?: () => void;
  showBackButton?: boolean;
  confirmClose?: boolean;
  saveStatus?: 'idle' | 'saving' | 'saved' | 'error';
}

export default function SellFlowHeader({
  currentStep,
  onBack,
  showBackButton = true,
  confirmClose = false,
  saveStatus,
}: SellFlowHeaderProps) {
  const insets = useSafeAreaInsets();
  const router = useRouter();

  const handleClose = () => {
    if (confirmClose) {
      Alert.alert(
        'Quitter?',
        'Vous avez des modifications non sauvegardées. Êtes-vous sûr de vouloir quitter?',
        [
          { text: 'Annuler', style: 'cancel' },
          {
            text: 'Quitter',
            style: 'destructive',
            onPress: () => router.replace('/(tabs)'),
          },
        ]
      );
    } else {
      router.replace('/(tabs)');
    }
  };

  const handleBack = () => {
    if (onBack) {
      onBack();
    } else if (router.canGoBack()) {
      router.back();
    } else {
      // Fallback: go to appropriate previous step or home
      if (currentStep === 2) {
        router.replace('/sell/capture');
      } else if (currentStep === 3) {
        router.replace('/sell/details');
      } else if (currentStep === 4) {
        router.replace('/sell/pricing');
      } else {
        router.replace('/(tabs)');
      }
    }
  };

  return (
    <View style={[styles.container, { paddingTop: insets.top }]}>
      <View style={styles.header}>
        {/* Left: Back button or spacer */}
        <View style={styles.leftButton}>
          {showBackButton && currentStep > 1 ? (
            <TouchableOpacity onPress={handleBack} style={styles.iconButton}>
              <Ionicons name="chevron-back" size={28} color={colors.foreground} />
            </TouchableOpacity>
          ) : (
            <View style={styles.iconButton} />
          )}
        </View>

        {/* Center: Step indicator */}
        <View style={styles.centerContent}>
          <StepIndicator currentStep={currentStep} />
        </View>

        {/* Right: Save indicator + Close button */}
        <View style={styles.rightSection}>
          {saveStatus && <SaveIndicator status={saveStatus} />}
          <TouchableOpacity onPress={handleClose} style={styles.iconButton}>
            <Ionicons name="close" size={28} color={colors.foreground} />
          </TouchableOpacity>
        </View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    backgroundColor: colors.surface,
    borderBottomWidth: 1,
    borderBottomColor: colors.borderLight,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: spacing.sm,
    paddingBottom: spacing.sm,
  },
  leftButton: {
    width: 44,
  },
  centerContent: {
    flex: 1,
    alignItems: 'center',
  },
  rightSection: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
  },
  iconButton: {
    width: 44,
    height: 44,
    justifyContent: 'center',
    alignItems: 'center',
  },
});
