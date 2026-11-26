/** Domain-only recovery projections. These witnesses never authorize an old
 * value by themselves and are written by the caller's native transaction. */
import { createHash } from 'node:crypto';
import { FieldValue, Timestamp } from 'firebase-admin/firestore';
import {localAgreementFields,localServerTimestamps} from './localAgreement';
import {localCatalogueFields,localCatalogueRestrictionOnly,type LocalCatalogueDomain} from './localCatalogue';
import { FinancialRecoveryBlocked, assertFinancialRecoveryEffect, assertFinancialRecoverySource, financialRecoveryNewSourceWitness,
  type FinancialRecoveryWitness } from './financialRecoveryInterlock';

type Data = Record<string, any>;
export type FinancialRecoveryDomain = 'wallet' | 'inventory_unit' | 'inventory_article' | 'purchase' | 'card_intent' |
  'withdrawal' | 'swap' | 'swap_topup' | 'shop_tier' | 'shop_entitlement' | 'refund_repair' |
  'label_lifecycle_command' | 'label_lifecycle_case' | 'bank_case_command' | 'bank_case_root' | 'bank_case_entry' | 'bank_operation';
const fields: Record<FinancialRecoveryDomain, readonly string[]> = {
  wallet: ['balance','pendingBalance','heldBalance','sellerDebt','currency','status','exceptionalRestitution.protocol','exceptionalRestitution.caseId','exceptionalRestitution.instructionId','exceptionalRestitution.state','exceptionalRestitution.ownerId','exceptionalRestitution.amountCents','exceptionalRestitution.sourceHash'],
  inventory_unit: ['protocol','ownerId','originArticleId','memberArticleIds','version','state',
    'engagement.kind','engagement.id','engagement.sourceArticleId'],
  inventory_article: ['sellerId','isSold','isActive','activeTransactionId','inventoryUnit.protocol','inventoryUnit.identity',
    'inventoryAvailability.protocol','inventoryAvailability.state'],
  purchase: ['devShippingSimulation.protocol','devShippingSimulation.realShipment','devShippingSimulation.trackingSource',
    'devShippingSimulationClock.protocol','devShippingSimulationClock.source','devShippingSimulationClock.actorId','devShippingSimulationClock.recordedAt','devShippingSimulationClock.advancedThroughAt','devShippingSimulationClock.realShipment',
    'labelPurchase.qualification.simulation.protocol','labelPurchase.qualification.simulation.realShipment','deliveryTrackingProof.provider','deliveryTrackingProof.identitySource','returnDeliveryProof.provider','returnDeliveryProof.identitySource','exceptionalRestitution.protocol','exceptionalRestitution.caseId','exceptionalRestitution.instructionId','exceptionalRestitution.state','exceptionalRestitution.ownerId','exceptionalRestitution.amountCents','exceptionalRestitution.sourceHash','buyerId','sellerId','articleId','currency','amount','totalAmount','sellerPayout','serviceFee','taxTotal',
    'shippingCost','deliveryType','paidVia','walletAmountUsed','walletPayment.schemaVersion','walletPayment.state',
    'walletPayment.actorUid','walletPayment.amountCents','walletPayment.ledgerId','walletPayment.currency','walletPayment.quoteId','walletPayment.rateId',
    'stripePaymentIntentId','stripeChargeId','capturedCardCents','sellerCreditedCents','sellerPendingCreditCents',
    'sellerHeldCreditCents','sellerReleasedCents','sellerDebtRepaidCents','deliveredAt','deliveryRecordedAt','fundsReleaseAt','heldFundsReleaseAt','fundsReleasedAt',
    'purchasePolicy.hash','purchasePolicy.sourceHash','purchasePolicy.policyVersion','purchasePolicyAcceptance.acceptedAt',
    'purchasePolicyAcceptance.policyHash','purchasePolicyAcceptance.totalCents','purchasePolicyAcceptance.rateId',
    'nonShipmentPolicyWindow.sourceHash','nonShipmentPolicyWindow.startsAt','nonShipmentPolicyWindow.expiresAt',
    'pendingPaymentPolicyWindow.sourceHash','pendingPaymentPolicyWindow.startsAt','pendingPaymentPolicyWindow.expiresAt',
    'deliveryPolicyWindow.sourceHash','deliveryPolicyWindow.startsAt','deliveryPolicyWindow.recordedAt','deliveryPolicyWindow.fundsReleaseAt',
    'deliveryPolicyWindow.trackingSourceHash','deliveryPolicyWindow.observationHash',
    'deliveryCorrectionResolution.sourceHash','deliveryCorrectionResolution.effectiveFundsReleaseAt',
    'refund.intentId','refund.attemptId','refund.state','refund.providerStatus','refund.paymentIntentId','refund.stripeRefundId',
    'refund.cardAmountCents','refund.walletAmountCents','refund.sellerDebitCents','refund.freezeCents','refund.idempotencyKey',
    'refund.cardRepairSettlement.protocol','refund.cardRepairSettlement.refundIntentId','refund.cardRepairSettlement.originalRefundId','refund.cardRepairSettlement.repairId','refund.cardRepairSettlement.amountCents','refund.cardRepairSettlement.proofHash','refund.fundsAppliedAt','refund.outstandingCardCents','refund.localOutstandingWalletCents','refund.localOutstandingSellerCents',
    'manualRefundRestitution.protocol','manualRefundRestitution.refundIntentId','manualRefundRestitution.obligationHash','manualRefundRestitution.instructionId',
    'manualRefundRestitution.instructionHash','manualRefundRestitution.state','manualRefundRestitution.amountCents','manualRefundRestitution.beneficiaryId',
    'manualRefundRestitution.beneficiaryEvidenceId','manualRefundRestitution.paymentEvidenceId','manualRefundRestitution.attestationId','manualRefundRestitution.voidId',
    'refund.manualBankSettlement.protocol','refund.manualBankSettlement.verificationBasis','refund.manualBankSettlement.instructionId','refund.manualBankSettlement.attestationId',
    'refund.manualBankSettlement.amountCents','refund.manualBankSettlement.beneficiaryId','refund.manualBankSettlement.obligationHash','refund.manualBankSettlement.beneficiaryEvidenceHash',
    'refund.manualBankSettlement.paymentEvidenceHash','refund.manualBankSettlement.transferReferenceHash','refund.manualBankSettlement.executedDate','refund.manualBankSettlement.attestationHash',
    'refund.manualBankSettlement.preparationHash','refund.manualBankSettlement.recordHash','refund.manualConfirmedCents','refund.duplicateCardSettlementCents',
    'refund.allocation.protocol','refund.allocation.reservationHash','refund.allocation.basisHash','refund.allocation.cumulativeHash',
    'refund.allocation.terms.currency','refund.allocation.terms.settlementKind','refund.allocation.terms.cardCents',
    'refund.allocation.terms.walletCents','refund.allocation.terms.sellerDebitCents','refund.allocation.terms.platformArticleCostCents',
    'refund.allocation.terms.paymentDeadline.qualification','refund.allocation.terms.paymentDeadline.date',
    'refund.allocation.agreement.agreementId','refund.allocation.agreement.version','refund.allocation.agreement.termsHash',
    'refund.allocation.agreement.acceptanceHash',
    'labelAttempts','lastCountedLabelAttemptId','shippingQuoteId','shipEngineRateId','shipEngineLabelId','returnLabelId','labelPurchase.attemptId','labelPurchase.state',
    'labelPurchase.transactionId','labelPurchase.buyerId','labelPurchase.sellerId','labelPurchase.shipmentId','labelPurchase.rateId','labelPurchase.sourceHash','labelPurchase.requestBodyHash','labelPurchase.providerLabelId',
    'disputeFreezeCents','refundedVia','stripeRefundId','bankDispute.closedAt','bankDispute.id','bankDispute.amountCents','bankDispute.freezeCents','bankDispute.ledgerReconciledAt',
    'bankDispute.commercialHoldRelease.schemaVersion','bankDispute.commercialHoldRelease.bankDisputeId',
    'bankDispute.commercialHoldRelease.amountCents','bankDispute.commercialHoldRelease.holdLedgerId',
    'bankDispute.commercialHoldRelease.buyerId','bankDispute.commercialHoldRelease.sellerId','bankDispute.commercialHoldRelease.paymentIntentId',
    'bankDispute.commercialHoldRelease.openedAt','bankDispute.commercialHoldRelease.closedAt','bankDispute.commercialHoldRelease.outcome','bankDispute.commercialHoldRelease.decisionId','bankDispute.commercialHoldRelease.releaseLedgerId','bankDispute.commercialHoldRelease.releasedAt',
    'cashAgreement.protocol','cashAgreement.agreementId','cashAgreement.acceptedAt','cashAgreement.articleSourceHash','cashAgreement.locationSourceHash',
    'cashAgreement.offeredBy','cashAgreement.acceptedBy','cashAgreement.amountCents','cashAgreement.platformMoneyObligationCents',
    "returnRequest.schemaVersion","returnRequest.requestId","returnRequest.version",
    "returnRequest.transactionId","returnRequest.actorUid","returnRequest.buyerId",
    "returnRequest.sellerId","returnRequest.reason","returnRequest.totalCents",
    "returnRequest.sellerPayoutCents","returnRequest.currency","returnRequest.requestedAt",
    "returnRequest.fundsReleaseAt","returnRequest.sourceHash","returnRequest.state",
    "returnRequest.effectiveDeliveryWindowSourceHash","returnRequest.preparationAuthorizedAt","returnRequest.authorizedAt",
    "returnRequest.purchaseExternalId","returnRequest.committedAt","returnRequest.quote.schemaVersion",
    "returnRequest.quote.quoteId","returnRequest.quote.requestId","returnRequest.quote.transactionId",
    "returnRequest.quote.ownerId","returnRequest.quote.sourceHash","returnRequest.quote.rateId",
    "returnRequest.quote.currency","returnRequest.quote.expectedCostCents","returnRequest.quote.issuedAt",
    "returnRequest.quote.depositTermsHash","returnRequest.quote.convenienceReturnFinancialTermsHash","returnRequest.acceptance.actorUid",
    "returnRequest.acceptance.quoteId","returnRequest.acceptance.rateId","returnRequest.acceptance.expectedCostCents",
    "returnRequest.acceptance.currency","returnRequest.acceptance.acceptedAt","returnRequest.acceptance.convenienceReturnFinancialTermsHash",
    "returnRequest.acceptance.expectedNetRefundCents","returnRequest.acceptance.returnDepositTermsHash","returnRequest.labelProof.schemaVersion",
    "returnRequest.labelProof.labelId","returnRequest.labelProof.shipmentId","returnRequest.labelProof.carrierId",
    "returnRequest.labelProof.carrierCode","returnRequest.labelProof.serviceCode","returnRequest.labelProof.outboundLabelId",
    "returnRequest.labelProof.trackingNumber","returnRequest.labelProof.cost","returnRequest.labelProof.currency",
    "returnRequest.labelProof.shipmentCents","returnRequest.labelProof.insuranceCents","returnRequest.labelProof.totalCents",
    "returnRequest.labelProof.providerCreatedAt","returnRequest.routeAmendmentCapture.protocol","returnRequest.routeAmendmentCapture.transactionId",
    "returnRequest.routeAmendmentCapture.leg","returnRequest.routeAmendmentCapture.requestId","returnRequest.routeAmendmentCapture.buyerId",
    "returnRequest.routeAmendmentCapture.sellerId","returnRequest.routeAmendmentCapture.baseHash","returnRequest.routeAmendmentCapture.proposal.id",
    "returnRequest.routeAmendmentCapture.proposal.contentHash","returnRequest.routeAmendmentCapture.recordedAt","returnRequest.convenienceReturn.proposalId",
    "returnRequest.convenienceReturn.contentHash","returnRequest.convenienceReturn.termsProtocol","returnRequest.convenienceReturnBasis.protocol",
    "returnRequest.convenienceReturnBasis.transactionId","returnRequest.convenienceReturnBasis.buyerId","returnRequest.convenienceReturnBasis.sellerId",
    "returnRequest.convenienceReturnBasis.proposalId","returnRequest.convenienceReturnBasis.agreementContentHash","returnRequest.convenienceReturnBasis.agreementSourceHash",
    "returnRequest.convenienceReturnBasis.termsHash","returnRequest.convenienceReturnBasis.acceptedAt","returnRequest.convenienceReturnBasis.initialReleaseAt",
    "returnRequest.commercialReturn.instructionId","returnRequest.commercialReturn.contentHash","returnRequest.commercialReturnBasis.protocol",
    "returnRequest.commercialReturnBasis.transactionId","returnRequest.commercialReturnBasis.buyerId","returnRequest.commercialReturnBasis.sellerId",
    "returnRequest.commercialReturnBasis.disputeId","returnRequest.commercialReturnBasis.instructionId","returnRequest.commercialReturnBasis.contentHash",
    "returnRequest.commercialReturnBasis.semanticSourceHash","returnRequest.commercialReturnBasis.reportedAt","returnRequest.commercialReturnBasis.instructedAt",
    "returnRequest.commercialReturnBasis.initialReleaseAt",
    
    
    
    
    
    "shippingSnapshot.parcel.weight.value","shippingSnapshot.parcel.weight.unit",
    "shippingSnapshot.parcel.dimensions.length","shippingSnapshot.parcel.dimensions.width","shippingSnapshot.parcel.dimensions.height",
    "shippingSnapshot.parcel.dimensions.unit",
    
    "returnRequest.quote.context.shipFrom.name","returnRequest.quote.context.shipFrom.addressLine1",
    "returnRequest.quote.context.shipFrom.addressLine2","returnRequest.quote.context.shipFrom.cityLocality","returnRequest.quote.context.shipFrom.stateProvince",
    "returnRequest.quote.context.shipFrom.postalCode","returnRequest.quote.context.shipFrom.countryCode","returnRequest.quote.context.shipFrom.phone",
    "returnRequest.quote.context.shipFrom.email","returnRequest.quote.context.shipTo.name","returnRequest.quote.context.shipTo.addressLine1",
    "returnRequest.quote.context.shipTo.addressLine2","returnRequest.quote.context.shipTo.cityLocality","returnRequest.quote.context.shipTo.stateProvince",
    "returnRequest.quote.context.shipTo.postalCode","returnRequest.quote.context.shipTo.countryCode","returnRequest.quote.context.shipTo.phone",
    "returnRequest.quote.context.shipTo.email","returnRequest.quote.context.parcel.weight.value","returnRequest.quote.context.parcel.weight.unit",
    "returnRequest.quote.context.parcel.dimensions.length","returnRequest.quote.context.parcel.dimensions.width","returnRequest.quote.context.parcel.dimensions.height",
    "returnRequest.quote.context.parcel.dimensions.unit","returnRequest.quote.context.isReturn","returnRequest.quote.context.outboundLabelId",
    "returnRequest.quote.context.carrierId","returnRequest.quote.context.carrierCode","returnRequest.quote.context.serviceCode",
    "returnRequest.quote.context.externalShipmentId","returnRequest.labelContext.shipFrom.name","returnRequest.labelContext.shipFrom.addressLine1",
    "returnRequest.labelContext.shipFrom.addressLine2","returnRequest.labelContext.shipFrom.cityLocality","returnRequest.labelContext.shipFrom.stateProvince",
    "returnRequest.labelContext.shipFrom.postalCode","returnRequest.labelContext.shipFrom.countryCode","returnRequest.labelContext.shipFrom.phone",
    "returnRequest.labelContext.shipFrom.email","returnRequest.labelContext.shipTo.name","returnRequest.labelContext.shipTo.addressLine1",
    "returnRequest.labelContext.shipTo.addressLine2","returnRequest.labelContext.shipTo.cityLocality","returnRequest.labelContext.shipTo.stateProvince",
    "returnRequest.labelContext.shipTo.postalCode","returnRequest.labelContext.shipTo.countryCode","returnRequest.labelContext.shipTo.phone",
    "returnRequest.labelContext.shipTo.email","returnRequest.labelContext.parcel.weight.value","returnRequest.labelContext.parcel.weight.unit",
    "returnRequest.labelContext.parcel.dimensions.length","returnRequest.labelContext.parcel.dimensions.width","returnRequest.labelContext.parcel.dimensions.height",
    "returnRequest.labelContext.parcel.dimensions.unit","returnRequest.labelContext.isReturn","returnRequest.labelContext.outboundLabelId",
    "returnRequest.labelContext.carrierId","returnRequest.labelContext.carrierCode","returnRequest.labelContext.serviceCode",
    "returnRequest.labelContext.externalShipmentId","returnRequest.routeAmendmentCapture.context.shipFrom.name","returnRequest.routeAmendmentCapture.context.shipFrom.addressLine1",
    "returnRequest.routeAmendmentCapture.context.shipFrom.addressLine2","returnRequest.routeAmendmentCapture.context.shipFrom.cityLocality","returnRequest.routeAmendmentCapture.context.shipFrom.stateProvince",
    "returnRequest.routeAmendmentCapture.context.shipFrom.postalCode","returnRequest.routeAmendmentCapture.context.shipFrom.countryCode","returnRequest.routeAmendmentCapture.context.shipFrom.phone",
    "returnRequest.routeAmendmentCapture.context.shipFrom.email","returnRequest.routeAmendmentCapture.context.shipTo.name","returnRequest.routeAmendmentCapture.context.shipTo.addressLine1",
    "returnRequest.routeAmendmentCapture.context.shipTo.addressLine2","returnRequest.routeAmendmentCapture.context.shipTo.cityLocality","returnRequest.routeAmendmentCapture.context.shipTo.stateProvince",
    "returnRequest.routeAmendmentCapture.context.shipTo.postalCode","returnRequest.routeAmendmentCapture.context.shipTo.countryCode","returnRequest.routeAmendmentCapture.context.shipTo.phone",
    "returnRequest.routeAmendmentCapture.context.shipTo.email","returnRequest.routeAmendmentCapture.context.parcel.weight.value","returnRequest.routeAmendmentCapture.context.parcel.weight.unit",
    "returnRequest.routeAmendmentCapture.context.parcel.dimensions.length","returnRequest.routeAmendmentCapture.context.parcel.dimensions.width","returnRequest.routeAmendmentCapture.context.parcel.dimensions.height",
    "returnRequest.routeAmendmentCapture.context.parcel.dimensions.unit","returnRequest.routeAmendmentCapture.context.isReturn","returnRequest.routeAmendmentCapture.context.outboundLabelId",
    "returnRequest.routeAmendmentCapture.context.carrierId","returnRequest.routeAmendmentCapture.context.carrierCode","returnRequest.routeAmendmentCapture.context.serviceCode",
    "returnRequest.routeAmendmentCapture.context.externalShipmentId","returnRequest.quote.rates.rates.0.rateId","returnRequest.quote.rates.rates.0.shipmentId",
    "returnRequest.quote.rates.rates.0.shippingCents","returnRequest.quote.rates.rates.0.carrierId","returnRequest.quote.rates.rates.0.carrierCode",
    "returnRequest.quote.rates.rates.0.serviceCode","returnRequest.quote.rates.rates.0.componentsCents.shipping","returnRequest.quote.rates.rates.0.componentsCents.insurance",
    "returnRequest.quote.rates.rates.0.componentsCents.confirmation","returnRequest.quote.rates.rates.0.componentsCents.other","returnRequest.quote.rates.shipmentId",
    "returnRequest.quote.rates.qualification.version",
    'shippingSnapshot.schemaVersion','shippingSnapshot.provider','shippingSnapshot.currency','shippingSnapshot.priceAcceptedBy','shippingSnapshot.validatedAt','shippingSnapshot.acceptanceValidatedAt','shippingSnapshot.measurementSource','shippingSnapshot.measurementVerified','shippingSnapshot.parcelVersion','shippingSnapshot.shipmentId','shippingSnapshot.acceptancePolicyVersion','shippingSnapshot.localValidUntil','shippingSnapshot.quotedAt','shippingSnapshot.rate.rateId','shippingSnapshot.rate.shipmentId','shippingSnapshot.rate.carrierId','shippingSnapshot.rate.carrierCode','shippingSnapshot.rate.serviceCode','shippingSnapshot.rate.shippingCents','shippingSnapshot.origin.name','shippingSnapshot.origin.street','shippingSnapshot.origin.line2','shippingSnapshot.origin.city','shippingSnapshot.origin.province','shippingSnapshot.origin.postalCode','shippingSnapshot.origin.country','shippingSnapshot.origin.phone','shippingSnapshot.origin.email','shippingSnapshot.destination.name','shippingSnapshot.destination.street','shippingSnapshot.destination.line2','shippingSnapshot.destination.city','shippingSnapshot.destination.province','shippingSnapshot.destination.postalCode','shippingSnapshot.destination.country','shippingSnapshot.destination.phone','shippingSnapshot.destination.email',
    'purchaseRefundCaseDisposition.protocol','purchaseRefundCaseDisposition.transactionId','purchaseRefundCaseDisposition.buyerId','purchaseRefundCaseDisposition.sellerId','purchaseRefundCaseDisposition.decisionId','purchaseRefundCaseDisposition.disputeId','purchaseRefundCaseDisposition.refundIntentId','purchaseRefundCaseDisposition.recordedAt','purchaseRefundCaseDisposition.allocation.protocol','purchaseRefundCaseDisposition.allocation.basisHash','purchaseRefundCaseDisposition.allocation.cumulativeHash','purchaseRefundCaseDisposition.allocation.agreement.agreementId','purchaseRefundCaseDisposition.allocation.agreement.version','purchaseRefundCaseDisposition.allocation.agreement.termsHash','purchaseRefundCaseDisposition.allocation.agreement.acceptanceHash','purchaseRefundCaseDisposition.allocation.terms.currency','purchaseRefundCaseDisposition.allocation.terms.settlementKind','purchaseRefundCaseDisposition.allocation.terms.cardCents','purchaseRefundCaseDisposition.allocation.terms.walletCents','purchaseRefundCaseDisposition.allocation.terms.sellerDebitCents','purchaseRefundCaseDisposition.allocation.terms.platformArticleCostCents',
    'cashReservationRelease.protocol','cashReservationRelease.releaseId','cashReservationRelease.agreementId','cashReservationRelease.releasedAt'],
  card_intent: ['schemaVersion','protocol','ownerId','transactionId','intentId','version','state','sellerId','walletCents','totalCents',
    'cardCents','currency','sourceHash','sourceRevision','paymentIntentId','confirmAttemptId','retireOperationId','walletLedgerId',
    'walletCommittedAt','authorizedAt','receivedCents','capturableCents','quoteId','rateId'],
  withdrawal: ['exceptionalRestitution.protocol','exceptionalRestitution.caseId','exceptionalRestitution.instructionId','exceptionalRestitution.state','exceptionalRestitution.ownerId','exceptionalRestitution.amountCents','exceptionalRestitution.sourceHash','userId','amount','currency','status','ledgerEntryId','stripeAccountId','stripeTransferId','stripePayoutId',
    'payoutDestination.accountId','payoutDestination.bankAccountId','payoutDestination.selectionIdentity',
    'withdrawalIntent.schemaVersion','withdrawalIntent.ownerId','withdrawalIntent.clientRequestId','withdrawalIntent.withdrawalRequestId',
    'withdrawalIntent.payloadHash','withdrawalIntent.amountCents','withdrawalIntent.currency','withdrawalIntent.accountId',
    'withdrawalIntent.bankAccountId','withdrawalIntent.debitLedgerId','withdrawalIntent.transferKey','withdrawalIntent.payoutKey',
    'providerSubmission.transfer.state','providerSubmission.transfer.providerId','providerSubmission.payout.state','providerSubmission.payout.providerId',
    'payoutRecovery.schemaVersion','payoutRecovery.requestId','payoutRecovery.ownerId','payoutRecovery.amountCents','payoutRecovery.currency',
    'payoutRecovery.accountId','payoutRecovery.payoutId','payoutRecovery.transferId','payoutRecovery.debitLedgerId',
    'payoutRecovery.idempotencyKey','payoutRecovery.externalAttemptedAtMs','payoutRecovery.leaseOwner',
    'payoutRecovery.leaseUntilMs','payoutRecovery.reversalId','payoutRecovery.returnBalanceTransactionId','payoutRecovery.compensationLedgerId',
    'transferOutcome','payoutOutcome'],
  swap: ['initiatorId','receiverId','cashTopUp.amount','cashTopUp.payerId','cashTopUp.paidAt','stripePaymentIntentId',
    'topUpPaymentIntentId','topUpRefundIntentId','topUpRefundId','topUpFundsBucket','topUpAmountCents','topUpPayerId','topUpPayeeId',
    'topUpPaid','topUpPaidAt','topUpChargeId','topUpFee','topUpTax',
    'topUpSettlement.protocol','topUpSettlement.state','topUpSettlement.swapId','topUpSettlement.paymentIntentId',
    'topUpSettlement.payerId','topUpSettlement.payeeId','topUpSettlement.baseCents','topUpSettlement.serviceFeeCents',
    'topUpSettlement.taxCents','topUpSettlement.totalCents','topUpSettlement.receivedCents','initiatorReceivedAt','receiverReceivedAt','topUpFundsHeldAt','topUpFundsReleaseAt','topUpReleasedAt','topUpRefundedAt'],
  swap_topup: ['protocol','ownerId','swapId','intentId','operationId','state','version','paymentIntentId','payerId','payeeId',
    'amountCents','baseCents','feeCents','totalCents','currency','refundId','idempotencyKey','bodyHash',
    'providerId','amounts.baseCents','amounts.serviceFeeCents','amounts.taxCents','amounts.totalCents','amounts.currency',
    'agreementHash','sourceHash','sourceProofHash','workId','source','activeCommand','actorId','payloadHash','command.action','authorizedAt','postAuthorizedAt',
    'futureEffectsNeutralizedAt','expected.baseCents','expected.serviceFeeCents','expected.taxCents','expected.totalCents',
    'expected.currency','expected.swapId','expected.payerId','expected.payeeId','expected.paymentIntentId','expected.intentId'],
  refund_repair: ['protocol','repairId','transactionId','refundIntentId','actorId','commandHash','buyerId','sellerId','ordinal',
    'attemptId','paymentIntentId','chargeId','amountCents','currency','idempotencyKey','state','providerRefundId','providerStatus',
    'cardRepairedCents','externalAttemptedAtMs','targetRefundIds','command.sourceHash','command.sourceRevision',
    'command.terminalRefundId','command.terminalAttemptId','command.action','firstIoAuthorization.sourceHash','newEffectRefusedReason'],
  shop_entitlement: ['ownerId','tier','tierPaidUntil','tierPaymentIntentId','tierChargeId','plan','forfait','feesTier','buyerFeePercent'],
  bank_operation: ['action','schemaVersion','ownerId','actorUid','id','requestId','accountId','mode','inputHash','source',
    'policyVersion','previousBankAccountId','bankAccountId','state','attemptId','leaseUntilMs','declaration.accepted',
    'declaration.statementVersion','declaration.ownershipVerified','declaration.proofType','declaration.authTime',
    'declaration.acceptedAtMs'],
  bank_case_root: ['protocol','transactionId','disputeId','pendingEffect.id','pendingEffect.actorId','pendingEffect.payloadHash',
    'currentDraft.id','currentDraft.contentHash','currentStage.id','currentStage.contentHash','responsibleUid'],
  bank_case_entry: ['protocol','document.id','document.transactionId','document.disputeId','document.actorId',
    'document.requestId','document.sourceHash','contentHash'],
  bank_case_command: ['protocol','id','actorId','requestId','transactionId','disputeId','payloadHash','command.action',
    'command.scope','command.sourceHash','nativeSource.sourceHash','nativeSource.parties','providerPayloadHash',
    'providerBefore.disputeId','providerBefore.paymentIntentId','providerBefore.chargeId','providerBefore.currency',
    'providerBefore.amountCents','providerBefore.livemode','providerBefore.status','providerBefore.evidenceHash',
    'providerBefore.submissionCount','providerBefore.hasEvidence','providerBefore.pastDue','providerBefore.dueBySeconds',
    'providerBefore.operationMarker','postAuthorizedAt','futureEffectsNeutralizedAt','providerFile.id','providerFile.purpose',
    'providerFile.byteLength','providerFile.sourceSha256','providerFile.generation','providerFile.crc32c',
    'closeResponse.disputeId','closeResponse.status','closeResponse.requestId','closeResponse.observedAt'],
  label_lifecycle_command: ['protocol','actorId','requestId','payloadHash','command.transactionId','command.leg','command.scope',
    'command.action','command.sourceHash','command.sourceRevision','command.caseVersion','command.quoteReference.id',
    'command.quoteReference.contentHash','command.platformAuthorization.approved','command.platformAuthorization.payer',
    'command.platformAuthorization.currency','command.platformAuthorization.amountCents','command.platformAuthorization.authorityReference',
    'command.platformAuthorization.cause','state','providerOperationState','providerRequestedAt','expectedSemanticHash',
    'sourceCapture.semanticSourceHash','sourceCapture.sourceHash','sourceCapture.sourceRevision','sourceCapture.caseVersion',
    'sourceCapture.buyerId','sourceCapture.sellerId','sourceCapture.routeSourceHash','sourceCapture.purchasePolicyHash',
    'replacementQuoteContentHash','entryId','caseVersionAtCommit','recordedAt'],
  label_lifecycle_case: ['protocol','caseId','transactionId','leg','buyerId','sellerId','version','pendingEffect.actorId',
    'pendingEffect.requestId','pendingEffect.payloadHash','pendingEffect.reservedVersion','latestQuoteId','latestQuoteHash',
    'pendingReplacement.entryId','pendingReplacement.contentHash','pendingReplacement.labelId',
    'replacementAcceptances.buyer.actorId','replacementAcceptances.buyer.entryId','replacementAcceptances.buyer.quoteReference.id',
    'replacementAcceptances.buyer.quoteReference.contentHash','replacementAcceptances.buyer.recordedAt',
    'replacementAcceptances.seller.actorId','replacementAcceptances.seller.entryId','replacementAcceptances.seller.quoteReference.id',
    'replacementAcceptances.seller.quoteReference.contentHash','replacementAcceptances.seller.recordedAt',
    'latestInstructionId','latestProviderObservationId'],
  shop_tier: ['protocol','action','id','operationId','requestId','inputHash','idempotencyKey','ownerId','shopId','tier',
    'amountCents','currency','periodMonths','durationDays','state','paymentIntentId','postAuthorizationId','postBodyHash','postAuthorizedAt',
    'currentOperationId','currentRequestId','legacyHistoryQualified','cancelAuthorization.protocol','cancelAuthorization.paymentIntentId',
    'cancelAuthorization.amountCents','cancelAuthorization.currency','cancelAuthorization.authorizedAt','cancelAuthorization.idempotencyKey',
    'cancelAuthorization.bodyHash','cancellation.proofHash',
    'settlement.protocol','settlement.proofHash','entitlement.operationId','entitlement.proofHash'],
};
const presenceDates = new Set(['fundsReleasedAt','refund.fundsAppliedAt','walletCommittedAt','authorizedAt',
  'cancelAuthorization.authorizedAt','bankDispute.ledgerReconciledAt','bankDispute.closedAt','bankDispute.commercialHoldRelease.releasedAt',
  'cashAgreement.acceptedAt','purchaseRefundCaseDisposition.recordedAt','shippingSnapshot.validatedAt','cashReservationRelease.releasedAt','cashTopUp.paidAt','topUpPaidAt','topUpReleasedAt','topUpRefundedAt','postAuthorizedAt','futureEffectsNeutralizedAt']);
