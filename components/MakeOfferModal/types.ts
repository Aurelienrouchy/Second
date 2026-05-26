import { MeetupNeighborhood, MeetupSpot } from '@/types';

// Steps for meetup flow (datetime removed)
export type Step = 'offer' | 'location' | 'confirm';

// Offer mode: meetup (in-person) or shipping (delivery)
export type OfferMode = 'meetup' | 'shipping';

export interface MakeOfferState {
  step: Step;
  mode: OfferMode;
  offerAmount: string;
  message: string;

  // Meetup fields
  selectedNeighborhood: MeetupNeighborhood | null;
  selectedSpot: MeetupSpot | null;
  customSpotName: string;

  // Common
  isSubmitting: boolean;
}

export interface MakeOfferActions {
  setStep: (step: Step) => void;
  setMode: (mode: OfferMode) => void;
  setOfferAmount: (amount: string) => void;
  setMessage: (message: string) => void;

  // Meetup actions
  setSelectedNeighborhood: (neighborhood: MeetupNeighborhood | null) => void;
  setSelectedSpot: (spot: MeetupSpot | null) => void;
  setCustomSpotName: (name: string) => void;

  // Common
  setIsSubmitting: (submitting: boolean) => void;
}

export interface MakeOfferContext {
  state: MakeOfferState;
  actions: MakeOfferActions;
  articleTitle: string;
  currentPrice: number;
  sellerNeighborhood?: MeetupNeighborhood;
  sellerPreferredSpots?: MeetupSpot[];
  onClose: () => void;
}

export const initialState: MakeOfferState = {
  step: 'offer',
  mode: 'meetup',
  offerAmount: '',
  message: '',

  // Meetup fields
  selectedNeighborhood: null,
  selectedSpot: null,
  customSpotName: '',

  // Common
  isSubmitting: false,
};

// Helper to get next step — shipping mode skips the location step
export const getNextStep = (currentStep: Step, mode?: OfferMode): Step => {
  if (mode === 'shipping') {
    // shipping: offer -> confirm (no location)
    switch (currentStep) {
      case 'offer':
        return 'confirm';
      default:
        return 'confirm';
    }
  }
  // meetup: offer -> location -> confirm
  switch (currentStep) {
    case 'offer':
      return 'location';
    case 'location':
      return 'confirm';
    default:
      return 'confirm';
  }
};

// Helper to get previous step — shipping mode skips the location step
export const getPreviousStep = (currentStep: Step, mode?: OfferMode): Step | null => {
  if (mode === 'shipping') {
    switch (currentStep) {
      case 'confirm':
        return 'offer';
      default:
        return null;
    }
  }
  switch (currentStep) {
    case 'location':
      return 'offer';
    case 'confirm':
      return 'location';
    default:
      return null;
  }
};
