import { auth, firestore, functions } from '@/config/firebaseConfig';
import { ShopTypeLabels, type Article, type Shop, type ShopStatus, type ShopType } from '@/types';
import {
  addDoc,
  collection,
  doc,
  getDocFromServer,
  getDocs,
  getDocsFromServer,
  limit,
  query,
  serverTimestamp,
  updateDoc,
  where
} from 'firebase/firestore';
import { httpsCallable } from 'firebase/functions';
import { geohashForLocation } from 'geofire-common';
import { EligibilityService } from '@/services/eligibilityService';
import { assertTradeSessionCurrent, captureTradeSession } from '@/services/tradeOperation';
import AsyncStorage from '@/utils/environmentStorage';
import { CryptoDigestAlgorithm, digestStringAsync, randomUUID } from 'expo-crypto';

export interface ShopTierPaymentOffer {
  success: true;
  clientSecret: string;
  paymentIntentId: string;
  tier: 'pro' | 'premium';
  periodMonths: number;
  amountCents: number;
}

export interface ShopTierPurchaseCommand {shopId: string; tier: 'pro' | 'premium'; periodMonths: number}
type ShopTierPurchaseMode = 'prepare' | 'observe' | 'neutralize' | 'cancel_known_unconfirmed';
export interface ShopTierPurchaseJournal {
  protocol: 'shop_tier_purchase_local_v1'; actorId: string; requestId: string; command: ShopTierPurchaseCommand; operationId: string;
  native: {amountCents: number | null; paymentIntentId: string | null};
  paymentAttempted: boolean; neutralizeRequested: boolean; cancelRequested: boolean; acknowledgedReceipt: string | null;
}
export interface ShopTierPurchaseReceipt {
  protocol: 'shop_tier_purchase_receipt_v1'; outcome: 'settled' | 'canceled' | 'not_executed'; operationId: string;
  paymentIntentId: string | null; amountCents: number | null; currency: 'CAD'; recordedAt: string; paidUntil: string | null; proofHash: string;
}
export interface ShopTierTaxPricing {
  protocol: 'shop_tier_tax_pricing_v2'; currency: 'CAD'; priceMode: 'exclusive' | 'inclusive'; priceCents: number;
  netCents: number; gstCents: number; qstCents: number; taxCents: number; totalCents: number; taxDecisionHash: string; hash: string;
}
export interface ShopTierPurchaseObservation {
  protocol: 'shop_tier_purchase_command_v1'; actorId: string; requestId: string; command: ShopTierPurchaseCommand; operationId: string;
  requestRecorded: boolean; state: 'unrecorded' | 'reserved' | 'unknown' | 'payable' | 'processing' | 'activation_pending' | 'settled' | 'canceled' | 'not_executed' | 'review_required';
  amountCents: number | null; currency: 'CAD'; paymentIntentId: string | null; providerStatus: string | null; postAuthorized: boolean;
  clientSecret: string | null; terminal: boolean; receipt: ShopTierPurchaseReceipt | null; reason: string | null; readAt: string;
  pricing?: ShopTierTaxPricing;
}
const TIER_CAPABILITY = 'shop_tier_purchase_v1';
const tierJournalLocks = new Set<string>();
const tierJournalKey = (uid: string, shop: string) => `second:shop-tier-purchase:v1:${encodeURIComponent(uid)}:${encodeURIComponent(shop)}`;
const tierHash = (value: unknown) => digestStringAsync(CryptoDigestAlgorithm.SHA256, JSON.stringify(value));
const tierHashShape = (value: unknown): value is string => typeof value === 'string' && /^[a-f0-9]{64}$/.test(value);
const tierCents = (value: unknown): value is number | null => value === null || typeof value === 'number' && Number.isSafeInteger(value) && value >= 50;
const tierPi = (value: unknown): value is string | null => value === null || typeof value === 'string' && value.length <= 255 && /^pi_[A-Za-z0-9_]+$/.test(value);
const tierUnknown = () => new Error('Cette demande de forfait reste à vérifier avec sa référence d’origine. Aucun nouveau paiement ne sera préparé.');
function tierCommand(value: unknown): ShopTierPurchaseCommand {
  if (!shopObject(value) || Object.keys(value).sort().join(',') !== 'periodMonths,shopId,tier' ||
      typeof value.shopId !== 'string' || !value.shopId || value.shopId.length > 128 || value.shopId.includes('/') ||
      value.tier !== 'pro' && value.tier !== 'premium' || typeof value.periodMonths !== 'number' ||
      !Number.isSafeInteger(value.periodMonths) || value.periodMonths < 1 || value.periodMonths > 12) throw tierUnknown();
  return {shopId: value.shopId, tier: value.tier, periodMonths: value.periodMonths};
}
const sameTierCommand = (a: ShopTierPurchaseCommand, b: ShopTierPurchaseCommand) => a.shopId === b.shopId && a.tier === b.tier && a.periodMonths === b.periodMonths;
function tierIso(value: unknown): value is string {
  return typeof value === 'string' && Number.isFinite(Date.parse(value)) && new Date(value).toISOString() === value;
}
async function readTierJournal(uid: string, shop: string, current: () => void): Promise<ShopTierPurchaseJournal | null> {
  current(); const raw = await AsyncStorage.getItem(tierJournalKey(uid, shop)); current();
  if (raw === null) return null;
  let value: unknown; try {value = JSON.parse(raw);} catch {throw tierUnknown();}
  if (!shopObject(value) || Object.keys(value).sort().join(',') !== 'acknowledgedReceipt,actorId,cancelRequested,command,native,neutralizeRequested,operationId,paymentAttempted,protocol,requestId' ||
      value.protocol !== 'shop_tier_purchase_local_v1' || value.actorId !== uid || typeof value.requestId !== 'string' || !/^[A-Za-z0-9_-]{16,128}$/.test(value.requestId) ||
      !shopObject(value.native) || Object.keys(value.native).sort().join(',') !== 'amountCents,paymentIntentId' || !tierCents(value.native.amountCents) || !tierPi(value.native.paymentIntentId) ||
      value.native.paymentIntentId !== null && value.native.amountCents === null ||
      typeof value.paymentAttempted !== 'boolean' || typeof value.neutralizeRequested !== 'boolean' || typeof value.cancelRequested !== 'boolean' ||
      (value.paymentAttempted || value.cancelRequested) && value.native.paymentIntentId === null ||
      value.acknowledgedReceipt !== null && !tierHashShape(value.acknowledgedReceipt)) throw tierUnknown();
  const command = tierCommand(value.command);
  const expected = 'forfait_' + await tierHash([TIER_CAPABILITY, uid, value.requestId]); current();
  if (command.shopId !== shop || value.operationId !== expected) throw tierUnknown();
  return {protocol: 'shop_tier_purchase_local_v1', actorId: uid, requestId: value.requestId, command, operationId: expected,
    native: {amountCents: value.native.amountCents, paymentIntentId: value.native.paymentIntentId}, paymentAttempted: value.paymentAttempted,
    neutralizeRequested: value.neutralizeRequested, cancelRequested: value.cancelRequested, acknowledgedReceipt: value.acknowledgedReceipt as string | null};
}
async function writeTierJournal(journal: ShopTierPurchaseJournal, current: () => void): Promise<void> {
  current(); await AsyncStorage.setItem(tierJournalKey(journal.actorId, journal.command.shopId), JSON.stringify(journal)); current();
}
async function parseTierPricing(value: unknown, amountCents: unknown): Promise<ShopTierTaxPricing> {
  const keys = ['protocol', 'currency', 'priceMode', 'priceCents', 'netCents', 'gstCents', 'qstCents', 'taxCents', 'totalCents', 'taxDecisionHash', 'hash'];
  const nonnegative = (n: unknown): n is number => typeof n === 'number' && Number.isSafeInteger(n) && n >= 0;
  if (!shopObject(value) || Object.keys(value).sort().join(',') !== keys.sort().join(',') || value.protocol !== 'shop_tier_tax_pricing_v2' ||
      value.currency !== 'CAD' || value.priceMode !== 'exclusive' && value.priceMode !== 'inclusive' ||
      !nonnegative(value.priceCents) || value.priceCents < 50 || !nonnegative(value.netCents) || value.netCents < 1 ||
      !nonnegative(value.gstCents) || !nonnegative(value.qstCents) || !nonnegative(value.taxCents) || !nonnegative(value.totalCents) ||
      !Number.isSafeInteger(value.gstCents + value.qstCents) || value.taxCents !== value.gstCents + value.qstCents ||
      !Number.isSafeInteger(value.netCents + value.taxCents) || value.totalCents !== value.netCents + value.taxCents || value.totalCents !== amountCents ||
      (value.priceMode === 'exclusive' ? value.priceCents !== value.netCents : value.priceCents !== value.totalCents) ||
      !tierHashShape(value.taxDecisionHash) || !tierHashShape(value.hash)) throw tierUnknown();
  // Exact native key order, independent of the transport's property order.
  const body: Omit<ShopTierTaxPricing, 'hash'> = {protocol: 'shop_tier_tax_pricing_v2' as const, currency: 'CAD' as const, priceMode: value.priceMode,
    priceCents: value.priceCents, netCents: value.netCents, gstCents: value.gstCents, qstCents: value.qstCents,
    taxCents: value.taxCents, totalCents: value.totalCents, taxDecisionHash: value.taxDecisionHash};
  if (await tierHash(body) !== value.hash) throw tierUnknown();
  return {...body, hash: value.hash};
}
async function parseTierObservation(value: unknown, journal: ShopTierPurchaseJournal, mode: ShopTierPurchaseMode): Promise<ShopTierPurchaseObservation> {
  if (!shopObject(value) || Object.keys(value).sort().join(',') !== ['protocol', 'actorId', 'requestId', 'command', 'operationId', 'requestRecorded', 'state', 'amountCents', 'currency', 'paymentIntentId', 'providerStatus', 'postAuthorized', 'clientSecret', 'terminal', 'receipt', 'reason', 'readAt', ...('pricing' in value ? ['pricing'] : [])].sort().join(',') || value.protocol !== 'shop_tier_purchase_command_v1' || value.actorId !== journal.actorId || value.requestId !== journal.requestId ||
      value.operationId !== journal.operationId || !sameTierCommand(tierCommand(value.command), journal.command) || value.currency !== 'CAD' ||
      typeof value.requestRecorded !== 'boolean' || typeof value.postAuthorized !== 'boolean' || typeof value.terminal !== 'boolean' ||
      typeof value.state !== 'string' || !['unrecorded','reserved','unknown','payable','processing','activation_pending','settled','canceled','not_executed','review_required'].includes(value.state) ||
      !tierCents(value.amountCents) || !tierPi(value.paymentIntentId) || !tierIso(value.readAt) ||
      value.providerStatus !== null && (typeof value.providerStatus !== 'string' || !['requires_payment_method','requires_confirmation','requires_action','processing','requires_capture','canceled','succeeded'].includes(value.providerStatus)) ||
      value.reason !== null && (typeof value.reason !== 'string' || !value.reason || value.reason.length > 300) ||
      journal.native.amountCents !== null && value.amountCents !== journal.native.amountCents || journal.native.paymentIntentId !== null && value.paymentIntentId !== journal.native.paymentIntentId) throw tierUnknown();
  const pricing = 'pricing' in value ? await parseTierPricing(value.pricing, value.amountCents) : undefined;
  const secret = value.clientSecret;
  if (secret !== null && (mode !== 'prepare' || value.state !== 'payable' || !value.postAuthorized || typeof value.paymentIntentId !== 'string' ||
      typeof secret !== 'string' || secret.length > 1024 || !secret.startsWith(value.paymentIntentId + '_secret_') ||
      !/^[A-Za-z0-9_]+$/.test(secret.slice((value.paymentIntentId + '_secret_').length)))) throw tierUnknown();
  if (value.requestRecorded !== (value.state !== 'unrecorded') || value.state === 'unrecorded' && (value.amountCents !== null || value.paymentIntentId !== null || value.postAuthorized) ||
      value.state === 'payable' && (!value.postAuthorized || value.amountCents === null || value.paymentIntentId === null || !['requires_payment_method','requires_confirmation','requires_action'].includes(String(value.providerStatus)))) throw tierUnknown();
  let receipt: ShopTierPurchaseReceipt | null = null;
  if (value.receipt !== null) {
    const r = value.receipt;
    if (!shopObject(r) || r.protocol !== 'shop_tier_purchase_receipt_v1' || typeof r.outcome !== 'string' || !['settled','canceled','not_executed'].includes(r.outcome) ||
        value.state !== r.outcome || !value.terminal || r.operationId !== journal.operationId || r.paymentIntentId !== value.paymentIntentId || r.amountCents !== value.amountCents ||
        r.currency !== 'CAD' || !tierIso(r.recordedAt) || !tierHashShape(r.proofHash) ||
        (r.outcome === 'settled' ? !tierIso(r.paidUntil) || Date.parse(r.paidUntil) <= Date.parse(r.recordedAt) || r.paymentIntentId === null || r.amountCents === null || !value.postAuthorized || value.providerStatus !== 'succeeded'
          : r.paidUntil !== null || r.outcome === 'canceled' && (r.paymentIntentId === null || !value.postAuthorized || value.providerStatus !== 'canceled') || r.outcome === 'not_executed' && (value.postAuthorized || r.paymentIntentId !== null))) throw tierUnknown();
    receipt = {protocol: 'shop_tier_purchase_receipt_v1', outcome: r.outcome as ShopTierPurchaseReceipt['outcome'], operationId: journal.operationId,
      paymentIntentId: value.paymentIntentId, amountCents: value.amountCents, currency: 'CAD', recordedAt: r.recordedAt, paidUntil: r.paidUntil as string | null, proofHash: r.proofHash};
  }
  if (value.terminal !== (receipt !== null) || ['settled','canceled','not_executed'].includes(String(value.state)) !== value.terminal || value.terminal && (secret !== null || value.reason !== null)) throw tierUnknown();
  if (journal.acknowledgedReceipt !== null && receipt?.proofHash !== journal.acknowledgedReceipt) throw tierUnknown();
  return {protocol: 'shop_tier_purchase_command_v1', actorId: journal.actorId, requestId: journal.requestId, command: journal.command, operationId: journal.operationId,
    requestRecorded: value.requestRecorded, state: value.state as ShopTierPurchaseObservation['state'], amountCents: value.amountCents, currency: 'CAD', paymentIntentId: value.paymentIntentId,
    providerStatus: value.providerStatus as string | null, postAuthorized: value.postAuthorized, clientSecret: secret as string | null, terminal: value.terminal,
    receipt, reason: value.reason as string | null, readAt: value.readAt, ...(pricing ? {pricing} : {})};
}
async function tierRpc(journal: ShopTierPurchaseJournal, mode: ShopTierPurchaseMode, current: () => void): Promise<ShopTierPurchaseObservation> {
  current();
  const reply = await httpsCallable<unknown, unknown>(functions, 'purchaseShopTier')({capability: TIER_CAPABILITY, mode,
    expectedUid: journal.actorId, requestId: journal.requestId, command: journal.command, ...(mode === 'cancel_known_unconfirmed' ? {cancelAcknowledged: true} : {})});
  current();
  const observed = await parseTierObservation(reply.data, journal, mode); current();
  await writeTierJournal({...journal, native: {amountCents: observed.amountCents, paymentIntentId: observed.paymentIntentId}}, current);
  return observed;
}
async function withTierJournalLock<T>(uid: string, shop: string, assertContext: () => void, execute: (current: () => void) => Promise<T>): Promise<T> {
  const session = captureTradeSession(uid), key = tierJournalKey(uid, shop);
  const current = () => {assertTradeSessionCurrent(session); assertContext();}; current();
  if (tierJournalLocks.has(key)) throw tierUnknown(); tierJournalLocks.add(key);
  try {return await execute(current);} finally {tierJournalLocks.delete(key);}
}

