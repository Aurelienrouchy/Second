import { getEnvironmentStorageKey } from '@/config/firebaseEnvironment';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { auth } from '@/config/firebaseConfig';
import { httpsCallable } from 'firebase/functions';
import { waitFor } from '@testing-library/react-native';
import type { Article } from '@/types';
let mockUid: string | null = 'A'; let mockGeneration = 1; let mockSold = false; let mockRevision = 1;
const mockReadArticle = jest.fn();
jest.mock('@/store/authStore', () => ({ getAuthSessionGeneration: () => mockGeneration, useAuthStore: { getState: () => ({ authenticatedUid: mockUid }) } }));
jest.mock('@/services/articlesService', () => ({ ArticlesService: { getArticleById: (id: string) => mockReadArticle(id) } }));
import { prepareArticleSoldChange, toggleArticleSoldSafely, type ArticleSoldIntent, type ArticleSoldPayload } from '@/services/articleSoldService';
const key = getEnvironmentStorageKey('article-sold:v1:A:article-A');
const revision = () => String(mockRevision).padStart(64, '0');
const marker = () => JSON.stringify({ version: 1, uid: 'A', articleId: 'article-A', localId: 'local-attempt' });
const storageSet = (AsyncStorage.setItem as jest.Mock).getMockImplementation()!;
let observe: jest.Mock; let set: jest.Mock;
const serverReceipts = new Map<string, ArticleSoldPayload>();
async function intent(id = 'article-A', guard: () => void = () => undefined) {
  const prepared = await prepareArticleSoldChange(id, 'A', mockSold, guard);
  if (!prepared.intent) throw new Error('expected fresh intention');
  return prepared.intent;
}
async function gesture(guard: () => void = () => undefined) { return toggleArticleSoldSafely('article-A', 'A', guard, await intent('article-A', guard)); }
beforeEach(async () => {
  jest.clearAllMocks(); (AsyncStorage.setItem as jest.Mock).mockImplementation(storageSet); await AsyncStorage.clear(); mockUid = 'A'; mockGeneration++; mockSold = false; mockRevision = 1; serverReceipts.clear();
  (auth as unknown as { currentUser: { uid: string } | null }).currentUser = { uid: 'A' };
  mockReadArticle.mockImplementation(async id => ({ id, sellerId: 'A', isSold: mockSold } as Article));
  observe = jest.fn(async ({ articleId }: { articleId: string }) => ({ data: { operation: 'observe', articleId, isSold: mockSold, revision: revision() } }));
  set = jest.fn(async (p: ArticleSoldPayload) => {
    const old = serverReceipts.get(p.requestId);
    if (old) return { data: { success: true, operation: 'set', outcome: 'replayed', articleId: p.articleId, requestId: p.requestId, isSold: p.desiredIsSold, revision: revision() } };
    if (p.expectedRevision !== revision()) throw Object.assign(new Error('changed'), { code: 'functions/failed-precondition', details: { reason: 'article_sold_observation_stale', action: 'refreshArticle', articleId: p.articleId, requestId: p.requestId, currentIsSold: mockSold, currentRevision: revision() } });
    mockSold = p.desiredIsSold; mockRevision++; serverReceipts.set(p.requestId, { ...p });
    return { data: { success: true, operation: 'set', outcome: 'applied', articleId: p.articleId, requestId: p.requestId, isSold: mockSold, revision: null } };
  });
  (httpsCallable as jest.Mock).mockImplementation(() => (p: ArticleSoldPayload | { operation: 'observe'; articleId: string }) => p.operation === 'observe' ? observe(p) : set(p));
});
it('V4-S01 requires an observed confirmed intention before first mutation', async () => {
  await expect(toggleArticleSoldSafely('article-A', 'A')).rejects.toThrow('confirmez'); expect(set).not.toHaveBeenCalled(); expect(observe).not.toHaveBeenCalled();
});
it('V4-S02 persists exactly six immutable confirmed fields before server IO and each opposite gesture observes anew', async () => {
  const i = await intent(); const exact = i.payload; const server = set.getMockImplementation()!;
  set.mockImplementation(async p => { expect(JSON.parse((await AsyncStorage.getItem(key))!).intent).toEqual(p); return server(p); });
  const first = await toggleArticleSoldSafely('article-A', 'A', undefined, i); first.acknowledge(); const second = await gesture(); second.acknowledge();
  expect(Object.keys(exact)).toHaveLength(6); expect(set.mock.calls[0][0]).toEqual(exact); expect(set.mock.calls[1][0]).toMatchObject({ desiredIsSold: false, expectedIsSold: true }); expect(set.mock.calls[1][0].requestId).not.toBe(exact.requestId); expect(observe).toHaveBeenCalledTimes(2);
  expect(JSON.parse((await AsyncStorage.getItem(`${key}:receipts`))!)[0].intent).toEqual(exact);
});
it('V4-S03 applied receipt with current opposite article is reconciliation, never new-mutation success', async () => {
  const i = await intent(); mockReadArticle.mockResolvedValueOnce({ id: 'article-A', sellerId: 'A', isSold: false });
  const result = await toggleArticleSoldSafely('article-A', 'A', undefined, i); expect(result.reconciled).toBe(true); expect(result.article.isSold).toBe(false); expect(JSON.parse((await AsyncStorage.getItem(key))!).proof).toMatchObject({ kind: 'applied', appliedIsSold: true });
});
it('V4-S04 response unknown replays the complete immutable intention, never re-observes or reverses', async () => {
  const server = set.getMockImplementation()!; set.mockImplementationOnce(async p => { await server(p); throw Object.assign(new Error('lost'), { code: 'functions/unavailable' }); });
  await expect(gesture()).rejects.toThrow('lost'); const exact = set.mock.calls[0][0]; expect(JSON.parse((await AsyncStorage.getItem(key))!).intent).toEqual(exact);
  const recovered = await toggleArticleSoldSafely('article-A', 'A'); expect(recovered.reconciled).toBe(true); expect(recovered.article.isSold).toBe(true); expect(set.mock.calls[1][0]).toEqual(exact); expect(mockRevision).toBe(2); expect(observe).toHaveBeenCalledTimes(1);
  recovered.acknowledge(); const next = await gesture(); expect(next.article.isSold).toBe(false); expect(set.mock.calls[2][0].requestId).not.toBe(exact.requestId);
});
it('V4-S05 historical superseded receipt preserves proof and reconciles read-only before a fresh gesture', async () => {
  const i = await intent(); await AsyncStorage.setItem(key, JSON.stringify({ version: 2, uid: 'A', articleId: 'article-A', localId: i.payload.requestId, intent: i.payload }));
  mockRevision = 5;
  set.mockRejectedValueOnce(Object.assign(new Error('superseded'), { code: 'functions/failed-precondition', details: { reason: 'article_sold_intent_superseded', action: 'refreshArticle', articleId: i.payload.articleId, requestId: i.payload.requestId, appliedIsSold: true, currentIsSold: false, currentRevision: revision() } }));
  const result = await toggleArticleSoldSafely('article-A', 'A'); const raw = JSON.parse((await AsyncStorage.getItem(key))!); expect(raw.intent).toEqual(i.payload); expect(raw.proof).toMatchObject({ kind: 'superseded', appliedIsSold: true, currentIsSold: false }); expect(result.reconciled).toBe(true);
  await toggleArticleSoldSafely('article-A', 'A'); expect(set).toHaveBeenCalledTimes(1); const recovered = await toggleArticleSoldSafely('article-A', 'A'); recovered.acknowledge(); await gesture(); expect(set).toHaveBeenCalledTimes(2); expect(set.mock.calls[1][0].requestId).not.toBe(i.payload.requestId); expect(JSON.parse((await AsyncStorage.getItem(`${key}:receipts`))!)[0].proof.kind).toBe('superseded');
});
it.each(['state', 'aba'])('V4-S06 server change %s after precheck returns read-only refreshed state and a new gesture remains usable', async axis => {
  const i = await intent(); if (axis === 'state') mockSold = true; mockRevision += 2;
  const result = await toggleArticleSoldSafely('article-A', 'A', undefined, i); expect(result.reconciled).toBe(true); expect(JSON.parse((await AsyncStorage.getItem(key))!).proof.kind).toBe('stale'); expect(serverReceipts.size).toBe(0);
  result.acknowledge(); await gesture(); expect(serverReceipts.size).toBe(1);
});
it('V4-S07 V1 unknown marker stays read-only, preserved in history before a newly confirmed gesture', async () => {
  const legacy = marker(); await AsyncStorage.setItem(key, legacy); mockSold = true;
  const prepared = await prepareArticleSoldChange('article-A', 'A', false); expect(prepared.intent).toBeNull(); expect(prepared.result?.reconciled).toBe(true); expect(set).not.toHaveBeenCalled(); expect(observe).not.toHaveBeenCalled(); prepared.result!.acknowledge();
  await gesture(); expect(JSON.parse((await AsyncStorage.getItem(`${key}:receipts`))!)[0]).toMatchObject(JSON.parse(legacy)); expect(set.mock.calls[0][0]).toMatchObject({ operation: 'set', expectedIsSold: true, desiredIsSold: false });
});
it('V4-S08 failed legacy read keeps exact bytes and repeated recovery has no callable IO', async () => {
  const raw = marker(); await AsyncStorage.setItem(key, raw); mockReadArticle.mockRejectedValue(new Error('offline'));
  await expect(toggleArticleSoldSafely('article-A', 'A')).rejects.toThrow('offline'); await expect(toggleArticleSoldSafely('article-A', 'A')).rejects.toThrow('offline'); expect(await AsyncStorage.getItem(key)).toBe(raw); expect(set).not.toHaveBeenCalled(); expect(observe).not.toHaveBeenCalled();
});
it('V4-S09 observation differing from displayed expectation reconciles without mutation or confirmation', async () => {
  mockSold = true; const p = await prepareArticleSoldChange('article-A', 'A', false); expect(p.intent).toBeNull(); expect(p.result?.article.isSold).toBe(true); expect(p.result?.reconciled).toBe(true); expect(set).not.toHaveBeenCalled(); p.result!.acknowledge(); await gesture(); expect(set).toHaveBeenCalledTimes(1);
});
it('V4-S10 unavailable observation invents no marker and next current action works', async () => {
  observe.mockRejectedValueOnce(new Error('observe offline')); await expect(intent()).rejects.toThrow('observe offline'); expect(await AsyncStorage.getItem(key)).toBeNull(); expect(set).not.toHaveBeenCalled(); await gesture(); expect(set).toHaveBeenCalledTimes(1);
});
it.each(['{broken', '{}', JSON.stringify({ version: 1, uid: 'B', articleId: 'article-A', localId: 'x' }), JSON.stringify({ version: 2, uid: 'A', articleId: 'article-A', localId: 'x', intent: { articleId: 'article-A' } })])('V4-S11 invalid journal %s blocks all remote IO and retains bytes', async raw => {
  await AsyncStorage.setItem(key, raw); await expect(prepareArticleSoldChange('article-A', 'A', false)).rejects.toThrow(); expect(await AsyncStorage.getItem(key)).toBe(raw); expect(set).not.toHaveBeenCalled(); expect(observe).not.toHaveBeenCalled(); expect(mockReadArticle).not.toHaveBeenCalled();
});
it('V4-S12 genuine refusal removes only current pending intention and gives no fabricated success', async () => {
  set.mockRejectedValueOnce(Object.assign(new Error('not allowed'), { code: 'functions/permission-denied' })); await expect(gesture()).rejects.toThrow('not allowed'); expect(await AsyncStorage.getItem(key)).toBeNull(); expect(mockReadArticle).not.toHaveBeenCalled(); await gesture(); expect(set).toHaveBeenCalledTimes(2);
});
it.each(['uid', 'generation', 'dossier'])('V4-S13 %s invalidation during pending intent write prevents set and preserves exact payload', async axis => {
  const i = await intent(); let current = true; const original = (AsyncStorage.setItem as jest.Mock).getMockImplementation()!;
  (AsyncStorage.setItem as jest.Mock).mockImplementationOnce(async(k: string, v: string) => { await original(k, v); if (axis === 'uid') mockUid = 'B'; else if (axis === 'generation') mockGeneration++; else current = false; });
  await expect(toggleArticleSoldSafely('article-A', 'A', () => { if (!current) throw new Error('closed'); }, i)).rejects.toThrow(); expect(set).not.toHaveBeenCalled(); expect(JSON.parse((await AsyncStorage.getItem(key))!).intent).toEqual(i.payload);
});
it('V4-S14 generation change during final read prevents adoption and keeps applied proof', async () => {
  let release!: (a: Article) => void; mockReadArticle.mockImplementationOnce(() => new Promise(resolve => { release = resolve; }));
  const pending = gesture(); await waitFor(() => expect(mockReadArticle).toHaveBeenCalled()); mockGeneration++; release({ id: 'article-A', sellerId: 'A', isSold: true } as Article);
  await expect(pending).rejects.toMatchObject({ code: 'client/stale-operation' }); expect(JSON.parse((await AsyncStorage.getItem(key))!).proof.kind).toBe('applied'); const r = await toggleArticleSoldSafely('article-A', 'A'); expect(r.reconciled).toBe(true); expect(set).toHaveBeenCalledTimes(1);
});
it('V4-S15 old acknowledgement cannot adopt the next pending write, new receipt remains recoverable', async () => {
  const old = await gesture(); old.acknowledge(); const i = await intent(); let release!: () => void; const original = (AsyncStorage.setItem as jest.Mock).getMockImplementation()!;
  (AsyncStorage.setItem as jest.Mock).mockImplementation(async(k: string, v: string) => { if (k === key && !JSON.parse(v).receiptId && !JSON.parse(v).proof) await new Promise<void>(r => { release = r; }); return original(k, v); });
  const pending = toggleArticleSoldSafely('article-A', 'A', undefined, i); await waitFor(() => expect(release).toBeDefined()); expect(() => old.acknowledge()).toThrow('courante'); release(); const next = await pending; expect(() => old.acknowledge()).toThrow('courante'); next.acknowledge();
});
it('V4-S16 wrong seller returned by read never authorizes adoption and keeps proof for retry', async () => {
  mockReadArticle.mockResolvedValueOnce({ id: 'article-A', sellerId: 'B', isSold: true }); await expect(gesture()).rejects.toThrow('vérifier'); expect(JSON.parse((await AsyncStorage.getItem(key))!).proof.kind).toBe('applied'); const r = await toggleArticleSoldSafely('article-A', 'A'); expect(r.reconciled).toBe(true); expect(set).toHaveBeenCalledTimes(1);
});
it('V4-S17 lock covers observation and journal IO while another article has its independent intent', async () => {
  let release!: (v: unknown) => void; observe.mockImplementationOnce(() => new Promise(r => { release = r; })); const first = intent(); await expect(intent()).rejects.toMatchObject({ code: 'client/operation-pending' }); const other = await intent('article-B'); expect(other.payload.articleId).toBe('article-B'); release({ data: { operation: 'observe', articleId: 'article-A', isSold: false, revision: revision() } }); await first;
});

