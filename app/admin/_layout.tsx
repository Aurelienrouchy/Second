import React from 'react';
import { ScrollView, StyleSheet, Text, View } from 'react-native';
import { Redirect, Slot, usePathname } from 'expo-router';
import { useQuery } from '@tanstack/react-query';
import { useAuthGuardSession, useAuthenticatedUid } from '@/hooks/useAuth';
import { Button } from '@/components/ui/Button';
import { Skeleton } from '@/components/ui/Skeleton';
import { colors, radius, spacing, typography } from '@/constants/theme';
import { UserService } from '@/services/userService';
import { getAuthSessionGeneration } from '@/store/authStore';
import { SupportRequestService } from '@/services/supportRequestService';
import { AccountAccessAdminService } from '@/features/admin/services/accountAccessAdminService';
import { assertTradeSessionCurrent, captureTradeSession } from '@/services/tradeOperation';
import { FraudReviewService } from '@/services/fraudReviewService';
import { AdminTransportFinancialHistory, AdminProductFinancialHistory, AdminPurchaseRefundHistory, AdminRefundRepairHistory, AdminLateCommercialReview, AdminExceptionalRestitutionHistory, AdminOrphanCaptureRefundHistory } from '@/features/admin';
import { ProductReviewHistory } from '@/components/ProductReviewHistory';
import { BankDisputeCommandHistory } from '@/components/BankDisputeCommandHistory';
import { BankRefundReconciliationCommandHistory } from '@/components/BankRefundReconciliationCommandHistory';
import { SwapDisputeReviewCommandHistory } from '@/components/SwapDisputeReviewCommandHistory';
import { ReturnDepositDeadlineCommandHistory } from '@/components/ReturnDepositDeadlineCommandHistory';
import { LabelLifecycleOwnHistory } from '@/components/LabelLifecycleOwnHistory';
import { LabelLifecycleService } from '@/services/labelLifecycleService';
import { useLabelLifecycleContext } from '@/hooks/useLabelLifecycleContext';
/** Identity-only admission management is opt-in. Other admin routes keep the normal account gate. */
export default function AdminLayout() {
  const { normalUser, identity, isAuthLoading } = useAuthGuardSession();
  const pathname = usePathname();
  const sdkUid = useAuthenticatedUid();
  const labelRoute = pathname === '/admin/label-lifecycle';
  const privacyReceiptRoute = pathname === '/admin/privacy-incidents';
  const labelFrame = useLabelLifecycleContext(`label-lifecycle-layout:${pathname}`, sdkUid);
  const user = pathname === '/admin/eligibility' ? identity : normalUser;
  const uid = labelRoute || privacyReceiptRoute || pathname === '/admin/tax' || pathname === '/admin/support' || pathname === '/admin/reports' || pathname === '/admin/account-access' || pathname === '/admin/fraud-reviews' || pathname === '/admin/transport-reviews' || pathname === '/admin/disputes' || pathname === '/admin/product-reviews' ? sdkUid : user?.id;
  const permission = useQuery({ queryKey: ['admin-layout-permission', uid ?? '', pathname, getAuthSessionGeneration(), labelRoute ? labelFrame.focusRevision : null],
    queryFn: async () => {
      const generation = getAuthSessionGeneration();
      const session = captureTradeSession(uid ?? undefined);
      const labelOp = labelRoute ? labelFrame.capture() : null;
      const allowed = labelRoute ? !!await LabelLifecycleService.queue(session.uid, null, () => {assertTradeSessionCurrent(session); if (!labelOp) throw new Error('Relisez l’accès opérateur.'); labelFrame.assertCurrent(labelOp);}) : pathname === '/admin/fraud-reviews' ?
        !!await FraudReviewService.list(session.uid, 'admin', null, null, () => assertTradeSessionCurrent(session)) : pathname === '/admin/account-access' ?
        !!await AccountAccessAdminService.list(session.uid, undefined, () => assertTradeSessionCurrent(session)) : (pathname === '/admin/support' || pathname === '/admin/reports' || pathname === '/admin/transport-reviews' || pathname === '/admin/disputes' || pathname === '/admin/product-reviews') ?
        !!await SupportRequestService.list(session.uid, 'admin', undefined, () => assertTradeSessionCurrent(session)) :
        await UserService.isUserAdmin(session.uid);
      assertTradeSessionCurrent(session);
      if (generation !== getAuthSessionGeneration()) throw new Error('La session a changé.');
      return allowed;
    }, enabled: !!uid && !isAuthLoading && !privacyReceiptRoute && pathname !== '/admin/reports' && pathname !== '/admin/support' && pathname !== '/admin/transport-reviews' && pathname !== '/admin/tax' && (!labelRoute || labelFrame.focused), staleTime: 0, gcTime: 0, retry: false });
  if ((privacyReceiptRoute || pathname === '/admin/reports' || pathname === '/admin/support' || pathname === '/admin/transport-reviews' || pathname === '/admin/tax') && sdkUid) return <Slot />;
  if (pathname === '/admin/product-reviews' && sdkUid && (permission.isError || permission.data !== true || isAuthLoading)) return <ScrollView><ProductReviewHistory uid={sdkUid} /><AdminLateCommercialReview uid={sdkUid} supportRequestId={null} /></ScrollView>;
  if (pathname === '/admin/disputes' && sdkUid && (isAuthLoading || permission.isError || permission.isFetching || permission.data !== true || normalUser?.id !== sdkUid)) return <ScrollView><AdminExceptionalRestitutionHistory uid={sdkUid} /><AdminOrphanCaptureRefundHistory uid={sdkUid} /><AdminTransportFinancialHistory uid={sdkUid} /><AdminProductFinancialHistory uid={sdkUid} /><AdminPurchaseRefundHistory uid={sdkUid} /><AdminRefundRepairHistory uid={sdkUid} /><BankDisputeCommandHistory uid={sdkUid} scope="admin" /><BankRefundReconciliationCommandHistory uid={sdkUid} /><SwapDisputeReviewCommandHistory uid={sdkUid} /><ReturnDepositDeadlineCommandHistory uid={sdkUid} /></ScrollView>;
  if (isAuthLoading || (uid && (permission.isPending || permission.isFetching))) return <View style={styles.center}><Skeleton width={48} height={48} borderRadius={radius.md} /></View>;

  if (labelRoute && sdkUid && (permission.isError || permission.data !== true)) return <ScrollView><LabelLifecycleOwnHistory uid={sdkUid} /></ScrollView>;

  if ((pathname === '/admin/support' || pathname === '/admin/reports' || pathname === '/admin/transport-reviews') && sdkUid && (permission.isError || permission.data !== true)) return <Slot />;
  if (uid && permission.isError) return <View style={styles.center}><Text style={styles.error}>Impossible de vérifier les permissions.</Text><Button onPress={() => { void permission.refetch(); }}>Réessayer</Button></View>;
  if (!uid || permission.data !== true) return <Redirect href="/(tabs)" />;
  return <Slot />;
}
const styles = StyleSheet.create({ center: { flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.background, gap: spacing.md },
  error: { ...typography.body, color: colors.danger } });
