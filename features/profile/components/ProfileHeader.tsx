/**
 * ProfileHeader — avatar, name, handle, member since, bio, and stats.
 * Extracted from profile screen.
 */

import React, { useMemo } from 'react';
import { StyleSheet, View } from 'react-native';
import Animated, { FadeInDown } from 'react-native-reanimated';

import { Avatar, Text } from '@/components/ui';
import { colors, fonts, spacing } from '@/constants/theme';
import { formatDisplayName } from '@/utils/formatName';

import { ProfileStats } from './ProfileStats';

// =============================================================================
// TYPES
// =============================================================================

interface ProfileHeaderProps {
  profileImage: string | undefined;
  displayName: string | undefined;
  bio: string | undefined;
  createdAt: Date | string | undefined;
  articlesCount: number;
  salesCount: number;
  rating: number | null | undefined;
  followersCount: number;
}

// =============================================================================
// PROFILE HEADER
// =============================================================================

const ProfileHeader = React.memo(function ProfileHeader({
  profileImage,
  displayName,
  bio,
  createdAt,
  articlesCount,
  salesCount,
  rating,
  followersCount,
}: ProfileHeaderProps) {
  const memberSince = useMemo(() => {
    if (!createdAt) return '';
    const date = createdAt instanceof Date ? createdAt : new Date(createdAt);
    return `Membre depuis ${date.toLocaleDateString('fr-FR', {
      month: 'long',
      year: 'numeric',
    })}`;
  }, [createdAt]);

  return (
    <>
      {/* Avatar + Info */}
      <Animated.View
        entering={FadeInDown.duration(400)}
        style={styles.avatarSection}
      >
        <Avatar
          source={profileImage}
          name={displayName || 'U'}
          size="xxl"
        />
        <View style={styles.nameSection}>
          <Text style={styles.userName}>
            {formatDisplayName(displayName)}
          </Text>
          {displayName && (
            <Text style={styles.userHandle}>
              @{displayName.toLowerCase().replace(/\s+/g, '.')}
            </Text>
          )}
          <Text style={styles.memberSince}>{memberSince}</Text>
        </View>
      </Animated.View>

      {/* Bio */}
      {bio ? (
        <Animated.View entering={FadeInDown.duration(400).delay(50)}>
          <Text style={styles.bio}>{bio}</Text>
        </Animated.View>
      ) : null}

      {/* Stats */}
      <ProfileStats
        articlesCount={articlesCount}
        salesCount={salesCount}
        rating={rating}
        followersCount={followersCount}
      />
    </>
  );
});

export { ProfileHeader };

// =============================================================================
// STYLES
// =============================================================================

const styles = StyleSheet.create({
  avatarSection: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    marginBottom: spacing.md,
  },
  nameSection: {
    flex: 1,
  },
  userName: {
    fontFamily: fonts.displayMedium,
    fontSize: 22,
    lineHeight: 28,
    color: colors.charcoal,
  },
  userHandle: {
    fontFamily: fonts.sans,
    fontSize: 13,
    lineHeight: 18,
    color: colors.muted,
    marginTop: 2,
  },
  memberSince: {
    fontFamily: fonts.sans,
    fontSize: 11,
    lineHeight: 15,
    color: colors.muted,
    marginTop: spacing.xs,
  },
  bio: {
    fontFamily: fonts.sans,
    fontSize: 13,
    lineHeight: 20,
    color: colors.charcoal,
    marginBottom: spacing.md,
  },
});
