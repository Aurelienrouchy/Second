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
}

/** Action callbacks passed from the screen to action components. */
export interface SwapActionHandlers {
  onAccept: () => void;
  onDecline: () => void;
  onCancel: () => void;
  onSetExchangeMode: (mode: SwapExchangeMode) => void;
  onUploadPhotos: () => void;
  onConfirmShipping: () => void;
  onConfirmReception: () => void;
  onRate: (score: number) => void;
}

export { type Swap, type SwapStatus, type SwapExchangeMode, type SwapItemInfo };
