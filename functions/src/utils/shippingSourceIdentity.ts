import { createHash } from 'node:crypto';
import { qualifiedServiceFeeTaxSnapshot, type ServiceFeeTaxSnapshot } from './fees';
import {qualifiedServiceFeeTaxAdmission,type ServiceFeeTaxAdmission} from '../config/operatorServiceTax';

export const SHIPPING_PURCHASE_PRICING_VERSION = 'shipping_purchase_pricing_v2' as const;
const digest = (value: unknown) => createHash('sha256').update(JSON.stringify(value)).digest('hex');

/** Explicit new projection around the unchanged historical source fingerprint. */
export function shippingTaxSourceHash(baseHash: string, taxSnapshot: ServiceFeeTaxSnapshot,taxAdmission?:ServiceFeeTaxAdmission): string {
  return digest([SHIPPING_PURCHASE_PRICING_VERSION, baseHash, taxSnapshot,...(taxAdmission?[taxAdmission]:[])]);
}
export function qualifiedShippingTaxSource(source: any): ServiceFeeTaxSnapshot | null {
  const snapshot = qualifiedServiceFeeTaxSnapshot(source?.taxSnapshot, source?.fee, source?.tax);
  const hasAdmission=source!=null&&Object.prototype.hasOwnProperty.call(source,'taxAdmission');
  const admission=hasAdmission?qualifiedServiceFeeTaxAdmission(source.taxAdmission):null;
  if(hasAdmission){
    if(!admission||!snapshot)return null;
    if(admission.protocol==='operator_tax_decision_v2'){
      if(digest(admission.technicalConfiguration)!==digest(snapshot.technicalConfiguration))return null;
    }else if(!snapshot.technicalConfiguration.enabled||admission.gstRate!==snapshot.technicalConfiguration.gstRate||
      admission.qstRate!==snapshot.technicalConfiguration.qstRate)return null;
  }
  return snapshot && source.pricingVersion === SHIPPING_PURCHASE_PRICING_VERSION && /^[a-f0-9]{64}$/.test(source.pricingBaseHash ?? '') &&
    source.hash === shippingTaxSourceHash(source.pricingBaseHash, snapshot,admission??undefined) ? snapshot : null;
}
/** Firestore maps can reorder keys; only reconstructed canonical captures compare. */
export function qualifiedQuoteTaxSnapshot(quote: any): ServiceFeeTaxSnapshot | null {
  const source = qualifiedShippingTaxSource(quote?.source), snapshot = qualifiedServiceFeeTaxSnapshot(quote?.taxSnapshot, quote?.source?.fee, quote?.source?.tax);
  return source && snapshot && quote.pricingVersion === SHIPPING_PURCHASE_PRICING_VERSION && digest(source) === digest(snapshot) ? snapshot : null;
}

/** V4 item projection; append declarations without reordering legacy keys.
 * Absent legacy fields stay absent, preserving their existing source hash. */
export function shippingItemProjection(article: Record<string, any>): Record<string, any> {
  const contentVersion = article.saleDeclaration?.version;
  const nativeListing = contentVersion === 'listing_content_v1' || contentVersion === 'listing_content_v2';
  const item = Object.fromEntries(['title', 'description', 'price', 'images', 'category', 'categoryIds', 'condition', 'size', 'brand',
    'colors', 'materials', 'packageSize', 'shopId', 'hasKnownDefects', 'defectsDescription', 'brandStatus',
    'hasAlterations', 'alterationsDescription', 'hygieneDeclaration', 'saleUnit', 'childSafetyDeclaration', 'counterfeitStatus', 'inventoryUnit']
    .filter(k => article[k] !== undefined && (!nativeListing || !['brandStatus', 'hasAlterations', 'alterationsDescription', 'saleUnit', 'counterfeitStatus'].includes(k)) &&
      (contentVersion !== 'listing_content_v2' || !['hasKnownDefects', 'defectsDescription'].includes(k)) &&
      (k !== 'counterfeitStatus' || article.saleDeclaration?.version === 'personal_item_v3') &&
      (k !== 'inventoryUnit' || article.inventoryUnit?.protocol === 'seller_inventory_article_v1')).map(k => [k, article[k]]));
  // Bound to the frozen purchase source. It qualifies a whole-listing contract
  // without reintroducing a seller answer about its physical composition.
  return nativeListing
    ? { ...item, listingContentVersion: contentVersion } : item;
}
export function shippingSourceFingerprint(value: Record<string, unknown>): string {
  const keys = ['articleId', 'sellerId', 'buyerId', 'origin', 'destination', 'parcel', 'parcelVersion', 'item', 'amount', 'fee',
    'tax', 'reduction', 'buyerVersion', 'sellerVersion', 'accountId', 'stripeChargesEnabled', 'proofIdentity', 'shops'];
  return createHash('sha256').update(JSON.stringify(Object.fromEntries(keys.map(key => [key, value[key]])))).digest('hex');
}
