import { useAuthRequired } from '@/hooks/useAuthRequired';
import { useFocusEffect, useRouter } from 'expo-router';
import { useCallback, useState, useRef } from 'react';
import { View, ActivityIndicator, StyleSheet } from 'react-native';
import DraftResumeModal from '@/components/DraftResumeModal';
import draftService, { ArticleDraft } from '@/services/draftService';

/**
 * Sell Tab Entry Point
 * - Checks authentication
 * - Checks for existing draft
 * - Shows resume modal or navigates to capture
 */
export default function SellTabScreen() {
  const { isLoggedIn, isLoading, requireAuth } = useAuthRequired();
  const router = useRouter();

  const [draft, setDraft] = useState<ArticleDraft | null>(null);
  const [showModal, setShowModal] = useState(false);
  const [isChecking, setIsChecking] = useState(false);

  // Refs to prevent stale closures and multiple checks
  const isCheckingRef = useRef(false);
  const showModalRef = useRef(false);
  const routerRef = useRef(router);
  const requireAuthRef = useRef(requireAuth);

  // Keep refs updated
  routerRef.current = router;
  requireAuthRef.current = requireAuth;

  // Single useFocusEffect with cleanup
  useFocusEffect(
    useCallback(() => {
      console.log('[SellTab] useFocusEffect triggered', { isLoading, isLoggedIn, isCheckingRef: isCheckingRef.current });

      // Don't do anything while auth is loading
      if (isLoading) {
        console.log('[SellTab] Auth is loading, returning early');
        return;
      }

      // Prevent multiple simultaneous checks or if modal is showing
      if (isCheckingRef.current || showModalRef.current) {
        console.log('[SellTab] Already checking or modal showing, skipping', {
          isChecking: isCheckingRef.current,
          showModal: showModalRef.current
        });
        return;
      }

      const checkDraftAndNavigate = async () => {
        console.log('[SellTab] checkDraftAndNavigate START', { isLoggedIn, isLoading });

        // Not logged in - show auth sheet
        if (!isLoggedIn) {
          console.log('[SellTab] User not logged in, showing auth sheet');
          requireAuthRef.current(
            () => {
              routerRef.current.replace('/sell/capture');
            },
            'Connectez-vous pour vendre un article'
          );
          return;
        }

        // Logged in - check for existing draft
        console.log('[SellTab] User logged in, setting isChecking=true');
        isCheckingRef.current = true;
        setIsChecking(true);

        try {
          console.log('[SellTab] Calling draftService.loadDraft()...');
          const existingDraft = await draftService.loadDraft();
          console.log('[SellTab] loadDraft() returned:', existingDraft ? `Draft with ${existingDraft.photos.length} photos` : 'null');

          if (existingDraft && existingDraft.photos.length > 0) {
            // Has draft with photos - show modal
            console.log('[SellTab] Showing draft resume modal');
            setDraft(existingDraft);
            showModalRef.current = true;
            setShowModal(true);
          } else {
            // No draft - go to capture
            console.log('[SellTab] No draft, navigating to /sell/capture');
            routerRef.current.replace('/sell/capture');
          }
        } catch (error) {
          console.error('[SellTab] Error checking draft:', error);
          routerRef.current.replace('/sell/capture');
        } finally {
          console.log('[SellTab] Finally block, resetting isChecking');
          isCheckingRef.current = false;
          setIsChecking(false);
        }
      };

      checkDraftAndNavigate();

      return () => {
        console.log('[SellTab] Cleanup function called');
        // Don't reset isCheckingRef here - let the async function complete
      };
    }, [isLoading, isLoggedIn])
  );

  const handleResume = useCallback(() => {
    showModalRef.current = false;
    setShowModal(false);
    if (draft) {
      // Navigate to the correct step based on draft.currentStep
      const step = draft.currentStep;
      console.log('[SellTab] Resuming draft at step:', step);

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
            photos: JSON.stringify(draft.photos),
            aiResult: draft.aiResult ? JSON.stringify(draft.aiResult) : undefined,
          },
        });
      } else {
        // Step 1: Capture (photos only)
        router.replace({
          pathname: '/sell/capture',
          params: {
            resumeDraft: 'true',
            photos: JSON.stringify(draft.photos),
          },
        });
      }
    }
  }, [draft, router]);

  const handleDiscard = useCallback(async () => {
    showModalRef.current = false;
    setShowModal(false);
    await draftService.deleteDraft();
    router.replace('/sell/capture');
  }, [router]);

  return (
    <View style={styles.container}>
      {(isLoading || isChecking) && !showModal && (
        <ActivityIndicator size="large" color="#F79F24" />
      )}

      <DraftResumeModal
        visible={showModal}
        draft={draft}
        onResume={handleResume}
        onDiscard={handleDiscard}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: '#FFFFFF',
  },
});
