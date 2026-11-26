/**
 * UserActions — Contact + Follow action buttons for the profile.
 */

import { Ionicons } from '@expo/vector-icons';
import React from 'react';
import { ActivityIndicator, Pressable, StyleSheet, Text } from 'react-native';
import Animated, { FadeInDown } from 'react-native-reanimated';

import { colors, components, spacing } from '@/constants/theme';

interface UserActionsProps {
  isFollowing: boolean;
  isContactLoading: boolean;
  isFollowLoading?: boolean;
  onContact: () => void;
  onFollow: () => void;
}

export const UserActions = React.memo(function UserActions({
  isFollowing,
  isContactLoading,
  isFollowLoading = false,
  onContact,
  onFollow,
}: UserActionsProps) {
  return (
    <Animated.View
      entering={FadeInDown.duration(400).delay(300)}
      style={styles.actionsRow}
    >
      <Pressable
        testID="profile-contact-button"
        style={styles.contactButton}
        onPress={onContact}
        disabled={isContactLoading}
      >
        {isContactLoading ? (
          <ActivityIndicator size="small" color={colors.foreground} />
        ) : (
          <>
            <Ionicons name="chatbubble-outline" size={14} color={colors.foreground} />
            <Text style={styles.contactButtonText}>CONTACTER</Text>
          </>
        )}
      </Pressable>
      <Pressable
        testID="profile-follow-button"
        style={[
          styles.followButton,
          isFollowing && styles.followButtonActive,
        ]}
        onPress={onFollow}
        disabled={isFollowLoading}
      >
        <Ionicons
          name={isFollowing ? 'checkmark' : 'add'}
          size={14}
          color={colors.foreground}
        />
        <Text
          style={[
            styles.followButtonText,
            isFollowing && styles.followButtonTextActive,
          ]}
        >
          {isFollowing ? 'ABONNÉ' : "S'ABONNER"}
        </Text>
      </Pressable>
    </Animated.View>
  );
});

const styles = StyleSheet.create({
  actionsRow: {
    flexDirection: 'row',
    gap: spacing.sm,
    paddingTop: spacing.md,
    paddingBottom: spacing.lg,
    paddingHorizontal: spacing.lg,
    backgroundColor: colors.cream,
  },
  contactButton: {
    ...components.button.container,
    ...components.button.primary,
    flex: 1,
    paddingHorizontal: spacing.sm,
  },
  contactButtonText: {
    ...components.button.label,
    ...components.button.primaryLabel,
    ...components.button.smallLabel,
  },
  followButton: {
    ...components.button.container,
    ...components.button.secondary,
    flex: 1,
    paddingHorizontal: spacing.sm,
  },
  followButtonActive: {
    borderColor: colors.sage,
  },
  followButtonText: {
    ...components.button.label,
    ...components.button.secondaryLabel,
    ...components.button.smallLabel,
  },
  followButtonTextActive: {
    color: colors.foreground,
  },
});