function native(value: unknown): unknown {
  if(value===null || typeof value==='string' || typeof value==='boolean' || typeof value==='number'&&Number.isFinite(value))return value;
  if(Array.isArray(value)&&value.length<=200&&value.every(v=>typeof v==='string'))return value;
  if(value instanceof Timestamp && Number.isSafeInteger(value.seconds) && value.seconds>=-62135596800 && value.seconds<=253402300799 &&
      Number.isSafeInteger(value.nanoseconds) && value.nanoseconds>=0 && value.nanoseconds<1000000000){
    return {seconds:value.seconds,nanoseconds:value.nanoseconds};
  }
  throw new FinancialRecoveryBlocked('domain_source_unqualified');
}
/** Explicit paths exclude only the chosen maintenance fields; a business
 * deadline with the same nested name cannot disappear through recursion. */
export function financialRecoverySourceHash(domain: FinancialRecoveryDomain, data: Data): string {
  if(!data || typeof data!=='object' || Array.isArray(data) || !fields[domain])throw new FinancialRecoveryBlocked('domain_source_unqualified');
  if(domain==='wallet' && (['balance','pendingBalance','heldBalance','sellerDebt'].some(key=>Object.prototype.hasOwnProperty.call(data,key)&&(!Number.isSafeInteger(data[key])||data[key]<0)) ||
      Object.prototype.hasOwnProperty.call(data,'currency')&&(typeof data.currency!=='string'||data.currency.toUpperCase()!=='CAD')))throw new FinancialRecoveryBlocked('wallet_source_unqualified');
  // Open bank identities and review flags remain restrictive observations.
  // The native reserve amount is bound separately; terminal financial identity
  // and release proofs are selected after a recorded closure/settlement.
  const bankFinancial = domain==='purchase' && (data.bankDispute?.closedAt!=null ||
    data.bankDispute?.ledgerReconciledAt!=null || data.bankDispute?.commercialHoldRelease!=null);
  const parents=new Map<string,unknown>();
  const projection=fields[domain].map(key=>{
    if(domain==='purchase' && key.startsWith('bankDispute.') && !bankFinancial)return [key,false];
    let value:any=data,path='';
    for(const part of key.split('.')){
      if(!value || typeof value!=='object' || !Object.prototype.hasOwnProperty.call(value,part))return [key,false];
      value=value[part];path=path?path+'.'+part:part;
      if(path!==key)parents.set(path,value===null?'null':typeof value==='object'&&!Array.isArray(value)?'map':'other');
    }
    if(presenceDates.has(key) && !(domain==='bank_case_command' && ['postAuthorizedAt','futureEffectsNeutralizedAt'].includes(key))){
      if(value===null)return [key,true,null];
      if(value instanceof Timestamp){native(value);return [key,true,true];}
      if(value instanceof FieldValue && value.isEqual(FieldValue.serverTimestamp()))return [key,true,true];
      throw new FinancialRecoveryBlocked('domain_source_unqualified');
    }
    return [key,true,native(value)];
  });
  return createHash('sha256').update(JSON.stringify(['financial_recovery_domain_source_v1',domain,[...parents].sort(([a],[b])=>a.localeCompare(b)),projection])).digest('hex');
}
export async function prepareFinancialRecoverySource(domain: FinancialRecoveryDomain, ref: string, current: Data,
  next: Data = current): Promise<FinancialRecoveryWitness> {
  if(Object.prototype.hasOwnProperty.call(current,'localCatalogueWitness')||Object.prototype.hasOwnProperty.call(next,'localCatalogueWitness'))throw new FinancialRecoveryBlocked('local_catalogue_cannot_become_financial');
  if((domain==='purchase'||domain==='swap')&&current.localAgreementWitness)throw new FinancialRecoveryBlocked('local_source_cannot_become_financial');
  return assertFinancialRecoverySource({ref,nativeSourceHash:financialRecoverySourceHash(domain,current),
    witness:current.financialRecoveryWitness,nextSourceHash:financialRecoverySourceHash(domain,next)});
}
/** The caller must supply the exact absent snapshot read by its transaction. */
export async function prepareFinancialRecoveryNewSource(domain: FinancialRecoveryDomain,
  missing: FirebaseFirestore.DocumentSnapshot, initial: Data): Promise<FinancialRecoveryWitness> {
  if(Object.prototype.hasOwnProperty.call(initial,'localCatalogueWitness'))throw new FinancialRecoveryBlocked('local_catalogue_cannot_become_financial');
  if((domain==='purchase'||domain==='swap')&&initial.localAgreementWitness)throw new FinancialRecoveryBlocked('local_source_cannot_become_financial');
  if (missing.exists || !missing.ref?.path) throw new FinancialRecoveryBlocked('new_source_absence_unqualified');
  return financialRecoveryNewSourceWitness(missing.ref.path,financialRecoverySourceHash(domain,initial));
}

