import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import React, { useEffect, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  ScrollView,
  StyleSheet,
  Switch,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { useAuth } from '@/contexts/AuthContext';
import { UserService } from '@/services/userService';

const CARRIERS = [
  { id: 'mondial_relay', name: 'Mondial Relay', description: 'Livraison en point relais' },
  { id: 'laposte', name: 'La Poste / Colissimo', description: 'Livraison à domicile' },
  { id: 'relais_colis', name: 'Relais Colis', description: 'Livraison en point relais' },
  { id: 'chronopost', name: 'Chronopost Shop2Shop', description: 'Livraison express en relais' },
  { id: 'hand_delivery', name: 'Remise en main propre', description: 'Rencontre avec l\'acheteur' },
];

export default function ShippingOptionsScreen() {
  const router = useRouter();
  const { user } = useAuth();
  
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
      console.error('Error loading preferences:', error);
    } finally {
      setIsLoading(false);
    }
  };

  const toggleCarrier = async (carrierId: string) => {
    const isEnabled = enabledCarriers.includes(carrierId);
    let newCarriers: string[];

    if (isEnabled) {
      // Cannot disable the last one? Maybe allow it.
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
        console.error('Error saving shipping preferences:', error);
        // Revert on error
        setEnabledCarriers(enabledCarriers); 
        Alert.alert('Erreur', 'Impossible d\'enregistrer la modification');
      }
    }
  };

  return (
    <SafeAreaView style={styles.container} edges={['bottom']}>
      <ScrollView style={styles.scrollView} contentContainerStyle={styles.content}>
        <View style={styles.infoBox}>
          <Ionicons name="information-circle-outline" size={24} color="#007AFF" />
          <Text style={styles.infoText}>
            Choisissez les modes de livraison que vous souhaitez proposer aux acheteurs.
          </Text>
        </View>

        {isLoading ? (
          <ActivityIndicator size="large" color="#F79F24" style={{ marginTop: 40 }} />
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
                  trackColor={{ false: '#767577', true: '#F79F24' }}
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
    color: '#1C1C1E',
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

