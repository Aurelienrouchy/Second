/**
 * Admin Panel — Disputes Review + Resolution (F27/F88 + F10 + F26 + F48)
 *
 * Liste les litiges (`disputes/{id}`) ouverts par les callables serveur
 * (`reportTransactionProblem` / `reportMeetupNoShow`, Admin SDK + runTransaction).
 * Un litige gèle la transaction sous-jacente (`disputed=true`) : sans résolution
 * admin, ces transactions ET la suppression de compte des deux parties restaient
 * gelées indéfiniment. Cet écran RÉSOUT désormais les litiges.
 *
 * SÉCURITÉ / RÔLES : la lecture des `disputes` est autorisée aux admins par
 * firestore.rules (request.auth.token.admin). Aucun write client n'est permis
 * (creation/update/delete: false) — la RÉSOLUTION passe EXCLUSIVEMENT par des
 * callables serveur admin-only (double garde) :
 *   - `adminRefundTransaction` → rembourse l'acheteur + clôt le dispute,
 *   - `resolveDispute`         → clôt en faveur du vendeur (sans remboursement),
 *   - `resolveSwapDispute`     → litige SWAP (rembourse le payeur OU libère le
 *                                bénéficiaire). Les swaps disputed ne créent PAS
 *                                de doc `disputes` (et les rules limitent leur
 *                                lecture aux participants) : la résolution se
 *                                fait par saisie manuelle du swapId (issu du
 *                                ticket support / logs).
 *
 * Suit les conventions de app/admin/reports.tsx (état local, FlashList,
 * Skeleton, tokens DS, useUser, défense en profondeur). L'accès admin est
 * garanti par app/admin/_layout.tsx (vérification re-jouée ici par cohérence).
 */

