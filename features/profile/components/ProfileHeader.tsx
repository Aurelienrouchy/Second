/**
 * ProfileHeader — avatar, name, handle, member since, bio, and stats.
 * Extracted from profile screen.
 */

import { Ionicons } from '@expo/vector-icons';
import React, { useMemo } from 'react';
import { StyleSheet, View } from 'react-native';
import Animated, { FadeInDown } from 'react-native-reanimated';

import { Avatar, Text } from '@/components/ui';
import { APP_LOCALE } from '@/constants/locale';
import { colors, fonts, radius, spacing } from '@/constants/theme';
import { formatDisplayName } from '@/utils/formatName';

import { ProfileStats } from './ProfileStats';

// =============================================================================
// TYPES
// =============================================================================

interface ProfileHeaderProps {
  profileImage: string | undefined;
  displayName: string | undefined;
  username: string | undefined;
  bio: string | undefined;
  createdAt: Date | string | undefined;
  city: string | undefined;
  styleTags: string[] | undefined;
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
  city,
  styleTags,
  articlesCount,
  salesCount,
  rating,
  followersCount,
}: ProfileHeaderProps) {
  const memberSince = useMemo(() => {
    if (!createdAt) return '';
    const date = createdAt instanceof Date ? createdAt : new Date(createdAt);
    return `Membre depuis ${date.toLocaleDateString(APP_LOCALE, {
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
          <View style={styles.metaRow}>
            <Ionicons name="time-outline" size={12} color={colors.muted} />
            <Text style={styles.metaText}>{memberSince}</Text>
          </View>
          {city ? (
            <View style={styles.metaRow}>
              <Ionicons name="location-outline" size={12} color={colors.muted} />
              <Text style={styles.metaText}>{city}</Text>
            </View>
          ) : null}
        </View>
      </Animated.View>

      {/* Bio */}
      {bio ? (
        <Animated.View entering={FadeInDown.duration(400).delay(50)}>
          <Text style={styles.bio}>{bio}</Text>
        </Animated.View>
      ) : null}

      {/* Style Tags */}
      {styleTags && styleTags.length > 0 ? (
        <Animated.View
          entering={FadeInDown.duration(400).delay(80)}
          style={styles.styleTagsRow}
        >
          {styleTags.slice(0, 5).map((tag) => (
            <View key={tag} style={styles.styleTag}>
              <Text style={styles.styleTagText}>{tag}</Text>
            </View>
          ))}
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
  metaRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    marginTop: spacing.xs,
  },
  metaText: {
    fontFamily: fonts.sans,
    fontSize: 11,
    lineHeight: 15,
    color: colors.muted,
  },
  bio: {
    fontFamily: fonts.sans,
    fontSize: 13,
    lineHeight: 20,
    color: colors.charcoal,
    marginBottom: spacing.md,
  },
  styleTagsRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.sm,
    marginBottom: spacing.md,
  },
  styleTag: {
    backgroundColor: colors.white,
    paddingHorizontal: spacing.sm + 4,
    paddingVertical: spacing.xs + 2,
    borderRadius: radius.xs,
    borderWidth: 1,
    borderColor: colors.border,
  },
  styleTagText: {
    fontFamily: fonts.sansMedium,
    fontSize: 11,
    lineHeight: 15,
    color: colors.charcoal,
    letterSpacing: 0.3,
  },
});
