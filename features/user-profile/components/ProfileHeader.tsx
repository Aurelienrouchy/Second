/**
 * ProfileHeader — Avatar, name, handle, bio, style tags, and stats row.
 */

import { Ionicons } from '@expo/vector-icons';
import React, { useMemo } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import Animated, { FadeInDown } from 'react-native-reanimated';

import { Avatar } from '@/components/ui';
import { colors, fonts, spacing } from '@/constants/theme';
import { UserStats } from '@/services/userStatsService';
import { User } from '@/types';
import { formatDisplayName } from '@/utils/formatName';

import { StatItem } from './StatItem';
import { StyleTag } from './StyleTag';

interface ProfileHeaderProps {
  user: User;
  stats: UserStats | null;
}

export const ProfileHeader = React.memo(function ProfileHeader({
  user,
  stats,
}: ProfileHeaderProps) {
  const memberSince = useMemo(() => {
    if (!user.createdAt) return '';
    const date =
      user.createdAt instanceof Date
        ? user.createdAt
        : new Date(user.createdAt);
    return `Membre depuis ${date.toLocaleDateString('fr-FR', {
      month: 'long',
      year: 'numeric',
    })}`;
  }, [user.createdAt]);

  const userHandle = useMemo(() => {
    if (!user.displayName) return '';
    return `@${user.displayName.toLowerCase().replace(/\s+/g, '.')}`;
  }, [user.displayName]);

  const locationLabel = user.address?.city ?? null;

  return (
    <View style={styles.profileHeaderZone}>
      {/* Avatar + Info */}
      <Animated.View
        entering={FadeInDown.duration(400)}
        style={styles.avatarSection}
      >
        <Avatar
          source={user.profileImage}
          name={user.displayName || 'U'}
          size="xxl"
        />
        <View style={styles.nameSection}>
          <Text style={styles.userName}>
            {formatDisplayName(user.displayName)}
          </Text>
          {userHandle ? (
            <Text style={styles.userHandle}>{userHandle}</Text>
          ) : null}
          <View style={styles.metaRow}>
            <Ionicons name="time-outline" size={12} color={colors.muted} />
            <Text style={styles.metaText}>{memberSince}</Text>
          </View>
          {locationLabel && (
            <View style={styles.metaRow}>
              <Ionicons name="location-outline" size={12} color={colors.muted} />
              <Text style={styles.metaText}>{locationLabel}</Text>
            </View>
          )}
        </View>
      </Animated.View>

      {/* Bio */}
      {user.bio ? (
        <Animated.View entering={FadeInDown.duration(400).delay(50)}>
          <Text style={styles.bio}>{user.bio}</Text>
        </Animated.View>
      ) : null}

      {/* Style Tags */}
      {user.styleProfile?.styleTags && user.styleProfile.styleTags.length > 0 && (
        <Animated.View
          entering={FadeInDown.duration(400).delay(80)}
          style={styles.styleTagsRow}
        >
          {user.styleProfile.styleTags.slice(0, 5).map((tag) => (
            <StyleTag key={tag} tag={tag} />
          ))}
        </Animated.View>
      )}

      {/* Stats Row */}
      <View style={styles.statsRow}>
        <StatItem
          value={stats?.articlesEnVente ?? 0}
          label="Articles"
          delay={100}
        />
        <View style={styles.statDivider} />
        <StatItem
          value={stats?.articlesVendus ?? 0}
          label="Ventes"
          delay={150}
        />
        <View style={styles.statDivider} />
        <StatItem
          value={stats?.moyenneNote ? stats.moyenneNote.toFixed(1) : '—'}
          label="Note"
          delay={200}
        />
        <View style={styles.statDivider} />
        <StatItem
          value={user.sellerLikesCount ?? 0}
          label="Abonnes"
          delay={250}
        />
      </View>
    </View>
  );
});

const styles = StyleSheet.create({
  profileHeaderZone: {
    backgroundColor: colors.cream,
    paddingHorizontal: spacing.lg,
    paddingBottom: spacing.lg,
  },
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
  statsRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: spacing.md,
    borderTopWidth: 1,
    borderTopColor: colors.border,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  statDivider: {
    width: 1,
    height: 28,
    backgroundColor: colors.border,
  },
});
