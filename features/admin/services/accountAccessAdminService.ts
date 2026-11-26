import { CryptoDigestAlgorithm, digestStringAsync } from 'expo-crypto';
import { httpsCallable } from 'firebase/functions';
import { functions } from '@/config/firebaseConfig';
import { assertTradeSessionCurrent, captureTradeSession } from '@/services/tradeOperation';
import type { AccountAccessAdminDetail, AccountAccessAdminItem, AccountAccessAdminList } from '../types/accountAccessAdmin';

const protocol = 'account_access_intake_v1';
const object = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v);
const reference = (v: unknown): v is string => typeof v === 'string' && /^access_[a-f0-9]{64}$/.test(v);
const hash = (v: unknown): v is string => typeof v === 'string' && /^[a-f0-9]{64}$/.test(v);
const requestId = (v: unknown): v is string => typeof v === 'string' && /^[A-Za-z0-9_-]{16,128}$/.test(v);
const text = (v: unknown, max: number): v is string => typeof v === 'string' && v.trim() === v && !!v && v.length <= max &&
  !/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/.test(v);
const date = (v: unknown): v is string => typeof v === 'string' && Number.isFinite(Date.parse(v)) && new Date(v).toISOString() === v;
const fail = () => new Error('La lecture privée de ces dépôts ne peut pas être confirmée. Relisez la file avec votre accès administratif actuel.');
const digest = (v: unknown) => digestStringAsync(CryptoDigestAlgorithm.SHA256, JSON.stringify(v));
async function parseItem(v: unknown, assertCurrent: () => void): Promise<AccountAccessAdminItem> {
  if (!object(v) || Object.keys(v).some(k => !['protocol', 'reference', 'requestId', 'payloadHash', 'state', 'recordedAt', 'command',
    'contactVerified', 'identityVerified', 'recoveryGranted'].includes(k)) || v.protocol !== protocol || !reference(v.reference) || !requestId(v.requestId) ||
    !hash(v.payloadHash) || !date(v.recordedAt) || !['received', 'neutralized'].includes(String(v.state)) ||
    v.contactVerified !== false || v.identityVerified !== false || v.recoveryGranted !== false) throw fail();
  const expectedReference = `access_${await digest([protocol, v.requestId])}`; assertCurrent();
  if (v.reference !== expectedReference) throw fail();
  if (v.state === 'neutralized') {
    if (v.command !== null) throw fail();
  } else {
    if (!object(v.command) || Object.keys(v.command).some(k => !['replyEmail', 'narrative'].includes(k)) ||
      !text(v.command.replyEmail, 320) || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v.command.replyEmail) || !text(v.command.narrative, 4000)) throw fail();
    const payloadHash = await digest([protocol, v.requestId, v.command.replyEmail, v.command.narrative]); assertCurrent();
    if (v.payloadHash !== payloadHash) throw fail();
  }
  return v as unknown as AccountAccessAdminItem;
}
function adminEnvelope(v: unknown, keys: string[]): v is Record<string, unknown> {
  return object(v) && Object.keys(v).every(k => keys.includes(k)) && v.protocol === protocol && v.scope === 'admin' &&
    v.accountSearchPerformed === false && v.recoveryGranted === false;
}
export const AccountAccessAdminService = {
  async list(uid: string, cursor: string | undefined, assertContext: () => void): Promise<AccountAccessAdminList> {
    const session = captureTradeSession(uid), assertCurrent = () => {assertTradeSessionCurrent(session); assertContext();};
    assertCurrent(); if (cursor !== undefined && !reference(cursor)) throw fail();
    const response = await httpsCallable<unknown, unknown>(functions, 'accountAccessIntake')({mode: 'admin_list', expectedUid: uid, ...(cursor ? {cursor} : {})});
    assertCurrent(); const v = response.data;
    if (!adminEnvelope(v, ['protocol', 'scope', 'items', 'hasMore', 'cursor', 'accountSearchPerformed', 'recoveryGranted']) ||
      !Array.isArray(v.items) || v.items.length > 30 || typeof v.hasMore !== 'boolean' || v.hasMore !== (v.cursor !== null) ||
      !(v.cursor === null || reference(v.cursor)) || cursor && v.cursor !== null && (v.cursor as string) <= cursor) throw fail();
    const items: AccountAccessAdminItem[] = [];
    for (const raw of v.items) {items.push(await parseItem(raw, assertCurrent)); assertCurrent();}
    if (new Set(items.map(item => item.reference)).size !== items.length || items.some((item, index) =>
      cursor && item.reference <= cursor || index > 0 && item.reference <= items[index - 1].reference ||
      v.cursor !== null && item.reference > (v.cursor as string))) throw fail();
    return {...v, items} as unknown as AccountAccessAdminList;
  },
  async detail(uid: string, expectedReference: string, assertContext: () => void): Promise<AccountAccessAdminDetail> {
    const session = captureTradeSession(uid), assertCurrent = () => {assertTradeSessionCurrent(session); assertContext();};
    assertCurrent(); if (!reference(expectedReference)) throw fail();
    const response = await httpsCallable<unknown, unknown>(functions, 'accountAccessIntake')({mode: 'admin_detail', expectedUid: uid, reference: expectedReference});
    assertCurrent(); const v = response.data;
    if (!adminEnvelope(v, ['protocol', 'scope', 'item', 'accountSearchPerformed', 'recoveryGranted'])) throw fail();
    const item = await parseItem(v.item, assertCurrent); assertCurrent(); if (item.reference !== expectedReference) throw fail();
    return {...v, item} as unknown as AccountAccessAdminDetail;
  },
};