import { Skeleton, SkeletonText } from '@/components/ui/Skeleton';
import { firestore } from '@/config/firebaseConfig';
import { APP_LOCALE } from '@/constants/locale';
import { useUser } from '@/hooks/useAuth';
import { TransactionService } from '@/services/transactionService';
import { resolveSwapDispute } from '@/services/swapService';
import { UserService } from '@/services/userService';
import { Ionicons } from '@expo/vector-icons';
import { FlashList } from '@shopify/flash-list';
import { useRouter } from 'expo-router';
import {
  collection,
  getDocs,
  limit as fbLimit,
  orderBy,
  query,
} from 'firebase/firestore';
import React, { useCallback, useEffect, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { colors, radius, spacing, typography } from '@/constants/theme';

// =============================================================================
// TYPES (Firestore `disputes` doc — see functions/src/callable/payments.ts,
// functions/src/callable/recourse.ts)
// =============================================================================

type DisputeStatus = 'open' | 'resolved' | 'dismissed' | string;

interface Dispute {
  id: string;
  transactionId: string | null;
  type: string | null;
  buyerId: string | null;
  sellerId: string | null;
  articleId: string | null;
  articleTitle: string | null;
  reportedBy: string | null;
  reportedAgainst: string | null;
  reason: string | null;
  details: string | null;
  status: DisputeStatus;
  statusBeforeDispute: string | null;
  createdAt: Date | null;
}

const DISPUTES_PAGE_SIZE = 50;

// =============================================================================
// HELPERS
// =============================================================================

const DISPUTE_TYPE_LABELS: Record<string, string> = {
  meetup_no_show: 'Rencontre manquée',
  transaction_problem: 'Problème de transaction',
};

const DISPUTE_REASON_LABELS: Record<string, string> = {
  not_received: 'Article non reçu',
  not_as_described: 'Non conforme à la description',
  damaged: 'Article endommagé',
  counterfeit: 'Contrefaçon suspectée',
  other_party_no_show: "L'autre partie ne s'est pas présentée",
  cancelled_last_minute: 'Annulation de dernière minute',
  unsafe_situation: 'Situation dangereuse',
  other: 'Autre',
};

function formatDisputeType(type: string | null): string {
  if (type && type in DISPUTE_TYPE_LABELS) return DISPUTE_TYPE_LABELS[type];
  return 'Litige';
}

function formatReason(reason: string | null): string {
  if (reason && reason in DISPUTE_REASON_LABELS) return DISPUTE_REASON_LABELS[reason];
  return 'Raison non précisée';
}

function formatStatus(status: DisputeStatus): string {
  switch (status) {
    case 'open':
      return 'Ouvert';
    case 'resolved':
      return 'Résolu';
    case 'dismissed':
      return 'Rejeté';
    default:
      return status;
  }
}

function formatDate(date: Date | null): string {
  if (!date || Number.isNaN(date.getTime())) return '';
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

type TabType = 'open' | 'all' | 'swaps';

export default function AdminDisputesScreen() {
  const router = useRouter();
  const user = useUser();
  const [selectedTab, setSelectedTab] = useState<TabType>('open');
  const [disputes, setDisputes] = useState<Dispute[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isAdmin, setIsAdmin] = useState(false);
  // Per-dispute action in flight (keyed by dispute id) — disables both buttons.
  const [resolvingId, setResolvingId] = useState<string | null>(null);

  const loadDisputes = useCallback(async (tab: TabType) => {
    try {
      setIsLoading(true);
      // Admin read is granted by firestore.rules; client SDK query is allowed.
      // We query ONLY by createdAt desc (single-field index, auto-provisioned)
      // and filter the "open" tab in-memory: no composite (status + createdAt)
      // index is defined in firestore.indexes.json (owned by firebase-backend),
      // so a server-side `where('status','==',…) + orderBy('createdAt')` would
      // fail at runtime with a missing-index error.
      const q = query(
        collection(firestore, 'disputes'),
        orderBy('createdAt', 'desc'),
        fbLimit(DISPUTES_PAGE_SIZE),
      );

      const snapshot = await getDocs(q);
      const all: Dispute[] = snapshot.docs.map((docSnapshot) => {
        const data = docSnapshot.data();
        return {
          id: docSnapshot.id,
          transactionId: typeof data.transactionId === 'string' ? data.transactionId : null,
          type: typeof data.type === 'string' ? data.type : null,
          buyerId: typeof data.buyerId === 'string' ? data.buyerId : null,
          sellerId: typeof data.sellerId === 'string' ? data.sellerId : null,
          articleId: typeof data.articleId === 'string' ? data.articleId : null,
          articleTitle: typeof data.articleTitle === 'string' ? data.articleTitle : null,
          reportedBy: typeof data.reportedBy === 'string' ? data.reportedBy : null,
          reportedAgainst:
            typeof data.reportedAgainst === 'string' ? data.reportedAgainst : null,
          reason: typeof data.reason === 'string' ? data.reason : null,
          details: typeof data.details === 'string' ? data.details : null,
          status: typeof data.status === 'string' ? data.status : 'open',
          statusBeforeDispute:
            typeof data.statusBeforeDispute === 'string' ? data.statusBeforeDispute : null,
          createdAt: data.createdAt?.toDate?.() ?? null,
        };
      });
      setDisputes(tab === 'open' ? all.filter((d) => d.status === 'open') : all);
    } catch (error) {
      if (__DEV__) console.error('Error loading disputes:', error);
      Alert.alert('Erreur', 'Impossible de charger les litiges');
    } finally {
      setIsLoading(false);
    }
  }, []);

  // F27/F88 — refund the buyer (closes the dispute too). Destructive: confirm.
  const handleRefundBuyer = useCallback(
    (dispute: Dispute) => {
      if (!dispute.transactionId) {
        Alert.alert('Action impossible', 'Ce litige n’est lié à aucune transaction.');
        return;
      }
      const txId = dispute.transactionId;
      Alert.alert(
        "Rembourser l'acheteur",
        "L'acheteur sera intégralement remboursé et le vendeur débité. Le litige sera clôturé. Cette action est irréversible.",
        [
          { text: 'Retour', style: 'cancel' },
          {
            text: "Rembourser l'acheteur",
            style: 'destructive',
            onPress: async () => {
              setResolvingId(dispute.id);
              try {
                await TransactionService.adminRefundTransaction(txId, 'admin_dispute_refund');
                Alert.alert('Remboursé', "L'acheteur a été remboursé et le litige clôturé.");
                await loadDisputes(selectedTab);
              } catch (error) {
                if (__DEV__) console.error('Error refunding dispute:', error);
                Alert.alert('Erreur', 'Le remboursement a échoué. Réessayez.');
              } finally {
                setResolvingId(null);
              }
            },
          },
        ],
      );
    },
    [loadDisputes, selectedTab],
  );

  // F27/F88 + F10 + F26 — close in favor of the seller (no refund).
  const handleResolveForSeller = useCallback(
    (dispute: Dispute) => {
      if (!dispute.transactionId) {
        Alert.alert('Action impossible', 'Ce litige n’est lié à aucune transaction.');
        return;
      }
      const txId = dispute.transactionId;
      Alert.alert(
        'Clôturer en faveur du vendeur',
        "Le litige sera clôturé sans remboursement : la transaction reprend son cours normal et les fonds éventuellement gelés sont restitués au vendeur.",
        [
          { text: 'Retour', style: 'cancel' },
          {
            text: 'Clôturer',
            onPress: async () => {
              setResolvingId(dispute.id);
              try {
                await TransactionService.resolveDispute(txId);
                Alert.alert('Litige clôturé', 'Le litige a été résolu en faveur du vendeur.');
                await loadDisputes(selectedTab);
              } catch (error) {
                if (__DEV__) console.error('Error resolving dispute for seller:', error);
                Alert.alert('Erreur', 'La clôture a échoué. Réessayez.');
              } finally {
                setResolvingId(null);
              }
            },
          },
        ],
      );
    },
    [loadDisputes, selectedTab],
  );

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
        Alert.alert('Accès refusé', "Vous n'avez pas les droits d'administrateur", [
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
    // The 'swaps' tab is a manual resolver (no firestore list — rules restrict
    // swap reads to participants), so we only load for the dispute-doc tabs.
    if (isAdmin && selectedTab !== 'swaps') {
      loadDisputes(selectedTab);
    }
  }, [isAdmin, selectedTab, loadDisputes]);

  const renderDisputeItem = useCallback(
    ({ item }: { item: Dispute }) => (
      <DisputeCard
        dispute={item}
        isResolving={resolvingId === item.id}
        actionsDisabled={resolvingId !== null}
        onRefundBuyer={handleRefundBuyer}
        onResolveForSeller={handleResolveForSeller}
      />
    ),
    [resolvingId, handleRefundBuyer, handleResolveForSeller],
  );

  const renderEmpty = useCallback(
    () => (
      <View style={styles.emptyContainer}>
        <Ionicons name="shield-checkmark-outline" size={64} color={colors.muted} />
        <Text style={styles.emptyTitle}>Aucun litige</Text>
        <Text style={styles.emptyText}>
          {selectedTab === 'open'
            ? 'Aucun litige en attente de résolution'
            : 'Aucun litige enregistré'}
        </Text>
      </View>
    ),
    [selectedTab],
  );

  if (!isAdmin) {
    return (
      <SafeAreaView style={styles.container} edges={['top']}>
        <View style={styles.skeletonContainer}>
          {Array.from({ length: 3 }).map((_, i) => (
            <DisputeCardSkeleton key={i} />
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
            <Text style={styles.headerSubtitle}>Litiges</Text>
          </View>
        </View>
        <Pressable
          onPress={() => loadDisputes(selectedTab)}
          hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
        >
          <Ionicons name="refresh" size={24} color={colors.primary} />
        </Pressable>
      </View>

      {/* Tabs */}
      <View style={styles.tabs}>
        <Pressable
          style={[styles.tab, selectedTab === 'open' && styles.tabActive]}
          onPress={() => setSelectedTab('open')}
        >
          <Text style={[styles.tabText, selectedTab === 'open' && styles.tabTextActive]}>
            Ouverts
          </Text>
        </Pressable>
        <Pressable
          style={[styles.tab, selectedTab === 'all' && styles.tabActive]}
          onPress={() => setSelectedTab('all')}
        >
          <Text style={[styles.tabText, selectedTab === 'all' && styles.tabTextActive]}>
            Tous
          </Text>
        </Pressable>
        <Pressable
          style={[styles.tab, selectedTab === 'swaps' && styles.tabActive]}
          onPress={() => setSelectedTab('swaps')}
        >
          <Text style={[styles.tabText, selectedTab === 'swaps' && styles.tabTextActive]}>
            Swaps
          </Text>
        </Pressable>
      </View>

      {selectedTab === 'swaps' ? (
        <SwapDisputeResolver />
      ) : isLoading ? (
        <View style={styles.skeletonContainer}>
          {Array.from({ length: 4 }).map((_, i) => (
            <DisputeCardSkeleton key={i} />
          ))}
        </View>
      ) : (
        <FlashList
          data={disputes}
          renderItem={renderDisputeItem}
          keyExtractor={keyExtractor}
          ListEmptyComponent={renderEmpty}
          contentContainerStyle={styles.listContent}
          showsVerticalScrollIndicator={false}
        />
      )}
    </SafeAreaView>
  );
}

const keyExtractor = (item: Dispute) => item.id;

// =============================================================================
// DISPUTE CARD (read-only)
// =============================================================================

interface DisputeCardProps {
  dispute: Dispute;
  isResolving: boolean;
  actionsDisabled: boolean;
  onRefundBuyer: (dispute: Dispute) => void;
  onResolveForSeller: (dispute: Dispute) => void;
}

const DisputeCard = React.memo(function DisputeCard({
  dispute,
  isResolving,
  actionsDisabled,
  onRefundBuyer,
  onResolveForSeller,
}: DisputeCardProps) {
  const isOpen = dispute.status === 'open';
  return (
    <View style={styles.card}>
      <View style={styles.cardHeader}>
        <View style={styles.typeBadge}>
          <Text style={styles.typeBadgeText}>{formatDisputeType(dispute.type)}</Text>
        </View>
        <View style={[styles.statusBadge, !isOpen && styles.statusBadgeClosed]}>
          <Text style={[styles.statusBadgeText, !isOpen && styles.statusBadgeTextClosed]}>
            {formatStatus(dispute.status)}
          </Text>
        </View>
      </View>

      <Text style={styles.cardTitle} numberOfLines={2}>
        {dispute.articleTitle ?? 'Article inconnu'}
      </Text>
      <Text style={styles.cardReason}>{formatReason(dispute.reason)}</Text>

      {!!dispute.details && (
        <Text style={styles.cardDescription} numberOfLines={4}>
          {dispute.details}
        </Text>
      )}

      {!!dispute.transactionId && (
        <View style={styles.metaRow}>
          <Ionicons name="receipt-outline" size={14} color={colors.muted} />
          <Text style={styles.metaText} numberOfLines={1}>
            Transaction : {dispute.transactionId}
          </Text>
        </View>
      )}
      {!!dispute.buyerId && (
        <View style={styles.metaRow}>
          <Ionicons name="bag-handle-outline" size={14} color={colors.muted} />
          <Text style={styles.metaText} numberOfLines={1}>
            Acheteur : {dispute.buyerId}
          </Text>
        </View>
      )}
      {!!dispute.sellerId && (
        <View style={styles.metaRow}>
          <Ionicons name="storefront-outline" size={14} color={colors.muted} />
          <Text style={styles.metaText} numberOfLines={1}>
            Vendeur : {dispute.sellerId}
          </Text>
        </View>
      )}
      {!!dispute.reportedBy && (
        <View style={styles.metaRow}>
          <Ionicons name="person-outline" size={14} color={colors.muted} />
          <Text style={styles.metaText} numberOfLines={1}>
            Signalé par : {dispute.reportedBy}
          </Text>
        </View>
      )}
      {!!dispute.createdAt && (
        <Text style={styles.cardDate}>{formatDate(dispute.createdAt)}</Text>
      )}

      {/* Resolution actions — only on OPEN disputes linked to a transaction. */}
      {isOpen && !!dispute.transactionId && (
        <View style={styles.actionsRow}>
          {isResolving ? (
            <View style={styles.actionsLoading}>
              <ActivityIndicator size="small" color={colors.primary} />
            </View>
          ) : (
            <>
              <Pressable
                style={[styles.actionBtn, styles.refundBtn, actionsDisabled && styles.actionBtnDisabled]}
                onPress={() => onRefundBuyer(dispute)}
                disabled={actionsDisabled}
              >
                <Ionicons name="cash-outline" size={16} color={colors.white} />
                <Text style={styles.refundBtnText}>Rembourser l&apos;acheteur</Text>
              </Pressable>
              <Pressable
                style={[styles.actionBtn, styles.dismissBtn, actionsDisabled && styles.actionBtnDisabled]}
                onPress={() => onResolveForSeller(dispute)}
                disabled={actionsDisabled}
              >
                <Ionicons name="shield-checkmark-outline" size={16} color={colors.foreground} />
                <Text style={styles.dismissBtnText}>Clôturer (vendeur)</Text>
              </Pressable>
            </>
          )}
        </View>
      )}
    </View>
  );
});

// =============================================================================
// SWAP DISPUTE RESOLVER (F48) — manual swapId entry (swaps don't create
// `disputes` docs, and firestore.rules restrict swap reads to participants, so
// an admin resolves by swapId pulled from the support ticket / logs).
// =============================================================================

const SwapDisputeResolver = React.memo(function SwapDisputeResolver() {
  const [swapId, setSwapId] = useState('');
  const [issue, setIssue] = useState<'refund_payer' | 'release_payee'>('refund_payer');
  const [isSubmitting, setIsSubmitting] = useState(false);

  const handleResolve = useCallback(() => {
    const trimmed = swapId.trim();
    if (!trimmed) {
      Alert.alert('swapId requis', "Saisissez l'identifiant du swap à résoudre.");
      return;
    }
    const label =
      issue === 'refund_payer'
        ? 'Rembourser le payeur (et libérer les articles)'
        : 'Libérer le bénéficiaire (l’échange est validé)';
    Alert.alert(
      'Résoudre le litige swap',
      `${label}\n\nCette action est irréversible.`,
      [
        { text: 'Retour', style: 'cancel' },
        {
          text: 'Confirmer',
          style: issue === 'refund_payer' ? 'destructive' : 'default',
          onPress: async () => {
            setIsSubmitting(true);
            try {
              await resolveSwapDispute(trimmed, issue);
              Alert.alert('Litige swap résolu', 'Le swap a été traité.');
              setSwapId('');
            } catch (error) {
              if (__DEV__) console.error('Error resolving swap dispute:', error);
              Alert.alert(
                'Erreur',
                'La résolution a échoué. Vérifiez le swapId (le swap doit être en litige).',
              );
            } finally {
              setIsSubmitting(false);
            }
          },
        },
      ],
    );
  }, [swapId, issue]);

  return (
    <View style={styles.swapResolver}>
      <Text style={styles.swapResolverTitle}>Résoudre un litige d&apos;échange</Text>
      <Text style={styles.swapResolverHelp}>
        Les swaps en litige n&apos;apparaissent pas dans la liste ci-dessus. Saisissez le swapId
        (issu du ticket support / des logs) pour le résoudre.
      </Text>

      <TextInput
        style={styles.swapInput}
        value={swapId}
        onChangeText={setSwapId}
        placeholder="swapId"
        placeholderTextColor={colors.muted}
        autoCapitalize="none"
        autoCorrect={false}
        editable={!isSubmitting}
      />

      <View style={styles.issueSelector}>
        <Pressable
          style={[styles.issueOption, issue === 'refund_payer' && styles.issueOptionActive]}
          onPress={() => setIssue('refund_payer')}
          disabled={isSubmitting}
        >
          <Text
            style={[styles.issueOptionText, issue === 'refund_payer' && styles.issueOptionTextActive]}
          >
            Rembourser le payeur
          </Text>
        </Pressable>
        <Pressable
          style={[styles.issueOption, issue === 'release_payee' && styles.issueOptionActive]}
          onPress={() => setIssue('release_payee')}
          disabled={isSubmitting}
        >
          <Text
            style={[styles.issueOptionText, issue === 'release_payee' && styles.issueOptionTextActive]}
          >
            Libérer le bénéficiaire
          </Text>
        </Pressable>
      </View>

      <Pressable
        style={[styles.swapResolveBtn, isSubmitting && styles.actionBtnDisabled]}
        onPress={handleResolve}
        disabled={isSubmitting}
      >
        {isSubmitting ? (
          <ActivityIndicator size="small" color={colors.white} />
        ) : (
          <Text style={styles.swapResolveBtnText}>Résoudre le litige</Text>
        )}
      </Pressable>
    </View>
  );
});

// =============================================================================
// SKELETON
// =============================================================================

const DisputeCardSkeleton = React.memo(function DisputeCardSkeleton() {
  return (
    <View style={styles.card}>
      <View style={styles.cardHeader}>
        <Skeleton width={120} height={24} borderRadius={radius.sm} />
        <Skeleton width={70} height={24} borderRadius={radius.sm} />
      </View>
      <Skeleton width={180} height={18} borderRadius={radius.sm} style={styles.skeletonTitle} />
      <Skeleton width={140} height={16} borderRadius={radius.sm} style={styles.skeletonReason} />
      <SkeletonText lines={2} style={styles.skeletonDescription} />
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
  tabs: {
    flexDirection: 'row',
    backgroundColor: colors.white,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm + 4,
    gap: spacing.sm,
    borderBottomWidth: 1,
    borderBottomColor: colors.surfaceWarm,
  },
  tab: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.xs + 2,
    paddingVertical: spacing.sm + 2,
    borderRadius: radius.md,
    backgroundColor: colors.surfaceWarm,
  },
  tabActive: {
    backgroundColor: colors.primary,
  },
  tabText: {
    fontSize: typography.bodySmall.fontSize,
    fontWeight: '600',
    color: colors.muted,
  },
  tabTextActive: {
    color: colors.white,
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
  typeBadge: {
    backgroundColor: colors.primaryLight,
    paddingHorizontal: spacing.sm + 2,
    paddingVertical: spacing.xs,
    borderRadius: radius.sm,
  },
  typeBadgeText: {
    fontSize: typography.caption.fontSize,
    fontWeight: '700',
    color: colors.primary,
  },
  statusBadge: {
    backgroundColor: colors.warningLight,
    paddingHorizontal: spacing.sm + 2,
    paddingVertical: spacing.xs,
    borderRadius: radius.sm,
  },
  statusBadgeText: {
    fontSize: typography.caption.fontSize,
    fontWeight: '700',
    color: colors.warning,
  },
  statusBadgeClosed: {
    backgroundColor: colors.surfaceWarm,
  },
  statusBadgeTextClosed: {
    color: colors.foregroundSecondary,
  },
  cardTitle: {
    fontSize: typography.body.fontSize,
    fontWeight: '700',
    color: colors.foreground,
    marginBottom: spacing.xs,
  },
  cardReason: {
    fontSize: typography.bodySmall.fontSize,
    fontWeight: '600',
    color: colors.foregroundSecondary,
    marginBottom: spacing.sm,
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
  cardDate: {
    fontSize: typography.caption.fontSize,
    color: colors.muted,
    marginTop: spacing.xs,
  },
  skeletonContainer: {
    flex: 1,
    padding: spacing.md,
  },
  skeletonTitle: {
    marginBottom: spacing.sm,
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
