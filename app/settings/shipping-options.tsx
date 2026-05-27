import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import React from 'react';
import {
  Alert,
  ScrollView,
  StyleSheet,
  Switch,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { useUser } from '@/contexts/AuthContext';
import { UserService } from '@/services/userService';
import { colors, fonts, spacing, radius } from '@/constants/theme';
import { Text, Caption } from '@/components/ui';
import { Skeleton } from '@/components/ui/Skeleton';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';

const CARRIERS = [
  { id: 'postes_canada_bureau', name: 'Postes Canada — Bureau de poste', description: 'Retrait en bureau de poste · 200+ points à Montréal' },
  { id: 'ups_access_point', name: 'UPS Access Point — Dépanneur', description: 'Retrait en dépanneur ou commerce · 47+ points à Montréal' },
  { id: 'penguin_pickup', name: 'Penguin Pickup — Casier métro', description: 'Casier 24/7 en station de métro STM' },
  { id: 'hand_delivery', name: 'Remise en main propre', description: 'Rencontre avec l\'acheteur · Gratuit' },
];

const ALL_CARRIER_IDS = CARRIERS.map(c => c.id);

export default function ShippingOptionsScreen() {
  const user = useUser();
  const queryClient = useQueryClient();

  const { data: enabledCarriers = ALL_CARRIER_IDS, isLoading } = useQuery({
    queryKey: ['userShippingCarriers', user?.id],
    queryFn: async () => {
      const preferences = await UserService.getUserPreferences(user!.id);
      return preferences?.shippingCarriers ?? ALL_CARRIER_IDS;
    },
    enabled: !!user?.id,
    staleTime: 10 * 60 * 1000,
  });

  const { mutate: toggleCarrier } = useMutation({
    mutationFn: (carrierId: string) => {
      const isEnabled = enabledCarriers.includes(carrierId);
      const newCarriers = isEnabled
        ? enabledCarriers.filter(id => id !== carrierId)
        : [...enabledCarriers, carrierId];
      return UserService.updateUserPreferences(user!.id, {
        shippingCarriers: newCarriers,
      });
    },
    onMutate: async (carrierId: string) => {
      await queryClient.cancelQueries({ queryKey: ['userShippingCarriers', user?.id] });
      const previousCarriers = queryClient.getQueryData<string[]>(
        ['userShippingCarriers', user?.id]
      );
      queryClient.setQueryData(
        ['userShippingCarriers', user?.id],
        (old: string[] | undefined) => {
          const current = old ?? ALL_CARRIER_IDS;
          return current.includes(carrierId)
            ? current.filter(id => id !== carrierId)
            : [...current, carrierId];
        }
      );
      return { previousCarriers };
    },
    onError: (_error, _carrierId, context) => {
      if (context?.previousCarriers) {
        queryClient.setQueryData(
          ['userShippingCarriers', user?.id],
          context.previousCarriers
        );
      }
      Alert.alert('Erreur', 'Impossible d\'enregistrer la modification');
    },
  });

  return (
    <SafeAreaView style={styles.container} edges={['bottom']}>
      <ScrollView style={styles.scrollView} contentContainerStyle={styles.content}>
        <View style={styles.infoBox}>
          <Ionicons name="information-circle-outline" size={24} color={colors.primary} />
          <Text variant="bodySmall" style={styles.infoText}>
            Choisissez les modes de livraison que vous souhaitez proposer aux acheteurs.
          </Text>
        </View>

        {isLoading ? (
          <View style={styles.skeletonCards}>
            {[0, 1, 2].map((i) => (
              <View key={i} style={styles.carrierItem}>
                <View style={styles.carrierInfo}>
                  <Skeleton width="65%" height={16} />
                  <Skeleton width="90%" height={13} style={{ marginTop: spacing.xs }} />
                </View>
                <Skeleton width={51} height={31} borderRadius={16} />
              </View>
            ))}
          </View>
        ) : (
          <View style={styles.carriersList}>
            {CARRIERS.map((carrier) => (
              <View key={carrier.id} style={styles.carrierItem}>
                <View style={styles.carrierInfo}>
                  <Text variant="body" style={styles.carrierName}>{carrier.name}</Text>
                  <Caption style={styles.carrierDescription}>{carrier.description}</Caption>
                </View>
                <Switch
                  value={enabledCarriers.includes(carrier.id)}
                  onValueChange={() => toggleCarrier(carrier.id)}
                  trackColor={{ false: colors.border, true: colors.primary }}
                  thumbColor={colors.white}
                  ios_backgroundColor={colors.border}
                />
              </View>
            ))}
          </View>
        )}
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.background,
  },
  scrollView: {
    flex: 1,
  },
  content: {
    padding: spacing.md,
  },
  infoBox: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    backgroundColor: colors.primaryLight,
    padding: spacing.md,
    borderRadius: radius.md,
    marginBottom: spacing.lg,
  },
  infoText: {
    flex: 1,
    color: colors.foreground,
  },
  skeletonCards: {
    backgroundColor: colors.surface,
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: colors.borderLight,
  },
  carriersList: {
    backgroundColor: colors.surface,
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: colors.borderLight,
  },
  carrierItem: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    padding: spacing.md,
    borderBottomWidth: 1,
    borderBottomColor: colors.borderLight,
  },
  carrierInfo: {
    flex: 1,
    marginRight: spacing.md,
  },
  carrierName: {
    fontFamily: fonts.sansMedium,
    marginBottom: spacing.xs,
  },
  carrierDescription: {
    color: colors.muted,
  },
});

