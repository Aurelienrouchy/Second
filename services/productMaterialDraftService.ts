import AsyncStorage from '@/utils/environmentStorage';
import { captureTradeSession, assertTradeSessionCurrent } from '@/services/tradeOperation';
import { isProductReviewContext } from '@/services/productReviewService';
import { isProductMaterialStatementDraft } from '@/utils/productMaterialStatement';
import type { ProductMaterialStatementDraft } from '@/types/productMaterialReview';
export interface ProductMaterialDraftRecord {version: 1; uid: string; transactionId: string; sourceHash: string; value: ProductMaterialStatementDraft}
const writes = new Map<string, Promise<void>>();
const key = (uid: string, transactionId: string) => `second:product-material-draft:v1:${JSON.stringify([uid, transactionId])}`;
const failure = () => new Error('Le brouillon privé doit être conservé et relu pour cette même commande.');
function valid(v: unknown, uid: string, transactionId: string): v is ProductMaterialDraftRecord {
  if (!v || typeof v !== 'object' || Array.isArray(v)) return false; const r = v as Record<string, unknown>;
  return Object.keys(r).length === 5 && Object.keys(r).every(k => ['version', 'uid', 'transactionId', 'sourceHash', 'value'].includes(k)) &&
    r.version === 1 && r.uid === uid && r.transactionId === transactionId && typeof r.sourceHash === 'string' && /^[a-f0-9]{64}$/.test(r.sourceHash) && isProductMaterialStatementDraft(r.value);
}
export async function readProductMaterialDraft(uid: string, transactionId: string, assertContext: () => void): Promise<ProductMaterialDraftRecord | null> {
  const session = captureTradeSession(uid); assertContext(); if (!isProductReviewContext({kind: 'order', id: transactionId})) throw failure();
  const raw = await AsyncStorage.getItem(key(uid, transactionId)); assertTradeSessionCurrent(session); assertContext(); if (raw === null) return null;
  let v: unknown; try {v = JSON.parse(raw);} catch {throw failure();} if (!valid(v, uid, transactionId)) throw failure(); return v;
}
export async function writeProductMaterialDraft(record: ProductMaterialDraftRecord, assertContext: () => void): Promise<void> {
  const session = captureTradeSession(record.uid); assertContext(); if (!valid(record, session.uid, record.transactionId) || !isProductReviewContext({kind: 'order', id: record.transactionId})) throw failure();
  const slot = key(record.uid, record.transactionId), pending = (writes.get(slot) ?? Promise.resolve()).catch(() => undefined).then(async () => {
    assertTradeSessionCurrent(session); assertContext(); await AsyncStorage.setItem(slot, JSON.stringify(record)); assertTradeSessionCurrent(session); assertContext();
  }); writes.set(slot, pending);
  try {await pending;} finally {if (writes.get(slot) === pending) writes.delete(slot);}
}