/** Inventory-only dispatch. In an initial unconfigured installation these
 * fields cannot become a financial witness or a provider permission. */
export async function inventoryRecoverySourceFields(domain:LocalCatalogueDomain,ref:string,current:Data|undefined,next:Data,
  missing?:FirebaseFirestore.DocumentSnapshot):Promise<Data>{
  if(missing&&missing.ref.path!==ref)throw new FinancialRecoveryBlocked('new_source_absence_unqualified');
  if(process.env.FINANCIAL_RECOVERY_ENVIRONMENT==='unconfigured'){
    await assertFinancialRecoveryEffect('firestore_commit',{refs:[ref]});
    if(localCatalogueRestrictionOnly(ref,current,next))return {};
    return {localCatalogueWitness:localCatalogueFields(domain,ref,current,next,!!missing&&!missing.exists)};
  }
  return {financialRecoveryWitness:missing&&!missing.exists?await prepareFinancialRecoveryNewSource(domain,missing,next):
    await prepareFinancialRecoverySource(domain,ref,current!,next)};
}

/** Numeric results are explicit caller calculations, never SDK transform
 * introspection. Missing snapshots are required for genuinely new wallets. */
export async function financialRecoveryWalletFields(ref: FirebaseFirestore.DocumentReference,
  current: Data | FirebaseFirestore.DocumentSnapshot, fields: Data, numericResults: Data = {}): Promise<Data> {
  const snapshot = typeof current.data === 'function' && typeof current.exists === 'boolean'
    ? current as FirebaseFirestore.DocumentSnapshot : null;
  const before = snapshot ? snapshot.data() : current as Data;
  const after = {...before,...fields,...numericResults};
  const financialRecoveryWitness = snapshot && !snapshot.exists
    ? await prepareFinancialRecoveryNewSource('wallet',snapshot,after)
    : await prepareFinancialRecoverySource('wallet',ref.path,before!,after);
  return {...fields,financialRecoveryWitness};
}

