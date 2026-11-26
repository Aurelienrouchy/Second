import { getEnvironmentStorageKey } from '@/config/firebaseEnvironment';
import { getEnvironmentFileDirectory } from '@/utils/environmentStorage';
import AsyncStorage from '@react-native-async-storage/async-storage';
import type { ArticleDraft } from '@/features/sell/services/draftService';
const mockAuth: { currentUser: { uid: string } | null } = { currentUser: { uid: 'A' } };
let mockListener: ((user: { uid: string } | null) => void) | undefined;
const mockDeleteLocal = jest.fn();
const mockDeleteRemote = jest.fn();
jest.mock('@/config/firebaseConfig', () => ({ auth: mockAuth }));
jest.mock('firebase/auth', () => ({ onAuthStateChanged: (_auth: unknown, listener: typeof mockListener) => { mockListener = listener; return jest.fn(); } }));
jest.mock('expo-file-system/legacy', () => ({ documentDirectory: 'file:///documents/', getInfoAsync: async () => ({ exists: true }), readDirectoryAsync: async () => [], deleteAsync: (...args: unknown[]) => mockDeleteLocal(...args) }));
jest.mock('@/features/sell/services/aiService', () => ({ deleteDraftImagesFromStorage: (...args: unknown[]) => mockDeleteRemote(...args) }));
const { draftService } = require('@/features/sell/services/draftService') as typeof import('@/features/sell/services/draftService');
const key = getEnvironmentStorageKey('@article_draft:user:A');
function switchTo(uid: string | null) { mockAuth.currentUser = uid ? { uid } : null; mockListener?.(mockAuth.currentUser); }
const draft = (id = 'original'): ArticleDraft => ({ id, ownerUid: 'A', createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(), currentStep: 4, photos: [`file:///documents/${getEnvironmentFileDirectory('draft_images')}/A/original_1.jpg`], originalPhotoUris: [], storageUrls: ['https://firebasestorage.googleapis.com/original.jpg'], fields: null, pricing: null, aiResult: null });
beforeEach(async () => { jest.clearAllMocks(); switchTo('A'); await AsyncStorage.clear(); });

it('rejects the original generation after A-B-A even with the same UID', async () => {
  const context = draftService.captureSession(); await draftService.saveDraft(draft()); const original = (await draftService.loadDraft())!;
  switchTo('B'); switchTo('A'); await draftService.saveDraft(draft('replacement')); const saved = await AsyncStorage.getItem(key);
  await expect(draftService.deletePublishedDraft(original, context)).rejects.toThrow('Account changed');
  expect(await AsyncStorage.getItem(key)).toBe(saved); expect(draftService.wasPublished).toBe(false);
  expect(mockDeleteLocal).not.toHaveBeenCalled(); expect(mockDeleteRemote).not.toHaveBeenCalled();
});

it('keeps another draft and another version of the same draft', async () => {
  const context = draftService.captureSession(); await draftService.saveDraft(draft()); const original = (await draftService.loadDraft())!;
  await draftService.saveDraft({ ...original, currentStep: 3 }); const changed = await AsyncStorage.getItem(key);
  expect(await draftService.deletePublishedDraft(original, context)).toBe(false); expect(await AsyncStorage.getItem(key)).toBe(changed);
  await draftService.saveDraft(draft('replacement')); const replacement = await AsyncStorage.getItem(key);
  expect(await draftService.deletePublishedDraft(original, context)).toBe(false); expect(await AsyncStorage.getItem(key)).toBe(replacement);
});

it('removes the exact confirmed draft and keeps every potentially shared cache/Storage photo', async () => {
  const context = draftService.captureSession(); await draftService.saveDraft(draft()); const original = (await draftService.loadDraft())!;
  expect(await draftService.deletePublishedDraft(original, context)).toBe(true);
  expect(await AsyncStorage.getItem(key)).toBeNull(); expect(mockDeleteLocal).not.toHaveBeenCalled(); expect(mockDeleteRemote).not.toHaveBeenCalled();
  draftService.markPublished(context); expect(draftService.wasPublished).toBe(true);
});

