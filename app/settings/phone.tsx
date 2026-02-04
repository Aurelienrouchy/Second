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

export default function PhoneSettingsScreen() {
  const router = useRouter();
  const { user } = useAuth();
  
  const [phoneNumber, setPhoneNumber] = useState('');
  const [isSaving, setIsSaving] = useState(false);

  useEffect(() => {
    if (user && user.phoneNumber) {
      setPhoneNumber(user.phoneNumber);
    }
  }, [user]);

  const handleSave = async () => {
    if (!user) return;
    
    // Basic validation
    const cleanPhone = phoneNumber.replace(/\D/g, '');
    if (cleanPhone.length < 10) {
      Alert.alert('Erreur', 'Veuillez entrer un numéro de téléphone valide');
      return;
    }

    setIsSaving(true);
    try {
      await UserService.updateUserProfile(user.id, {
        phoneNumber: phoneNumber.trim(),
      });

      Alert.alert('Succès', 'Votre numéro de téléphone a été mis à jour', [
        { text: 'OK', onPress: () => router.back() }
      ]);
    } catch (error) {
      console.error('Error updating phone:', error);
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
              <ActivityIndicator color="#F79F24" />
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
            <Ionicons name="information-circle-outline" size={24} color="#007AFF" />
            <Text style={styles.infoText}>
              Ajouter un numéro de téléphone vérifié aide à sécuriser votre compte et facilite les transactions.
            </Text>
          </View>

          <View style={styles.formSection}>
            <View style={styles.inputContainer}>
              <Text style={styles.label}>Numéro de téléphone</Text>
              <TextInput
                style={styles.input}
                value={phoneNumber}
                onChangeText={setPhoneNumber}
                placeholder="Ex: +33 6 12 34 56 78"
                keyboardType="phone-pad"
                autoComplete="tel"
              />
              <Text style={styles.helperText}>
                Un code de vérification pourrait vous être envoyé (simulation).
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
    color: '#F79F24',
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
    color: '#1C1C1E',
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
  input: {
    borderWidth: 1,
    borderColor: '#e0e0e0',
    borderRadius: 8,
    padding: 12,
    fontSize: 16,
    color: '#333',
    backgroundColor: '#fff',
  },
  helperText: {
    fontSize: 12,
    color: '#999',
  },
});
