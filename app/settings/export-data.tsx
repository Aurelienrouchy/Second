/**
 * Export Data Settings (RGPD)
 * Design System: Luxe Français + Street Energy
 */

import { useAuth } from '@/contexts/AuthContext';
import { UserService } from '@/services/userService';
import { colors, fonts, spacing, radius } from '@/constants/theme';
import { Text, Label, Caption } from '@/components/ui';
import { Button } from '@/components/ui';
import { Ionicons } from '@expo/vector-icons';
import * as FileSystem from 'expo-file-system';
import * as Sharing from 'expo-sharing';
import { Stack } from 'expo-router';
import React, { useState } from 'react';
import {
  Alert,
  ScrollView,
  StyleSheet,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

interface DataItemProps {
  icon: keyof typeof Ionicons.glyphMap;
  title: string;
  description: string;
}

const DataItem = ({ icon, title, description }: DataItemProps) => (
  <View style={styles.dataItem}>
    <View style={styles.dataItemIcon}>
      <Ionicons name={icon} size={20} color={colors.primary} />
    </View>
    <View style={styles.dataItemText}>
      <Text variant="body" style={styles.dataItemTitle}>{title}</Text>
      <Caption>{description}</Caption>
    </View>
  </View>
);

export default function ExportDataScreen() {
  const { user } = useAuth();
  const [loading, setLoading] = useState(false);
  const [exported, setExported] = useState(false);

  const handleExportData = async () => {
    if (!user) return;

    setLoading(true);
    try {
      // Récupérer toutes les données de l'utilisateur
      const data = await UserService.exportUserData(user.id);

      // Créer le fichier JSON
      const fileName = `seconde_data_${user.id}_${Date.now()}.json`;
      const filePath = `${FileSystem.documentDirectory}${fileName}`;

      await FileSystem.writeAsStringAsync(
        filePath,
        JSON.stringify(data, null, 2),
        { encoding: FileSystem.EncodingType.UTF8 }
      );

      // Vérifier si le partage est disponible
      const isAvailable = await Sharing.isAvailableAsync();

      if (isAvailable) {
        await Sharing.shareAsync(filePath, {
          mimeType: 'application/json',
          dialogTitle: 'Exporter mes données Seconde',
          UTI: 'public.json',
        });
      } else {
        Alert.alert(
          'Export réussi',
          `Vos données ont été exportées dans : ${filePath}`
        );
      }

      setExported(true);
    } catch (error: any) {
      console.error('Error exporting data:', error);
      Alert.alert(
        'Erreur',
        error.message || 'Une erreur est survenue lors de l\'export'
      );
    } finally {
      setLoading(false);
    }
  };

  return (
    <SafeAreaView style={styles.container} edges={['bottom']}>
      <Stack.Screen options={{ title: 'Exporter mes données' }} />

      <ScrollView style={styles.scrollView} contentContainerStyle={styles.content}>
        {/* RGPD Info Box */}
        <View style={styles.rgpdBox}>
          <View style={styles.rgpdIconContainer}>
            <Ionicons name="shield-checkmark" size={48} color={colors.success} />
          </View>
          <Text variant="h3" style={styles.rgpdTitle}>Droit à la portabilité</Text>
          <Caption style={styles.rgpdText}>
            Conformément à l'article 20 du RGPD, vous avez le droit de recevoir vos données
            personnelles dans un format structuré, couramment utilisé et lisible par machine.
          </Caption>
        </View>

        {/* Data Included Section */}
        <Label style={styles.sectionHeader}>Données incluses dans l'export</Label>
        <View style={styles.dataList}>
          <DataItem
            icon="person"
            title="Profil"
            description="Nom, email, bio, photo, préférences"
          />
          <DataItem
            icon="shirt"
            title="Articles"
            description="Tous vos articles publiés"
          />
          <DataItem
            icon="heart"
            title="Favoris"
            description="Articles sauvegardés"
          />
          <DataItem
            icon="notifications"
            title="Notifications"
            description="Historique de vos notifications"
          />
          <DataItem
            icon="chatbubbles"
            title="Messages"
            description="Vos messages envoyés"
          />
        </View>

        {/* Format Info */}
        <View style={styles.formatBox}>
          <Ionicons name="document-text" size={24} color={colors.foregroundSecondary} />
          <Text variant="bodySmall" style={styles.formatText}>
            Format : JSON (JavaScript Object Notation){'\n'}
            Lisible par la plupart des applications et services
          </Text>
        </View>

        {/* Success Message */}
        {exported && (
          <View style={styles.successBox}>
            <Ionicons name="checkmark-circle" size={24} color={colors.success} />
            <Text variant="bodySmall" style={styles.successText}>
              Export réussi ! Vos données ont été téléchargées.
            </Text>
          </View>
        )}

        {/* Export Button */}
        <Button
          variant="primary"
          fullWidth
          loading={loading}
          onPress={handleExportData}
          leftIcon={<Ionicons name="download" size={20} color={colors.white} />}
          style={styles.exportButton}
        >
          {exported ? 'Exporter à nouveau' : 'Exporter mes données'}
        </Button>

        {/* Note */}
        <Caption style={styles.note}>
          L'export peut prendre quelques secondes selon la quantité de données.
          Vos données seront téléchargées dans un fichier JSON que vous pourrez
          ouvrir avec n'importe quel éditeur de texte.
        </Caption>
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
    paddingBottom: spacing.xl,
  },
  rgpdBox: {
    backgroundColor: colors.successLight,
    borderRadius: radius.md,
    padding: spacing.lg,
    alignItems: 'center',
    marginBottom: spacing.lg,
    borderWidth: 1,
    borderColor: colors.success,
  },
  rgpdIconContainer: {
    marginBottom: spacing.md,
  },
  rgpdTitle: {
    color: colors.foreground,
    marginBottom: spacing.sm,
    textAlign: 'center',
  },
  rgpdText: {
    textAlign: 'center',
    color: colors.foregroundSecondary,
    lineHeight: 20,
  },
  sectionHeader: {
    color: colors.foregroundSecondary,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
    marginBottom: spacing.sm,
  },
  dataList: {
    backgroundColor: colors.surface,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.borderLight,
    overflow: 'hidden',
    marginBottom: spacing.lg,
  },
  dataItem: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: spacing.md,
    borderBottomWidth: 1,
    borderBottomColor: colors.borderLight,
  },
  dataItemIcon: {
    width: 40,
    height: 40,
    borderRadius: radius.sm,
    backgroundColor: colors.primaryLight,
    justifyContent: 'center',
    alignItems: 'center',
    marginRight: spacing.md,
  },
  dataItemText: {
    flex: 1,
  },
  dataItemTitle: {
    fontFamily: fonts.sansMedium,
    marginBottom: 2,
  },
  formatBox: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: colors.surface,
    borderRadius: radius.sm,
    padding: spacing.md,
    marginBottom: spacing.lg,
    borderWidth: 1,
    borderColor: colors.borderLight,
    gap: spacing.md,
  },
  formatText: {
    flex: 1,
    color: colors.foregroundSecondary,
    lineHeight: 20,
  },
  successBox: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: colors.successLight,
    borderRadius: radius.sm,
    padding: spacing.md,
    marginBottom: spacing.md,
    gap: spacing.sm,
  },
  successText: {
    flex: 1,
    color: colors.foreground,
  },
  exportButton: {
    marginBottom: spacing.md,
  },
  note: {
    textAlign: 'center',
    color: colors.muted,
    lineHeight: 18,
  },
});