it('keeps a replacement scheduled during the conditional read and cannot mark the new work published', async () => {
  const context = draftService.captureSession(); await draftService.saveDraft(draft()); const original = (await draftService.loadDraft())!;
  const get = (AsyncStorage.getItem as jest.Mock).getMockImplementation()!;
  let release!: () => void;
  (AsyncStorage.getItem as jest.Mock).mockImplementationOnce(async (...args: unknown[]) => { await new Promise<void>(r => { release = r; }); return get(...args); });
  const deleting = draftService.deletePublishedDraft(original, context);
  const replacement = draft('replacement'); const saving = draftService.saveDraft(replacement);
  release(); expect(await deleting).toBe(false); await saving;
  expect(JSON.parse((await AsyncStorage.getItem(key))!).id).toBe('replacement');
  expect(() => draftService.markPublished(context)).toThrow('Draft changed'); expect(draftService.wasPublished).toBe(false);
});

it('rechecks storage after the first read when an external writer replaces the snapshot', async () => {
  const context = draftService.captureSession(); await draftService.saveDraft(draft()); const original = (await draftService.loadDraft())!;
  const get = (AsyncStorage.getItem as jest.Mock).getMockImplementation()!;
  const replacement = JSON.stringify(draft('external-replacement'));
  (AsyncStorage.getItem as jest.Mock).mockImplementationOnce(async (...args: unknown[]) => { const before = await get(...args); await AsyncStorage.setItem(key, replacement); return before; });
  expect(await draftService.deletePublishedDraft(original, context)).toBe(false); expect(await AsyncStorage.getItem(key)).toBe(replacement);
});

it('rejects logout during a conditional read and leaves its draft byte exact', async () => {
  const context = draftService.captureSession(); await draftService.saveDraft(draft()); const original = (await draftService.loadDraft())!;
  const saved = await AsyncStorage.getItem(key); let release!: () => void;
  (AsyncStorage.getItem as jest.Mock).mockImplementationOnce(async () => { await new Promise<void>(r => { release = r; }); return saved; });
  const deleting = draftService.deletePublishedDraft(original, context); const rejected = expect(deleting).rejects.toThrow('Account changed');
  switchTo(null); release(); await rejected;
  expect(await AsyncStorage.getItem(key)).toBe(saved); expect(AsyncStorage.removeItem).not.toHaveBeenCalled();
});

it('serializes a replacement queued while removeItem is already dispatched and refuses late success', async () => {
  const context = draftService.captureSession(); await draftService.saveDraft(draft()); const original = (await draftService.loadDraft())!;
  const remove = (AsyncStorage.removeItem as jest.Mock).getMockImplementation()!; let release!: () => void;
  (AsyncStorage.removeItem as jest.Mock).mockImplementationOnce(async (...args: unknown[]) => { await new Promise<void>(r => { release = r; }); return remove(...args); });
  const deleting = draftService.deletePublishedDraft(original, context);
  while (!(AsyncStorage.removeItem as jest.Mock).mock.calls.length) await Promise.resolve();
  const saving = draftService.saveDraft(draft('replacement')); release();
  expect(await deleting).toBe(false); await saving;
  expect(JSON.parse((await AsyncStorage.getItem(key))!).id).toBe('replacement');
  expect(() => draftService.markPublished(context)).toThrow(); expect(mockDeleteLocal).not.toHaveBeenCalled();
});

it('returns the exact persisted draft version when the clock advances between mutation and save', async () => {
  jest.useFakeTimers();
  const iso = Date.prototype.toISOString;
  const tick = jest.spyOn(Date.prototype, 'toISOString').mockImplementation(function (this: Date) {
    const result = iso.call(this);
    jest.advanceTimersByTime(1);
    return result;
  });
  try {
    await draftService.saveDraft({ ...draft('advancing-clock'), currentStep: 3 });
    const initial = (await draftService.loadDraft())!;
    const before = Date.now();
    const updated = await draftService.updateDraftStep(initial, 4);
    expect(Date.now()).toBeGreaterThan(before);
    const persisted = await AsyncStorage.getItem(key);
    expect(JSON.stringify(updated)).toBe(persisted);
    expect(await draftService.deletePublishedDraft(updated, draftService.captureSession())).toBe(true);
  } finally { tick.mockRestore(); jest.useRealTimers(); }
});
