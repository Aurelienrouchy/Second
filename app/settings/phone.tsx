import { Ionicons } from '@expo/vector-icons';
import { Stack, useRouter } from 'expo-router';
import React, { useEffect, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  KeyboardAvoidingView,
  Platform,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { useAuth } from '@/contexts/AuthContext';
import { UserService } from '@/services/userService';
import { colors } from '@/constants/theme';

export default function PhoneSettingsScreen() {
  const router = useRouter();
  const { user } = useAuth();
  
  const [phoneNumber, setPhoneNumber] = useState('');
  const [isSaving, setIsSaving] = useState(false);

  useEffect(() => {
    if (user && user.phoneNumber) {
      // Si le numéro commence par +1, retirer le préfixe pour l'affichage
      const stored = user.phoneNumber;
      if (stored.startsWith('+1')) {
        setPhoneNumber(stored.slice(2).trim());
      } else {
        setPhoneNumber(stored);
      }
    }
  }, [user]);

  const formatPhoneDisplay = (text: string) => {
    // Retirer tout sauf les chiffres
    const digits = text.replace(/\D/g, '');
    // Formater au fur et à mesure : (514) 555-1234
    if (digits.length <= 3) return digits;
    if (digits.length <= 6) return `(${digits.slice(0, 3)}) ${digits.slice(3)}`;
    return `(${digits.slice(0, 3)}) ${digits.slice(3, 6)}-${digits.slice(6, 10)}`;
  };

  const handlePhoneChange = (text: string) => {
    const digits = text.replace(/\D/g, '');
    if (digits.length <= 10) {
      setPhoneNumber(formatPhoneDisplay(digits));
    }
  };

  const handleSave = async () => {
    if (!user) return;

    // Validation pour un numéro canadien (10 chiffres)
    const cleanPhone = phoneNumber.replace(/\D/g, '');
    if (cleanPhone.length !== 10) {
      Alert.alert('Erreur', 'Veuillez entrer un numéro de téléphone canadien valide (10 chiffres)');
      return;
    }

    setIsSaving(true);
    try {
      // Stocker avec le préfixe +1
      await UserService.updateUserProfile(user.id, {
        phoneNumber: `+1${cleanPhone}`,
      });

      Alert.alert('Succès', 'Votre numéro de téléphone a été mis à jour', [
        { text: 'OK', onPress: () => router.back() }
      ]);
    } catch (error) {
      if (__DEV__) console.error('Error updating phone:', error);
      Alert.alert('Erreur', 'Une erreur est survenue lors de la mise à jour du numéro');
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <SafeAreaView style={styles.container} edges={['bottom']}>
      <Stack.Screen options={{
        headerRight: () => (
          <TouchableOpacity onPress={handleSave} disabled={isSaving}>
            {isSaving ? (
              <ActivityIndicator color={colors.primary} />
            ) : (
              <Text style={styles.headerButton}>Enregistrer</Text>
            )}
          </TouchableOpacity>
        ),
      }} />

      <KeyboardAvoidingView 
        behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
        style={styles.keyboardView}
      >
        <ScrollView style={styles.scrollView} contentContainerStyle={styles.content}>
          <View style={styles.infoBox}>
            <Ionicons name="information-circle-outline" size={24} color={colors.primary} />
            <Text style={styles.infoText}>
              Ajouter un numéro de téléphone vérifié aide à sécuriser votre compte et facilite les transactions.
            </Text>
          </View>

          <View style={styles.formSection}>
            <View style={styles.inputContainer}>
              <Text style={styles.label}>Numéro de téléphone</Text>
              <View style={styles.phoneRow}>
                <View style={styles.countryCode}>
                  <Text style={styles.countryCodeText}>🇨🇦 +1</Text>
                </View>
                <TextInput
                  style={[styles.input, styles.phoneInput]}
                  value={phoneNumber}
                  onChangeText={handlePhoneChange}
                  placeholder="(514) 555-1234"
                  keyboardType="phone-pad"
                  autoComplete="tel"
                  maxLength={14}
                />
              </View>
              <Text style={styles.helperText}>
                Numéro de téléphone canadien à 10 chiffres.
              </Text>
            </View>
          </View>
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#fff',
  },
  headerButton: {
    color: colors.primary,
    fontSize: 16,
    fontWeight: '600',
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
  infoBox: {
    flexDirection: 'row',
    alignItems: 'flex-start',
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
    lineHeight: 20,
  },
  formSection: {
    gap: 24,
  },
  inputContainer: {
    gap: 8,
  },
  label: {
    fontSize: 14,
    fontWeight: '600',
    color: '#666',
    textTransform: 'uppercase',
  },
  phoneRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  countryCode: {
    borderWidth: 1,
    borderColor: '#e0e0e0',
    borderRadius: 8,
    padding: 12,
    backgroundColor: '#f9f9f9',
    justifyContent: 'center',
    alignItems: 'center',
  },
  countryCodeText: {
    fontSize: 16,
    color: '#333',
    fontWeight: '500',
  },
  input: {
    borderWidth: 1,
    borderColor: '#e0e0e0',
    borderRadius: 8,
    padding: 12,
    fontSize: 16,
    color: '#333',
    backgroundColor: '#fff',
  },
  phoneInput: {
    flex: 1,
  },
  helperText: {
    fontSize: 12,
    color: '#999',
  },
});
