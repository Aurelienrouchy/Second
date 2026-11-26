import AsyncStorage from '@/utils/environmentStorage';
import { getEnvironmentFileDirectory } from '@/utils/environmentStorage';
import * as FileSystem from 'expo-file-system/legacy';
import { AIAnalysisResult } from '@/types/ai';
import { MeetupNeighborhood, SizeSystem } from '@/types';
import type { ArticleChildSafetyDraft } from '@/types/articleChildSafety';
import type { ArticleHygieneDeclarationInput } from '@/functions/src/shared/articleHygiene';
import { auth } from '@/config/firebaseConfig';
import { onAuthStateChanged } from 'firebase/auth';
import { deleteDraftImagesFromStorage } from './aiService';
import { resolveDraftPhotoUri } from '../utils/draftPhotoUri';

// New drafts are isolated by account. Never inspect or migrate the legacy
// '@article_draft' key or files directly under draft_images/.
const DRAFT_KEY_PREFIX = '@article_draft:user:';
const ALL_DRAFT_IMAGES_ROOT = `${FileSystem.documentDirectory}draft_images/`;
const DRAFT_IMAGES_ROOT = `${FileSystem.documentDirectory}${getEnvironmentFileDirectory('draft_images')}/`;
export interface DraftSession { readonly uid: string; readonly generation: number }
function validateDraftOwnerUid(uid: string): void {
  // Firebase generated IDs fit this subset. Reject unusual custom IDs rather
  // than let file:// path normalization escape the owner's cache directory.
  if (!/^[A-Za-z0-9_-]{1,128}$/.test(uid)) throw new Error('Unsupported draft account identifier');
}
const draftKey = (uid: string) => `${DRAFT_KEY_PREFIX}${encodeURIComponent(uid)}`;
const imageDirectory = (uid: string) => `${DRAFT_IMAGES_ROOT}${encodeURIComponent(uid)}/`;

// Local draft expiration: 14 days. This does not purge remote originals.
const DRAFT_EXPIRATION_DAYS = 14;

export interface DraftFields {
  title: string;
  description: string;
  categoryIds: string[];
  categoryDisplay: { icon: string; name: string; context: string };
  condition: string;
  quantity?: number;
  stock?: number;
  childSafetyDeclaration?: ArticleChildSafetyDraft | null;
  /** An AI suggestion or historical default is not the seller's declaration. */
  conditionConfirmed?: boolean;
  /** Explicit seller choices, preserved across draft navigation; never supplied by AI. */
  hygieneDeclaration?: ArticleHygieneDeclarationInput | null;
  hygieneKind?: ArticleHygieneDeclarationInput['kind'] | null;
  // New multi-select fields
  colors: string[];
  materials: string[];
  brands: string[];
  // Legacy single-value fields (for backwards compatibility)
  color?: string | null;
  material?: string | null;
  brand?: string | null;
  // Size remains single-select
  size: string | null;
  sizeSystem?: SizeSystem;
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
  return expired;
}

// Get days until expiration
export function getDaysUntilExpiration(draft: ArticleDraft): number {
  const createdAt = new Date(draft.createdAt);
  const expirationDate = new Date(createdAt);
  expirationDate.setDate(expirationDate.getDate() + DRAFT_EXPIRATION_DAYS);
  const now = new Date();
  if (expirationDate.getTime() <= now.getTime()) return 0;
  // Count local wall-clock days: a DST change adds/removes an elapsed hour,
  // but does not add/remove a calendar day from the existing expiry policy.
  const offsetChange = (expirationDate.getTimezoneOffset() - now.getTimezoneOffset()) * 60 * 1000;
  const diffTime = expirationDate.getTime() - now.getTime() - offsetChange;
  return Math.max(0, Math.ceil(diffTime / (1000 * 60 * 60 * 24)));
}

/**
 * True when a draft holds work worth resuming: photos, uploaded images or an
 * analysis. The two « Vendre » entries (iOS overlay, Android tab) each had
 * their own test and had drifted apart.
 */
export function hasDraftProgress(draft: ArticleDraft | null): boolean {
  return !!draft && (draft.photos.length > 0 || draft.storageUrls.length > 0 || !!draft.aiResult);
}

/**
 * True when the draft's analysis and uploaded images describe exactly
 * `photos` — same files, same order — and can be reused without a new
 * analysis. Comparing the NUMBER of photos only re-used, for new photos, the
 * images and the text of a previous article.
 */
export function analysisMatchesPhotos(draft: ArticleDraft | null, photos: string[]): boolean {
  return (
    !!draft?.aiResult &&
    draft.storageUrls.length === photos.length &&
    draft.photos.length === photos.length &&
    draft.photos.every((uri, i) => uri === photos[i])
  );
}

