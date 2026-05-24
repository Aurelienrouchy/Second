import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import React, { useRef, useState } from 'react';
import {
  Alert,
  KeyboardAvoidingView,
  Platform,
  StyleSheet,
  View
} from 'react-native';
import { GooglePlacesAutocomplete, GooglePlacesAutocompleteRef } from 'react-native-google-places-autocomplete';
import { SafeAreaView } from 'react-native-safe-area-context';

import { Text, Label, Caption } from '@/components/ui';
import { useUser, useAuthActions } from '@/contexts/AuthContext';
import { UserService } from '@/services/userService';
import { colors, fonts, spacing, radius } from '@/constants/theme';

const GOOGLE_PLACES_API_KEY = process.env.EXPO_PUBLIC_GOOGLE_PLACES_API_KEY || '';

export default function AddressSettingsScreen() {
  const router = useRouter();
  const user = useUser();
  const { refreshUser } = useAuthActions();
  const addressRef = useRef<GooglePlacesAutocompleteRef>(null);
  
  const [isSaving, setIsSaving] = useState(false);

  const handleUpdateAddress = async (details: any) => {
    if (!user || !details) return;

    const streetNumber = details.address_components.find((c: any) => c.types.includes('street_number'))?.long_name || '';
    const route = details.address_components.find((c: any) => c.types.includes('route'))?.long_name || '';
    const city = details.address_components.find((c: any) => c.types.includes('locality'))?.long_name || '';
    const province = details.address_components.find((c: any) => c.types.includes('administrative_area_level_1'))?.short_name || '';
    const postalCode = details.address_components.find((c: any) => c.types.includes('postal_code'))?.long_name || '';
    const country = details.address_components.find((c: any) => c.types.includes('country'))?.long_name || '';

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
                  province,
                  postalCode,
                  country,
                },
              });

              // Rafraîchir les données utilisateur depuis Firestore
              await refreshUser();

              Alert.alert('Succès', 'Votre adresse a été mise à jour', [
                { text: 'OK', onPress: () => router.back() }
              ]);
            } catch (error) {
              if (__DEV__) console.error('Error updating address:', error);
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
              <Label style={styles.currentAddressLabel}>Adresse actuelle :</Label>
              <View style={styles.addressRow}>
                <Ionicons name="location" size={24} color={colors.primary} />
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
              <Ionicons name="information-circle-outline" size={24} color={colors.primary} />
              <Caption style={styles.infoText}>
                Aucune adresse enregistrée. Ajoutez-en une pour faciliter vos ventes et achats.
              </Caption>
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
                  components: 'country:ca',
                }}
                fetchDetails={true}
                styles={{
                  container: { flex: 0 },
                  textInputContainer: {
                    backgroundColor: 'transparent',
                    borderWidth: 1,
                    borderColor: colors.border,
                    borderRadius: radius.md,
                    paddingHorizontal: spacing.xs,
                  },
                  textInput: {
                    height: 44,
                    color: colors.foreground,
                    fontSize: 16,
                    fontFamily: fonts.sans,
                  },
                  listView: {
                    position: 'absolute',
                    top: 50,
                    left: 0,
                    right: 0,
                    zIndex: 1000,
                    backgroundColor: colors.white,
                    borderWidth: 1,
                    borderColor: colors.border,
                    borderRadius: radius.sm,
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
    backgroundColor: colors.background,
  },
  keyboardView: {
    flex: 1,
  },
  content: {
    padding: spacing.md,
  },
  currentAddressCard: {
    backgroundColor: colors.white,
    borderRadius: radius.lg,
    padding: spacing.md,
    marginBottom: spacing.lg,
    borderWidth: 1,
    borderColor: colors.borderLight,
    shadowColor: colors.charcoal,
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.05,
    shadowRadius: 4,
    elevation: 2,
  },
  currentAddressLabel: {
    color: colors.foregroundSecondary,
    marginBottom: spacing.md,
    textTransform: 'uppercase',
  },
  addressRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
  },
  addressDetails: {
    flex: 1,
  },
  addressText: {
    fontSize: 16,
    fontFamily: fonts.sansMedium,
    color: colors.foreground,
    marginBottom: spacing.xs,
  },
  countryText: {
    fontSize: 14,
    fontFamily: fonts.sans,
    color: colors.foregroundSecondary,
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
    fontSize: 14,
    fontFamily: fonts.sans,
    color: colors.foreground,
  },
  formSection: {
    gap: spacing.md,
  },
  inputContainer: {
    marginBottom: spacing.md,
  },
  label: {
    fontSize: 16,
    fontFamily: fonts.sansMedium,
    color: colors.foreground,
    marginBottom: spacing.sm,
  },
});