/** Flat Firestore field paths are interpreted without changing the original
 * patch. Numeric transforms must have their exact resulting native value. */
export async function financialRecoverySourceFields(domain: FinancialRecoveryDomain,
  ref: FirebaseFirestore.DocumentReference, current: Data | FirebaseFirestore.DocumentSnapshot,
  fields: Data, numericResults: Data = {}, deletedPaths: readonly string[] = []): Promise<Data> {
  if((domain==='purchase'||domain==='swap')&&process.env.FINANCIAL_RECOVERY_ENVIRONMENT==='unconfigured')fields=localServerTimestamps(fields);
  const snapshot = typeof current.data === 'function' && typeof current.exists === 'boolean'
    ? current as FirebaseFirestore.DocumentSnapshot : null;
  const before = snapshot ? snapshot.data() : current as Data;
  const after = {...before};
  for (const [key,value] of Object.entries({...fields,...numericResults})) {
    const path=key.split('.');
    if(path.length>10 || path.some(part=>!part || ['__proto__','constructor','prototype'].includes(part))) throw new FinancialRecoveryBlocked('domain_patch_unqualified');
    let parent:Data=after;
    for(const part of path.slice(0,-1)){parent[part]={...parent[part]};parent=parent[part];}
    const leaf=path[path.length-1];
    const deletion = value instanceof FieldValue && value.isEqual(FieldValue.delete());
    if(deletedPaths.includes(key)||deletion)delete parent[leaf];else parent[leaf]=value;
  }
  if((domain==='purchase'||domain==='swap') && process.env.FINANCIAL_RECOVERY_ENVIRONMENT==='unconfigured') {
    await assertFinancialRecoveryEffect('firestore_commit',{refs:[ref.path]});
    return {...fields,localAgreementWitness:localAgreementFields(domain,ref.path,before,after,!!snapshot&&!snapshot.exists)};
  }
  if((domain==='purchase'||domain==='swap') && before?.localAgreementWitness)throw new FinancialRecoveryBlocked('local_source_cannot_become_financial');
  if(domain==='inventory_article'||domain==='inventory_unit')return {...fields,...await inventoryRecoverySourceFields(domain,ref.path,before,after,snapshot??undefined)};
  const financialRecoveryWitness = snapshot && !snapshot.exists
    ? await prepareFinancialRecoveryNewSource(domain,snapshot,after)
    : await prepareFinancialRecoverySource(domain,ref.path,before!,after);
  return {...fields,financialRecoveryWitness};
}

/** One check for ONE invocation of a native commit callback. Callers create
 * this closure anew inside every transaction attempt, never reuse it on retry. */
export function financialRecoveryCommitCheckpoint(): (source?: import('./financialRecoveryInterlock').FinancialRecoverySource) => Promise<void> {
  let assertion: Promise<void> | null = null;
  return source => assertion ??= assertFinancialRecoveryEffect('firestore_commit',source);
}

/** Shipping diagnostics affect the purchase source and must invalidate a
 * concurrent disposition just like every other native purchase mutation. */
export async function writeFinancialRecoveryPurchaseDiagnostic(database: FirebaseFirestore.Firestore,
  ref: FirebaseFirestore.DocumentReference, fields: {labelCreationPending: boolean; labelCreationNote: string}) {
  return database.runTransaction(async tx => {
    const snapshot = await tx.get(ref);
    if (!snapshot.exists) throw new FinancialRecoveryBlocked('purchase_diagnostic_source_missing');
    tx.update(ref, await financialRecoverySourceFields('purchase', ref, snapshot, fields));
  });
}
