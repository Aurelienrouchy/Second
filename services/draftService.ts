import AsyncStorage from '@react-native-async-storage/async-storage';
import * as FileSystem from 'expo-file-system/legacy';
import { AIAnalysisResult } from '@/types/ai';
import { MeetupNeighborhood } from '@/types';
import { auth } from '@/config/firebaseConfig';
import { onAuthStateChanged } from 'firebase/auth';
import { deleteDraftImagesFromStorage } from './aiService';

// New drafts are isolated by account. Never inspect or migrate the legacy
// '@article_draft' key or files directly under draft_images/.
const DRAFT_KEY_PREFIX = '@article_draft:user:';
const DRAFT_IMAGES_ROOT = `${FileSystem.documentDirectory}draft_images/`;
interface DraftSession { uid: string; generation: number }
function validateDraftOwnerUid(uid: string): void {
  // Firebase generated IDs fit this subset. Reject unusual custom IDs rather
  // than let file:// path normalization escape the owner's cache directory.
  if (!/^[A-Za-z0-9_-]{1,128}$/.test(uid)) throw new Error('Unsupported draft account identifier');
}
const draftKey = (uid: string) => `${DRAFT_KEY_PREFIX}${encodeURIComponent(uid)}`;
const imageDirectory = (uid: string) => `${DRAFT_IMAGES_ROOT}${encodeURIComponent(uid)}/`;

// Draft expiration: 14 days
const DRAFT_EXPIRATION_DAYS = 14;

export interface DraftFields {
  title: string;
  description: string;
  categoryIds: string[];
  categoryDisplay: { icon: string; name: string; context: string };
  condition: string;
  // New multi-select fields
  colors: string[];
  materials: string[];
  brands: string[];
  // Legacy single-value fields (for backwards compatibility)
  color?: string | null;
  material?: string | null;
  brand?: string;
  // Size remains single-select
  size: string | null;
}

export interface DraftPricing {
  price: number | null;
  isHandDelivery: boolean;
  isShipping: boolean;
  /** @deprecated Use neighborhoods instead */
  neighborhood: MeetupNeighborhood | null;
  neighborhoods: MeetupNeighborhood[];
  packageSize: string | null;
}

export interface ArticleDraft {
  id: string;
  ownerUid: string;
  createdAt: string;
  updatedAt: string;
  currentStep: number; // 1-4
  photos: string[]; // Local cached URIs (legacy)
  originalPhotoUris: string[]; // Original URIs for reference
  storageUrls: string[]; // Canonical private media references; promoted server-side on publication. Legacy draft URLs are read without rewriting historical data.
  fields: DraftFields | null;
  pricing: DraftPricing | null;
  aiResult: AIAnalysisResult | null;
}

