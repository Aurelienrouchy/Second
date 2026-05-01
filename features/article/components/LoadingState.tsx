/**
 * Article detail screen — loading & error states.
 */

import { Ionicons } from '@expo/vector-icons';
import React from 'react';
import { ActivityIndicator, Pressable, Text, View } from 'react-native';
import Animated, { FadeIn } from 'react-native-reanimated';
import { SafeAreaView } from 'react-native-safe-area-context';

import { colors } from '@/constants/theme';

import { articleStyles as styles } from '../styles';

function LoadingStateComponent() {
  return (
    <SafeAreaView style={styles.container}>
      <View style={styles.loadingContainer}>
        <ActivityIndicator size="large" color={colors.primary} />
        <Text style={styles.loadingText}>Chargement...</Text>
      </View>
    </SafeAreaView>
  );
}

export const LoadingState = React.memo(LoadingStateComponent);

interface ErrorStateProps {
  onBack: () => void;
}

function ErrorStateComponent({ onBack }: ErrorStateProps) {
  return (
    <SafeAreaView style={styles.container}>
      <Animated.View entering={FadeIn.duration(300)} style={styles.errorContainer}>
        <View style={styles.errorIconCircle}>
          <Ionicons name="alert-circle-outline" size={40} color={colors.muted} />
        </View>
        <Text style={styles.errorTitle}>Article introuvable</Text>
        <Text style={styles.errorText}>
          Cet article n'existe plus ou a été supprimé
        </Text>
        <Pressable style={styles.errorButton} onPress={onBack}>
          <Text style={styles.errorButtonText}>Retour</Text>
        </Pressable>
      </Animated.View>
    </SafeAreaView>
  );
}

export const ErrorState = React.memo(ErrorStateComponent);