it.each(['success-only','cross-request','applied-revision','replay-null'])('V4-S18 malformed %s receipt is unknown; exact intent survives without proof',async shape=>{
 const i=await intent();let data:Record<string,unknown>={success:true,operation:'set',outcome:'applied',articleId:i.payload.articleId,requestId:i.payload.requestId,isSold:true,revision:null};
 if(shape==='success-only')data={success:true};if(shape==='cross-request')data.requestId='other';if(shape==='applied-revision')data.revision=revision();if(shape==='replay-null')data.outcome='replayed';
 set.mockResolvedValueOnce({data});await expect(toggleArticleSoldSafely('article-A','A',undefined,i)).rejects.toThrow('réception');const journal=JSON.parse((await AsyncStorage.getItem(key))!);expect(journal.intent).toEqual(i.payload);expect(journal.proof).toBeUndefined();expect(mockReadArticle).not.toHaveBeenCalled();
 const r=await toggleArticleSoldSafely('article-A','A');expect(r.reconciled).toBe(true);expect(set.mock.calls[1][0]).toEqual(i.payload);
});
it.each(['code','article','request','applied','revision'])('V4-S19 malformed superseded %s cannot become historical proof or discard an unknown request',async axis=>{
 const i=await intent();const details={reason:'article_sold_intent_superseded',action:'refreshArticle',articleId:i.payload.articleId,requestId:i.payload.requestId,appliedIsSold:true,currentIsSold:false,currentRevision:revision()};
 if(axis==='article')details.articleId='other';if(axis==='request')details.requestId='other';if(axis==='applied')details.appliedIsSold=false;if(axis==='revision')details.currentRevision='bad';
 set.mockRejectedValueOnce(Object.assign(new Error('malformed'),{code:axis==='code'?'functions/unavailable':'functions/failed-precondition',details}));
 await expect(toggleArticleSoldSafely('article-A','A',undefined,i)).rejects.toThrow('malformed');expect(JSON.parse((await AsyncStorage.getItem(key))!).intent).toEqual(i.payload);expect(JSON.parse((await AsyncStorage.getItem(key))!).proof).toBeUndefined();expect(mockReadArticle).not.toHaveBeenCalled();
});
