import { useNotifications } from '@/contexts/NotificationContext';
import { colors, fonts, radius } from '@/constants/theme';
import { Ionicons } from '@expo/vector-icons';
import { router } from 'expo-router';
import React from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';

interface NotificationBellIconProps {
  size?: number;
  color?: string;
  showBadge?: boolean;
}

/**
 * Bell icon with notification badge
 * Tapping navigates to the notifications screen
 */
export function NotificationBellIcon({
  size = 24,
  color = colors.foreground,
  showBadge = true,
}: NotificationBellIconProps) {
  const { notificationCount } = useNotifications();

  const handlePress = () => {
    router.push('/notifications' as any);
  };

  const displayCount = notificationCount > 99 ? '99+' : notificationCount.toString();

  return (
    <Pressable
      onPress={handlePress}
      style={({ pressed }) => [
        styles.container,
        pressed && styles.pressed,
      ]}
      hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
    >
      <Ionicons name="notifications-outline" size={size} color={color} />

      {showBadge && notificationCount > 0 && (
        <View style={styles.badge}>
          <Text style={styles.badgeText}>{displayCount}</Text>
        </View>
      )}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  container: {
    position: 'relative',
    padding: 4,
  },
  pressed: {
    opacity: 0.7,
  },
  badge: {
    position: 'absolute',
    top: 0,
    right: 0,
    backgroundColor: colors.danger,
    borderRadius: radius.full,
    minWidth: 18,
    height: 18,
    paddingHorizontal: 4,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 2,
    borderColor: colors.surface,
  },
  badgeText: {
    color: colors.white,
    fontSize: 10,
    fontFamily: fonts.sansBold,
    textAlign: 'center',
  },
});

export default NotificationBellIcon;
