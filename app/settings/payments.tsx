import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import React from 'react';
import {
  Alert,
  Pressable,
  ScrollView,
  StyleSheet,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Text, Label, Caption } from '@/components/ui';
import { colors, fonts, spacing, radius } from '@/constants/theme';

export default function PaymentsSettingsScreen() {
  const router = useRouter();

  const handleAddCard = () => {
    Alert.alert('Bientôt disponible', 'L\'ajout de carte bancaire sera bientôt disponible.');
  };

  return (
    <SafeAreaView style={styles.container} edges={['bottom']}>
      <ScrollView style={styles.scrollView} contentContainerStyle={styles.content}>
        <View style={styles.infoBox}>
          <Ionicons name="shield-checkmark-outline" size={24} color={colors.success} />
          <Text variant="bodySmall" style={styles.infoText}>
            Vos informations de paiement sont sécurisées et chiffrées.
          </Text>
        </View>

        <Label style={styles.sectionTitle}>Cartes enregistrées</Label>
        
        <View style={styles.emptyState}>
          <Ionicons name="card-outline" size={48} color={colors.muted} />
          <Caption style={styles.emptyText}>Aucune carte enregistrée</Caption>
        </View>

        <Pressable style={({ pressed }) => [styles.addButton, pressed && { opacity: 0.7 }]} onPress={handleAddCard}>
          <Ionicons name="add" size={24} color={colors.primary} />
          <Text variant="body" style={styles.addButtonText}>Ajouter une carte</Text>
        </Pressable>
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
    backgroundColor: colors.successLight,
    padding: spacing.md,
    borderRadius: radius.md,
    marginBottom: spacing.xl,
  },
  infoText: {
    flex: 1,
  },
  sectionTitle: {
    marginBottom: spacing.md,
  },
  emptyState: {
    alignItems: 'center',
    justifyContent: 'center',
    padding: spacing.xl,
    backgroundColor: colors.surface,
    borderRadius: radius.lg,
    marginBottom: spacing.lg,
    borderWidth: 1,
    borderColor: colors.borderLight,
    borderStyle: 'dashed',
  },
  emptyText: {
    marginTop: spacing.md,
  },
  addButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    padding: spacing.md,
    backgroundColor: colors.background,
    borderWidth: 1,
    borderColor: colors.primary,
    borderRadius: radius.md,
    gap: spacing.sm,
  },
  addButtonText: {
    color: colors.primary,
    fontFamily: fonts.sansMedium,
  },
});

