import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import React, { useRef, useState } from 'react';
import {
  Alert,
  KeyboardAvoidingView,
  Platform,
  StyleSheet,
  Text,
  View
} from 'react-native';
import { GooglePlacesAutocomplete, GooglePlacesAutocompleteRef } from 'react-native-google-places-autocomplete';
import { SafeAreaView } from 'react-native-safe-area-context';

import { useAuth } from '@/contexts/AuthContext';
import { UserService } from '@/services/userService';

const GOOGLE_PLACES_API_KEY = process.env.EXPO_PUBLIC_GOOGLE_PLACES_API_KEY || '';

export default function AddressSettingsScreen() {
  const router = useRouter();
  const { user, signIn } = useAuth();
  const addressRef = useRef<GooglePlacesAutocompleteRef>(null);
  
  const [isSaving, setIsSaving] = useState(false);

  const handleUpdateAddress = async (details: any) => {
    if (!user || !details) return;

    const streetNumber = details.address_components.find((c: any) => c.types.includes('street_number'))?.long_name || '';
    const route = details.address_components.find((c: any) => c.types.includes('route'))?.long_name || '';
    const city = details.address_components.find((c: any) => c.types.includes('locality'))?.long_name || '';
    const postalCode = details.address_components.find((c: any) => c.types.includes('postal_code'))?.long_name || '';
    const country = details.address_components.find((c: any) => c.types.includes('country'))?.short_name || '';

    const streetAddress = `${streetNumber} ${route}`.trim();
    const fullAddress = details.formatted_address;

    Alert.alert(
      'Mettre à jour l\'adresse ?',
      `Nouvelle adresse :\n${fullAddress}`,
      [
        {
          text: 'Annuler',
          style: 'cancel',
        },
        {
          text: 'Confirmer',
          onPress: async () => {
            setIsSaving(true);
            try {
              await UserService.updateUserProfile(user.id, {
                address: {
                  street: streetAddress,
                  city,
                  postalCode,
                  country,
                },
              });

              // Mettre à jour l'utilisateur localement pour refléter les changements immédiatement
              if (user) {
                const updatedUser = {
                  ...user,
                  address: {
                    street: streetAddress,
                    city,
                    postalCode,
                    country,
                  }
                };
                await signIn(updatedUser);
              }

              Alert.alert('Succès', 'Votre adresse a été mise à jour', [
                { text: 'OK', onPress: () => router.back() }
              ]);
            } catch (error) {
              console.error('Error updating address:', error);
              Alert.alert('Erreur', 'Une erreur est survenue lors de la mise à jour de l\'adresse');
            } finally {
              setIsSaving(false);
            }
          }
        }
      ]
    );
  };

  return (
    <SafeAreaView style={styles.container} edges={['bottom']}>
      {/* Pas de Stack.Screen ici pour ne pas surcharger le header du layout */}

      <KeyboardAvoidingView   
        behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
        style={styles.keyboardView}
      >
        <View style={styles.content}>
          {user?.address && (user.address.street || user.address.city) ? (
            <View style={styles.currentAddressCard}>
              <Text style={styles.currentAddressLabel}>Adresse actuelle :</Text>
              <View style={styles.addressRow}>
                <Ionicons name="location" size={24} color="#F79F24" />
                <View style={styles.addressDetails}>
                  <Text style={styles.addressText}>
                    {user.address.street ? `${user.address.street}, ` : ''}
                    {user.address.postalCode} {user.address.city}
                  </Text>
                  <Text style={styles.countryText}>{user.address.country}</Text>
                </View>
              </View>
            </View>
          ) : (
            <View style={styles.infoBox}>
              <Ionicons name="information-circle-outline" size={24} color="#007AFF" />
              <Text style={styles.infoText}>
                Aucune adresse enregistrée. Ajoutez-en une pour faciliter vos ventes et achats.
              </Text>
            </View>
          )}

          <View style={styles.formSection}>
            <Text style={styles.label}>Changer d'adresse</Text>
            <View style={[styles.inputContainer, { zIndex: 1 }]}>
              <GooglePlacesAutocomplete
                ref={addressRef}
                placeholder="Rechercher une adresse..."
                onPress={(data, details = null) => {
                  handleUpdateAddress(details);
                }}
                query={{
                  key: GOOGLE_PLACES_API_KEY,
                  language: 'fr',
                  types: 'address',
                }}
                fetchDetails={true}
                styles={{
                  container: { flex: 0 },
                  textInputContainer: { 
                    backgroundColor: 'transparent',
                    borderWidth: 1,
                    borderColor: '#e0e0e0',
                    borderRadius: 8,
                    paddingHorizontal: 4,
                  },
                  textInput: {
                    height: 44,
                    color: '#333',
                    fontSize: 16,
                  },
                  listView: { 
                    position: 'absolute', 
                    top: 50, 
                    left: 0, 
                    right: 0, 
                    zIndex: 1000, 
                    backgroundColor: 'white', 
                    borderWidth: 1, 
                    borderColor: '#ccc',
                    borderRadius: 5,
                    elevation: 5, 
                  },
                }}
                enablePoweredByContainer={false}
              />
            </View>
          </View>
        </View>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#fff',
  },
  keyboardView: {
    flex: 1,
  },
  scrollView: {
    flex: 1,
  },
  content: {
    padding: 20,
  },
  currentAddressCard: {
    backgroundColor: '#fff',
    borderRadius: 12,
    padding: 16,
    marginBottom: 24,
    borderWidth: 1,
    borderColor: '#eee',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.05,
    shadowRadius: 4,
    elevation: 2,
  },
  currentAddressLabel: {
    fontSize: 14,
    color: '#666',
    marginBottom: 12,
    fontWeight: '600',
    textTransform: 'uppercase',
  },
  addressRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  addressDetails: {
    flex: 1,
  },
  addressText: {
    fontSize: 16,
    color: '#1C1C1E',
    fontWeight: '500',
    marginBottom: 4,
  },
  countryText: {
    fontSize: 14,
    color: '#666',
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
  formSection: {
    gap: 12,
  },
  inputContainer: {
    marginBottom: 20,
  },
  label: {
    fontSize: 16,
    fontWeight: '600',
    color: '#1C1C1E',
    marginBottom: 8,
  },
});
