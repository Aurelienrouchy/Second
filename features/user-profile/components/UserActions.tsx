/**
 * UserActions — Contact + Follow action buttons for the profile.
 */

import { Ionicons } from '@expo/vector-icons';
import React from 'react';
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from 'react-native';
import Animated, { FadeInDown } from 'react-native-reanimated';

import { colors, fonts, radius, spacing } from '@/constants/theme';

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
          <ActivityIndicator size="small" color={colors.cream} />
        ) : (
          <>
            <Ionicons name="chatbubble-outline" size={14} color={colors.cream} />
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
          color={isFollowing ? colors.sage : colors.charcoal}
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
    flex: 1,
    flexDirection: 'row',
    backgroundColor: colors.charcoal,
    paddingVertical: 14,
    borderRadius: radius.sm,
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.sm,
  },
  contactButtonText: {
    fontFamily: fonts.sansMedium,
    fontSize: 11,
    lineHeight: 15,
    letterSpacing: 2.16,
    color: colors.cream,
    textTransform: 'uppercase',
  },
  followButton: {
    flex: 1,
    flexDirection: 'row',
    backgroundColor: colors.white,
    paddingVertical: 14,
    borderRadius: radius.sm,
    borderWidth: 1,
    borderColor: colors.borderStrong,
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.sm,
  },
  followButtonActive: {
    backgroundColor: colors.sageLight,
    borderColor: colors.sage,
  },
  followButtonText: {
    fontFamily: fonts.sansMedium,
    fontSize: 11,
    lineHeight: 15,
    letterSpacing: 2.16,
    color: colors.charcoal,
    textTransform: 'uppercase',
  },
  followButtonTextActive: {
    color: colors.sage,
  },
});
