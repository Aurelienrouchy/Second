import AsyncStorage from '@/utils/environmentStorage';
import { captureTradeSession, assertTradeSessionCurrent } from '@/services/tradeOperation';
import { isProductReviewContext } from '@/services/productReviewService';
import { isProductParcelStatementDraft } from '@/utils/productParcelStatement';
import type { ProductParcelStatementDraft } from '@/types/productParcelReview';
export interface ProductParcelDraftRecord {version: 1; uid: string; transactionId: string; sourceHash: string; value: ProductParcelStatementDraft}
const writes = new Map<string, Promise<void>>(), key = (uid: string, id: string) => `second:product-parcel-draft:v1:${JSON.stringify([uid, id])}`;
const failure = () => new Error('Le brouillon colis doit être conservé et relu pour le même compte et la même commande.');
function valid(v: unknown, uid: string, id: string): v is ProductParcelDraftRecord {
  if (!v || typeof v !== 'object' || Array.isArray(v)) return false; const r = v as Record<string, unknown>;
  return Object.keys(r).length === 5 && Object.keys(r).every(k => ['version', 'uid', 'transactionId', 'sourceHash', 'value'].includes(k)) && r.version === 1 && r.uid === uid && r.transactionId === id &&
    typeof r.sourceHash === 'string' && /^[a-f0-9]{64}$/.test(r.sourceHash) && isProductParcelStatementDraft(r.value);
}
export async function readProductParcelDraft(uid: string, id: string, assertContext: () => void): Promise<ProductParcelDraftRecord | null> {
  const session = captureTradeSession(uid); assertContext(); if (!isProductReviewContext({kind: 'order', id})) throw failure();
  const raw = await AsyncStorage.getItem(key(uid, id)); assertTradeSessionCurrent(session); assertContext(); if (raw === null) return null;
  let value: unknown; try {value = JSON.parse(raw);} catch {throw failure();} if (!valid(value, uid, id)) throw failure(); return value;
}
export async function writeProductParcelDraft(record: ProductParcelDraftRecord, assertContext: () => void): Promise<void> {
  const session = captureTradeSession(record.uid); assertContext(); if (!valid(record, session.uid, record.transactionId) || !isProductReviewContext({kind: 'order', id: record.transactionId})) throw failure();
  const slot = key(record.uid, record.transactionId), pending = (writes.get(slot) ?? Promise.resolve()).catch(() => undefined).then(async () => {
    assertTradeSessionCurrent(session); assertContext(); await AsyncStorage.setItem(slot, JSON.stringify(record)); assertTradeSessionCurrent(session); assertContext();
  }); writes.set(slot, pending); try {await pending;} finally {if (writes.get(slot) === pending) writes.delete(slot);}
}