class DraftService {
  private saveDebounceTimer: ReturnType<typeof setTimeout> | null = null;
  private readonly DEBOUNCE_MS = 500;
  private updateQueue: Promise<unknown> = Promise.resolve();
  private storageQueue: Promise<unknown> | null = null;
  private draftWriteRevision = 0;
  private publishedDraftProof: { session: DraftSession; revision: number } | null = null;
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
    this.publishedDraftProof = null;
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
    if (draft?.photos.some(uri => uri.startsWith(ALL_DRAFT_IMAGES_ROOT) && !uri.startsWith(imageDirectory(session.uid)))) {
      throw new Error('Photo belongs to another draft cache');
    }
    for (const uri of draft?.photos ?? []) {
      resolveDraftPhotoUri({uri, documentDirectory: FileSystem.documentDirectory,
        cacheDirectory: getEnvironmentFileDirectory('draft_images'), ownerUid: session.uid, draftId: draft!.id});
    }
  }

  /** Capture the generation observed by this module's actual SDK listener. */
  captureSession(): DraftSession { return this.session(); }

  assertCurrentSession(session: DraftSession): void { this.assertSession(session); }

  private withStorageLock<T>(operation: () => Promise<T>): Promise<T> {
    const running = this.storageQueue ? this.storageQueue.then(operation) : operation();
    const tail = running.catch(() => undefined);
    this.storageQueue = tail;
    void tail.then(() => { if (this.storageQueue === tail) this.storageQueue = null; });
    return running;
  }

  /** A publication may only remove the exact version it submitted. All writes
   * through this service serialize with the read/cleanup/remove sequence. */
  async deletePublishedDraft(draft: ArticleDraft, session: DraftSession): Promise<boolean> {
    this.assertSession(session, draft);
    const expected = JSON.stringify(draft);
    const revision = this.draftWriteRevision;
    return this.withStorageLock(async () => {
      this.assertSession(session, draft);
      const stored = await AsyncStorage.getItem(draftKey(session.uid));
      this.assertSession(session, draft);
      if (stored !== expected || revision !== this.draftWriteRevision) return false;
      // Cache files can be reused by a new local version while this operation
      // is finishing. Keep them for the existing orphan cleanup rather than
      // delete a possibly shared local URI during an irreversible await.
      // Defensive re-read also detects storage writes outside this service.
      const current = await AsyncStorage.getItem(draftKey(session.uid));
      this.assertSession(session, draft);
      if (current !== expected || revision !== this.draftWriteRevision) return false;
      await AsyncStorage.removeItem(draftKey(session.uid));
      this.assertSession(session, draft);
      if (revision !== this.draftWriteRevision) return false;
      this.discardedDraftIds.add(this.discardedKey(draft));
      this.publishedDraftProof = { session, revision };
      return true;
    });
  }

  /** Screen callbacks keep the owner captured when their media was selected. */
  assertCurrentOwner(ownerUid: string | undefined): void {
    const session = this.session();
    if (ownerUid !== session.uid) throw new Error('Account changed during draft operation');
  }

  private discardedKey(draft: ArticleDraft): string { return `${draft.ownerUid}/${draft.id}`; }

  private async resolveCachedPhotos(draft: ArticleDraft, session: DraftSession): Promise<ArticleDraft> {
    this.assertSession(session, draft);
    const replacements = new Map<string, string>();
    for (const uri of draft.photos) {
      const current = resolveDraftPhotoUri({uri, documentDirectory: FileSystem.documentDirectory,
        cacheDirectory: getEnvironmentFileDirectory('draft_images'), ownerUid: session.uid, draftId: draft.id});
      if (current === uri) continue;
      const info = await FileSystem.getInfoAsync(current);
      this.assertSession(session, draft);
      if (!info.exists || info.isDirectory) throw new Error('Une photo du brouillon est indisponible. Sélectionnez-la de nouveau.');
      replacements.set(uri, current);
    }
    if (!replacements.size) return draft;
    return {...draft, photos: draft.photos.map(uri => replacements.get(uri) ?? uri),
      originalPhotoUris: draft.originalPhotoUris.map(uri => replacements.get(uri) ?? uri)};
  }

  private async cacheImage(uri: string, draftId: string, index: number, session: DraftSession): Promise<string> {
    this.assertSession(session);
    const resolved = resolveDraftPhotoUri({uri, documentDirectory: FileSystem.documentDirectory,
      cacheDirectory: getEnvironmentFileDirectory('draft_images'), ownerUid: session.uid, draftId});
    if (resolved !== uri) {
      const info = await FileSystem.getInfoAsync(resolved);
      this.assertSession(session);
      if (!info.exists || info.isDirectory) throw new Error('Une photo du brouillon est indisponible. Sélectionnez-la de nouveau.');
      return resolved;
    }
    const directory = imageDirectory(session.uid);
    // A source in another account/environment's cache (including the old global
    // cache) must never be read or adopted by this account.
    if (uri.startsWith(ALL_DRAFT_IMAGES_ROOT) && !uri.startsWith(directory)) {
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
      throw new Error('Cette photo ne peut pas être conservée. Sélectionnez-la de nouveau.');
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
      const persisted = await this.persistDraft(updated, session);
      this.assertSession(session);
      return persisted;
    });
    this.updateQueue = operation.catch(() => undefined);
    return operation;
  }
  // True le temps d'un flux après publication réussie : le guard beforeRemove de
  // l'écran details s'en sert pour ne pas afficher l'alerte "Quitter ?" alors que
  // le brouillon a déjà été supprimé. Ré-armé (false) à chaque édition / entrée de flux.
  private published = false;

  markPublished(session?: DraftSession): void {
    if (session) {
      this.assertSession(session);
      const proof = this.publishedDraftProof;
      if (!proof || proof.revision !== this.draftWriteRevision || proof.session.uid !== session.uid ||
          proof.session.generation !== session.generation) throw new Error('Draft changed after publication');
    } else this.session();
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
    await this.persistDraft(draft, this.session());
  }

  private persistDraft(draft: ArticleDraft, session: DraftSession): Promise<ArticleDraft> {
    this.assertSession(session, draft);
    ++this.draftWriteRevision;
    this.publishedDraftProof = null;
    const draftToSave: ArticleDraft = JSON.parse(JSON.stringify({ ...draft, updatedAt: new Date().toISOString() }));
    Reflect.deleteProperty(draftToSave, 'saleDeclarationReviewKey');
    if (draftToSave.fields) {
      for (const key of ['saleUnit', 'counterfeitStatus', 'inventoryUnitDeclaration', 'brandStatus', 'hasAlterations', 'alterationsDescription', 'hasKnownDefects', 'defectsDescription'])
        Reflect.deleteProperty(draftToSave.fields, key);
    }
    return this.withStorageLock(async () => {
      this.assertSession(session, draftToSave);
      this.published = false;
      await AsyncStorage.setItem(draftKey(session.uid), JSON.stringify(draftToSave));
      this.assertSession(session, draftToSave);
      return draftToSave;
    });
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
    try {
      if (!auth.currentUser) return null;
      const session = this.session();
      const draftJson = await AsyncStorage.getItem(draftKey(session.uid));
      this.assertSession(session);

      if (!draftJson) {
        return null;
      }

      const draft: ArticleDraft = JSON.parse(draftJson);
      this.assertSession(session, draft);

      // Check expiration
      const expired = isDraftExpired(draft);

      if (expired) {
        await this.deleteDraft();
        return null;
      }

      const resolved = await this.resolveCachedPhotos(draft, session);
      this.assertSession(session, resolved);
      if (resolved !== draft) {
        // Merge with the latest draft under the existing write queue, rather
        // than overwrite an edit that completed while the file was checked.
        return await this.mutateDraft(draft, latest => this.resolveCachedPhotos(latest, session));
      }
      return resolved;
    } catch (error) {
      if (__DEV__) console.error('[DraftService] Failed to load draft');
      return null;
    }
  }

  /**
   * Delete draft from AsyncStorage and clean up its local cached images.
   * NOTE: Reads AsyncStorage directly to avoid circular recursion with loadDraft()
   * @param keepStorageImages - Legacy caller option; remote originals are retained in either case.
   */
  async deleteDraft(keepStorageImages: boolean = false): Promise<void> {
    if (!auth.currentUser) return;
    const session = this.session();
    if (this.saveDebounceTimer) clearTimeout(this.saveDebounceTimer);
    this.saveDebounceTimer = null;
    await this.updateQueue;
    return this.withStorageLock(async () => {
      try {
        // Read directly from AsyncStorage - DO NOT call loadDraft() here!
        // loadDraft() calls deleteDraft() for expired drafts, causing infinite recursion
        this.assertSession(session);
        const draftJson = await AsyncStorage.getItem(draftKey(session.uid));
        this.assertSession(session);

        if (draftJson) {
          const draft: ArticleDraft = JSON.parse(draftJson);
          this.assertSession(session, draft);
          this.discardedDraftIds.add(this.discardedKey(draft));

          // Delete local cached images
          await this.deleteCachedImages(draft.id, session);
          this.assertSession(session);

          // This compatibility call cannot erase immutable Storage originals and returns false.
          if (!keepStorageImages && draft.storageUrls && draft.storageUrls.length > 0) {
            this.assertSession(session);
            await deleteDraftImagesFromStorage(draft.id, session.uid);
            this.assertSession(session);
          }
        }

        this.assertSession(session);
        await AsyncStorage.removeItem(draftKey(session.uid));
        this.assertSession(session);
      } catch (error) {
        if (__DEV__) console.error('[DraftService] Failed to delete draft:', error);
      }
    });
  }

  /**
   * Check if draft exists
   */
  async startNewDraft(): Promise<ArticleDraft> {
    await this.deleteDraft();
    const draft = createEmptyDraft();
    await this.saveDraft(draft);
    return draft;
  }

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
    options?: { invalidateAnalysis?: boolean },
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
        aiResult: options?.invalidateAnalysis === true || storageUrls === undefined && photoIndices.some(index => index < 0) ? null : latest.aiResult,
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
      ...latest, aiResult, storageUrls: storageUrls ?? latest.storageUrls, currentStep: Math.max(latest.currentStep, 2),
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
