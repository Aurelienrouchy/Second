import { Ionicons } from '@expo/vector-icons';
import BottomSheet, { BottomSheetBackdrop, BottomSheetScrollView } from '@gorhom/bottom-sheet';
import * as Haptics from 'expo-haptics';
import React, { forwardRef, useCallback, useMemo, useRef, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { MeetupNeighborhood, MeetupSpot } from '@/types';

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
  // Seller's meetup preferences
  sellerNeighborhood?: MeetupNeighborhood;
  sellerPreferredSpots?: MeetupSpot[];
  // Callback
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
      mode: 'meetup', // Always meetup mode
    });

    const snapPoints = useMemo(() => ['85%', '95%'], []);

    const resetState = useCallback(() => {
      setState({ ...initialState, mode: 'meetup' });
    }, []);

    const handleSheetChanges = useCallback(
      (index: number) => {
        if (index === -1) {
          resetState();
        }
      },
      [resetState]
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
        Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
        bottomSheetRef.current?.expand();
      },
      dismiss: handleClose,
    }));

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
        setMode: () => {}, // No-op, always meetup
        setOfferAmount: (offerAmount: string) => setState((s) => ({ ...s, offerAmount })),
        setMessage: (message: string) => setState((s) => ({ ...s, message })),

        // Meetup actions
        setSelectedNeighborhood: (selectedNeighborhood: MeetupNeighborhood | null) =>
          setState((s) => ({ ...s, selectedNeighborhood })),
        setSelectedSpot: (selectedSpot: MeetupSpot | null) =>
          setState((s) => ({ ...s, selectedSpot })),
        setCustomSpotName: (customSpotName: string) =>
          setState((s) => ({ ...s, customSpotName })),

        // Common
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

    // Calculate step progress (meetup flow: offer -> location -> confirm)
    const meetupSteps: Step[] = ['offer', 'location', 'confirm'];
    const currentIndex = meetupSteps.indexOf(state.step);
    const progress = { current: currentIndex + 1, total: meetupSteps.length };

    return (
      <BottomSheet
        ref={bottomSheetRef}
        index={-1}
        snapPoints={snapPoints}
        onChange={handleSheetChanges}
        backdropComponent={renderBackdrop}
        enablePanDownToClose
        handleIndicatorStyle={styles.handleIndicator}
        containerStyle={styles.bottomSheetContainer}
        topInset={insets.top}
      >
        <BottomSheetScrollView style={styles.container} keyboardShouldPersistTaps="handled">
          <View style={styles.header}>
            {state.step !== 'offer' && (
              <Pressable onPress={handleBack} style={styles.backButton}>
                <Ionicons name="arrow-back" size={24} color="#1C1C1E" />
              </Pressable>
            )}
            <View style={styles.headerCenter}>
              <Text style={styles.title}>{getTitle()}</Text>
              <Text style={styles.stepIndicator}>
                Étape {progress.current}/{progress.total}
              </Text>
            </View>
            <Pressable onPress={handleClose} style={styles.closeButton}>
              <Ionicons name="close" size={24} color="#1C1C1E" />
            </Pressable>
          </View>

          {/* Progress bar */}
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
    backgroundColor: '#E5E5EA',
    width: 40,
  },
  container: {
    flex: 1,
    backgroundColor: '#FFFFFF',
  },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: 20,
    paddingBottom: 12,
  },
  headerCenter: {
    flex: 1,
    alignItems: 'center',
  },
  backButton: {
    width: 40,
    height: 40,
    alignItems: 'flex-start',
    justifyContent: 'center',
  },
  closeButton: {
    width: 40,
    height: 40,
    alignItems: 'flex-end',
    justifyContent: 'center',
  },
  title: {
    fontSize: 18,
    fontWeight: '700',
    color: '#1C1C1E',
  },
  stepIndicator: {
    fontSize: 12,
    color: '#8E8E93',
    marginTop: 2,
  },
  progressContainer: {
    paddingHorizontal: 20,
    paddingBottom: 16,
  },
  progressBar: {
    height: 4,
    backgroundColor: '#E5E5EA',
    borderRadius: 2,
    overflow: 'hidden',
  },
  progressFill: {
    height: '100%',
    backgroundColor: '#34C759',
    borderRadius: 2,
  },
  content: {
    flex: 1,
    paddingHorizontal: 20,
    paddingTop: 8,
    paddingBottom: 40,
  },
});

export default MakeOfferModal;
