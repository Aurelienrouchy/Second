/**
 * Admin Panel — Reports Triage (B3)
 *
 * Liste les signalements en attente (collection `reports`, status == 'pending')
 * et permet à l'admin de les trier. Le status / reviewedBy / reviewedAt /
 * resolution d'un report sont verrouillés côté firestore.rules (admin-owned) :
 * lecture comme triage passent donc par des Cloud Functions callables
 * (`getPendingReports` / `triageReport`, Admin SDK + runTransaction).
 *
 * Suit les conventions de app/admin/shops.tsx (état local, FlashList,
 * confirmations Alert, tokens DS). L'accès admin est garanti par
 * app/admin/_layout.tsx (defense-in-depth conservée ici par souci de cohérence).
 */

import { Skeleton, SkeletonText } from '@/components/ui/Skeleton';
import { functions } from '@/config/firebaseConfig';
import { APP_LOCALE } from '@/constants/locale';
import { useUser } from '@/hooks/useAuth';
import { ReportReasonLabels, type ReportReason, type ReportType } from '@/services/moderationService';
import { UserService } from '@/services/userService';
import { Ionicons } from '@expo/vector-icons';
import { FlashList } from '@shopify/flash-list';
import { useRouter } from 'expo-router';
import { httpsCallable } from 'firebase/functions';
import React, { useCallback, useEffect, useState } from 'react';
import {
  Alert,
  Pressable,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { colors, radius, spacing, typography } from '@/constants/theme';

// =============================================================================
// TYPES (Cloud Function shapes — see functions/src/callable/shopModeration.ts)
// =============================================================================

type ReportOutcome = 'reviewed' | 'resolved' | 'dismissed';

interface PendingReport {
  id: string;
  reporterId: string | null;
  reporterName: string | null;
  targetType: ReportType | null;
  targetId: string | null;
  targetOwnerId: string | null;
  reason: ReportReason | null;
  description: string | null;
  status: string;
  createdAt: string | null;
}

interface GetPendingReportsResponse {
  ok: boolean;
  reports: PendingReport[];
  count: number;
}

interface TriageReportResponse {
  ok: boolean;
  reportId: string;
  status: ReportOutcome;
}

// =============================================================================
// CALLABLES
// =============================================================================

const callGetPendingReports = httpsCallable<{ limit?: number }, GetPendingReportsResponse>(
  functions,
  'getPendingReports',
);

const callTriageReport = httpsCallable<
  { reportId: string; outcome: ReportOutcome; resolution?: string },
  TriageReportResponse
>(functions, 'triageReport');

// =============================================================================
// HELPERS
// =============================================================================

const TARGET_TYPE_LABELS: Record<ReportType, string> = {
  user: 'Utilisateur',
  article: 'Article',
  message: 'Message',
};

function formatTargetType(type: ReportType | null): string {
  if (type && type in TARGET_TYPE_LABELS) return TARGET_TYPE_LABELS[type];
  return 'Cible inconnue';
}

function formatReason(reason: ReportReason | null): string {
  if (reason && reason in ReportReasonLabels) return ReportReasonLabels[reason];
  return 'Raison non précisée';
}

function formatDate(iso: string | null): string {
  if (!iso) return '';
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return '';
  return date.toLocaleDateString(APP_LOCALE, {
    day: '2-digit',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
  });
}

// =============================================================================
// SCREEN
// =============================================================================

export default function AdminReportsScreen() {
  const router = useRouter();
  const user = useUser();
  const [reports, setReports] = useState<PendingReport[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isAdmin, setIsAdmin] = useState(false);
  const [processingId, setProcessingId] = useState<string | null>(null);

  const loadReports = useCallback(async () => {
    try {
      setIsLoading(true);
      const { data } = await callGetPendingReports({});
      setReports(data.reports ?? []);
    } catch (error) {
      if (__DEV__) console.error('Error loading reports:', error);
      Alert.alert('Erreur', 'Impossible de charger les signalements');
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    let cancelled = false;

    const checkAdminAccess = async () => {
      if (!user) {
        router.replace('/(tabs)');
        return;
      }
      const adminStatus = await UserService.isUserAdmin(user.id);
      if (cancelled) return;
      if (!adminStatus) {
        Alert.alert('Accès refusé', 'Vous n\'avez pas les droits d\'administrateur', [
          { text: 'OK', onPress: () => router.replace('/(tabs)') },
        ]);
        return;
      }
      setIsAdmin(true);
    };

    checkAdminAccess();
    return () => {
      cancelled = true;
    };
  }, [user, router]);

  useEffect(() => {
    if (isAdmin) {
      (async () => {
        await loadReports();
      })();
    }
  }, [isAdmin, loadReports]);

  const triage = useCallback(
    async (report: PendingReport, outcome: ReportOutcome) => {
      try {
        setProcessingId(report.id);
        await callTriageReport({ reportId: report.id, outcome });
        // Optimistic removal: the report leaves the pending queue.
        setReports((prev) => prev.filter((r) => r.id !== report.id));
      } catch (error) {
        if (__DEV__) console.error('Error triaging report:', error);
        Alert.alert('Erreur', 'Impossible de traiter le signalement');
      } finally {
        setProcessingId(null);
      }
    },
    [],
  );

  const confirmTriage = useCallback(
    (report: PendingReport, outcome: ReportOutcome) => {
      const labels: Record<ReportOutcome, { title: string; action: string }> = {
        resolved: { title: 'Valider le signalement', action: 'Valider' },
        dismissed: { title: 'Rejeter le signalement', action: 'Rejeter' },
        reviewed: { title: 'Marquer comme examiné', action: 'Marquer' },
      };
      const { title, action } = labels[outcome];
      Alert.alert(
        title,
        `${formatTargetType(report.targetType)} — ${formatReason(report.reason)}`,
        [
          { text: 'Annuler', style: 'cancel' },
          {
            text: action,
            style: outcome === 'dismissed' ? 'destructive' : 'default',
            onPress: () => triage(report, outcome),
          },
        ],
      );
    },
    [triage],
  );

  const renderReportItem = useCallback(
    ({ item }: { item: PendingReport }) => (
      <ReportCard
        report={item}
        isProcessing={processingId === item.id}
        onResolve={() => confirmTriage(item, 'resolved')}
        onDismiss={() => confirmTriage(item, 'dismissed')}
        onReview={() => confirmTriage(item, 'reviewed')}
      />
    ),
    [processingId, confirmTriage],
  );

  const renderEmpty = useCallback(
    () => (
      <View style={styles.emptyContainer}>
        <Ionicons name="shield-checkmark-outline" size={64} color={colors.muted} />
        <Text style={styles.emptyTitle}>Aucun signalement</Text>
        <Text style={styles.emptyText}>
          Aucun signalement en attente de traitement
        </Text>
      </View>
    ),
    [],
  );

  if (!isAdmin) {
    return (
      <SafeAreaView style={styles.container} edges={['top']}>
        <View style={styles.skeletonContainer}>
          {Array.from({ length: 3 }).map((_, i) => (
            <ReportCardSkeleton key={i} />
          ))}
        </View>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.container} edges={['top']}>
      {/* Header */}
      <View style={styles.header}>
        <View style={styles.headerContent}>
          <Pressable
            onPress={() => router.back()}
            hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
          >
            <Ionicons name="chevron-back" size={24} color={colors.foreground} />
          </Pressable>
          <View style={styles.headerTextContainer}>
            <Text style={styles.headerTitle}>Panel Admin</Text>
            <Text style={styles.headerSubtitle}>Signalements en attente</Text>
          </View>
        </View>
        <Pressable
          onPress={loadReports}
          hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
        >
          <Ionicons name="refresh" size={24} color={colors.primary} />
        </Pressable>
      </View>

      {/* Liste des signalements */}
      {isLoading ? (
        <View style={styles.skeletonContainer}>
          {Array.from({ length: 4 }).map((_, i) => (
            <ReportCardSkeleton key={i} />
          ))}
        </View>
      ) : (
        <FlashList
          data={reports}
          renderItem={renderReportItem}
          keyExtractor={keyExtractor}
          ListEmptyComponent={renderEmpty}
          contentContainerStyle={styles.listContent}
          showsVerticalScrollIndicator={false}
        />
      )}
    </SafeAreaView>
  );
}

const keyExtractor = (item: PendingReport) => item.id;

// =============================================================================
// REPORT CARD
// =============================================================================

interface ReportCardProps {
  report: PendingReport;
  isProcessing: boolean;
  onResolve: () => void;
  onDismiss: () => void;
  onReview: () => void;
}

const ReportCard = React.memo(function ReportCard({
  report,
  isProcessing,
  onResolve,
  onDismiss,
  onReview,
}: ReportCardProps) {
  return (
    <View style={styles.card}>
      <View style={styles.cardHeader}>
        <View style={styles.targetBadge}>
          <Text style={styles.targetBadgeText}>
            {formatTargetType(report.targetType)}
          </Text>
        </View>
        {!!report.createdAt && (
          <Text style={styles.cardDate}>{formatDate(report.createdAt)}</Text>
        )}
      </View>

      <Text style={styles.cardReason}>{formatReason(report.reason)}</Text>

      {!!report.description && (
        <Text style={styles.cardDescription} numberOfLines={4}>
          {report.description}
        </Text>
      )}

      <View style={styles.metaRow}>
        <Ionicons name="person-outline" size={14} color={colors.muted} />
        <Text style={styles.metaText} numberOfLines={1}>
          Signalé par {report.reporterName ?? 'Utilisateur inconnu'}
        </Text>
      </View>
      {!!report.targetId && (
        <View style={styles.metaRow}>
          <Ionicons name="pricetag-outline" size={14} color={colors.muted} />
          <Text style={styles.metaText} numberOfLines={1}>
            Cible : {report.targetId}
          </Text>
        </View>
      )}

      <View style={styles.actions}>
        <Pressable
          style={[styles.actionButton, styles.dismissButton]}
          onPress={onDismiss}
          disabled={isProcessing}
        >
          <Text style={styles.dismissButtonText}>Rejeter</Text>
        </Pressable>
        <Pressable
          style={[styles.actionButton, styles.reviewButton]}
          onPress={onReview}
          disabled={isProcessing}
        >
          <Text style={styles.reviewButtonText}>Examiné</Text>
        </Pressable>
        <Pressable
          style={[styles.actionButton, styles.resolveButton]}
          onPress={onResolve}
          disabled={isProcessing}
        >
          <Text style={styles.resolveButtonText}>Valider</Text>
        </Pressable>
      </View>
    </View>
  );
});

// =============================================================================
// SKELETON
// =============================================================================

const ReportCardSkeleton = React.memo(function ReportCardSkeleton() {
  return (
    <View style={styles.card}>
      <View style={styles.cardHeader}>
        <Skeleton width={90} height={24} borderRadius={radius.sm} />
        <Skeleton width={70} height={14} borderRadius={radius.sm} />
      </View>
      <Skeleton width={160} height={18} borderRadius={radius.sm} style={styles.skeletonReason} />
      <SkeletonText lines={2} style={styles.skeletonDescription} />
      <View style={styles.actions}>
        <Skeleton width={80} height={40} borderRadius={radius.md} />
        <Skeleton width={80} height={40} borderRadius={radius.md} />
        <Skeleton width={80} height={40} borderRadius={radius.md} />
      </View>
    </View>
  );
});

// =============================================================================
// STYLES
// =============================================================================

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.background,
  },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.md,
    backgroundColor: colors.white,
    borderBottomWidth: 1,
    borderBottomColor: colors.surfaceWarm,
  },
  headerContent: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm + 4,
    flex: 1,
  },
  headerTextContainer: {
    flex: 1,
  },
  headerTitle: {
    fontSize: typography.h3.fontSize,
    fontWeight: '700',
    color: colors.foreground,
  },
  headerSubtitle: {
    fontSize: typography.bodySmall.fontSize,
    color: colors.muted,
  },
  listContent: {
    padding: spacing.md,
  },
  card: {
    backgroundColor: colors.white,
    borderRadius: radius.xl,
    padding: spacing.md,
    marginBottom: spacing.sm + 4,
    borderWidth: 1,
    borderColor: colors.surfaceWarm,
  },
  cardHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: spacing.sm + 4,
  },
  targetBadge: {
    backgroundColor: colors.primaryLight,
    paddingHorizontal: spacing.sm + 2,
    paddingVertical: spacing.xs,
    borderRadius: radius.sm,
  },
  targetBadgeText: {
    fontSize: typography.caption.fontSize,
    fontWeight: '700',
    color: colors.primary,
  },
  cardDate: {
    fontSize: typography.caption.fontSize,
    color: colors.muted,
  },
  cardReason: {
    fontSize: typography.body.fontSize,
    fontWeight: '700',
    color: colors.foreground,
    marginBottom: spacing.xs,
  },
  cardDescription: {
    fontSize: typography.bodySmall.fontSize,
    color: colors.foregroundSecondary,
    marginBottom: spacing.sm + 4,
    lineHeight: 20,
  },
  metaRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs + 2,
    marginBottom: spacing.xs,
  },
  metaText: {
    fontSize: typography.bodySmall.fontSize,
    color: colors.muted,
    flex: 1,
  },
  actions: {
    flexDirection: 'row',
    gap: spacing.sm,
    marginTop: spacing.md,
  },
  actionButton: {
    flex: 1,
    paddingVertical: spacing.sm + 4,
    borderRadius: radius.md,
    alignItems: 'center',
    justifyContent: 'center',
  },
  dismissButton: {
    backgroundColor: colors.surfaceWarm,
  },
  dismissButtonText: {
    fontSize: typography.bodySmall.fontSize,
    fontWeight: '600',
    color: colors.foregroundSecondary,
  },
  reviewButton: {
    backgroundColor: colors.warningLight,
  },
  reviewButtonText: {
    fontSize: typography.bodySmall.fontSize,
    fontWeight: '600',
    color: colors.warning,
  },
  resolveButton: {
    backgroundColor: colors.success,
  },
  resolveButtonText: {
    fontSize: typography.bodySmall.fontSize,
    fontWeight: '600',
    color: colors.white,
  },
  skeletonContainer: {
    flex: 1,
    padding: spacing.md,
  },
  skeletonReason: {
    marginBottom: spacing.sm,
  },
  skeletonDescription: {
    marginBottom: spacing.md,
  },
  emptyContainer: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: spacing['4xl'],
    gap: spacing.md,
  },
  emptyTitle: {
    fontSize: typography.h3.fontSize,
    fontWeight: '700',
    color: colors.foreground,
  },
  emptyText: {
    fontSize: typography.body.fontSize,
    color: colors.muted,
    textAlign: 'center',
    paddingHorizontal: spacing['2xl'],
  },
});