// Cloud Function return shape for the shop-moderation callables (B2).
interface ShopModerationResponse {
  ok: boolean;
  shopId: string;
  status: 'approved' | 'rejected' | 'suspended';
}
interface ShopModerationOptions {expectedUid: string; assertCurrent: () => void}

const SHOP_PROJECTION = 'shop_public_projection_v1';
const SHOP_DAYS = ['monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday'] as const;
const shopObject = (value: unknown): value is Record<string, unknown> => !!value && typeof value === 'object' && !Array.isArray(value);
function shopReadError(): Error { return new Error('La lecture des boutiques est indisponible ou incomplète. Réessayez.'); }
function shopText(value: unknown, max: number): string {
  if (typeof value !== 'string' || value.length > max) throw shopReadError();
  return value;
}
function shopId(value: unknown): string {
  const id = shopText(value, 200);
  if (!id || id !== id.trim() || id.includes('/') || id === '.' || id === '..' || /^__.*__$/.test(id)) throw shopReadError();
  return id;
}
function shopDate(value: unknown): Date | null {
  if (value === null) return null;
  if (typeof value !== 'string') throw shopReadError();
  const date = new Date(value);
  if (!Number.isFinite(date.getTime()) || date.toISOString() !== value) throw shopReadError();
  return date;
}
function shopCoordinate(value: unknown, maximum: number): number | null {
  if (value === null) return null;
  if (typeof value !== 'number' || !Number.isFinite(value) || Math.abs(value) > maximum) throw shopReadError();
  return value;
}
function newShopCoordinates(location: Shop['location']): [number, number] {
  const latitude = shopCoordinate(location.latitude, 90), longitude = shopCoordinate(location.longitude, 180);
  if (latitude === null || longitude === null) throw new Error('Une position complète et valide est requise pour enregistrer une nouvelle localisation.');
  return [latitude, longitude];
}
function parseShopProjection(value: unknown): Shop {
  if (!shopObject(value) || ['legalInfo', 'verificationDetails', 'tierPaymentIntentId', 'tierChargeId', 'notes'].some(key => Object.hasOwn(value, key)) ||
      !shopObject(value.address) || !shopObject(value.location) || !shopObject(value.socialMedia) || !shopObject(value.openingHours) ||
      !Array.isArray(value.images) || value.images.length > 10 ||
      !['approved', 'pending', 'rejected', 'suspended'].includes(String(value.status)) ||
      !['basic', 'pro', 'premium'].includes(String(value.tier))) throw shopReadError();
  const openingHours: Shop['openingHours'] = {};
  for (const day of SHOP_DAYS) {
    const hours = value.openingHours[day];
    if (hours === null) openingHours[day] = null;
    else {
      if (!shopObject(hours)) throw shopReadError();
      openingHours[day] = { open: shopText(hours.open, 20), close: shopText(hours.close, 20) };
    }
  }
  const count = (number: unknown) => { if (typeof number !== 'number' || !Number.isSafeInteger(number) || number < 0) throw shopReadError(); return number; };
  if (value.rating !== null && (typeof value.rating !== 'number' || !Number.isFinite(value.rating) || value.rating < 0 || value.rating > 5)) throw shopReadError();
  const type = shopText(value.type, 100), until = shopDate(value.tierPaidUntil);
  return { id: shopId(value.id), ownerId: shopText(value.ownerId, 128), name: shopText(value.name, 300), description: shopText(value.description, 8000),
    type: Object.hasOwn(ShopTypeLabels, type) ? type as ShopType : 'autre',
    address: {street: shopText(value.address.street, 500), city: shopText(value.address.city, 200), postalCode: shopText(value.address.postalCode, 30), country: shopText(value.address.country, 100)},
    location: {latitude: shopCoordinate(value.location.latitude, 90), longitude: shopCoordinate(value.location.longitude, 180)},
    phoneNumber: shopText(value.phoneNumber, 100), email: shopText(value.email, 320), website: shopText(value.website, 2048),
    socialMedia: {instagram: shopText(value.socialMedia.instagram, 2048), facebook: shopText(value.socialMedia.facebook, 2048)}, openingHours,
    logo: shopText(value.logo, 2048), images: value.images.map(image => shopText(image, 2048)), status: value.status as ShopStatus,
    tier: value.tier as Shop['tier'], ...(until ? {tierPaidUntil: until} : {}), ...(value.rating !== null ? {rating: value.rating as number} : {}),
    reviewCount: count(value.reviewCount), articlesCount: count(value.articlesCount), createdAt: shopDate(value.createdAt), updatedAt: shopDate(value.updatedAt) };
}

