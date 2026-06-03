import React, { useEffect } from 'react';
import {
  Text,
  StyleSheet,
  Modal,
  Pressable,
} from 'react-native';
import Animated, {
  useSharedValue,
  useAnimatedStyle,
  withTiming,
  withDelay,
  Easing,
} from 'react-native-reanimated';
import { Ionicons } from '@expo/vector-icons';
import { colors, fonts, spacing, radius } from '@/constants/theme';

interface SuccessModalProps {
  visible: boolean;
  articleTitle: string;
  onViewArticle: () => void;
  onReturnHome: () => void;
}

export default function SuccessModal({
  visible,
  articleTitle,
  onViewArticle,
  onReturnHome,
}: SuccessModalProps) {
  const scale = useSharedValue(0.8);
  const opacity = useSharedValue(0);
  const checkScale = useSharedValue(0);

  useEffect(() => {
    if (visible) {
      opacity.value = withTiming(1, { duration: 200 });
      scale.value = withTiming(1, { duration: 400, easing: Easing.out(Easing.ease) });
      checkScale.value = withDelay(
        200,
        withTiming(1, { duration: 400, easing: Easing.out(Easing.ease) }),
      );
    } else {
      opacity.value = 0;
      scale.value = 0.8;
      checkScale.value = 0;
    }
  }, [visible]);

  const overlayStyle = useAnimatedStyle(() => ({
    opacity: opacity.value,
  }));

  const cardStyle = useAnimatedStyle(() => ({
    transform: [{ scale: scale.value }],
    opacity: opacity.value,
  }));

  const checkStyle = useAnimatedStyle(() => ({
    transform: [{ scale: checkScale.value }],
  }));

  return (
    <Modal
      visible={visible}
      transparent
      animationType="none"
      statusBarTranslucent
      onRequestClose={onReturnHome}
    >
      <Animated.View style={[styles.overlay, overlayStyle]}>
        <Animated.View style={[styles.card, cardStyle]}>
          {/* Checkmark */}
          <Animated.View style={[styles.checkCircle, checkStyle]}>
            <Ionicons name="checkmark" size={28} color={colors.white} />
          </Animated.View>

          {/* Title */}
          <Text style={styles.title}>Annonce publiée</Text>

          {/* Description */}
          <Text style={styles.description}>
            Ton {articleTitle ? articleTitle.toLowerCase() : 'article'} est
            maintenant visible par tous les acheteurs.
          </Text>

          {/* Primary CTA */}
          <Pressable
            style={({ pressed }) => [styles.primaryButton, pressed && { opacity: 0.85 }]}
            onPress={onViewArticle}
          >
            <Text style={styles.primaryButtonText}>VOIR MON ANNONCE</Text>
          </Pressable>

          {/* Secondary CTA */}
          <Pressable
            style={({ pressed }) => [styles.secondaryButton, pressed && { opacity: 0.7 }]}
            onPress={onReturnHome}
          >
            <Text style={styles.secondaryButtonText}>
              Retour à l'accueil
            </Text>
          </Pressable>
        </Animated.View>
      </Animated.View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  overlay: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: 'rgba(15, 14, 12, 0.85)',
    paddingHorizontal: spacing.lg,
  },
  card: {
    backgroundColor: colors.cream,
    borderRadius: 4,
    paddingHorizontal: 32,
    paddingTop: 40,
    paddingBottom: 32,
    width: '100%',
    maxWidth: 340,
    alignItems: 'center',
  },
  checkCircle: {
    width: 56,
    height: 56,
    borderRadius: 28,
    backgroundColor: colors.sage,
    justifyContent: 'center',
    alignItems: 'center',
    marginBottom: 16,
  },
  title: {
    fontFamily: fonts.display,
    fontSize: 28,
    color: colors.charcoal,
    marginBottom: 8,
    textAlign: 'center',
  },
  description: {
    fontFamily: fonts.sans,
    fontSize: 13,
    lineHeight: 22,
    color: colors.muted,
    textAlign: 'center',
    marginBottom: 24,
  },
  primaryButton: {
    width: '100%',
    backgroundColor: colors.charcoal,
    paddingVertical: 16,
    borderRadius: radius.md,
    alignItems: 'center',
    marginBottom: 10,
  },
  primaryButtonText: {
    fontFamily: fonts.sansMedium,
    fontSize: 12,
    letterSpacing: 2.16,
    color: colors.cream,
    textTransform: 'uppercase',
  },
  secondaryButton: {
    width: '100%',
    paddingVertical: 14,
    alignItems: 'center',
  },
  secondaryButtonText: {
    fontFamily: fonts.sans,
    fontSize: 12,
    color: colors.muted,
    letterSpacing: 0.72,
  },
});
