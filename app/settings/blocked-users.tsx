/**
 * Blocked Users Settings
 */

import { useUser } from '@/hooks/useAuth';
import { BlockedUser, ModerationService } from '@/services/moderationService';
import { APP_LOCALE } from '@/constants/locale';
import { colors, fonts, spacing, radius, sizing } from '@/constants/theme';
import { Text, Caption, ScreenHeader } from '@/components/ui';
import { Button } from '@/components/ui';
import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import React, { useCallback, useState } from 'react';
import {
  Alert,
  StyleSheet,
  View,
} from 'react-native';
import { FlashList } from '@shopify/flash-list';
import { formatDisplayName } from '@/utils/formatName';
import { Skeleton, SkeletonAvatar } from '@/components/ui/Skeleton';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useUserProfile } from '@/hooks/useUserProfile';

const keyExtractor = (item: BlockedUser) => item.blockedUserId;

/**
 * Resolve the blocked user's display name LIVE from the immutable
 * `blockedUserId`, instead of the `blockedUserName` snapshot frozen at block
 * time. Falls back to the snapshot while the live profile loads.
 */
interface BlockedUserRowProps {
  item: BlockedUser;
  unblocking: string | null;
  onUnblock: (blockedUser: BlockedUser) => void;
}

const BlockedUserRow = React.memo(function BlockedUserRow({
  item,
  unblocking,
  onUnblock,
}: BlockedUserRowProps) {
  const { data: profile } = useUserProfile(item.blockedUserId);
  const displayName = profile?.displayName || item.blockedUserName;

  return (
    <View style={styles.userItem}>
      <View style={styles.userInfo}>
        <View style={styles.avatar}>
          <Ionicons name="person" size={24} color={colors.muted} />
        </View>
        <View style={styles.userText}>
          <Text variant="body" style={styles.userName}>{formatDisplayName(displayName)}</Text>
          <Caption>Bloqué le {formatDate(item.blockedAt)}</Caption>
        </View>
      </View>
      <Button
        variant="secondary"
        size="small"
        loading={unblocking === item.blockedUserId}
        onPress={() => onUnblock(item)}
        style={styles.unblockButton}
      >
        Débloquer
      </Button>
    </View>
  );
});

const formatDate = (date: Date) => {
  return date.toLocaleDateString(APP_LOCALE, {
    day: 'numeric',
    month: 'long',
    year: 'numeric',
  });
};

