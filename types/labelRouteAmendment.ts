import type { LabelLifecycleContext, LabelLifecycleScope, LabelLifecycleCursor, LabelLifecycleCoverage } from './labelLifecycle';
export interface LabelRouteEffects {
  shippingPermissionGranted: false; additionalPartyChargeAuthorized: false; inventoryEffectAuthorized: false;
  interceptionAuthorized: false; carrierPossessionVerified: false; historicalAddressReconstructed: false;
}
export interface LabelRouteAddress {name: string; street: string; line2?: string; city: string; province: 'QC'; postalCode: string; country: 'CA'}
export interface LabelOperationalRoute {
  origin: LabelRouteAddress; destination: LabelRouteAddress;
  parcel: {weight: {value: number; unit: 'kilogram'}; dimensions: {length: number; width: number; height: number; unit: 'centimeter'}};
  carrierId: string; carrierCode: string; serviceCode: string; outboundLabelId: string | null;
}
export interface LabelRouteReference {id: string; contentHash: string}
export type LabelParcelAmendmentCapability = 'label_parcel_amendment_v1';
export interface LabelPreviousParcel {qualification: 'native_current_label_route' | 'native_historical_route' | 'unknown'; sourceHash: string | null; labelId: string | null}
export interface LabelParcelObservation {
  protocol: 'label_parcel_measurement_statement_v1'; previousParcel: LabelPreviousParcel;
  weight: {value: number | null; unit: 'kilogram' | 'gram' | 'pound' | 'ounce' | 'unknown'};
  dimensions: {length: number | null; width: number | null; height: number | null; unit: 'centimeter' | 'millimeter' | 'inch' | 'unknown'};
  observedAt: string | null; method: string | null;
}
export interface LabelParcelAmendment {
  capability: LabelParcelAmendmentCapability; enabled: boolean; previousParcel: LabelPreviousParcel;
  previousMeasurements: LabelOperationalRoute['parcel'] | null; physicalMeasurementsVerified: false; unitConversionApplied: false; previousSourcePreserved: true;
}
export type LabelRouteHandoverDeclaration = 'not_deposited_declared' | 'deposited_declared' | 'unknown';
export interface LabelRouteCapturedContext {
  shipFrom: {name: string; addressLine1: string; addressLine2?: string; cityLocality: string; stateProvince: string; postalCode: string; countryCode: string};
  shipTo: LabelRouteCapturedContext['shipFrom']; parcel: LabelOperationalRoute['parcel']; isReturn?: boolean;
  externalShipmentId?: string; carrierId?: string; carrierCode?: string; serviceCode?: string; outboundLabelId?: string;
}
export type LabelRouteAction = 'request_route' | 'request_parcel' | 'request_details' | 'refuse_route' | 'propose_route' | 'accept_route' | 'withdraw_route';
export interface LabelRouteCommand extends LabelLifecycleContext {
  scope: LabelLifecycleScope; sourceHash: string; sourceRevision: string; version: number; action: LabelRouteAction; reason: string;
  endpoint: 'origin' | 'destination' | null; address: LabelRouteAddress | null; route: LabelOperationalRoute | null;
  reference: LabelRouteReference | null; acknowledged: true; handoverDeclaration?: LabelRouteHandoverDeclaration;
  parcelAmendmentCapability?: LabelParcelAmendmentCapability; parcelObservation?: LabelParcelObservation;
}
export interface LabelRouteAttempt {version: 1; uid: string; requestId: string; context: LabelLifecycleContext; command: LabelRouteCommand}
export interface LabelRouteReceipt extends LabelRouteEffects {
  protocol: 'label_route_amendment_command_v1'; actorId: string; requestId: string; command: LabelRouteCommand; payloadHash: string;
  entryId: string | null; state: 'unrecorded' | 'committed' | 'not_executed'; reason: string | null; recordedAt: string | null;
}
export interface LabelRouteEntry extends LabelRouteEffects {
  reference: LabelRouteReference; action: LabelRouteAction; scope: LabelLifecycleScope; actorRole: 'buyer' | 'seller' | 'operator'; reason: string;
  endpoint: LabelRouteCommand['endpoint']; address: LabelRouteAddress | null; route: LabelOperationalRoute | null;
  relatedReference: LabelRouteReference | null; recordedAt: string; historicalOnly: true; handoverDeclaration?: LabelRouteHandoverDeclaration;
  parcelAmendmentCapability?: LabelParcelAmendmentCapability; parcelObservation?: LabelParcelObservation;
}
export interface LabelRouteNoticeReference {entryId: string; contentHash: string; notificationId: string}
export interface LabelRouteNotice {qualification: 'native_owner_notice'; entry: LabelRouteEntry; notificationId: string}
export interface LabelRouteSource extends LabelLifecycleContext {
  protocol: 'label_route_amendment_source_v1'; buyerId: string; sellerId: string; sourceRevision: string; orderHash: string; stateHash: string;
  version: number | null; baseHash: string; returnRequestId: string | null; sourceHash: string; qualification: 'native_order_parties' | 'unknown';
}
export interface LabelRoutePreview extends LabelLifecycleContext, LabelRouteEffects {
  protocol: 'label_route_amendment_preview_v1'; actorId: string; scope: LabelLifecycleScope; source: LabelRouteSource;
  state: 'unrecorded' | 'awaiting_review' | 'details_requested' | 'proposed' | 'agreed' | 'refused' | 'withdrawn';
  request: LabelRouteEntry | null; proposal: LabelRouteEntry | null;
  originalRoute: {qualification: 'native_historical_route' | 'unknown'; context: LabelRouteCapturedContext | null; sourceHash: string | null};
  currentLabelRoute: {qualification: 'native_current_label_route' | 'unknown'; context: LabelRouteCapturedContext | null; sourceHash: string | null; labelId: string | null};
  preparationBasisQualified: boolean; senderHandoverDeclaration: LabelRouteHandoverDeclaration;
  notice?: LabelRouteNotice;
  parcelAmendment?: LabelParcelAmendment;
  acceptances: Record<'buyer' | 'seller', 'unrecorded' | 'native_accepted' | 'unknown'>; options: LabelRouteAction[];
  entries: []; nextCursor: null; coverage: null;
}
export interface LabelRouteHistory extends Omit<LabelRoutePreview, 'protocol' | 'entries' | 'nextCursor' | 'coverage'> {
  protocol: 'label_route_amendment_history_v1';
  entries: ({qualification: 'native_route_entry'; entry: LabelRouteEntry} | {qualification: 'unknown'; entryId: string; entry: null})[];
  nextCursor: LabelLifecycleCursor | null; coverage: LabelLifecycleCoverage;
}
