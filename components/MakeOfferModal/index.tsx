import { Ionicons } from '@expo/vector-icons';
import BottomSheet, { BottomSheetBackdrop, BottomSheetScrollView } from '@gorhom/bottom-sheet';
import * as Haptics from 'expo-haptics';
import React, { forwardRef, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
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
  sellerNeighborhood?: MeetupNeighborhood;
  sellerPreferredSpots?: MeetupSpot[];
  onMeetupOfferSubmit?: (
    amount: number,
    message: string,
    meetupSpot: MeetupSpot
  ) => Promise<void>;
}

const MakeOfferModal = forwardRef<MakeOfferModalRef, MakeOfferModalProps>(
  (
    {
      articleId,
      articleTitle,
      currentPrice,
      sellerNeighborhood,
      sellerPreferredSpots,
      onMeetupOfferSubmit,
    },
    ref
  ) => {
    const bottomSheetRef = useRef<BottomSheet>(null);
    const insets = useSafeAreaInsets();
    const [state, setState] = useState<MakeOfferState>({
      ...initialState,
      mode: 'meetup',
    });

    const [isOpen, setIsOpen] = useState(false);
    const snapPoints = useMemo(() => ['85%', '95%'], []);

    const resetState = useCallback(() => {
      setState({ ...initialState, mode: 'meetup' });
    }, []);

    const handleSheetChanges = useCallback(
      (index: number) => {
        if (index === -1) setIsOpen(false);
      },
      []
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
      const previousStep = getPreviousStep(state.step, 'meetup');
      if (previousStep) {
        setState((s) => ({ ...s, step: previousStep }));
      }
    };

    const actions = useMemo(
      () => ({
        setStep: (step: Step) => setState((s) => ({ ...s, step })),
        setMode: () => {},
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

    const meetupSteps: Step[] = ['offer', 'location', 'confirm'];
    const currentIndex = meetupSteps.indexOf(state.step);
    const progress = { current: currentIndex + 1, total: meetupSteps.length };

    if (!isOpen) return null;

    return (
      <BottomSheet
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
        keyboardBehavior="interactive"
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

          <View style={styles.content}>
            {state.step === 'offer' && <OfferStep context={context} />}
            {state.step === 'location' && <LocationStep context={context} />}
            {state.step === 'confirm' && (
              <ConfirmStep context={context} onSubmitMeetup={onMeetupOfferSubmit} />
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

export default MakeOfferModal;
