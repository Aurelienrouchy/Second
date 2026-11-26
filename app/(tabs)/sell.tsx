import { serializeRouteParam } from '@/features/sell/utils/routeParams';
import { staleTradeOperation } from '@/services/tradeOperation';
import { useAuthenticatedUid } from '@/hooks/useAuth';
import { useTradeOperation } from '@/hooks/useTradeOperation';
import { useTradeAdmissionError } from '@/hooks/useTradeAdmissionError';
import { assertSalePreparationAdmission, eligibilityReadUnavailable } from '@/services/newSaleAdmission';
import { useAuthSheetStore } from '@/store/authSheetStore';
import { useFocusEffect, useRouter } from 'expo-router';
import { useCallback, useState, useRef, useLayoutEffect } from 'react';
import { Alert, View, StyleSheet, Platform } from 'react-native';
import DraftResumeModal from '@/features/sell/components/shared/DraftResumeModal';
import draftService, { ArticleDraft, hasDraftProgress } from '@/features/sell/services/draftService';
import { track } from '@/lib/analytics';
import { colors, radius } from '@/constants/theme';
import { Skeleton } from '@/components/ui/Skeleton';

const platform = Platform.OS === 'ios' ? 'ios' : 'android';

function draftStepLabel(step: number): '1' | '1b' | '2' | '3' | '4' {
  if (step >= 4) return '4';
  if (step >= 3) return '3';
  if (step >= 2) return '2';
  return '1';
}

/**
 * Sell Tab Entry Point
 *
 * For the immersive overlay prototype the sell flow content is rendered
 * directly inside the overlay (see SellOverlayContent in _layout.tsx).
 * This tab screen is kept as a fallback / placeholder and handles
 * draft resume logic when navigated to directly.
 */