export interface ShopProjectionPage {
  shops: Shop[];
  nextCursor: string | null;
  coverage: {scanned: number; limit: number; hasMore: boolean; exhaustive: false};
}

function rejectShopLegalInfo(value: object): void {
  if (Object.keys(value).some(key => key === 'legalInfo' || key.startsWith('legalInfo.'))) {
    throw new Error('La collecte des renseignements fiscaux et bancaires des boutiques n’est pas disponible au lancement.');
  }
}

/** A private admin read still returns a constructed view, never the raw legacy
 * legal/bank map. Only the moderation reason/date stay in this private view. */
function privateShopView(id: string, source: Record<string, unknown>): Shop {
  const object = (value: unknown) => shopObject(value) ? value : {};
  const text = (value: unknown, max: number) => typeof value === 'string' && value.length <= max ? value : '';
  const count = (value: unknown) => typeof value === 'number' && Number.isSafeInteger(value) && value >= 0 ? value : 0;
  const nativeDate = (value: unknown): string | null => {
    if (!value || typeof value !== 'object' || !('toDate' in value) || typeof value.toDate !== 'function') return null;
    try { const date: unknown = value.toDate(); return date instanceof Date && Number.isFinite(date.getTime()) ? date.toISOString() : null; } catch { return null; }
  };
  const address = object(source.address), location = object(source.location), social = object(source.socialMedia), hours = object(source.openingHours);
  const shop = parseShopProjection({ id, ownerId: text(source.ownerId, 128), name: text(source.name, 300), description: text(source.description, 8000), type: text(source.type, 100),
    address: { street: text(address.street, 500), city: text(address.city, 200), postalCode: text(address.postalCode, 30), country: text(address.country, 100) },
    location: {
      latitude: typeof location.latitude === 'number' && Number.isFinite(location.latitude) && Math.abs(location.latitude) <= 90 ? location.latitude : null,
      longitude: typeof location.longitude === 'number' && Number.isFinite(location.longitude) && Math.abs(location.longitude) <= 180 ? location.longitude : null,
    }, phoneNumber: text(source.phoneNumber, 100), email: text(source.email, 320), website: text(source.website, 2048),
    socialMedia: { instagram: text(social.instagram, 2048), facebook: text(social.facebook, 2048) },
    openingHours: Object.fromEntries(SHOP_DAYS.map(day => { const hour = object(hours[day]); return [day, typeof hour.open === 'string' && typeof hour.close === 'string' ? {open: text(hour.open, 20), close: text(hour.close, 20)} : null]; })),
    logo: text(source.logo, 2048), images: Array.isArray(source.images) ? source.images.filter(image => typeof image === 'string' && image.length <= 2048).slice(0, 10) : [],
    status: source.status, tier: ['basic', 'pro', 'premium'].includes(String(source.tier)) ? source.tier : 'basic', tierPaidUntil: nativeDate(source.tierPaidUntil),
    rating: typeof source.rating === 'number' && Number.isFinite(source.rating) && source.rating >= 0 && source.rating <= 5 ? source.rating : null,
    reviewCount: count(source.reviewCount), articlesCount: count(source.articlesCount), createdAt: nativeDate(source.createdAt), updatedAt: nativeDate(source.updatedAt) });
  const verification = object(source.verificationDetails), at = nativeDate(verification.verifiedAt);
  if (Object.keys(verification).length) shop.verificationDetails = {
    ...(typeof verification.reason === 'string' && verification.reason.length <= 8000 ? {reason: verification.reason} : {}),
    ...(typeof verification.verifiedBy === 'string' && verification.verifiedBy.length <= 128 ? {verifiedBy: verification.verifiedBy} : {}),
    ...(at ? {verifiedAt: new Date(at)} : {}),
  };
  return shop;
}

