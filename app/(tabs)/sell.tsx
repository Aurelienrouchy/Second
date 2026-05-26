import { useFocusEffect, useRouter } from 'expo-router';
import { useCallback, useState, useRef } from 'react';
import { View, StyleSheet } from 'react-native';
import DraftResumeModal from '@/components/DraftResumeModal';
import draftService, { ArticleDraft } from '@/services/draftService';
import { colors, radius } from '@/constants/theme';
import { Skeleton } from '@/components/ui/Skeleton';

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

  const [draft, setDraft] = useState<ArticleDraft | null>(null);
  const [showModal, setShowModal] = useState(false);
  const [isChecking, setIsChecking] = useState(false);

  const isCheckingRef = useRef(false);
  const showModalRef = useRef(false);

  useFocusEffect(
    useCallback(() => {
      if (isCheckingRef.current || showModalRef.current) return;

      const checkDraftAndNavigate = async () => {
        isCheckingRef.current = true;
        setIsChecking(true);

        try {
          const existingDraft = await draftService.loadDraft();

          if (existingDraft && existingDraft.photos.length > 0) {
            setDraft(existingDraft);
            showModalRef.current = true;
            setShowModal(true);
          } else {
            router.replace('/sell/capture');
          }
        } catch {
          router.replace('/sell/capture');
        } finally {
          isCheckingRef.current = false;
          setIsChecking(false);
        }
      };

      checkDraftAndNavigate();
    }, [router])
  );

  const handleResume = useCallback(() => {
    showModalRef.current = false;
    setShowModal(false);
    if (draft) {
      // Navigate to the correct step based on draft.currentStep
      const step = draft.currentStep;
      if (__DEV__) console.log('[SellTab] Resuming draft at step:', step);

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
      {isChecking && !showModal && (
        <Skeleton width={48} height={48} borderRadius={radius.md} />
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
    backgroundColor: colors.white,
  },
});
