/**
 * Offres & négociation — barrel de la feature.
 *
 * Les imports vers cette feature passent par `@/features/offers`,
 * jamais en deep import.
 */

export { default as ConfirmStep } from './components/MakeOfferModal/ConfirmStep';
export { default as LocationStep } from './components/MakeOfferModal/LocationStep';
export { default as OfferStep } from './components/MakeOfferModal/OfferStep';
export { default as index } from './components/MakeOfferModal/index';
export { MakeOfferModalRef } from './components/MakeOfferModal/index';
export { MakeOfferActions, MakeOfferContext, MakeOfferState, OfferMode, Step, getNextStep, getPreviousStep, initialState } from './components/MakeOfferModal/types';
export { default as OfferBubble } from './components/OfferBubble';
export { OfferProgressMessage } from './components/OfferProgressMessage';
export { CounterLocationInput, CounterLocationInputProps } from './components/offer-bubble/CounterLocationInput';
export { CounterPriceInput, CounterPriceInputProps } from './components/offer-bubble/CounterPriceInput';
export { CounterTimeInput, CounterTimeInputProps } from './components/offer-bubble/CounterTimeInput';
export { MeetupActions, MeetupActionsProps } from './components/offer-bubble/MeetupActions';
export { OfferActions, OfferActionsProps } from './components/offer-bubble/OfferActions';
export { styles } from './components/offer-bubble/styles';
export { useOfferTransaction } from './components/offer-bubble/useOfferTransaction';
export { formatTime, getStatusBgColor, getStatusColor, getStatusIcon, getStatusIconBackground, getStatusText, getTimeUntilExpiry } from './components/offer-bubble/utils';

// — modules rattachés lors du regroupement par feature —
export { default as MakeOfferModal } from './components/MakeOfferModal';