export class ShopService {
  private static readonly COLLECTION = 'shops';

  /**
   * Créer une nouvelle boutique (status: pending par défaut)
   */
  static async createShop(shopData: Omit<Shop, 'id' | 'createdAt' | 'updatedAt'>): Promise<string> {
    rejectShopLegalInfo(shopData);
    try {
      // Calculer le geohash pour la localisation
      const geohash = geohashForLocation(newShopCoordinates(shopData.location));

      const shopToCreate = {
        ...shopData,
        location: {
          ...shopData.location,
          geohash,
        },
        status: 'pending',
        reviewCount: 0,
        articlesCount: 0,
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      };

      const docRef = await addDoc(
        collection(firestore, this.COLLECTION),
        shopToCreate
      );

      // Mettre à jour l'ID dans le document
      await updateDoc(docRef, { id: docRef.id });

      return docRef.id;
    } catch (error) {
      if (__DEV__) console.error('Error creating shop:', error);
      throw new Error('Erreur lors de la création de la boutique');
    }
  }

  private static async readProjectedShop(id: string, expectedUid?: string): Promise<Shop | null> {
    shopId(id);
    const session = expectedUid ? captureTradeSession(expectedUid) : null;
    const current = () => { if (session) assertTradeSessionCurrent(session); };
    current();
    const result = await httpsCallable<Record<string, unknown>, unknown>(functions, 'getFeaturedSellers')({
      capability: SHOP_PROJECTION, mode: 'detail', shopId: id, scope: expectedUid ? 'owner_or_admin' : 'public',
      ...(expectedUid ? { expectedUid } : {}),
    });
    current();
    const data = result.data;
    if (!shopObject(data) || data.protocol !== SHOP_PROJECTION || data.mode !== 'detail' || !Object.hasOwn(data, 'shop')) throw shopReadError();
    if (data.shop === null) return null;
    const shop = parseShopProjection(data.shop);
    if (shop.id !== id || !expectedUid && shop.status !== 'approved') throw shopReadError();
    return shop;
  }

