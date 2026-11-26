import { getEnvironmentStorageKey } from '@/config/firebaseEnvironment';
import { auth } from '@/config/firebaseConfig';
import { httpsCallable } from 'firebase/functions';
import { doc } from 'firebase/firestore';
import { waitFor } from '@testing-library/react-native';
let mockUid: string | null = 'reviewer';
let mockGeneration = 71;
const mockData = new Map<string, string>();
const mockGet = jest.fn(); const mockSet = jest.fn(); const mockRemove = jest.fn(); const mockRead = jest.fn();
jest.mock('@react-native-async-storage/async-storage', () => ({ __esModule: true, default: {
 getItem: (key: string) => mockGet(key), setItem: (key: string, value: string) => mockSet(key, value), removeItem: (key: string) => mockRemove(key),
} }));
jest.mock('@/store/authStore', () => ({ getAuthSessionGeneration: () => mockGeneration, useAuthStore: { getState: () => ({ authenticatedUid: mockUid, user: null }) } }));
jest.mock('@/services/articlesService', () => ({ ArticlesService: { getArticleById: (...args: unknown[]) => mockRead(...args) } }));
import { sendMeetupProposal, acknowledgeMeetupProposal } from '@/services/chat/offers';
import { prepareArticleSoldChange, toggleArticleSoldSafely as executeSold } from '@/services/articleSoldService';
const pk = getEnvironmentStorageKey('meetup-proposal:v1:reviewer:review-chat'); const ak = getEnvironmentStorageKey('article-sold:v1:reviewer:review-article');
const payload = (amount = 23, chatId = 'review-chat') => ({ amount, chatId, location: { name: 'Même lieu', category: 'metro', neighborhood: { id: 'review-quartier', name: 'Quartier de revue', borough: 'Montréal' }, coordinates: { latitude: 45.5, longitude: -73.5 } } });
const canonical = (value: unknown): string => JSON.stringify(value, (_key, v: unknown) => v && typeof v === 'object' && !Array.isArray(v) ? Object.fromEntries(Object.entries(v).sort(([a], [b]) => a.localeCompare(b))) : v);
const lost = () => Object.assign(new Error('unknown reviewer response'), { code: 'functions/unavailable' });
const marker = () => JSON.stringify({ version: 1, uid: 'reviewer', articleId: 'review-article', localId: 'persisted-before-restart' });
let dispatch: jest.Mock; let sold: boolean;
beforeEach(() => {
 jest.clearAllMocks(); mockData.clear(); mockUid = 'reviewer'; mockGeneration = 71; sold = false;
 (auth as unknown as { currentUser: { uid: string } | null }).currentUser = { uid: 'reviewer' };
 mockGet.mockImplementation(async (key: string) => mockData.get(key) ?? null);
 mockSet.mockImplementation(async (key: string, value: string) => { mockData.set(key, value); });
 mockRemove.mockImplementation(async (key: string) => { mockData.delete(key); });
 mockRead.mockImplementation(async (id: string) => ({ id, sellerId: 'reviewer', isSold: sold }));
 let id = 0; (doc as jest.Mock).mockImplementation(() => ({ id: `independent-key-${++id}` }));
 dispatch = jest.fn(async (_name: string, _value: Record<string, unknown>) => ({ data: { success: true, messageId: 'review-receipt' } }));
 (httpsCallable as jest.Mock).mockImplementation((_f: unknown, name: string) => async (value: Record<string, unknown>) => { if(name==='toggleArticleSold' && value.operation==='observe')return {data:{operation:'observe',articleId:value.articleId,isSold:sold,revision:'a'.repeat(64)}}; const result=await dispatch(name,value); return name==='toggleArticleSold'?{data:{...result.data,operation:'set',outcome:'applied',articleId:value.articleId,requestId:value.requestId,isSold:value.desiredIsSold,revision:null}}:result; });
});
it('R-J01 duplicate fingerprints with distinct keys preserve the ambiguous journal and block IO', async () => {
 const value = payload(); const raw = JSON.stringify(['key-1', 'key-2'].map(requestId => ({ requestId, payload: value, fingerprint: canonical(value) })));
 mockData.set(pk, raw); await expect(sendMeetupProposal(value, 'reviewer')).rejects.toThrow('ambigu'); expect(dispatch).not.toHaveBeenCalled(); expect(mockData.get(pk)).toBe(raw);
});
it('R-J02 three unknown intents retain independent keys while one successful recovery and a new concurrent intent serialize', async () => {
 dispatch.mockRejectedValue(lost()); await Promise.all([11, 12, 13].map(amount => sendMeetupProposal(payload(amount), 'reviewer').catch(() => undefined)));
 const before = JSON.parse(mockData.get(pk)!) as { requestId: string; payload: { amount: number } }[]; expect(before).toHaveLength(3);
 dispatch.mockImplementation(async (_name: string, value: Record<string, unknown>) => { if (value.amount === 14) throw lost(); return { data: { success: true, messageId: 'r' } }; });
 await Promise.all([sendMeetupProposal(payload(12), 'reviewer'), sendMeetupProposal(payload(14), 'reviewer').catch(() => undefined)]);
 const after = JSON.parse(mockData.get(pk)!) as { requestId: string; payload: { amount: number } }[];
 expect(after.map(x => x.payload.amount).sort()).toEqual([11, 13, 14]); expect(after.filter(x => x.payload.amount !== 14).map(x => x.requestId)).toEqual(before.filter(x => x.payload.amount !== 12).map(x => x.requestId));
});
it('R-J03 another conversation with identical terms uses a distinct local key and independent dispatcher', async () => {
 dispatch.mockRejectedValue(lost()); await Promise.all([sendMeetupProposal(payload(), 'reviewer').catch(() => undefined), sendMeetupProposal(payload(23, 'other-review-chat'), 'reviewer').catch(() => undefined)]);
 expect(mockData.size).toBe(2); expect(new Set(dispatch.mock.calls.map(([, value]) => value.requestId)).size).toBe(2);
});
it('R-J04 a receipt cleanup failure keeps the same immutable request for later explicit recovery', async () => {
 mockRemove.mockRejectedValueOnce(new Error('removal offline'));
 await expect(sendMeetupProposal(payload(), 'reviewer')).rejects.toThrow('removal offline'); const first = dispatch.mock.calls[0][1]; expect(mockData.get(pk)).toContain(first.requestId);
 await sendMeetupProposal(payload(), 'reviewer'); expect(dispatch.mock.calls[1][1]).toEqual(first);
});
it('R-J05 joining during persistence with its own stale dossier cannot adopt the first consumer receipt', async () => {
 let release!: () => void; let joinerCurrent = true;
 mockSet.mockImplementationOnce(async (key: string, value: string) => { await new Promise<void>(r => { release = r; }); mockData.set(key, value); });
 const first = sendMeetupProposal(payload(), 'reviewer'); await waitFor(() => expect(mockSet).toHaveBeenCalledTimes(1));
 const second = sendMeetupProposal(payload(), 'reviewer', () => { if (!joinerCurrent) throw new Error('joiner stale'); }).catch(e => e);
 joinerCurrent = false; release(); await expect(first).resolves.toBe('review-receipt'); expect(await second).toMatchObject({ message: 'joiner stale' }); expect(dispatch).toHaveBeenCalledTimes(1);
});
it('R-J06 founder closes during persistence; later valid consumer gets explicit rejection and persisted retry rather than success', async () => {
 let release!: () => void; let founderCurrent = true;
 mockSet.mockImplementationOnce(async (key: string, value: string) => { await new Promise<void>(r => { release = r; }); mockData.set(key, value); });
 const first = sendMeetupProposal(payload(), 'reviewer', () => { if (!founderCurrent) throw new Error('founder stale'); }).catch(e => e);
 await waitFor(() => expect(mockSet).toHaveBeenCalledTimes(1)); const second = sendMeetupProposal(payload(), 'reviewer').catch(e => e);
 founderCurrent = false; release(); expect(await first).toMatchObject({ message: 'founder stale' }); expect(await second).toMatchObject({ message: 'founder stale' }); expect(dispatch).not.toHaveBeenCalled(); expect(mockData.get(pk)).toContain('independent-key-1');
 await sendMeetupProposal(payload(), 'reviewer'); expect(dispatch.mock.calls[0][1].requestId).toBe('independent-key-1');
});
it('R-J07 closing while receipt journal removal is awaiting storage retains the intent until actual current adoption', async () => {
 let release!: () => void; let current = true;
 mockRemove.mockImplementationOnce(async (key: string) => { await new Promise<void>(r => { release = r; }); mockData.delete(key); });
 const first = sendMeetupProposal(payload(), 'reviewer', () => { if (!current) throw new Error('dossier closed during removal'); }).catch(e => e);
 await waitFor(() => expect(mockRemove).toHaveBeenCalledTimes(1)); expect(dispatch).toHaveBeenCalledTimes(1);
 const firstPayload = dispatch.mock.calls[0][1]; const exactBeforeRemoval = mockData.get(pk);
 expect(exactBeforeRemoval).toContain(firstPayload.requestId); console.info('R-J07 BEFORE_REMOVE', { payload: firstPayload, exactBeforeRemoval, current }); current = false; release(); const firstOutcome = await first; const persistedAfter = mockData.get(pk) ?? mockData.get(`${pk}:receipts`) ?? null;
 await sendMeetupProposal(payload(), 'reviewer'); const nextPayload = dispatch.mock.calls[1][1];
 console.info('R-J07 reached', { firstOutcome: firstOutcome.message, persistedAfter, firstKey: firstPayload.requestId, nextKey: nextPayload.requestId });
 expect(firstOutcome).toMatchObject({ message: 'dossier closed during removal' });
 expect({ preserved: persistedAfter !== null, nextPayload }).toEqual({ preserved: true, nextPayload: firstPayload });
});
it.each(['read', 'write'])('R-J08 proposal local %s failure never dispatches and never invents success', async fault => {
 if (fault === 'read') mockGet.mockRejectedValueOnce(new Error('local down')); else mockSet.mockRejectedValueOnce(new Error('local down'));
 await expect(sendMeetupProposal(payload(), 'reviewer')).rejects.toThrow('local down'); expect(dispatch).not.toHaveBeenCalled();
});
it('R-T01 unknown toggle with legacy missing isSold repeatedly stays read-only and preserves its marker', async () => {
 mockData.set(ak, marker()); mockRead.mockResolvedValue({ id: 'review-article', sellerId: 'reviewer' });
 await expect(toggleArticleSoldSafely('review-article', 'reviewer')).rejects.toThrow('vérifier'); await expect(toggleArticleSoldSafely('review-article', 'reviewer')).rejects.toThrow('vérifier');
 expect(dispatch).not.toHaveBeenCalled(); expect(mockData.get(ak)).toBe(marker());
});
it.each(['dossier', 'generation'])('R-T02 stale %s during final marker removal never permits another toggle before displayed reconciliation', async boundary => {
 let release!: () => void; let current = true;
 dispatch.mockImplementation(async () => { sold = !sold; return { data: { success: true } }; });
 mockSet.mockImplementation(async (key: string, value: string) => { if (key === ak && JSON.parse(value).receiptId) await new Promise<void>(r => { release = r; }); mockData.set(key, value); });
 const first = toggleArticleSoldSafely('review-article', 'reviewer', () => { if (!current) throw new Error('dossier closed during removal'); }).catch(e => e);
 await waitFor(() => expect(mockSet.mock.calls.some(([key, value]) => key === ak && JSON.parse(value).receiptId)).toBe(true)); expect(mockRead).toHaveBeenCalledWith('review-article'); expect(sold).toBe(true);
 const exactBeforeRemoval = mockData.get(ak); expect(exactBeforeRemoval).toContain('localId');
 console.info('R-T02 BEFORE_REMOVE', { boundary, exactBeforeRemoval, generation: mockGeneration, current, dispatched: dispatch.mock.calls });
 if (boundary === 'dossier') current = false; else mockGeneration++;
 release(); const firstOutcome = await first; const persistedAfter = mockData.get(ak) ?? null;
 mockSet.mockImplementation(async (key: string, value: string) => { mockData.set(key, value); });
 const resumed = await toggleArticleSoldSafely('review-article', 'reviewer');
 console.info('R-T02 reached', { boundary, firstOutcome: firstOutcome.message, persistedAfter, reconciled: resumed.reconciled, sold: resumed.article.isSold, calls: dispatch.mock.calls.length });
 expect(firstOutcome).toBeInstanceOf(Error); expect({ retained: persistedAfter !== null, readOnly: resumed.reconciled, calls: dispatch.mock.calls.length, sold: resumed.article.isSold }).toEqual({ retained: true, readOnly: true, calls: 1, sold: true });
});
it('R-T03 interrupted module restarted with only persisted marker remains read-only', async () => {
 mockData.set(ak, marker()); sold = true;
 let restarted = toggleArticleSoldSafely;
 jest.isolateModules(() => {
  const c = require('@/config/firebaseConfig') as { auth: { currentUser: { uid: string } } }; c.auth.currentUser = { uid: 'reviewer' };
  restarted = (require('@/services/articleSoldService') as { toggleArticleSoldSafely: typeof toggleArticleSoldSafely }).toggleArticleSoldSafely;
 });
 const value = await restarted('review-article', 'reviewer'); expect(value.reconciled).toBe(true); expect(value.article.isSold).toBe(true); expect(dispatch).not.toHaveBeenCalled();
});
it('R-S01 incoherent store Auth fails both services before local IO', async () => {
 mockUid = 'other'; await expect(sendMeetupProposal(payload(), 'reviewer')).rejects.toMatchObject({ code: 'client/stale-operation' }); await expect(toggleArticleSoldSafely('review-article', 'reviewer')).rejects.toMatchObject({ code: 'client/stale-operation' }); expect(mockGet).not.toHaveBeenCalled(); expect(dispatch).not.toHaveBeenCalled();
});