export default function SellTabScreen() {
  const router = useRouter();
  const uid = useAuthenticatedUid();
  const entry = useTradeOperation('sell-fallback', uid);
  const showAdmissionError = useTradeAdmissionError();
  const [retryRevision, setRetryRevision] = useState(0);

  const [draft, setDraft] = useState<ArticleDraft | null>(null);
  const [showModal, setShowModal] = useState(false);
  const [isChecking, setIsChecking] = useState(false);

  const isCheckingRef = useRef(false);
  const showModalRef = useRef(false);
  const [ownerFrame, setOwnerFrame] = useState(entry.frame);
  if (ownerFrame !== entry.frame) {
    setOwnerFrame(entry.frame); setDraft(null); setShowModal(false);
  }

  useLayoutEffect(() => { showModalRef.current = false; isCheckingRef.current = false; }, [entry.frame]);

  useFocusEffect(
    useCallback(() => {
      if (isCheckingRef.current || showModalRef.current) return;
      let active = true;

      const checkDraftAndNavigate = async () => {
        isCheckingRef.current = true;
        setIsChecking(true);

        let operation;
        try {
          if (!uid) {
            useAuthSheetStore.getState().show('Connectez-vous pour vendre un article', () => router.replace('/(tabs)/sell'));
            router.replace('/(tabs)');
            return;
          }
          operation = entry.capture();
          await assertSalePreparationAdmission(uid, () => { entry.assertCurrent(operation!); if (!active) throw staleTradeOperation(); });
          const existingDraft = await draftService.loadDraft();

          entry.assertCurrent(operation);
          if (!active) return;

          // Resume a draft as soon as it carries meaningful progress, not only
          // when a local photo cache survives. Drafts that already uploaded to
          // Storage or ran the AI analysis must be offered for resume even after
          // the local photo cache has been purged.
          const hasProgress = hasDraftProgress(existingDraft);

          if (existingDraft && hasProgress) {
            setDraft(existingDraft);
            showModalRef.current = true;
            setShowModal(true);
          } else {
            router.replace('/sell/capture');
          }
        } catch (error) {
          if (active && !operation && entry.isOriginCurrent()) showAdmissionError(eligibilityReadUnavailable(), { isCurrent: () => entry.isOriginCurrent(), retry: () => setRetryRevision(value => value + 1) });
          if (active && operation && entry.isCurrent(operation)) {
            if (!showAdmissionError(error, { isCurrent: () => entry.isCurrent(operation!), retry: () => setRetryRevision(value => value + 1), publication: {uid: operation.session.uid} })) Alert.alert('Vérification impossible', 'Votre brouillon est conservé. Réessayez.');
          }
        } finally {
          if (active) { isCheckingRef.current = false; setIsChecking(false); }
        }
      };

      void checkDraftAndNavigate();
      return () => { active = false; isCheckingRef.current = false; };
    }, [router, uid, entry.frame, entry.focusRevision, retryRevision])
  );

  const handleResume = useCallback(async () => {
    try {
      const operation = entry.capture();
      await assertSalePreparationAdmission(operation.session.uid, () => entry.assertCurrent(operation));
      entry.assertCurrent(operation);
      showModalRef.current = false;
      setShowModal(false);
      if (draft) {
        // Navigate to the correct step based on draft.currentStep
        const step = draft.currentStep;
        if (__DEV__) console.log('[SellTab] Resuming draft at step:', step);

        track('sell_draft_resumed', {
          draft_step: draftStepLabel(step),
          photo_count: draft.photos.length,
          has_ai_result: !!draft.aiResult,
          platform,
        });

        if (step >= 4) {
          // Step 4: Preview
          router.replace({
            pathname: '/sell/preview',
            params: { resumeDraft: 'true' },
          });
        } else if (step >= 3) {
          // Step 3: Pricing
          router.replace({
            pathname: '/sell/pricing',
            params: { resumeDraft: 'true' },
          });
        } else if (step >= 2) {
          // Step 2: Details (has AI result and/or fields)
          router.replace({
            pathname: '/sell/details',
            params: {
              resumeDraft: 'true',
              photos: serializeRouteParam(draft.photos),
              aiResult: draft.aiResult ? serializeRouteParam(draft.aiResult) : undefined,
            },
          });
        } else {
          // Step 1: Capture (photos only)
          router.replace({
            pathname: '/sell/capture',
            params: {
              resumeDraft: 'true',
              photos: serializeRouteParam(draft.photos),
            },
          });
        }
      }
    } catch (error) { showAdmissionError(error, { isCurrent: () => entry.isOriginCurrent(), retry: () => setRetryRevision(value => value + 1), ...(uid ? {publication: {uid}} : {}) }); }
  }, [draft, router, entry]);

  const handleDiscard = useCallback(async () => {
    let operation;
    try {
      operation = entry.capture();
      await assertSalePreparationAdmission(operation.session.uid, () => entry.assertCurrent(operation!));
      entry.assertCurrent(operation);
      showModalRef.current = false;
      setShowModal(false);
      if (draft) {
        track('sell_draft_discarded', {
          draft_step: draftStepLabel(draft.currentStep),
          photo_count: draft.photos.length,
          platform,
        });
      }
      await draftService.deleteDraft();
      entry.assertCurrent(operation);
      router.replace('/sell/capture');
    } catch (error) { if (operation && entry.isCurrent(operation)) showAdmissionError(error, { isCurrent: () => entry.isCurrent(operation!), retry: () => setRetryRevision(value => value + 1), publication: {uid: operation.session.uid} }); }
  }, [draft, router, entry]);

  return (
    <View style={styles.container} testID="sell-tab-screen">
      {isChecking && !showModal && (
        <Skeleton width={48} height={48} borderRadius={radius.md} />
      )}

      <DraftResumeModal
        visible={showModal}
        draft={draft}
        onResume={handleResume}
        onDiscard={handleDiscard}
        onDismiss={() => {
          showModalRef.current = false;
          setShowModal(false);
          router.replace('/(tabs)');
        }}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: colors.white,
  },
});