  static async getShopById(id: string, privateScope?: {scope: 'owner_or_admin'; expectedUid: string}): Promise<Shop | null> {
    if (!privateScope) {
      const publicShop = await this.readProjectedShop(id);
      if (publicShop) return publicShop;
    }
    let session;
    try { session = captureTradeSession(privateScope?.expectedUid); }
    catch (error) { if (privateScope) throw error; return null; }
    try {
      const projected = await this.readProjectedShop(id, session.uid);
      assertTradeSessionCurrent(session);
      if (!projected) return null;
      // Historical moderation details remain private; no legal/bank fields are
      // returned. The final projection rechecks the current native owner/role.
      const raw = await getDocFromServer(doc(firestore, this.COLLECTION, id));
      assertTradeSessionCurrent(session);
      const current = await this.readProjectedShop(id, session.uid);
      assertTradeSessionCurrent(session);
      if (!current || !raw.exists()) return null;
      const historical = privateShopView(id, raw.data());
      if (historical.ownerId !== current.ownerId) throw shopReadError();
      return {...current, ...(historical.verificationDetails ? {verificationDetails: historical.verificationDetails} : {})};
    } catch (error: unknown) {
      assertTradeSessionCurrent(session);
      const code = error && typeof error === 'object' && 'code' in error ? error.code : null;
      if (!privateScope && (code === 'functions/permission-denied' || code === 'permission-denied')) return null;
      throw error;
    }
  }

  private static async assertShopAdminSession(expectedUid: string, assertContext: () => void): Promise<void> {
    const session = captureTradeSession(expectedUid);
    const current = () => {assertTradeSessionCurrent(session); assertContext();};
    await this.assertShopTierPaymentSession(expectedUid, current);
    current();
    const user = auth.currentUser;
    if (!user || user.uid !== expectedUid) throw shopReadError();
    const [token, profile] = await Promise.all([user.getIdTokenResult(true), getDocFromServer(doc(firestore, 'users', expectedUid))]);
    current();
    const native = profile.exists() ? profile.data() : null;
    if (native && Object.hasOwn(native, 'isActive') && native.isActive !== true || token.claims.admin !== true && native?.isAdmin !== true) {
      throw new Error('Votre autorisation d’administration doit être vérifiée.');
    }
    await this.assertShopTierPaymentSession(expectedUid, current);
    current();
  }

  private static async getPrivateStatusShops(status: Exclude<ShopStatus, 'approved'>): Promise<Shop[]> {
    const session = captureTradeSession();
    const current = () => assertTradeSessionCurrent(session);
    await this.assertShopAdminSession(session.uid, current);
    const snapshot = await getDocsFromServer(query(collection(firestore, this.COLLECTION), where('status', '==', status), limit(501)));
    current();
    await this.assertShopAdminSession(session.uid, current);
    current();
    if (snapshot.size > 500) throw new Error('La liste complète des boutiques nécessite une consultation paginée. Aucun résultat partiel n’a été retourné.');
    return snapshot.docs.map(document => {
      const shop = privateShopView(document.id, document.data());
      if (shop.status !== status) throw shopReadError();
      return shop;
    });
  }

