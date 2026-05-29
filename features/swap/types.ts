/**
 * Swap feature — shared types for sub-components.
 */

import { Swap, SwapExchangeMode, SwapItemInfo, SwapStatus } from '@/types';

/** Derived fields computed once in the screen and passed down. */
export interface SwapParticipantContext {
  isInitiator: boolean;
  isReceiver: boolean;
  senderName: string;
  senderImage: string | undefined;
  senderItems: SwapItemInfo[];
  myItems: SwapItemInfo[];
  hasUploadedPhotos: boolean;
  hasConfirmedShipping: boolean;
  hasConfirmedReception: boolean;
  hasRated: boolean;
  /** True when the current user is the cash top-up payer (cashTopUp.payerId). */
  isTopUpPayer: boolean;
  /** Display name of the party expected to pay the cash top-up. */
  topUpPayerName: string;
}

/** Action callbacks passed from the screen to action components. */
export interface SwapActionHandlers {
  onAccept: () => void;
  onDecline: () => void;
  onCancel: () => void;
  onPayTopUp: () => void;
  onSetExchangeMode: (mode: SwapExchangeMode) => void;
  onUploadPhotos: () => void;
  onConfirmShipping: () => void;
  onConfirmReception: () => void;
  onRate: (score: number) => void;
}

export { type Swap, type SwapStatus, type SwapExchangeMode, type SwapItemInfo };