// Generate unique ID
function generateDraftId(): string {
  return `draft_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
}

// Create empty draft
export function createEmptyDraft(): ArticleDraft {
  const ownerUid = auth.currentUser?.uid;
  if (!ownerUid) throw new Error('Authentication required for draft');
  validateDraftOwnerUid(ownerUid);
  const now = new Date().toISOString();
  return {
    id: generateDraftId(),
    ownerUid,
    createdAt: now,
    updatedAt: now,
    currentStep: 1,
    photos: [],
    originalPhotoUris: [],
    storageUrls: [], // Firebase Storage URLs
    fields: null,
    pricing: null,
    aiResult: null,
  };
}

// Check if draft is expired
function isDraftExpired(draft: ArticleDraft): boolean {
  const createdAt = new Date(draft.createdAt);
  const expirationDate = new Date(createdAt);
  expirationDate.setDate(expirationDate.getDate() + DRAFT_EXPIRATION_DAYS);
  const now = new Date();
  const expired = now > expirationDate;
  if (__DEV__) console.log('[DraftService] isDraftExpired check:', {
    createdAt: draft.createdAt,
    expirationDate: expirationDate.toISOString(),
    now: now.toISOString(),
    expired
  });
  return expired;
}

// Get days until expiration
export function getDaysUntilExpiration(draft: ArticleDraft): number {
  const createdAt = new Date(draft.createdAt);
  const expirationDate = new Date(createdAt);
  expirationDate.setDate(expirationDate.getDate() + DRAFT_EXPIRATION_DAYS);
  const diffTime = expirationDate.getTime() - new Date().getTime();
  return Math.max(0, Math.ceil(diffTime / (1000 * 60 * 60 * 24)));
}

class DraftService {
  private saveDebounceTimer: ReturnType<typeof setTimeout> | null = null;
  private readonly DEBOUNCE_MS = 500;
  private updateQueue: Promise<unknown> = Promise.resolve();
  private discardedDraftIds = new Set<string>();
  private sessionUid: string | null = auth.currentUser?.uid ?? null;
  private sessionGeneration = 0;

  constructor() {
    // Invalidate in-flight work even if an account changes away and back before
    // its next await completes. No persistent data is removed on sign-out.
    onAuthStateChanged(auth, user => this.observeAccount(user?.uid ?? null));
  }

  private observeAccount(uid: string | null): void {
    if (this.sessionUid === uid) return;
    this.sessionUid = uid;
    this.sessionGeneration++;
    this.published = false;
    if (this.saveDebounceTimer) clearTimeout(this.saveDebounceTimer);
    this.saveDebounceTimer = null;
  }

  private session(): DraftSession {
    this.observeAccount(auth.currentUser?.uid ?? null);
    if (!this.sessionUid) throw new Error('Authentication required for draft');
    validateDraftOwnerUid(this.sessionUid);
    return { uid: this.sessionUid, generation: this.sessionGeneration };
  }

  private assertSession(session: DraftSession, draft?: ArticleDraft): void {
    this.observeAccount(auth.currentUser?.uid ?? null);
    if (this.sessionUid !== session.uid || this.sessionGeneration !== session.generation) {
      throw new Error('Account changed during draft operation');
    }
    if (draft && draft.ownerUid !== session.uid) throw new Error('Draft belongs to another account');
    if (draft?.photos.some(uri => uri.startsWith(DRAFT_IMAGES_ROOT) && !uri.startsWith(imageDirectory(session.uid)))) {
      throw new Error('Photo belongs to another draft cache');
    }
  }

  /** Screen callbacks keep the owner captured when their media was selected. */
  assertCurrentOwner(ownerUid: string | undefined): void {
    const session = this.session();
    if (ownerUid !== session.uid) throw new Error('Account changed during draft operation');
  }

  private discardedKey(draft: ArticleDraft): string { return `${draft.ownerUid}/${draft.id}`; }

  private async cacheImage(uri: string, draftId: string, index: number, session: DraftSession): Promise<string> {
    this.assertSession(session);
    const directory = imageDirectory(session.uid);
    // A source in another account's cache (including the old global cache) must
    // never be read or adopted by this account.
    if (uri.startsWith(DRAFT_IMAGES_ROOT) && !uri.startsWith(directory)) {
      throw new Error('Photo belongs to another draft cache');
    }
    if (uri.startsWith(directory)) return uri;
    const dirInfo = await FileSystem.getInfoAsync(directory);
    this.assertSession(session);
    if (!dirInfo.exists) await FileSystem.makeDirectoryAsync(directory, { intermediates: true });
    this.assertSession(session);
    const extension = uri.split('.').pop()?.split('?')[0] || 'jpg';
    const filename = `${draftId}_${index}_${Date.now()}_${Math.random().toString(36).slice(2, 9)}.${extension}`;
    const localUri = `${directory}${filename}`;
    try {
      await FileSystem.copyAsync({ from: uri, to: localUri });
      this.assertSession(session);
      return localUri;
    } catch (error) {
      this.assertSession(session);
      if (__DEV__) console.warn('Failed to cache draft image');
      // Persist only owned cache files; a failed copy must not retain an
      // unscoped on-device reference that a later session could resume.
      throw error;
    }
  }

  private async deleteCachedImages(draftId: string, session: DraftSession): Promise<void> {
    const directory = imageDirectory(session.uid);
    this.assertSession(session);
    const info = await FileSystem.getInfoAsync(directory);
    this.assertSession(session);
    if (!info.exists) return;
    const files = await FileSystem.readDirectoryAsync(directory);
    this.assertSession(session);
    for (const file of files.filter(name => name.startsWith(`${draftId}_`) && !name.includes('/'))) {
      this.assertSession(session);
      await FileSystem.deleteAsync(`${directory}${file}`, { idempotent: true });
      this.assertSession(session);
    }
  }

  // Merge each edit with the latest saved draft, in order. A delayed fields
  // save must never restore photo order from an older screen snapshot.
  private mutateDraft(
    fallback: ArticleDraft,
    update: (latest: ArticleDraft) => ArticleDraft | Promise<ArticleDraft>,
  ): Promise<ArticleDraft> {
    const session = this.session();
    this.assertSession(session, fallback);
    const operation = this.updateQueue.then(async () => {
      this.assertSession(session, fallback);
      if (this.discardedDraftIds.has(this.discardedKey(fallback))) throw new Error('Draft was discarded');
      const stored = await AsyncStorage.getItem(draftKey(session.uid));
      this.assertSession(session);
      const parsed: ArticleDraft | null = stored ? JSON.parse(stored) : null;
      if (parsed) this.assertSession(session, parsed);
      if (parsed && parsed.id !== fallback.id) throw new Error('Draft was replaced');
      const latest = parsed ?? fallback;
      const updated = { ...await update(latest), updatedAt: new Date().toISOString() };
      this.assertSession(session, updated);
      if (this.discardedDraftIds.has(this.discardedKey(updated))) throw new Error('Draft was discarded');
      await this.saveDraft(updated);
      this.assertSession(session);
      return updated;
    });
    this.updateQueue = operation.catch(() => undefined);
    return operation;
  }
  // True le temps d'un flux après publication réussie : le guard beforeRemove de
  // l'écran details s'en sert pour ne pas afficher l'alerte "Quitter ?" alors que
  // le brouillon a déjà été supprimé. Ré-armé (false) à chaque édition / entrée de flux.
  private published = false;

  markPublished(): void {
    this.session();
    this.published = true;
  }

  get wasPublished(): boolean {
    this.observeAccount(auth.currentUser?.uid ?? null);
    return this.published;
  }

  /**
   * Save draft to AsyncStorage
   */
  async saveDraft(draft: ArticleDraft): Promise<void> {
    const session = this.session();
    this.assertSession(session, draft);
    // Toute activité d'édition ré-arme le guard pour le prochain flux.
    this.published = false;
    try {
      const draftToSave = {
        ...draft,
        updatedAt: new Date().toISOString(),
      };
      this.assertSession(session, draftToSave);
      await AsyncStorage.setItem(draftKey(session.uid), JSON.stringify(draftToSave));
      this.assertSession(session);
    } catch (error) {
      if (__DEV__) console.error('Failed to save draft:', error);
      throw error;
    }
  }

  /**
   * Save draft with debouncing (for field edits)
   */
  saveDraftDebounced(draft: ArticleDraft): void {
    if (this.saveDebounceTimer) {
      clearTimeout(this.saveDebounceTimer);
    }
    const session = this.session();
    this.assertSession(session, draft);
    this.saveDebounceTimer = setTimeout(() => {
      this.saveDebounceTimer = null;
      try { this.assertSession(session, draft); } catch { return; }
      void this.saveDraft(draft).catch(() => {
        if (__DEV__) console.warn('Draft autosave interrupted');
      });
    }, this.DEBOUNCE_MS);
  }

  /**
   * Load draft from AsyncStorage
   */
  async loadDraft(): Promise<ArticleDraft | null> {
    // Entrée de flux : ré-arme le guard (ceinture+bretelles avec saveDraft).
    this.published = false;
    if (__DEV__) console.log('[DraftService] loadDraft() START');
    try {
      if (!auth.currentUser) return null;
      const session = this.session();
      if (__DEV__) console.log('[DraftService] Getting item from AsyncStorage...');
      const draftJson = await AsyncStorage.getItem(draftKey(session.uid));
      this.assertSession(session);
      if (__DEV__) console.log('[DraftService] AsyncStorage returned:', draftJson ? 'has data' : 'null');

      if (!draftJson) {
        if (__DEV__) console.log('[DraftService] No draft found, returning null');
        return null;
      }

      const draft: ArticleDraft = JSON.parse(draftJson);
      this.assertSession(session, draft);
      if (__DEV__) console.log('[DraftService] Draft parsed, id:', draft.id, 'createdAt:', draft.createdAt);

      // Check expiration
      const expired = isDraftExpired(draft);
      if (__DEV__) console.log('[DraftService] Draft expired?', expired);

      if (expired) {
        if (__DEV__) console.log('[DraftService] Draft is expired, calling deleteDraft()...');
        await this.deleteDraft();
        if (__DEV__) console.log('[DraftService] deleteDraft() completed, returning null');
        return null;
      }

      if (__DEV__) console.log('[DraftService] Returning valid draft');
      return draft;
    } catch (error) {
      if (__DEV__) console.error('[DraftService] Failed to load draft:', error);
      return null;
    }
  }

  /**
   * Delete draft from AsyncStorage and cleanup images (local + Storage)
   * NOTE: Reads AsyncStorage directly to avoid circular recursion with loadDraft()
   * @param keepStorageImages - If true, don't delete images from Firebase Storage (used after publishing)
   */
  async deleteDraft(keepStorageImages: boolean = false): Promise<void> {
    if (!auth.currentUser) return;
    const session = this.session();
    if (this.saveDebounceTimer) clearTimeout(this.saveDebounceTimer);
    this.saveDebounceTimer = null;
    await this.updateQueue;
    if (__DEV__) console.log('[DraftService] deleteDraft() START, keepStorageImages:', keepStorageImages);
    try {
      // Read directly from AsyncStorage - DO NOT call loadDraft() here!
      // loadDraft() calls deleteDraft() for expired drafts, causing infinite recursion
      if (__DEV__) console.log('[DraftService] Reading AsyncStorage directly...');
      this.assertSession(session);
      const draftJson = await AsyncStorage.getItem(draftKey(session.uid));
      this.assertSession(session);
      if (__DEV__) console.log('[DraftService] deleteDraft got draftJson:', draftJson ? 'has data' : 'null');

      if (draftJson) {
        const draft: ArticleDraft = JSON.parse(draftJson);
        this.assertSession(session, draft);
        this.discardedDraftIds.add(this.discardedKey(draft));
        if (__DEV__) console.log('[DraftService] Deleting cached images for draft:', draft.id);

        // Delete local cached images
        await this.deleteCachedImages(draft.id, session);
        this.assertSession(session);
        if (__DEV__) console.log('[DraftService] Local cached images deleted');

        // Delete images from Firebase Storage (unless we're keeping them for a published article)
        if (!keepStorageImages && draft.storageUrls && draft.storageUrls.length > 0) {
          if (__DEV__) console.log('[DraftService] Deleting Storage images for draft:', draft.id);
          this.assertSession(session);
          await deleteDraftImagesFromStorage(draft.id, session.uid);
          this.assertSession(session);
          if (__DEV__) console.log('[DraftService] Storage images deleted');
        } else if (keepStorageImages) {
          if (__DEV__) console.log('[DraftService] Keeping Storage images for published article');
        }
      }

      if (__DEV__) console.log('[DraftService] Removing draft from AsyncStorage...');
      this.assertSession(session);
      await AsyncStorage.removeItem(draftKey(session.uid));
      this.assertSession(session);
      if (__DEV__) console.log('[DraftService] deleteDraft() COMPLETE');
    } catch (error) {
      if (__DEV__) console.error('[DraftService] Failed to delete draft:', error);
    }
  }

  /**
   * Check if draft exists
   */
  async hasDraft(): Promise<boolean> {
    return (await this.loadDraft()) !== null;
  }

  /**
   * Cache photos locally for draft persistence
   */
  async cachePhotos(
    photos: string[],
    draftId: string
  ): Promise<string[]> {
    const session = this.session();
    const cachedUris: string[] = [];
    for (let i = 0; i < photos.length; i++) {
      this.assertSession(session);
      const cachedUri = await this.cacheImage(photos[i], draftId, i, session);
      this.assertSession(session);
      cachedUris.push(cachedUri);
    }
    return cachedUris;
  }

  /**
   * Update draft photos and cache them
   */
  async updateDraftPhotos(
    draft: ArticleDraft,
    newPhotos: string[],
    storageUrls?: string[],
  ): Promise<ArticleDraft> {
    return this.mutateDraft(draft, async (latest) => {
      const photoIndices = newPhotos.map((uri) => {
        const cachedIndex = latest.photos.indexOf(uri);
        return cachedIndex >= 0 ? cachedIndex : latest.originalPhotoUris.indexOf(uri);
      });
      const knownUrls = photoIndices.map((index) => latest.storageUrls[index]);
      const alignedUrls = storageUrls ?? (
        photoIndices.every(index => index >= 0) && knownUrls.every(Boolean) ? knownUrls : []
      );
      const cacheSources = newPhotos.map((uri, index) =>
        photoIndices[index] >= 0 ? latest.photos[photoIndices[index]] : uri,
      );
      const cachedPhotos = await this.cachePhotos(cacheSources, latest.id);
      return {
        ...latest,
        photos: cachedPhotos,
        originalPhotoUris: newPhotos,
        storageUrls: alignedUrls.length === newPhotos.length ? alignedUrls : [],
        // Capture changes introducing new media invalidate the old analysis.
        aiResult: storageUrls === undefined && photoIndices.some(index => index < 0) ? null : latest.aiResult,
      };
    });
  }

  /** Update fields without overwriting newer media or pricing edits. */
  async updateDraftFields(draft: ArticleDraft, fields: DraftFields): Promise<ArticleDraft> {
    return this.mutateDraft(draft, latest => ({
      ...latest, fields, currentStep: Math.max(latest.currentStep, 2),
    }));
  }

  async updateDraftPricing(draft: ArticleDraft, pricing: DraftPricing): Promise<ArticleDraft> {
    return this.mutateDraft(draft, latest => ({
      ...latest, pricing, currentStep: Math.max(latest.currentStep, 3),
    }));
  }

  async updateDraftAIResult(
    draft: ArticleDraft,
    aiResult: AIAnalysisResult,
    storageUrls?: string[],
  ): Promise<ArticleDraft> {
    return this.mutateDraft(draft, latest => ({
      ...latest, aiResult, storageUrls: storageUrls ?? latest.storageUrls,
    }));
  }

  async updateDraftStorageUrls(draft: ArticleDraft, storageUrls: string[]): Promise<ArticleDraft> {
    return this.mutateDraft(draft, latest => ({ ...latest, storageUrls }));
  }

  async updateDraftStep(draft: ArticleDraft, step: number): Promise<ArticleDraft> {
    return this.mutateDraft(draft, latest => ({ ...latest, currentStep: step }));
  }

  /**
   * Cleanup expired drafts and orphaned images (local + Storage)
   * Call this on app startup
   */
  async cleanupExpiredDrafts(): Promise<void> {
    if (!auth.currentUser) return;
    const session = this.session();
    try {
      const draft = await this.loadDraft();
      this.assertSession(session);
      const directory = imageDirectory(session.uid);
      const info = await FileSystem.getInfoAsync(directory);
      this.assertSession(session);
      if (!info.exists) return;
      const files = await FileSystem.readDirectoryAsync(directory);
      this.assertSession(session);
      const orphans = files.filter(file => !file.includes('/') && (!draft || !file.startsWith(`${draft.id}_`)));
      for (const file of orphans) {
        this.assertSession(session);
        await FileSystem.deleteAsync(`${directory}${file}`, { idempotent: true });
        this.assertSession(session);
      }
    } catch {
      if (__DEV__) console.warn('Draft cleanup interrupted');
    }
  }

  /**
   * Check if draft has Storage URLs (images already uploaded)
   */
  hasStorageUrls(draft: ArticleDraft): boolean {
    return draft.storageUrls && draft.storageUrls.length > 0;
  }
}

// Export singleton instance
export const draftService = new DraftService();
export default draftService;