export default function BlockedUsersScreen() {
  const router = useRouter();
  const user = useUser();
  const queryClient = useQueryClient();
  const [unblocking, setUnblocking] = useState<string | null>(null);

  const { data: blockedUsers = [], isLoading: loading } = useQuery({
    queryKey: ['blockedUsers', user?.id],
    queryFn: () => ModerationService.getBlockedUsers(user!.id),
    enabled: !!user?.id,
    staleTime: 10 * 60 * 1000,
  });

  const { mutate: performUnblock } = useMutation({
    mutationFn: (blockedUserId: string) =>
      ModerationService.unblockUser(user!.id, blockedUserId),
    onMutate: (blockedUserId: string) => {
      setUnblocking(blockedUserId);
    },
    onSuccess: (_data, blockedUserId) => {
      queryClient.setQueryData(
        ['blockedUsers', user?.id],
        (old: BlockedUser[] | undefined) =>
          (old ?? []).filter((u) => u.blockedUserId !== blockedUserId)
      );
      setUnblocking(null);
    },
    onError: (error: Error) => {
      Alert.alert('Erreur', error.message || 'Une erreur est survenue');
      setUnblocking(null);
    },
  });

  const handleUnblock = useCallback((blockedUser: BlockedUser) => {
    if (!user) return;

    Alert.alert(
      'Débloquer',
      `Voulez-vous débloquer ${blockedUser.blockedUserName} ?`,
      [
        { text: 'Annuler', style: 'cancel' },
        {
          text: 'Débloquer',
          onPress: () => performUnblock(blockedUser.blockedUserId),
        },
      ]
    );
  }, [user, performUnblock]);

  const renderItem = useCallback(({ item }: { item: BlockedUser }) => (
    <BlockedUserRow item={item} unblocking={unblocking} onUnblock={handleUnblock} />
  ), [unblocking, handleUnblock]);

  const renderEmpty = () => (
    <View style={styles.emptyContainer}>
      <View style={styles.emptyIconContainer}>
        <Ionicons name="people-outline" size={64} color={colors.muted} />
      </View>
      <Text variant="h3" style={styles.emptyTitle}>Aucun utilisateur bloqué</Text>
      <Caption style={styles.emptyText}>
        Vous n'avez bloqué aucun utilisateur pour le moment.
      </Caption>
    </View>
  );

  return (
    <View style={styles.container}>
      <ScreenHeader title="Utilisateurs bloqués" onBack={() => router.back()} />

      {loading ? (
        <View style={styles.skeletonContainer}>
          {[0, 1, 2, 3].map((i) => (
            <View key={i} style={styles.skeletonRow}>
              <SkeletonAvatar size={sizing.avatarMD} />
              <View style={styles.skeletonRowText}>
                <Skeleton width="50%" height={14} />
                <Skeleton width="35%" height={12} style={{ marginTop: spacing.xs }} />
              </View>
              <Skeleton width={90} height={36} borderRadius={radius.md} />
            </View>
          ))}
        </View>
      ) : (
        <FlashList
          data={blockedUsers}
          keyExtractor={keyExtractor}
          renderItem={renderItem}
          ListEmptyComponent={renderEmpty}
          ListFooterComponent={
            blockedUsers.length > 0 ? (
              <View style={styles.infoBox}>
                <Ionicons name="information-circle" size={20} color={colors.foregroundSecondary} />
                <Text variant="bodySmall" style={styles.infoText}>
                  Les utilisateurs bloqués ne peuvent plus vous contacter ni voir vos articles.
                </Text>
              </View>
            ) : null
          }
          contentContainerStyle={
            blockedUsers.length === 0 ? styles.emptyList : styles.list
          }
        />
      )}

      {blockedUsers.length === 0 && !loading && (
        <View style={styles.bottomInfoBox}>
          <Ionicons name="shield-checkmark" size={20} color={colors.primary} />
          <Text variant="bodySmall" style={styles.bottomInfoText}>
            Vous pouvez bloquer un utilisateur depuis son profil ou depuis une conversation.
          </Text>
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.background,
  },
  skeletonContainer: {
    padding: spacing.md,
    gap: spacing.sm,
  },
  skeletonRow: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: colors.surface,
    borderRadius: radius.md,
    padding: spacing.md,
    borderWidth: 1,
    borderColor: colors.borderLight,
    gap: spacing.md,
  },
  skeletonRowText: {
    flex: 1,
  },
  list: {
    padding: spacing.md,
  },
  emptyList: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    padding: spacing.lg,
  },
  userItem: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    backgroundColor: colors.surface,
    borderRadius: radius.md,
    padding: spacing.md,
    marginBottom: spacing.sm,
    borderWidth: 1,
    borderColor: colors.borderLight,
  },
  userInfo: {
    flexDirection: 'row',
    alignItems: 'center',
    flex: 1,
  },
  avatar: {
    width: sizing.avatarMD,
    height: sizing.avatarMD,
    borderRadius: sizing.avatarMD / 2,
    backgroundColor: colors.borderLight,
    justifyContent: 'center',
    alignItems: 'center',
  },
  userText: {
    marginLeft: spacing.md,
    flex: 1,
  },
  userName: {
    fontFamily: fonts.sansMedium,
    marginBottom: 2,
  },
  unblockButton: {
    minWidth: 90,
  },
  emptyContainer: {
    alignItems: 'center',
    padding: spacing.lg,
  },
  emptyIconContainer: {
    width: 120,
    height: 120,
    borderRadius: 60,
    backgroundColor: colors.borderLight,
    justifyContent: 'center',
    alignItems: 'center',
    marginBottom: spacing.lg,
  },
  emptyTitle: {
    color: colors.foreground,
    marginBottom: spacing.sm,
    textAlign: 'center',
  },
  emptyText: {
    textAlign: 'center',
    color: colors.foregroundSecondary,
    lineHeight: 20,
  },
  infoBox: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    backgroundColor: colors.surface,
    padding: spacing.md,
    marginTop: spacing.md,
    borderRadius: radius.sm,
    borderWidth: 1,
    borderColor: colors.borderLight,
    gap: spacing.sm,
  },
  infoText: {
    flex: 1,
    color: colors.foregroundSecondary,
    lineHeight: 18,
  },
  bottomInfoBox: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    backgroundColor: colors.primaryLight,
    padding: spacing.md,
    margin: spacing.md,
    borderRadius: radius.sm,
    gap: spacing.sm,
  },
  bottomInfoText: {
    flex: 1,
    color: colors.foreground,
    lineHeight: 18,
  },
});
