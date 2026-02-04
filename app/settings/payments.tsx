import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import React from 'react';
import {
  Alert,
  Image,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

export default function PaymentsSettingsScreen() {
  const router = useRouter();

  const handleAddCard = () => {
    Alert.alert('Bientôt disponible', 'L\'ajout de carte bancaire sera bientôt disponible.');
  };

  return (
    <SafeAreaView style={styles.container} edges={['bottom']}>
      <ScrollView style={styles.scrollView} contentContainerStyle={styles.content}>
        <View style={styles.infoBox}>
          <Ionicons name="shield-checkmark-outline" size={24} color="#34C759" />
          <Text style={styles.infoText}>
            Vos informations de paiement sont sécurisées et chiffrées.
          </Text>
        </View>

        <Text style={styles.sectionTitle}>Cartes enregistrées</Text>
        
        <View style={styles.emptyState}>
          <Ionicons name="card-outline" size={48} color="#ccc" />
          <Text style={styles.emptyText}>Aucune carte enregistrée</Text>
        </View>

        <TouchableOpacity style={styles.addButton} onPress={handleAddCard}>
          <Ionicons name="add" size={24} color="#F79F24" />
          <Text style={styles.addButtonText}>Ajouter une carte</Text>
        </TouchableOpacity>
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
    backgroundColor: '#F0FFF4',
    padding: 16,
    borderRadius: 8,
    marginBottom: 32,
  },
  infoText: {
    flex: 1,
    fontSize: 14,
    color: '#1C1C1E',
  },
  sectionTitle: {
    fontSize: 16,
    fontWeight: '600',
    color: '#333',
    marginBottom: 16,
  },
  emptyState: {
    alignItems: 'center',
    justifyContent: 'center',
    padding: 32,
    backgroundColor: '#f8f9fa',
    borderRadius: 12,
    marginBottom: 24,
    borderWidth: 1,
    borderColor: '#f0f0f0',
    borderStyle: 'dashed',
  },
  emptyText: {
    marginTop: 12,
    color: '#999',
    fontSize: 14,
  },
  addButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    padding: 16,
    backgroundColor: '#fff',
    borderWidth: 1,
    borderColor: '#F79F24',
    borderRadius: 8,
    gap: 8,
  },
  addButtonText: {
    color: '#F79F24',
    fontSize: 16,
    fontWeight: '600',
  },
});

