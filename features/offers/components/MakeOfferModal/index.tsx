import { staleTradeOperation } from '@/services/tradeOperation';
import { useTradeOperation } from '@/hooks/useTradeOperation';
import { getAuthSessionGeneration, useAuthStore } from '@/store/authStore';
import { Ionicons } from '@expo/vector-icons';
import BottomSheet, { BottomSheetBackdrop, BottomSheetScrollView } from '@gorhom/bottom-sheet';
import * as Haptics from 'expo-haptics';
import { Image } from 'expo-image';
import React, { forwardRef, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Keyboard, Pressable, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { MeetupNeighborhood, MeetupSpot } from '@/types';

import { colors, fonts, radius, spacing } from '@/constants/theme';
import { track } from '@/lib/analytics';
import ConfirmStep from './ConfirmStep';
import LocationStep from './LocationStep';
import OfferStep from './OfferStep';
import {
  getPreviousStep,
  initialState,
  MakeOfferContext,
  MakeOfferState,
  OfferMode,
  Step,
} from './types';

export interface MakeOfferModalRef {
  present: () => void;
  dismiss: () => void;
  /** Reopen the same proposal without resetting its fields. */
  resume: () => void;
}

interface MakeOfferModalProps {
  articleId: string;
  articleTitle: string;
  articleImage?: string;
  currentPrice: number;
  /** Default offer mode — 'meetup' if unset */
  defaultMode?: OfferMode;
  availableModes?: OfferMode[];
  sellerNeighborhood?: MeetupNeighborhood;
  sellerPreferredSpots?: MeetupSpot[];
  onMeetupOfferSubmit?: (
    amount: number,
    message: string,
    meetupSpot: MeetupSpot,
    assertIntention?: () => void,
  ) => Promise<void>;
  onShippingOfferSubmit?: (
    amount: number,
    message: string,
    assertIntention?: () => void,
  ) => Promise<void>;
}

const MakeOfferModal = forwardRef<MakeOfferModalRef, MakeOfferModalProps>(
  (
    {
      articleId,
      articleTitle,
      articleImage,
      currentPrice,
      defaultMode = 'meetup',
      availableModes,
      sellerNeighborhood,
      sellerPreferredSpots,
      onMeetupOfferSubmit,
      onShippingOfferSubmit,
    },
    ref
  ) => {
    const userId = useAuthStore(s => s.authenticatedUid);
    const [presentation, setPresentation] = useState(0);
    const presentationEpoch = useRef(0);
    const pausedOwner = useRef<string | null>(null);
    const ownerKey = JSON.stringify([articleId, userId, getAuthSessionGeneration()]);
    const operationContext = useTradeOperation(JSON.stringify([articleId, presentation]), userId);
    const ownerContext = useTradeOperation(articleId, userId);
    const [lastFrame, setLastFrame] = useState(ownerContext.frame);
    const bottomSheetRef = useRef<BottomSheet>(null);
    const insets = useSafeAreaInsets();
    const [state, setState] = useState<MakeOfferState>({
      ...initialState,
      mode: defaultMode,
    });

    const [isOpen, setIsOpen] = useState(false);
    const [previousFocus, setPreviousFocus] = useState(operationContext.focusRevision);
    if (previousFocus !== operationContext.focusRevision) {
      setPreviousFocus(operationContext.focusRevision);
      setState(s => ({ ...s, isSubmitting: false }));
    }
    if (lastFrame !== ownerContext.frame) {
      setLastFrame(ownerContext.frame);
      pausedOwner.current = null;
      presentationEpoch.current++;
      setState({ ...initialState, mode: defaultMode });
      setIsOpen(false);
    }
    const snapPoints = useMemo(() => ['85%', '95%'], []);
    // Distinguishes a real dismissal (abandon) from the programmatic close that
    // follows a successful submit — set by the wrapped submit handlers below.
    const submittedRef = useRef(false);
    // Latest sheet state for the abandon event fired from the (deps-free)
    // onChange callback.
    const stateRef = useRef(state);
    stateRef.current = state;

    const resetState = useCallback(() => {
      setState({ ...initialState, mode: defaultMode });
    }, [defaultMode]);

    const handleSheetChanges = useCallback(
      (index: number) => {
        try { operationContext.capture(); } catch { return; }
        if (presentationEpoch.current !== presentation) return;
        if (index === -1) {
          if (pausedOwner.current) return;
          if (!submittedRef.current) {
            const s = stateRef.current;
            track('offer_modal_abandoned', {
              article_id: articleId,
              step_at_close: s.step,
              mode: s.mode,
              offer_amount_entered: s.offerAmount.trim().length > 0,
            });
          }
          submittedRef.current = false;
          presentationEpoch.current++;
          setPresentation(presentationEpoch.current);
          setState(s => ({ ...s, isSubmitting: false }));
          Keyboard.dismiss();
          setIsOpen(false);
        }
      },
      [articleId, operationContext, presentation]
    );

    const handleMeetupSubmit = useMemo(
      () =>
        onMeetupOfferSubmit
          ? async (amount: number, message: string, meetupSpot: MeetupSpot, assertIntention?: () => void) => {
              const operation = operationContext.capture();
              const epoch = presentation;
              const assertCurrent = () => {
                operationContext.assertCurrent(operation);
                if (presentationEpoch.current !== epoch) throw staleTradeOperation();
                assertIntention?.();
              };
              assertCurrent();
              await onMeetupOfferSubmit(amount, message, meetupSpot, assertCurrent);
              assertCurrent();
              submittedRef.current = true;
            }
          : undefined,
      [onMeetupOfferSubmit, operationContext]
    );

    const handleShippingSubmit = useMemo(
      () =>
        onShippingOfferSubmit
          ? async (amount: number, message: string, assertIntention?: () => void) => {
              const operation = operationContext.capture();
              const epoch = presentation;
              const assertCurrent = () => {
                operationContext.assertCurrent(operation);
                if (presentationEpoch.current !== epoch) throw staleTradeOperation();
                assertIntention?.();
              };
              assertCurrent();
              await onShippingOfferSubmit(amount, message, assertCurrent);
              assertCurrent();
              submittedRef.current = true;
            }
          : undefined,
      [onShippingOfferSubmit, operationContext]
    );

    const renderBackdrop = useCallback(
      (props: any) => (
        <BottomSheetBackdrop
          {...props}
          disappearsOnIndex={-1}
          appearsOnIndex={0}
          opacity={0.5}
        />
      ),
      []
    );

    const handleClose = useCallback(() => {
      const epoch = presentationEpoch.current;
      handleSheetChanges(-1);
      if (presentationEpoch.current === epoch) {
        presentationEpoch.current++;
        setPresentation(presentationEpoch.current);
        setState(s => ({ ...s, isSubmitting: false }));
        setIsOpen(false);
      }
      bottomSheetRef.current?.close();
    }, [handleSheetChanges]);

    React.useImperativeHandle(ref, () => ({
      present: () => {
        pausedOwner.current = null;
        presentationEpoch.current++;
        setPresentation(presentationEpoch.current);
        resetState();
        submittedRef.current = false;
        Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
        setIsOpen(true);
      },
      dismiss: handleClose,
      resume: () => {
        if (pausedOwner.current !== ownerKey || !ownerContext.isOriginCurrent()) return;
        pausedOwner.current = null;
        presentationEpoch.current++;
        setPresentation(presentationEpoch.current);
        setState(value => ({ ...value, isSubmitting: false }));
        setIsOpen(true);
      },
    }));

    useEffect(() => {
      if (pausedOwner.current !== ownerKey || !ownerContext.isOriginCurrent()) return;
      pausedOwner.current = null;
      presentationEpoch.current++;
      setPresentation(presentationEpoch.current);
      setState(value => ({ ...value, isSubmitting: false }));
      setIsOpen(true);
    }, [ownerKey, ownerContext.focusRevision]);

    useEffect(() => {
      if (isOpen) {
        bottomSheetRef.current?.expand();
      }
    }, [isOpen]);

    const handleBack = () => {
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
      const previousStep = getPreviousStep(state.step, state.mode);
      if (previousStep) {
        setState((s) => ({ ...s, step: previousStep }));
      }
    };

    const actions = useMemo(
      () => ({
        setStep: (step: Step) => setState((s) => ({ ...s, step })),
        setMode: (mode: OfferMode) => setState((s) => ({ ...s, mode })),
        setOfferAmount: (offerAmount: string) => setState((s) => ({ ...s, offerAmount })),
        setMessage: (message: string) => setState((s) => ({ ...s, message })),
        setSelectedNeighborhood: (selectedNeighborhood: MeetupNeighborhood | null) =>
          setState((s) => ({ ...s, selectedNeighborhood })),
        setSelectedSpot: (selectedSpot: MeetupSpot | null) =>
          setState((s) => ({ ...s, selectedSpot })),
        setCustomSpotName: (customSpotName: string) =>
          setState((s) => ({ ...s, customSpotName })),
        setIsSubmitting: (isSubmitting: boolean) => setState((s) => ({ ...s, isSubmitting })),
      }),
      []
    );

    const context: MakeOfferContext = {
      state,
      actions,
      articleId,
      articleTitle,
      currentPrice,
      availableModes,
      sellerNeighborhood,
      sellerPreferredSpots,
      onClose: handleClose,
      onPauseForCriteria: () => {
        pausedOwner.current = ownerKey;
        presentationEpoch.current++;
        setPresentation(presentationEpoch.current);
        setState(value => ({ ...value, isSubmitting: false }));
        setIsOpen(false);
        Keyboard.dismiss();
      },
      isPresentationCurrent: () => presentationEpoch.current === presentation,
    };

    const getTitle = () => {
      switch (state.step) {
        case 'offer':
          return 'Faire une offre';
        case 'location':
          return 'Lieu de rencontre';
        case 'confirm':
          return "Confirmer l'offre";
        default:
          return 'Faire une offre';
      }
    };

    const stepsForMode: Step[] = state.mode === 'shipping'
      ? ['offer', 'confirm']
      : ['offer', 'location', 'confirm'];
    const currentIndex = stepsForMode.indexOf(state.step);
    const progress = { current: currentIndex + 1, total: stepsForMode.length };

    if (!isOpen) return null;

    return (
      <BottomSheet
        accessible={false}
        ref={bottomSheetRef}
        index={0}
        snapPoints={snapPoints}
        onChange={handleSheetChanges}
        backdropComponent={renderBackdrop}
        enablePanDownToClose
        handleIndicatorStyle={styles.handleIndicator}
        containerStyle={styles.bottomSheetContainer}
        topInset={insets.top}
        enableDynamicSizing={false}
        keyboardBehavior="fillParent"
        keyboardBlurBehavior="restore"
        android_keyboardInputMode="adjustResize"
      >
        <BottomSheetScrollView style={styles.container} keyboardShouldPersistTaps="handled">
          <View style={styles.header}>
            {state.step !== 'offer' && (
              <Pressable onPress={handleBack} style={styles.backButton}>
                <Ionicons name="arrow-back" size={20} color={colors.charcoal} />
              </Pressable>
            )}
            <View style={styles.headerCenter}>
              <Text style={styles.title}>{getTitle()}</Text>
              <Text style={styles.stepIndicator}>
                ÉTAPE {progress.current} SUR {progress.total}
              </Text>
            </View>
            <Pressable onPress={handleClose} style={styles.closeButton}>
              <Ionicons name="close" size={20} color={colors.charcoal} />
            </Pressable>
          </View>

          <View style={styles.progressContainer}>
            <View style={styles.progressBar}>
              <View
                style={[
                  styles.progressFill,
                  { width: `${(progress.current / progress.total) * 100}%` },
                ]}
              />
            </View>
          </View>

          {state.step === 'location' && (
            <View style={styles.articleReminder}>
              {articleImage && <Image source={{ uri: articleImage }} style={styles.articleThumbnail} contentFit="cover" />}
              <Text style={styles.articleReminderTitle} numberOfLines={2}>{articleTitle}</Text>
            </View>
          )}
          <View style={styles.content}>
            {state.step === 'offer' && <OfferStep context={context} />}
            {state.step === 'location' && state.mode === 'meetup' && (
              <LocationStep context={context} />
            )}
            {state.step === 'confirm' && (
              <ConfirmStep
                context={context}
                presentationKey={presentation}
                onSubmitMeetup={handleMeetupSubmit}
                onSubmitShipping={handleShippingSubmit}
              />
            )}
          </View>
        </BottomSheetScrollView>
      </BottomSheet>
    );
  }
);

const styles = StyleSheet.create({
  articleReminder: { flexDirection: 'row', alignItems: 'center', gap: spacing.md, marginHorizontal: spacing.lg, marginBottom: spacing.md },
  articleThumbnail: { width: 44, height: 52, borderRadius: radius.sm },
  articleReminderTitle: { flex: 1, fontFamily: fonts.sansMedium, fontSize: 13, color: colors.charcoal },
  bottomSheetContainer: {
    zIndex: 100,
  },
  handleIndicator: {
    backgroundColor: colors.borderStrong,
    width: 36,
    height: 4,
  },
  container: {
    flex: 1,
    backgroundColor: colors.white,
  },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.md,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  headerCenter: {
    flex: 1,
    alignItems: 'center',
  },
  backButton: {
    width: 36,
    height: 36,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 18,
    borderWidth: 1,
    borderColor: colors.borderStrong,
  },
  closeButton: {
    width: 36,
    height: 36,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 18,
    borderWidth: 1,
    borderColor: colors.borderStrong,
  },
  title: {
    fontSize: 20,
    fontFamily: fonts.sansMedium,
    color: colors.charcoal,
    textAlign: 'center',
  },
  stepIndicator: {
    fontSize: 10,
    fontFamily: fonts.sansMedium,
    color: colors.charcoal,
    marginTop: spacing.xs,
    letterSpacing: 1.2,
    textTransform: 'uppercase',
  },
  progressContainer: {
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.md,
    paddingBottom: spacing.md,
  },
  progressBar: {
    height: 3,
    backgroundColor: colors.border,
    borderRadius: radius.xs,
    overflow: 'hidden',
  },
  progressFill: {
    height: '100%',
    backgroundColor: colors.sage,
    borderRadius: radius.xs,
  },
  content: {
    flex: 1,
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.sm,
    paddingBottom: spacing.lg + spacing.lg,
  },
});

MakeOfferModal.displayName = 'MakeOfferModal';

export default MakeOfferModal;