  static getPendingShops(): Promise<Shop[]> { return this.getPrivateStatusShops('pending'); }
  static getRejectedShops(): Promise<Shop[]> { return this.getPrivateStatusShops('rejected'); }
  static getSuspendedShops(): Promise<Shop[]> { return this.getPrivateStatusShops('suspended'); }

  private static async projectedPage(
    mode: 'approved_page' | 'nearby_page',
    cursor: string | null,
    pageLimit: number,
    nearby?: {latitude: number; longitude: number; radiusKm: number},
  ): Promise<ShopProjectionPage> {
    if (cursor !== null) shopId(cursor);
    if (!Number.isSafeInteger(pageLimit) || pageLimit < 1 || pageLimit > 20) throw shopReadError();
    if (nearby) {
      if (shopCoordinate(nearby.latitude, 90) === null || shopCoordinate(nearby.longitude, 180) === null) throw shopReadError();
      if (!Number.isFinite(nearby.radiusKm) || nearby.radiusKm < 1 || nearby.radiusKm > 100) throw shopReadError();
    }
    const result = await httpsCallable<Record<string, unknown>, unknown>(functions, 'getFeaturedSellers')({
      capability: SHOP_PROJECTION, mode, cursor, limit: pageLimit, ...(nearby ?? {}),
    });
    const data = result.data;
    if (!shopObject(data) || data.protocol !== SHOP_PROJECTION || data.mode !== mode || !Array.isArray(data.shops) || !shopObject(data.coverage)) throw shopReadError();
    const coverage = data.coverage;
    if (coverage.limit !== pageLimit || typeof coverage.scanned !== 'number' || !Number.isSafeInteger(coverage.scanned) || coverage.scanned < 0 || coverage.scanned > pageLimit ||
        typeof coverage.hasMore !== 'boolean' || coverage.exhaustive !== false || data.shops.length > coverage.scanned) throw shopReadError();
    const nextCursor = data.nextCursor === null ? null : shopId(data.nextCursor);
    if (coverage.hasMore !== (nextCursor !== null) || coverage.hasMore && coverage.scanned !== pageLimit ||
        nextCursor !== null && cursor !== null && nextCursor <= cursor) throw shopReadError();
    const shops = data.shops.map(parseShopProjection);
    let previous = cursor;
    for (const shop of shops) {
      if (shop.status !== 'approved' || previous !== null && shop.id <= previous || nextCursor !== null && shop.id > nextCursor) throw shopReadError();
      previous = shop.id;
    }
    return { shops: mode === 'nearby_page' ? shops.filter(shop => shop.location.latitude !== null && shop.location.longitude !== null) : shops,
      nextCursor, coverage: {scanned: coverage.scanned, limit: pageLimit, hasMore: coverage.hasMore, exhaustive: false} };
  }

  static getApprovedShopsPage(cursor: string | null = null, pageLimit = 20): Promise<ShopProjectionPage> {
    return this.projectedPage('approved_page', cursor, pageLimit);
  }

  static getShopsNearLocationPage(latitude: number, longitude: number, radiusKm = 10, cursor: string | null = null, pageLimit = 20): Promise<ShopProjectionPage> {
    return this.projectedPage('nearby_page', cursor, pageLimit, {latitude, longitude, radiusKm});
  }

  /** Legacy array consumers receive a complete cursor walk or an explicit error.
   * Empty nearby pages may still carry the next scanned document cursor. */
  private static async collectShopPages(read: (cursor: string | null) => Promise<ShopProjectionPage>): Promise<Shop[]> {
    let cursor: string | null = null;
    const shops: Shop[] = [], seen = new Set<string>();
    for (let page = 0; page < 200; page++) {
      const result = await read(cursor);
      for (const shop of result.shops) {
        if (seen.has(shop.id)) throw shopReadError();
        seen.add(shop.id); shops.push(shop);
      }
      if (result.nextCursor === null) return shops;
      cursor = result.nextCursor;
    }
    throw new Error('La liste complète des boutiques nécessite une consultation paginée. Aucun résultat partiel n’a été retourné.');
  }

  static getApprovedShops(): Promise<Shop[]> {
    return this.collectShopPages(cursor => this.getApprovedShopsPage(cursor));
  }

  static getShopsNearLocation(latitude: number, longitude: number, radiusKm = 10): Promise<Shop[]> {
    return this.collectShopPages(cursor => this.getShopsNearLocationPage(latitude, longitude, radiusKm, cursor));
  }

  /**
   * Mettre à jour une boutique
   */
  static async updateShop(id: string, data: Partial<Shop>): Promise<void> {
    rejectShopLegalInfo(data);
    if (Object.keys(data).some(key => key.startsWith('location.'))) throw new Error('La nouvelle localisation doit être fournie au complet.');
    try {
      const updateData: Record<string, unknown> = {
        ...data,
        updatedAt: serverTimestamp(),
      };

      // Ne pas permettre la mise à jour du status via cette méthode
      delete updateData.status;
      delete updateData.verificationDetails;

      // Si la localisation est mise à jour, recalculer le geohash
      if (Object.hasOwn(data, 'location')) {
        if (!data.location) throw new Error('Une position complète et valide est requise pour enregistrer une nouvelle localisation.');
        updateData.location = {
          ...data.location,
          geohash: geohashForLocation(newShopCoordinates(data.location)),
        };
      }

      await updateDoc(doc(firestore, this.COLLECTION, id), updateData);
    } catch (error) {
      if (__DEV__) console.error('Error updating shop:', error);
      throw new Error('Erreur lors de la mise à jour de la boutique');
    }
  }

