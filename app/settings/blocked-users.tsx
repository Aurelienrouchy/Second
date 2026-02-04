/**
 * Blocked Users Settings
 * Design System: Luxe Français + Street Energy
 */

import { useAuth } from '@/contexts/AuthContext';
import { BlockedUser, ModerationService } from '@/services/moderationService';
import { colors, fonts, spacing, radius, sizing } from '@/constants/theme';
import { Text, Caption } from '@/components/ui';
import { Button } from '@/components/ui';
import { Ionicons } from '@expo/vector-icons';
import { Stack } from 'expo-router';
import React, { useCallback, useEffect, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  FlatList,
  StyleSheet,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

export default function BlockedUsersScreen() {
  const { user } = useAuth();
  const [blockedUsers, setBlockedUsers] = useState<BlockedUser[]>([]);
  const [loading, setLoading] = useState(true);
  const [unblocking, setUnblocking] = useState<string | null>(null);

  const loadBlockedUsers = useCallback(async () => {
    if (!user) return;

    try {
      setLoading(true);
      const users = await ModerationService.getBlockedUsers(user.id);
      setBlockedUsers(users);
    } catch (error) {
      console.error('Error loading blocked users:', error);
    } finally {
      setLoading(false);
    }
  }, [user]);

  useEffect(() => {
    loadBlockedUsers();
  }, [loadBlockedUsers]);

  const handleUnblock = async (blockedUser: BlockedUser) => {
    if (!user) return;

    Alert.alert(
      'Débloquer',
      `Voulez-vous débloquer ${blockedUser.blockedUserName} ?`,
      [
        { text: 'Annuler', style: 'cancel' },
        {
          text: 'Débloquer',
          onPress: async () => {
            try {
              setUnblocking(blockedUser.blockedUserId);
              await ModerationService.unblockUser(user.id, blockedUser.blockedUserId);
              setBlockedUsers((prev) =>
                prev.filter((u) => u.blockedUserId !== blockedUser.blockedUserId)
              );
            } catch (error: any) {
              Alert.alert('Erreur', error.message || 'Une erreur est survenue');
            } finally {
              setUnblocking(null);
            }
          },
        },
      ]
    );
  };

  const formatDate = (date: Date) => {
    return date.toLocaleDateString('fr-FR', {
      day: 'numeric',
      month: 'long',
      year: 'numeric',
    });
  };

  const renderItem = ({ item }: { item: BlockedUser }) => (
    <View style={styles.userItem}>
      <View style={styles.userInfo}>
        <View style={styles.avatar}>
          <Ionicons name="person" size={24} color={colors.muted} />
        </View>
        <View style={styles.userText}>
          <Text variant="body" style={styles.userName}>{item.blockedUserName}</Text>
          <Caption>Bloqué le {formatDate(item.blockedAt)}</Caption>
        </View>
      </View>
      <Button
        variant="secondary"
        size="small"
        loading={unblocking === item.blockedUserId}
        onPress={() => handleUnblock(item)}
        style={styles.unblockButton}
      >
        Débloquer
      </Button>
    </View>
  );

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
    <SafeAreaView style={styles.container} edges={['bottom']}>
      <Stack.Screen options={{ title: 'Utilisateurs bloqués' }} />

      {loading ? (
        <View style={styles.loadingContainer}>
          <ActivityIndicator size="large" color={colors.primary} />
          <Text variant="body" style={styles.loadingText}>Chargement...</Text>
        </View>
      ) : (
        <FlatList
          data={blockedUsers}
          keyExtractor={(item) => item.blockedUserId}
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
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.background,
  },
  loadingContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    gap: spacing.md,
  },
  loadingText: {
    color: colors.foregroundSecondary,
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
    width: sizing.avatarMedium,
    height: sizing.avatarMedium,
    borderRadius: sizing.avatarMedium / 2,
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