function holdWrite(predicate: (key: string, value: string) => boolean) {
 let release!: () => void; let entered = false;
 mockSet.mockImplementation(async (key: string, value: string) => {
  if (!entered && predicate(key, value)) { entered = true; await new Promise<void>(r => { release = r; }); }
  mockData.set(key, value);
 });
 return { wait: () => waitFor(() => expect(entered).toBe(true)), release: () => release() };
}
const assertFlag = (current: () => boolean) => () => { if (!current()) throw new Error('consumer closed'); };
const proof = `${pk}:receipts`;
it.each(['dossier', 'generation'])('V2-P01 proposal persists known proof while %s changes during its write, exact retry remains available', async boundary => {
 let current = true; const write = holdWrite(key => key === proof);
 const pending = sendMeetupProposal(payload(), 'reviewer', assertFlag(() => current)).catch(error => error);
 await write.wait(); expect(dispatch).toHaveBeenCalledTimes(1); const exact = dispatch.mock.calls[0][1];
 if (boundary === 'dossier') current = false; else mockGeneration++;
 write.release(); expect(await pending).toBeInstanceOf(Error);
 expect(mockData.get(proof)).toContain(exact.requestId);
 await sendMeetupProposal(payload(), 'reviewer'); expect(dispatch.mock.calls[1][1]).toEqual(exact);
});
it('V2-P02 failed proof persistence cannot adopt a known success; recovery retains the same key', async () => {
 mockSet.mockImplementation(async (key: string, value: string) => { if (key === proof) throw new Error('proof disk offline'); mockData.set(key, value); });
 await expect(sendMeetupProposal(payload(), 'reviewer')).rejects.toThrow('proof disk offline'); const exact = dispatch.mock.calls[0][1];
 expect(mockData.get(pk)).toContain(exact.requestId);
 mockSet.mockImplementation(async (key: string, value: string) => { mockData.set(key, value); });
 await sendMeetupProposal(payload(), 'reviewer'); expect(dispatch.mock.calls[1][1]).toEqual(exact);
});
it('V2-P03 delayed proof with closed founder and current joiner adopts only the joiner', async () => {
 let founderCurrent = true; const write = holdWrite(key => key === proof);
 const first = sendMeetupProposal(payload(), 'reviewer', assertFlag(() => founderCurrent), { deferAdoption: true }).catch(error => error);
 await write.wait(); const second = sendMeetupProposal(payload(), 'reviewer', () => undefined, { deferAdoption: true });
 founderCurrent = false; write.release(); expect(await first).toBeInstanceOf(Error); const messageId = await second;
 expect(dispatch).toHaveBeenCalledTimes(1);
 expect(() => acknowledgeMeetupProposal(messageId, assertFlag(() => founderCurrent))).toThrow('consumer closed');
 acknowledgeMeetupProposal(messageId, () => undefined);
 dispatch.mockImplementation(async (_name: string, value: Record<string, unknown>) => ({ data: { success: true, messageId: `next-${value.requestId}` } }));
 await sendMeetupProposal(payload(), 'reviewer'); expect(dispatch.mock.calls[1][1].requestId).not.toBe(dispatch.mock.calls[0][1].requestId);
});
it('V2-P04 defer receipt alone is not adoption; exact key is replayed, current adoption permits a new identical intent', async () => {
 const receipt = await sendMeetupProposal(payload(), 'reviewer', () => undefined, { deferAdoption: true }); const exact = dispatch.mock.calls[0][1];
 await sendMeetupProposal(payload(), 'reviewer', () => undefined, { deferAdoption: true }); expect(dispatch.mock.calls[1][1]).toEqual(exact);
 acknowledgeMeetupProposal(receipt, () => undefined);
 dispatch.mockImplementation(async (_name: string, value: Record<string, unknown>) => ({ data: { success: true, messageId: `next-${value.requestId}` } }));
 await sendMeetupProposal(payload(), 'reviewer'); expect(dispatch.mock.calls[2][1].requestId).not.toBe(exact.requestId);
 expect(JSON.parse(mockData.get(proof)!)).toHaveLength(2);
});
it('V2-P05 reset of module with only proof retained replays exact payload before any new identical intention', async () => {
 await sendMeetupProposal(payload(), 'reviewer'); const exact = dispatch.mock.calls[0][1]; expect(mockData.has(pk)).toBe(false);
 let restarted = sendMeetupProposal;
 jest.isolateModules(() => {
  const c = require('@/config/firebaseConfig') as { auth: { currentUser: { uid: string } } }; c.auth.currentUser = { uid: 'reviewer' };
  const functions = require('firebase/functions') as { httpsCallable: jest.Mock }; functions.httpsCallable.mockImplementation((_f: unknown, name: string) => (value: Record<string, unknown>) => dispatch(name, value));
  restarted = (require('@/services/chat/offers') as { sendMeetupProposal: typeof sendMeetupProposal }).sendMeetupProposal;
 });
 await restarted(payload(), 'reviewer'); expect(dispatch.mock.calls[1][1]).toEqual(exact);
});
it('V2-P06 proof writes of two known intents never drop the unknown third intent', async () => {
 dispatch.mockImplementation(async (_name: string, value: Record<string, unknown>) => { if (value.amount === 31) throw lost(); return { data: { success: true, messageId: `message-${value.requestId}` } }; });
 await Promise.all([29, 30, 31].map(amount => sendMeetupProposal(payload(amount), 'reviewer').catch(error => error)));
 const receipts = JSON.parse(mockData.get(proof)!) as { payload: { amount: number } }[];
 const active = JSON.parse(mockData.get(pk)!) as { payload: { amount: number } }[];
 expect(receipts.map(item => item.payload.amount).sort()).toEqual([29, 30]); expect(active.map(item => item.payload.amount)).toEqual([31]);
});
it.each(['duplicate', 'wrong-chat'])('V2-P07 invalid known %s proof blocks before new dispatch and preserves bytes', async kind => {
 await sendMeetupProposal(payload(), 'reviewer'); dispatch.mockClear();
 const records = JSON.parse(mockData.get(proof)!) as { payload: Record<string, unknown>; fingerprint: string }[];
 if (kind === 'duplicate') records.push(records[0]); else { records[0].payload.chatId = 'wrong'; records[0].fingerprint = canonical(records[0].payload); }
 const raw = JSON.stringify(records); mockData.set(proof, raw);
 await expect(sendMeetupProposal(payload(), 'reviewer')).rejects.toThrow(); expect(dispatch).not.toHaveBeenCalled(); expect(mockData.get(proof)).toBe(raw);
});
it('V2-P08 proof read failure before preparation never invents a new key or IO', async () => {
 mockGet.mockImplementation(async (key: string) => { if (key === proof) throw new Error('proof read offline'); return mockData.get(key) ?? null; });
 await expect(sendMeetupProposal(payload(), 'reviewer')).rejects.toThrow('proof read offline'); expect(dispatch).not.toHaveBeenCalled(); expect(mockSet).not.toHaveBeenCalled();
});
it.each(['dossier', 'generation'])('V2-T01 current %s changes after receipt returns but before displayed adoption: retry remains read-only', async boundary => {
 let current = true; dispatch.mockImplementation(async () => { sold = !sold; return { data: { success: true } }; });
 const first = await toggleArticleSoldSafely('review-article', 'reviewer', assertFlag(() => current));
 if (boundary === 'dossier') current = false; else mockGeneration++;
 expect(() => first.acknowledge()).toThrow();
 const recovery = await toggleArticleSoldSafely('review-article', 'reviewer'); expect(recovery.reconciled).toBe(true); expect(dispatch).toHaveBeenCalledTimes(1);
 recovery.acknowledge(); const next = await toggleArticleSoldSafely('review-article', 'reviewer'); expect(next.reconciled).toBe(false); expect(next.article.isSold).toBe(false); expect(dispatch).toHaveBeenCalledTimes(2);
});
it('V2-T02 proof write failure cannot remove recovery or permit a second toggle', async () => {
 dispatch.mockImplementation(async () => { sold = true; return { data: { success: true } }; });
 mockSet.mockImplementation(async (key: string, value: string) => { if (JSON.parse(value).receiptId) throw new Error('receipt write offline'); mockData.set(key, value); });
 await expect(toggleArticleSoldSafely('review-article', 'reviewer')).rejects.toThrow('receipt write offline'); expect(mockData.get(ak)).toContain('localId');
 mockSet.mockImplementation(async (key: string, value: string) => { mockData.set(key, value); });
 const recovery = await toggleArticleSoldSafely('review-article', 'reviewer'); expect(recovery.reconciled).toBe(true); expect(dispatch).toHaveBeenCalledTimes(1);
});
it('V2-T03 old acknowledgement cannot adopt or overwrite the next intention while its write awaits', async () => {
 dispatch.mockImplementation(async () => { sold = !sold; return { data: { success: true } }; });
 const old = await toggleArticleSoldSafely('review-article', 'reviewer'); old.acknowledge(); const write = holdWrite((key, value) => key === ak && !JSON.parse(value).receiptId);
 const next = toggleArticleSoldSafely('review-article', 'reviewer'); await write.wait(); expect(() => old.acknowledge()).toThrow('courante');
 write.release(); const second = await next; expect(() => old.acknowledge()).toThrow('courante'); second.acknowledge();
 expect(dispatch).toHaveBeenCalledTimes(2); expect(second.article.isSold).toBe(false); expect(JSON.parse(mockData.get(ak)!).verifiedSold).toBe(false);
});
it('V2-T04 reset module with an acknowledged known proof still reconciles read-only', async () => {
 dispatch.mockImplementation(async () => { sold = true; return { data: { success: true } }; });
 const first = await toggleArticleSoldSafely('review-article', 'reviewer'); first.acknowledge(); let restarted = toggleArticleSoldSafely;
 jest.isolateModules(() => {
  const c = require('@/config/firebaseConfig') as { auth: { currentUser: { uid: string } } }; c.auth.currentUser = { uid: 'reviewer' };
  restarted = (require('@/services/articleSoldService') as { toggleArticleSoldSafely: typeof toggleArticleSoldSafely }).toggleArticleSoldSafely;
 });
 const recovery = await restarted('review-article', 'reviewer'); expect(recovery.reconciled).toBe(true); expect(recovery.article.isSold).toBe(true); expect(dispatch).toHaveBeenCalledTimes(1);
});
it('V2-T05 receipt alone repeatedly reconciles, only actual acknowledgement permits the next toggle', async () => {
 dispatch.mockImplementation(async () => { sold = !sold; return { data: { success: true } }; });
 const one = await toggleArticleSoldSafely('review-article', 'reviewer'); const two = await toggleArticleSoldSafely('review-article', 'reviewer');
 expect(two.reconciled).toBe(true); expect(dispatch).toHaveBeenCalledTimes(1); expect(() => one.acknowledge()).toThrow('courante');
 two.acknowledge(); await toggleArticleSoldSafely('review-article', 'reviewer'); expect(dispatch).toHaveBeenCalledTimes(2);
});
it('V2-P09 a malformed receipt journal also blocks replay of an otherwise valid active attempt before IO', async () => {
 // Both observations of the same idempotent request remain unavailable.
 dispatch.mockRejectedValue(lost()); await expect(sendMeetupProposal(payload(), 'reviewer')).rejects.toThrow();
 const active = mockData.get(pk); mockData.set(proof, '{broken'); dispatch.mockClear();
 await expect(sendMeetupProposal(payload(), 'reviewer')).rejects.toThrow(); expect(dispatch).not.toHaveBeenCalled(); expect(mockData.get(pk)).toBe(active); expect(mockData.get(proof)).toBe('{broken');
});
it('V2-T06 an incomplete known proof cannot authorize reconciliation or another toggle', async () => {
 const raw = JSON.stringify({ version: 1, uid: 'reviewer', articleId: 'review-article', localId: 'legacy', verifiedSold: true }); mockData.set(ak, raw);
 await expect(toggleArticleSoldSafely('review-article', 'reviewer')).rejects.toThrow('examinée'); expect(dispatch).not.toHaveBeenCalled(); expect(mockRead).not.toHaveBeenCalled(); expect(mockData.get(ak)).toBe(raw);
});

// V4 fixture: observe is read-only; dispatch assertions below count set/other mutations.
async function toggleArticleSoldSafely(id:string,uid:string,guard:()=>void=()=>undefined){const prepared=await prepareArticleSoldChange(id,uid,sold,guard);return prepared.result??executeSold(id,uid,guard,prepared.intent!);}