  /**
   * Approuver une boutique (admin uniquement).
   *
   * Le status / verificationDetails d'une boutique sont verrouillés côté
   * firestore.rules (admin-owned). La mutation passe par la Cloud Function
   * callable `approveShop` (Admin SDK + runTransaction), qui dérive l'admin
   * depuis request.auth — aucun adminId n'est envoyé par le client.
   */
  private static async moderateShop(id: string, status: ShopModerationResponse['status'], reason?: string, options?: ShopModerationOptions): Promise<void> {
    const session = captureTradeSession(options?.expectedUid);
    const current = () => {assertTradeSessionCurrent(session); options?.assertCurrent();};
    current();
    const name = status === 'approved' ? 'approveShop' : status === 'rejected' ? 'rejectShop' : 'suspendShop';
    const callable = httpsCallable<{shopId: string; expectedUid: string; reason?: string}, ShopModerationResponse>(functions, name);
    const result = await callable({shopId: id, expectedUid: session.uid, ...(reason !== undefined ? {reason} : {})});
    current();
    if (result.data?.ok !== true || result.data.shopId !== id || result.data.status !== status) {
      throw new Error('La décision n’a pas pu être confirmée. Actualisez la boutique.');
    }
  }

  static async approveShop(id: string, options?: ShopModerationOptions): Promise<void> {
    return this.moderateShop(id, 'approved', undefined, options);
  }

  static async rejectShop(id: string, reason: string, options?: ShopModerationOptions): Promise<void> {
    return this.moderateShop(id, 'rejected', reason, options);
  }

  static async suspendShop(id: string, reason: string, options?: ShopModerationOptions): Promise<void> {
    return this.moderateShop(id, 'suspended', reason, options);
  }

  /**
   * Récupérer les articles d'une boutique
   */
  static async getShopArticles(shopId: string): Promise<Article[]> {
    try {
      const q = query(
        collection(firestore, 'articles'),
        where('shopId', '==', shopId),
        where('isActive', '==', true),
        where('isSold', '==', false)
      );

      const querySnapshot = await getDocs(q);
      const articles: Article[] = [];

      querySnapshot.forEach((doc) => {
        const data = doc.data();
        articles.push({
          ...data,
          id: doc.id,
          createdAt: data.createdAt?.toDate() || new Date(),
        } as Article);
      });

      return articles;
    } catch (error) {
      console.error('Error fetching shop articles:', error);
      return [];
    }
  }

  /**
   * Mettre à jour les informations légales d'une boutique
   */
  static async updateLegalInfo(
    _shopId: string,
    _legalInfo: Partial<Shop['legalInfo']>
  ): Promise<void> {
    throw new Error('La collecte des renseignements fiscaux et bancaires des boutiques n’est pas disponible au lancement.');
  }

  /** Old callers cannot create an unjournaled payment. Existing native requests
   * are serviced by their durable UID/requestId/command below. */
  static async purchaseShopTier(_shopId: string, _tier: 'pro' | 'premium', _periodMonths: number): Promise<ShopTierPaymentOffer> {
    throw new Error('Reprenez le paiement depuis le suivi du forfait pour conserver sa référence.');
  }

  static async getShopTierPurchaseJournal(expectedUid: string, shop: string, assertContext: () => void): Promise<ShopTierPurchaseJournal | null> {
    const session = captureTradeSession(expectedUid);
    const current = () => {assertTradeSessionCurrent(session); assertContext();};
    return readTierJournal(expectedUid, shop, current);
  }

  /** Called only by the explicit NEW-choice button. Persisting the tuple is a
   * prerequisite of the very first RPC, including when its response is lost. */
  static async beginShopTierPurchase(expectedUid: string, input: ShopTierPurchaseCommand, newChoiceConfirmed: true, assertContext: () => void): Promise<ShopTierPurchaseObservation> {
    const command = tierCommand(input);
    if (newChoiceConfirmed !== true) throw tierUnknown();
    return withTierJournalLock(expectedUid, command.shopId, assertContext, async current => {
      const previous = await readTierJournal(expectedUid, command.shopId, current);
      if (previous) {
        if (!previous.acknowledgedReceipt) throw tierUnknown();
        const observed = await tierRpc(previous, 'observe', current);
        if (!observed.terminal || observed.receipt?.proofHash !== previous.acknowledgedReceipt) throw tierUnknown();
      }
      const requestId = randomUUID();
      const operationId = 'forfait_' + await tierHash([TIER_CAPABILITY, expectedUid, requestId]); current();
      const journal: ShopTierPurchaseJournal = {protocol: 'shop_tier_purchase_local_v1', actorId: expectedUid, requestId, command, operationId,
        native: {amountCents: null, paymentIntentId: null}, paymentAttempted: false, neutralizeRequested: false, cancelRequested: false, acknowledgedReceipt: null};
      await writeTierJournal(journal, current);
      return tierRpc(journal, 'prepare', current);
    });
  }

  /** A returning screen observes the same durable intention; absence is never
   * interpreted as permission to replace an earlier transport-unknown request. */
  static async observeShopTierPurchase(expectedUid: string, shop: string, assertContext: () => void): Promise<ShopTierPurchaseObservation> {
    return withTierJournalLock(expectedUid, shop, assertContext, async current => {
      const journal = await readTierJournal(expectedUid, shop, current);
      if (!journal) throw tierUnknown();
      return tierRpc(journal, 'observe', current);
    });
  }

  static async resumeShopTierPurchase(expectedUid: string, shop: string, assertContext: () => void): Promise<ShopTierPurchaseObservation> {
    return withTierJournalLock(expectedUid, shop, assertContext, async current => {
      const journal = await readTierJournal(expectedUid, shop, current);
      if (!journal) throw tierUnknown();
      const observed = await tierRpc(journal, 'observe', current);
      if (journal.cancelRequested || journal.neutralizeRequested || journal.acknowledgedReceipt ||
          observed.state !== 'payable' && observed.state !== 'reserved') return observed;
      const updated = await readTierJournal(expectedUid, shop, current);
      if (!updated || updated.requestId !== journal.requestId) throw tierUnknown();
      return tierRpc(updated, 'prepare', current);
    });
  }

