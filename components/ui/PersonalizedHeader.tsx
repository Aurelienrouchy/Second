/**
 * PersonalizedHeader Component
 * Design inspired by Fitmuse - Premium fashion app aesthetic
 *
 * Features:
 * - Avatar with user greeting
 * - Personalized subtitle
 * - Notification bell with badge
 */

import { Ionicons } from '@expo/vector-icons';
import * as Haptics from 'expo-haptics';
import { router } from 'expo-router';
import React, { useCallback } from 'react';
import {
  Pressable,
  StyleSheet,
  Text,
  View,
  ViewStyle,
} from 'react-native';
import Animated, {
  FadeIn,
  useAnimatedStyle,
  useSharedValue,
  withSpring,
} from 'react-native-reanimated';

import { colors, spacing, typography, animations, sizing } from '@/constants/theme';
import { Avatar } from './Avatar';

// =============================================================================
// TYPES
// =============================================================================

interface PersonalizedHeaderProps {
  userName?: string | null;
  userAvatar?: string | null;
  subtitle?: string;
  notificationCount?: number;
  onNotificationPress?: () => void;
  style?: ViewStyle;
  testID?: string;
}

// =============================================================================
// ANIMATED PRESSABLE
// =============================================================================

const AnimatedPressable = Animated.createAnimatedComponent(Pressable);

// =============================================================================
// NOTIFICATION BUTTON
// =============================================================================

interface NotificationButtonProps {
  count?: number;
  onPress?: () => void;
}

const NotificationButton: React.FC<NotificationButtonProps> = ({ count = 0, onPress }) => {
  const scale = useSharedValue(1);

  const animatedStyle = useAnimatedStyle(() => ({
    transform: [{ scale: scale.value }],
  }));

  const handlePressIn = useCallback(() => {
    scale.value = withSpring(0.9, animations.spring.snappy);
  }, [scale]);

  const handlePressOut = useCallback(() => {
    scale.value = withSpring(1, animations.spring.bouncy);
  }, [scale]);

  const handlePress = useCallback(() => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    if (onPress) {
      onPress();
    } else {
      router.push('/notifications' as any);
    }
  }, [onPress]);

  return (
    <AnimatedPressable
      style={[styles.notificationButton, animatedStyle]}
      onPressIn={handlePressIn}
      onPressOut={handlePressOut}
      onPress={handlePress}
      accessibilityLabel="Notifications"
    >
      <Ionicons name="notifications-outline" size={22} color={colors.foreground} />
      {count > 0 && (
        <View style={styles.badge}>
          <Text style={styles.badgeText}>{count > 9 ? '9+' : count}</Text>
        </View>
      )}
    </AnimatedPressable>
  );
};

// =============================================================================
// GREETING HELPERS
// =============================================================================

const getGreeting = (): string => {
  const hour = new Date().getHours();
  if (hour < 12) return 'Bonjour';
  if (hour < 18) return 'Bon après-midi';
  return 'Bonsoir';
};

const getDefaultSubtitle = (): string => {
  const subtitles = [
    'Trouve ta prochaine pépite',
    'Des trésors t\'attendent',
    'Prête pour de belles trouvailles ?',
    'Explore les nouveautés',
  ];
  // Use day of year to get consistent but varied subtitle
  const dayOfYear = Math.floor((Date.now() - new Date(new Date().getFullYear(), 0, 0).getTime()) / 86400000);
  return subtitles[dayOfYear % subtitles.length];
};

// =============================================================================
// COMPONENT
// =============================================================================

export const PersonalizedHeader: React.FC<PersonalizedHeaderProps> = ({
  userName,
  userAvatar,
  subtitle,
  notificationCount = 0,
  onNotificationPress,
  style,
  testID,
}) => {
  const greeting = getGreeting();
  const displayName = userName?.split(' ')[0] || 'toi';
  const displaySubtitle = subtitle || getDefaultSubtitle();

  return (
    <Animated.View
      entering={FadeIn.duration(300)}
      style={[styles.container, style]}
      testID={testID}
    >
      <View style={styles.leftSection}>
        <Avatar
          source={userAvatar}
          name={userName || undefined}
          size="md"
          testID="header-avatar"
        />
        <View style={styles.textContainer}>
          <Text style={styles.greeting}>
            {greeting}, <Text style={styles.name}>{displayName}</Text>
          </Text>
          <Text style={styles.subtitle} numberOfLines={1}>
            {displaySubtitle}
          </Text>
        </View>
      </View>

      <NotificationButton
        count={notificationCount}
        onPress={onNotificationPress}
      />
    </Animated.View>
  );
};

// =============================================================================
// STYLES
// =============================================================================

const styles = StyleSheet.create({
  container: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
  },
  leftSection: {
    flexDirection: 'row',
    alignItems: 'center',
    flex: 1,
  },
  textContainer: {
    marginLeft: spacing.sm,
    flex: 1,
  },
  greeting: {
    fontFamily: typography.body.fontFamily,
    fontSize: 16,
    color: colors.foreground,
  },
  name: {
    fontFamily: typography.label.fontFamily,
    fontWeight: '600',
  },
  subtitle: {
    fontFamily: typography.bodySmall.fontFamily,
    fontSize: typography.bodySmall.fontSize,
    color: colors.muted,
    marginTop: 2,
  },
  notificationButton: {
    width: 44,
    height: 44,
    borderRadius: 22,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: colors.borderLight,
  },
  badge: {
    position: 'absolute',
    top: 6,
    right: 6,
    minWidth: 18,
    height: 18,
    borderRadius: 9,
    backgroundColor: colors.danger,
    justifyContent: 'center',
    alignItems: 'center',
    paddingHorizontal: 4,
  },
  badgeText: {
    fontFamily: typography.caption.fontFamily,
    fontSize: 10,
    fontWeight: '700',
    color: colors.white,
  },
});

export default PersonalizedHeader;
