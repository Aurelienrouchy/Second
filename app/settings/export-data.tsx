/**
 * Selected data export with explicit source coverage.
 */

import { useAuthenticatedUid } from '@/hooks/useAuth';
import { useLabelLifecycleContext } from '@/hooks/useLabelLifecycleContext';
import { captureTradeSession, staleTradeOperation } from '@/services/tradeOperation';
import { assertSupportProjectionGeneration, getSupportProjectionGeneration } from '@/services/supportProjectionGuard';
import { CryptoDigestAlgorithm, digestStringAsync, randomUUID } from 'expo-crypto';
import { track } from '@/lib/analytics';
import { UserService } from '@/services/userService';
import { colors, fonts, spacing, radius } from '@/constants/theme';
import { Text, Label, Caption, ScreenHeader, Button } from '@/components/ui';
import { Ionicons } from '@expo/vector-icons';
import * as FileSystem from 'expo-file-system/legacy';
import * as Sharing from 'expo-sharing';
import { useRouter } from 'expo-router';
import React, { useRef, useState } from 'react';
import {
  Alert,
  ScrollView,
  StyleSheet,
  View,
} from 'react-native';

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
  const router = useRouter();
  const uid = useAuthenticatedUid();
  const context = useLabelLifecycleContext('settings-export-data', uid);
  const lock = useRef(false);
  const selection = useRef(0);
  const [loadingState, setLoadingState] = useState<{frame: symbol; focus: string} | null>(null);
  const [returnedShare, setReturnedShare] = useState<{frame: symbol; focus: string} | null>(null);
  const loading = loadingState?.frame === context.frame && loadingState.focus === context.focusRevision;
  const exported = returnedShare?.frame === context.frame && returnedShare.focus === context.focusRevision;

  const handleExportData = async () => {
    if (!uid || lock.current) return;
    let operation;
    try { operation = context.start(); } catch { return; }
    if (!operation) return;
    lock.current = true;
    const capturedSelection = selection.current;
    const supportGeneration = getSupportProjectionGeneration();
    const guard = () => {context.assertCurrent(operation); assertSupportProjectionGeneration(supportGeneration); if (selection.current !== capturedSelection) throw staleTradeOperation();};
    const stamp = {frame: context.frame, focus: context.focusRevision};
    setLoadingState(stamp);
    setReturnedShare(null);
    let filePath: string | null = null;
    try {
      guard();
      const data = await UserService.exportUserData(uid, guard);
      guard();
      const available = await Sharing.isAvailableAsync();
      guard();
      if (!available) {
        track('data_export_requested', {outcome: 'sharing_unavailable'});
        guard();
        Alert.alert('Partage indisponible', 'Le fichier ne peut pas être transmis sur cet appareil. Réessayez depuis un appareil prenant en charge le partage.');
        return;
      }
      const baseDir = FileSystem.cacheDirectory;
      if (!baseDir) throw new Error('export/cache_unavailable');
      const session = captureTradeSession(uid);
      const fileIdentity = await digestStringAsync(CryptoDigestAlgorithm.SHA256, JSON.stringify([uid, session.generation, context.focusRevision, randomUUID()]));
      guard();
      filePath = `${baseDir}seconde_export_${fileIdentity}.json`;
      const json = JSON.stringify(data, null, 2);
      if (json.length > data.limits.maxFileJsonCodeUnits) throw new Error('export/file_size_limit');
      guard();
      await UserService.assertUserDataExportSession(uid, guard);
      guard();
      await FileSystem.writeAsStringAsync(filePath, json, {encoding: FileSystem.EncodingType.UTF8});
      guard();
      await UserService.assertUserDataExportSession(uid, guard);
      guard();
      await Sharing.shareAsync(filePath, {mimeType: 'application/json', dialogTitle: 'Partager mon export Seconde', UTI: 'public.json'});
      guard();
      setReturnedShare(stamp);
    } catch {
      try { guard(); } catch { return; }
      track('data_export_requested', {outcome: 'error'});
      guard();
      Alert.alert('Export indisponible', 'Le fichier n’a pas pu être préparé ou partagé dans cette session. Réessayez ; si nécessaire, reconnectez-vous au compte concerné ou contactez notre équipe. Aucune transmission n’est confirmée.');
    } finally {
      // Only this operation's unique cache file is removed, even after its session ends.
      if (filePath) {
        try { await FileSystem.deleteAsync(filePath, {idempotent: true}); }
        catch { /* No path, private data or success claim is sent to another session. */ }
      }
      context.finish(operation);
      lock.current = false;
      try {
        // A changed support projection invalidates the payload, but must not strand this still-current screen's loading state.
        context.assertCurrent(operation);
        if (selection.current !== capturedSelection) throw staleTradeOperation();
        setLoadingState(null);
      } catch { /* An older navigation or session has no UI callback. */ }
    }
  };

  return (
    <View style={styles.container}>
      <ScreenHeader title="Exporter mes données" onBack={() => {selection.current++; router.back();}} />

      <ScrollView style={styles.scrollView} contentContainerStyle={styles.content}>
        {/* Privacy Info Box */}
        <View style={styles.rgpdBox}>
          <View style={styles.rgpdIconContainer}>
            <Ionicons name="shield-checkmark" size={48} color={colors.success} />
          </View>
          <Text variant="h3" style={styles.rgpdTitle}>Un export limité et lisible</Text>
          <Caption style={styles.rgpdText}>
            Ce fichier JSON reprend une sélection de champs lisibles depuis votre session.
            Chaque source indique si elle a été lue sur le serveur, si le document est absent,
            si la lecture est indisponible ou si la source n’est pas incluse.
            Il ne certifie pas l’exhaustivité de vos données ni le rétablissement de votre compte.
            La session est vérifiée sur le serveur avant et après les lectures, puis avant la
            création du fichier et l’ouverture du partage. Ces contrôles restent distincts.
          </Caption>
        </View>

        {/* Data Included Section */}
        <Label style={styles.sectionHeader}>Sources et limites de l’export</Label>
        <View style={styles.dataList}>
          <DataItem
            icon="person"
            title="Profil"
            description="Champs sélectionnés du profil, ou absence et indisponibilité signalées"
          />
          <DataItem
            icon="shirt"
            title="Articles"
            description="Champs sélectionnés des articles dont vous êtes vendeur"
          />
          <DataItem
            icon="heart"
            title="Favoris"
            description="Identifiants enregistrés dans votre document de favoris"
          />
          <DataItem
            icon="notifications"
            title="Notifications"
            description="Métadonnées lisibles ; titres et corps non inclus"
          />
          <DataItem
            icon="chatbubbles"
            title="Messages"
            description="Métadonnées de vos messages envoyés ; textes et images non inclus"
          />
          <DataItem icon="receipt" title="Commandes et autres sources" description="Champs sélectionnés des achats, ventes et avis ; recherches et consentements lisibles" />
          <DataItem icon="swap-horizontal" title="Trocs" description="Identifiants, votre rôle et états datés ; sans articles, photos, adresses ni identité de la contrepartie" />
          <DataItem icon="wallet" title="Portefeuille" description="Lignes qualifiées du ledger et des demandes de retrait, avec anomalies ; sans données bancaires, total ni signe financier déduit" />
          <DataItem icon="help-circle" title="Support" description="Métadonnées de vos tickets ; récits, pièces, originaux confinés et notes internes exclus" />
          <DataItem icon="information-circle" title="Limites et exclusions" description="10 pages et 200 lignes au plus par source, avec limites de volume indiquées dans le fichier. Brouillon local et autres pièces ou sous-dossiers privés exclus." />
        </View>

        {!uid ? <Caption>Connectez-vous au compte concerné pour demander cette lecture.</Caption> : null}

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
              Le dialogue de partage est revenu à l’application. Cela ne confirme ni un téléchargement, ni une copie enregistrée ou remise à un destinataire.
            </Text>
          </View>
        )}

        {/* Export Button */}
        <Button
          variant="primary"
          fullWidth
          loading={loading}
          disabled={!uid || !context.focused || loading}
          onPress={handleExportData}
          leftIcon={<Ionicons name="download" size={20} color={colors.foreground} />}
          style={styles.exportButton}
        >
          {exported ? 'Exporter à nouveau' : 'Exporter mes données'}
        </Button>

        {/* Note */}
        <Caption style={styles.note}>
          Les lectures sont distinctes et certains champs ne sont pas inclus. La progression,
          les troncatures et les lectures inconnues sont indiquées par source. Une source
          indisponible n’est pas déclarée vide. Le retour du partage ne prouve pas
          l’enregistrement du fichier. Une suppression du seul fichier de cache créé
          pour cette demande est tentée ensuite ; les copies choisies hors de l’application
          ne sont pas contrôlées ici. Pour les données non incluses, utilisez le support.
        </Caption>
      </ScrollView>
    </View>
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