  static async recordShopTierPaymentSheet(expectedUid: string, shop: string, accepted: ShopTierPurchaseObservation, assertContext: () => void): Promise<void> {
    return withTierJournalLock(expectedUid, shop, assertContext, async current => {
      const journal = await readTierJournal(expectedUid, shop, current);
      if (!journal || journal.requestId !== accepted.requestId || journal.operationId !== accepted.operationId || !sameTierCommand(journal.command, accepted.command) ||
          journal.cancelRequested || journal.neutralizeRequested || journal.acknowledgedReceipt || accepted.state !== 'payable' || !accepted.clientSecret ||
          journal.native.paymentIntentId !== accepted.paymentIntentId || journal.native.amountCents !== accepted.amountCents) throw tierUnknown();
      await writeTierJournal({...journal, paymentAttempted: true}, current);
    });
  }

  static async neutralizeShopTierPurchase(expectedUid: string, shop: string, assertContext: () => void, expectedRequestId?: string): Promise<ShopTierPurchaseObservation> {
    return withTierJournalLock(expectedUid, shop, assertContext, async current => {
      const journal = await readTierJournal(expectedUid, shop, current);
      if (!journal || expectedRequestId !== undefined && journal.requestId !== expectedRequestId) throw tierUnknown();
      const observed = await tierRpc(journal, 'observe', current);
      if (observed.terminal || observed.postAuthorized || observed.paymentIntentId !== null || !['unrecorded','reserved'].includes(observed.state)) return observed;
      const latest = await readTierJournal(expectedUid, shop, current);
      if (!latest || latest.requestId !== journal.requestId) throw tierUnknown();
      const flagged = {...latest, neutralizeRequested: true};
      await writeTierJournal(flagged, current);
      return tierRpc(flagged, 'neutralize', current);
    });
  }

  /** Explicit cancellation consent is separate from SDK dismissal. The flag is
   * durable before the cancel RPC; an unknown result resumes by GET only. */
  static async cancelShopTierPurchase(expectedUid: string, shop: string, paymentIntentId: string, cancelAcknowledged: true, assertContext: () => void, expectedRequestId?: string): Promise<ShopTierPurchaseObservation> {
    if (cancelAcknowledged !== true) throw tierUnknown();
    return withTierJournalLock(expectedUid, shop, assertContext, async current => {
      const journal = await readTierJournal(expectedUid, shop, current);
      if (!journal || expectedRequestId !== undefined && journal.requestId !== expectedRequestId) throw tierUnknown();
      const observed = await tierRpc(journal, 'observe', current);
      // The local marker proves intent, not arrival at the server. A freshly
      // payable native read permits another EXPLICIT confirmation of this same
      // tuple. A native cancel authorization instead returns unknown, so this
      // path cannot automatically replay its provider POST.
      if (observed.state !== 'payable' || observed.paymentIntentId !== paymentIntentId || !observed.postAuthorized) return observed;
      const latest = await readTierJournal(expectedUid, shop, current);
      if (!latest || latest.requestId !== journal.requestId) throw tierUnknown();
      const flagged = {...latest, cancelRequested: true};
      await writeTierJournal(flagged, current);
      return tierRpc(flagged, 'cancel_known_unconfirmed', current);
    });
  }

  static async acknowledgeShopTierPurchase(expectedUid: string, shop: string, proofHash: string, assertContext: () => void): Promise<ShopTierPurchaseObservation> {
    if (!tierHashShape(proofHash)) throw tierUnknown();
    return withTierJournalLock(expectedUid, shop, assertContext, async current => {
      const journal = await readTierJournal(expectedUid, shop, current);
      if (!journal) throw tierUnknown();
      const observed = await tierRpc(journal, 'observe', current);
      if (!observed.terminal || observed.receipt?.proofHash !== proofHash) throw tierUnknown();
      const latest = await readTierJournal(expectedUid, shop, current);
      if (!latest || latest.requestId !== journal.requestId) throw tierUnknown();
      await writeTierJournal({...latest, acknowledgedReceipt: proofHash}, current);
      return observed;
    });
  }

  /** Requalify the existing private owner session, independently of commerce
   * eligibility. A local SDK identity alone cannot prove a revoked session. */
  static async assertShopTierPaymentSession(expectedUid: string, assertContext: () => void): Promise<void> {
    const session = captureTradeSession(expectedUid);
    const current = () => { assertTradeSessionCurrent(session); assertContext(); };
    current();
    const reply = await EligibilityService.getMine(expectedUid);
    current();
    if (!reply || typeof reply.version !== 'string' || !/^[a-f0-9]{64}$/.test(reply.version) ||
        typeof reply.policyVersion !== 'string' || !reply.policyVersion.trim()) {
      throw new Error('Votre session doit être vérifiée avant de poursuivre le paiement.');
    }
  }

  /** Only a fresh server stamp for THIS payment proves its activation. Another
   * active tier or PaymentSheet success cannot stand in for this receipt. */
  static async getShopTierActivation(
    shopId: string,
    expectedUid: string,
    offer: ShopTierPaymentOffer,
    assertContext: () => void,
  ): Promise<{ tier: 'pro' | 'premium'; tierPaidUntil: Date } | null> {
    const session = captureTradeSession(expectedUid);
    const current = () => { assertTradeSessionCurrent(session); assertContext(); };
    await this.assertShopTierPaymentSession(expectedUid, current);
    current();
    const snapshot = await getDocFromServer(doc(firestore, this.COLLECTION, shopId));
    current();
    const data = snapshot.exists() ? snapshot.data() : null;
    await this.assertShopTierPaymentSession(expectedUid, current);
    current();
    if (!data || data.ownerId !== expectedUid || data.status !== 'approved' ||
        data.tierPaymentIntentId !== offer.paymentIntentId || data.tier !== offer.tier ||
        typeof data.tierPaidUntil?.toMillis !== 'function') return null;
    const until = data.tierPaidUntil.toMillis();
    if (!Number.isSafeInteger(until) || until <= Date.now()) return null;
    return { tier: offer.tier, tierPaidUntil: new Date(until) };
  }

}

