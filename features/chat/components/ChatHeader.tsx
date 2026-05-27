import { Ionicons } from '@expo/vector-icons';
import { Image } from 'expo-image';
import { useRouter } from 'expo-router';
import React from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { colors, fonts, radius, spacing } from '@/constants/theme';
import { formatDisplayName } from '@/utils/formatName';
import { formatPrice } from '@/utils/formatPrice';
import type { ChatHeaderProps } from '../types';

export const ChatHeader = React.memo(function ChatHeader({
  otherParticipant,
  otherAvatar,
  articlePrice,
  onMoreOptions,
}: ChatHeaderProps) {
  const router = useRouter();

  return (
    <View style={styles.header}>
      <Pressable onPress={() => router.back()} style={styles.headerButton}>
        <Ionicons name="arrow-back" size={20} color={colors.charcoal} />
      </Pressable>

      <Pressable
        style={styles.headerCenter}
        onPress={() => {
          if (otherParticipant?.userId) {
            router.push(`/user/${otherParticipant.userId}`);
          }
        }}
      >
        {otherParticipant && (
          <>
            {otherAvatar ? (
              <Image
                source={{ uri: otherAvatar }}
                style={styles.headerAvatar}
                contentFit="cover"
              />
            ) : (
              <View style={[styles.headerAvatar, styles.headerAvatarPlaceholder]}>
                <Ionicons name="person" size={18} color={colors.muted} />
              </View>
            )}
            <View style={styles.headerInfo}>
              <Text style={styles.headerTitle} numberOfLines={1}>
                {formatDisplayName(otherParticipant.userName)}
              </Text>
              {articlePrice != null && (
                <Text style={styles.headerSubtitle} numberOfLines={1}>
                  {formatPrice(articlePrice)}
                </Text>
              )}
            </View>
          </>
        )}
      </Pressable>

      <Pressable style={styles.headerButton} onPress={onMoreOptions}>
        <Ionicons name="ellipsis-horizontal" size={20} color={colors.charcoal} />
      </Pressable>
    </View>
  );
});

const styles = StyleSheet.create({
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.md,
    backgroundColor: colors.surfaceWarm,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  headerButton: {
    width: 36,
    height: 36,
    borderRadius: radius.full,
    justifyContent: 'center',
    alignItems: 'center',
    borderWidth: 1,
    borderColor: colors.borderStrong,
  },
  headerCenter: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    marginHorizontal: spacing.md,
  },
  headerAvatar: {
    width: 36,
    height: 36,
    borderRadius: radius.full,
    backgroundColor: colors.background,
    marginRight: spacing.md,
  },
  headerAvatarPlaceholder: {
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.surfaceWarm,
  },
  headerInfo: {
    flex: 1,
  },
  headerTitle: {
    fontFamily: fonts.sansMedium,
    fontSize: 14,
    color: colors.foreground,
  },
  headerSubtitle: {
    fontFamily: fonts.sans,
    fontSize: 11,
    color: colors.muted,
    marginTop: 2,
  },
});
