import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import React, { useEffect, useState } from 'react';
import {
  Alert,
  ScrollView,
  StyleSheet,
  Switch,
  Text,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { useUser } from '@/contexts/AuthContext';
import { UserService } from '@/services/userService';
import { colors, spacing, radius } from '@/constants/theme';
import { Skeleton } from '@/components/ui/Skeleton';

const CARRIERS = [
  { id: 'postes_canada_bureau', name: 'Postes Canada — Bureau de poste', description: 'Retrait en bureau de poste · 200+ points à Montréal' },
  { id: 'ups_access_point', name: 'UPS Access Point — Dépanneur', description: 'Retrait en dépanneur ou commerce · 47+ points à Montréal' },
  { id: 'penguin_pickup', name: 'Penguin Pickup — Casier métro', description: 'Casier 24/7 en station de métro STM' },
  { id: 'hand_delivery', name: 'Remise en main propre', description: 'Rencontre avec l\'acheteur · Gratuit' },
];

export default function ShippingOptionsScreen() {
  const router = useRouter();
  const user = useUser();
  
  const [enabledCarriers, setEnabledCarriers] = useState<string[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);

  useEffect(() => {
    if (user) {
      loadPreferences();
    }
  }, [user]);

  const loadPreferences = async () => {
    try {
      setIsLoading(true);
      if (!user) return;

      const preferences = await UserService.getUserPreferences(user.id);
      if (preferences && preferences.shippingCarriers) {
        setEnabledCarriers(preferences.shippingCarriers);
      } else {
        // Default: all enabled
        setEnabledCarriers(CARRIERS.map(c => c.id));
      }
    } catch (error) {
      if (__DEV__) console.error('Error loading preferences:', error);
    } finally {
      setIsLoading(false);
    }
  };

  const toggleCarrier = async (carrierId: string) => {
    const previousCarriers = [...enabledCarriers];
    const isEnabled = enabledCarriers.includes(carrierId);
    let newCarriers: string[];

    if (isEnabled) {
      newCarriers = enabledCarriers.filter(id => id !== carrierId);
    } else {
      newCarriers = [...enabledCarriers, carrierId];
    }

    setEnabledCarriers(newCarriers);

    // Auto-save
    if (user) {
      try {
        await UserService.updateUserPreferences(user.id, {
          shippingCarriers: newCarriers
        });
      } catch (error) {
        if (__DEV__) console.error('Error saving shipping preferences:', error);
        // Revert on error avec l'état précédent capturé
        setEnabledCarriers(previousCarriers);
        Alert.alert('Erreur', 'Impossible d\'enregistrer la modification');
      }
    }
  };

  return (
    <SafeAreaView style={styles.container} edges={['bottom']}>
      <ScrollView style={styles.scrollView} contentContainerStyle={styles.content}>
        <View style={styles.infoBox}>
          <Ionicons name="information-circle-outline" size={24} color={colors.primary} />
          <Text style={styles.infoText}>
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
                  <Text style={styles.carrierName}>{carrier.name}</Text>
                  <Text style={styles.carrierDescription}>{carrier.description}</Text>
                </View>
                <Switch
                  value={enabledCarriers.includes(carrier.id)}
                  onValueChange={() => toggleCarrier(carrier.id)}
                  trackColor={{ false: '#767577', true: colors.primary }}
                  thumbColor={'#f4f3f4'}
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
    backgroundColor: '#fff',
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    padding: 16,
    borderBottomWidth: 1,
    borderBottomColor: '#f0f0f0',
  },
  backButton: {
    padding: 4,
  },
  headerTitle: {
    fontSize: 18,
    fontWeight: 'bold',
    color: '#333',
  },
  scrollView: {
    flex: 1,
  },
  content: {
    padding: 20,
  },
  infoBox: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    backgroundColor: '#F0F9FF',
    padding: 16,
    borderRadius: 8,
    marginBottom: 24,
  },
  infoText: {
    flex: 1,
    fontSize: 14,
    color: colors.foreground,
  },
  skeletonCards: {
    backgroundColor: '#fff',
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#f0f0f0',
  },
  carriersList: {
    backgroundColor: '#fff',
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#f0f0f0',
  },
  carrierItem: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    padding: 16,
    borderBottomWidth: 1,
    borderBottomColor: '#f0f0f0',
  },
  carrierInfo: {
    flex: 1,
    marginRight: 16,
  },
  carrierName: {
    fontSize: 16,
    fontWeight: '600',
    color: '#333',
    marginBottom: 4,
  },
  carrierDescription: {
    fontSize: 13,
    color: '#999',
  },
});

