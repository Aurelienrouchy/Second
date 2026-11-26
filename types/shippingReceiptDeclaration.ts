export const SHIPPING_RECEIPT_DECLARATION_PROTOCOL = 'buyer_shipping_receipt_declaration_v1' as const;
export const SHIPPING_RECEIPT_DECLARATION_STATEMENT = 'Je déclare avoir reçu le colis lié à cette commande. Cette déclaration ne valide pas son contenu et ne ferme aucun recours.';
export interface ShippingReceiptDeclaration {
  requestId: string; commandId: string; actorUid: string; recordedAt: string; sourceRevision: string; sourceHash: string;
  humanDeclaration: true; physicalReceiptVerified: false; contentValidated: false; recoursesClosed: false;
}
export interface ShippingReceiptDeclarationCommand {
  requestId: string; commandId: string; inputHash: string; state: 'committed' | 'neutralized' | 'not_executed';
  reason: 'source_changed' | 'source_unqualified' | 'already_declared' | null; recordedAt: string;
  expectedSourceRevision: string; expectedSourceHash: string;
}
export interface ShippingReceiptDeclarationView {
  protocol: typeof SHIPPING_RECEIPT_DECLARATION_PROTOCOL; ownerId: string; transactionId: string; role: 'buyer' | 'seller';
  statementVersion: typeof SHIPPING_RECEIPT_DECLARATION_PROTOCOL; statement: typeof SHIPPING_RECEIPT_DECLARATION_STATEMENT;
  qualification: 'native_paid_contract' | 'needs_review'; sourceRevision: string | null; sourceHash: string | null;
  sourceObservedCurrently: boolean; declaration: ShippingReceiptDeclaration | null; command: ShippingReceiptDeclarationCommand | null;
  financialEffectsApplied: false; deadlinesChanged: false; recoursesClosed: false;
}
export interface ShippingReceiptDeclarationIntent {
  version: 1; expectedUid: string; transactionId: string; requestId: string;
  statementVersion: typeof SHIPPING_RECEIPT_DECLARATION_PROTOCOL; statement: typeof SHIPPING_RECEIPT_DECLARATION_STATEMENT;
  accepted: true; expectedSourceRevision: string; expectedSourceHash: string; inputHash: string;
}
export interface ShippingReceiptDeclarationObservation {
  intent: ShippingReceiptDeclarationIntent | null;
  /** Pure current source, separate from the historical receipt of an intention. */
  current: ShippingReceiptDeclarationView | null;
  currentUnavailable: boolean;
  receipt: ShippingReceiptDeclarationView | null;
}
