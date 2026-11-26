import { runtimeEnvironment, type AppEnvironment } from './firebaseEnvironment';
import { PHASE1_QA_ENABLED } from './featureFlags';

export const phase1ProductionContracts = {
  recordSignupConsent: 'recordSignupConsentV2',
  createArticle: 'createArticleV2',
  updateArticle: 'updateArticleV2',
  toggleArticleSold: 'toggleArticleSoldV2',
  incrementProductView: 'incrementProductViewV2',
  toggleProductLike: 'toggleProductLikeV2',
  markSavedSearchViewed: 'markSavedSearchViewedV2',
  setMarketingConsent: 'setMarketingConsentV2',
  declareSellerActivity: 'declareSellerActivityV2',
  sendMeetupProposal: 'sendMeetupProposalV2',
  rejectMeetupProposal: 'rejectMeetupProposalV2',
  acceptMeetupOffer: 'acceptMeetupOfferV2',
  confirmMeetupTransaction: 'confirmMeetupTransactionV2',
  completeMeetupTransaction: 'completeMeetupTransactionV2',
  reportMeetupNoShow: 'reportMeetupNoShowV2',
  closeMeetupNoShow: 'closeMeetupNoShowV2',
  cancelPendingTransaction: 'cancelPendingTransactionV2',
  sellerCancelTransaction: 'sellerCancelTransactionV2',
  ensureGeneralistZone: 'ensureGeneralistZoneV2',
  getActiveSwapPartyInfo: 'getActiveSwapPartyInfoV2',
  proposeMultiSwap: 'proposeMultiSwapV2',
  acceptSwap: 'acceptSwapV2',
  declineSwap: 'declineSwapV2',
  cancelSwap: 'cancelSwapV2',
  setSwapExchangeMode: 'setSwapExchangeModeV2',
  uploadSwapPhotos: 'uploadSwapPhotosV2',
  confirmSwapShipping: 'confirmSwapShippingV2',
  confirmSwapReception: 'confirmSwapReceptionV2',
  rateSwap: 'rateSwapV2',
  addItemToPartySecure: 'addItemToPartySecureV2',
  removeItemFromPartySecure: 'removeItemFromPartySecureV2',
  createReview: 'createReviewV2',
  submitReport: 'submitReportV2',
  triageReport: 'triageReportV2',
  getPendingReports: 'getPendingReportsV2',
  deleteUserAccount: 'deleteUserAccountV2',
} as const;

/** Read/support ports installed on Dev to exercise the production phase 1 handlers. */
export const phase1QaDevContracts = {
  getStripeAccountStatus: 'getStripeAccountStatusPhase1Dev',
  administerSupportRequest: 'administerSupportRequestPhase1Dev',
  getWalletInfo: 'getWalletInfoPhase1Dev',
  commandSupportRequest: 'commandSupportRequestPhase1Dev',
  checkTrackingStatus: 'checkTrackingStatusPhase1Dev',
  resolveSwapDispute: 'resolveSwapDisputePhase1Dev',
  openSwapDispute: 'openSwapDisputePhase1Dev',
  readSupportRequests: 'readSupportRequestsPhase1Dev',
  getMyEligibility: 'getMyEligibilityPhase1Dev',
} as const;

/** The explicit Dev QA profile selects phase 1 ports without changing the
 * normal Dev or emulator contracts, or any persisted business operation. */
export function phase1CallableName(name: string, environment: AppEnvironment = runtimeEnvironment.name): string {
  const phase1Qa = environment === 'development' && PHASE1_QA_ENABLED;
  if (phase1Qa && Object.prototype.hasOwnProperty.call(phase1QaDevContracts, name)) {
    return phase1QaDevContracts[name as keyof typeof phase1QaDevContracts];
  }
  return (environment === 'production' || phase1Qa) && Object.prototype.hasOwnProperty.call(phase1ProductionContracts, name)
    ? phase1ProductionContracts[name as keyof typeof phase1ProductionContracts]
    : name;
}

export const catalogueCallableName = phase1CallableName;
