import { Ionicons } from '@expo/vector-icons';
import BottomSheet, { BottomSheetBackdrop, BottomSheetScrollView } from '@gorhom/bottom-sheet';
import * as Haptics from 'expo-haptics';
import React, { forwardRef, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Keyboard, Pressable, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { MeetupNeighborhood, MeetupSpot } from '@/types';

import { colors, fonts, radius, spacing } from '@/constants/theme';
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
}

interface MakeOfferModalProps {
  articleId: string;
  articleTitle: string;
  currentPrice: number;
  /** Default offer mode — 'meetup' if unset */
  defaultMode?: OfferMode;
  sellerNeighborhood?: MeetupNeighborhood;
  sellerPreferredSpots?: MeetupSpot[];
  onMeetupOfferSubmit?: (
    amount: number,
    message: string,
    meetupSpot: MeetupSpot
  ) => Promise<void>;
  onShippingOfferSubmit?: (
    amount: number,
    message: string,
  ) => Promise<void>;
}

const MakeOfferModal = forwardRef<MakeOfferModalRef, MakeOfferModalProps>(
  (
    {
      articleId,
      articleTitle,
      currentPrice,
      defaultMode = 'meetup',
      sellerNeighborhood,
      sellerPreferredSpots,
      onMeetupOfferSubmit,
      onShippingOfferSubmit,
    },
    ref
  ) => {
    const bottomSheetRef = useRef<BottomSheet>(null);
    const insets = useSafeAreaInsets();
    const [state, setState] = useState<MakeOfferState>({
      ...initialState,
      mode: defaultMode,
    });

    const [isOpen, setIsOpen] = useState(false);
    const snapPoints = useMemo(() => ['85%', '95%'], []);

    const resetState = useCallback(() => {
      setState({ ...initialState, mode: defaultMode });
    }, [defaultMode]);

    const handleSheetChanges = useCallback(
      (index: number) => {
        if (index === -1) {
          Keyboard.dismiss();
          setIsOpen(false);
        }
      },
      []
    );

    const handleClose = useCallback(() => {
      bottomSheetRef.current?.close();
    }, []);

    React.useImperativeHandle(ref, () => ({
      present: () => {
        resetState();
        Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
        setIsOpen(true);
      },
      dismiss: handleClose,
    }));

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
      articleTitle,
      currentPrice,
      sellerNeighborhood,
      sellerPreferredSpots,
      onClose: handleClose,
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
        ref={bottomSheetRef}
        index={0}
        snapPoints={snapPoints}
        onChange={handleSheetChanges}
        enablePanDownToClose
        containerStyle={styles.bottomSheetContainer}
        enableDynamicSizing={false}
      >
        <BottomSheetScrollView style={[styles.container, sheetStyle]} keyboardShouldPersistTaps="handled">
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

          <View style={styles.content}>
            {state.step === 'offer' && <OfferStep context={context} />}
            {state.step === 'location' && state.mode === 'meetup' && (
              <LocationStep context={context} />
            )}
            {state.step === 'confirm' && (
              <ConfirmStep
                context={context}
                onSubmitMeetup={onMeetupOfferSubmit}
                onSubmitShipping={onShippingOfferSubmit}
              />
            )}
          </View>
        </BottomSheetScrollView>
      </BottomSheet>
    );
  }
);

const styles = StyleSheet.create({
  bottomSheetContainer: {
    zIndex: 100,
  },
  container: {
    // height fixe appliqué inline (bornage au plus grand détent) — pas de flex:1
    // (sinon le flexGrow s'étire contre la hauteur infinie proposée par @expo/ui).
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
    paddingBottom: SHEET_BOTTOM_INSET + spacing.lg + spacing.lg,
  },
});

export default MakeOfferModal;
