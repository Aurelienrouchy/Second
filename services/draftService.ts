import AsyncStorage from '@react-native-async-storage/async-storage';
import * as FileSystem from 'expo-file-system';
import { AIAnalysisResult } from '@/types/ai';
import { MeetupNeighborhood } from '@/types';
import { deleteDraftImagesFromStorage } from './aiService';

// Draft storage key
const DRAFT_KEY = '@article_draft';
const DRAFT_IMAGES_DIR = `${FileSystem.documentDirectory}draft_images/`;

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
  neighborhood: MeetupNeighborhood | null;
  packageSize: string | null;
}

export interface ArticleDraft {
  id: string;
  createdAt: string;
  updatedAt: string;
  currentStep: number; // 1-4
  photos: string[]; // Local cached URIs (legacy)
  originalPhotoUris: string[]; // Original URIs for reference
  storageUrls: string[]; // Firebase Storage URLs (new - used for publishing)
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
  const now = new Date().toISOString();
  return {
    id: generateDraftId(),
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

// Ensure draft images directory exists
async function ensureImageDirectory(): Promise<void> {
  const dirInfo = await FileSystem.getInfoAsync(DRAFT_IMAGES_DIR);
  if (!dirInfo.exists) {
    await FileSystem.makeDirectoryAsync(DRAFT_IMAGES_DIR, { intermediates: true });
  }
}

// Copy image to local cache
async function cacheImage(uri: string, draftId: string, index: number): Promise<string> {
  await ensureImageDirectory();

  // Generate local filename
  const extension = uri.split('.').pop()?.split('?')[0] || 'jpg';
  const localFilename = `${draftId}_${index}.${extension}`;
  const localUri = `${DRAFT_IMAGES_DIR}${localFilename}`;

  // Check if source is already local
  if (uri.startsWith(FileSystem.documentDirectory || '')) {
    return uri; // Already cached
  }

  try {
    await FileSystem.copyAsync({
      from: uri,
      to: localUri,
    });
    return localUri;
  } catch (error) {
    console.warn('Failed to cache image:', error);
    return uri; // Return original URI as fallback
  }
}

// Delete cached images for a draft
async function deleteCachedImages(draftId: string): Promise<void> {
  console.log('[DraftService] deleteCachedImages() START for draftId:', draftId);
  try {
    console.log('[DraftService] Checking if image directory exists...');
    const dirInfo = await FileSystem.getInfoAsync(DRAFT_IMAGES_DIR);
    console.log('[DraftService] Directory exists?', dirInfo.exists);

    if (!dirInfo.exists) {
      console.log('[DraftService] Directory does not exist, returning');
      return;
    }

    console.log('[DraftService] Reading directory...');
    const files = await FileSystem.readDirectoryAsync(DRAFT_IMAGES_DIR);
    console.log('[DraftService] Found files:', files.length);

    const draftFiles = files.filter(f => f.startsWith(draftId));
    console.log('[DraftService] Files matching draftId:', draftFiles.length);

    console.log('[DraftService] Deleting files...');
    await Promise.all(
      draftFiles.map(file =>
        FileSystem.deleteAsync(`${DRAFT_IMAGES_DIR}${file}`, { idempotent: true })
      )
    );
    console.log('[DraftService] deleteCachedImages() COMPLETE');
  } catch (error) {
    console.warn('[DraftService] Failed to delete cached images:', error);
  }
}

// Check if draft is expired
function isDraftExpired(draft: ArticleDraft): boolean {
  const createdAt = new Date(draft.createdAt);
  const expirationDate = new Date(createdAt);
  expirationDate.setDate(expirationDate.getDate() + DRAFT_EXPIRATION_DAYS);
  const now = new Date();
  const expired = now > expirationDate;
  console.log('[DraftService] isDraftExpired check:', {
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

  /**
   * Save draft to AsyncStorage
   */
  async saveDraft(draft: ArticleDraft): Promise<void> {
    try {
      const draftToSave = {
        ...draft,
        updatedAt: new Date().toISOString(),
      };
      await AsyncStorage.setItem(DRAFT_KEY, JSON.stringify(draftToSave));
    } catch (error) {
      console.error('Failed to save draft:', error);
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
    this.saveDebounceTimer = setTimeout(() => {
      this.saveDraft(draft);
    }, this.DEBOUNCE_MS);
  }

  /**
   * Load draft from AsyncStorage
   */
  async loadDraft(): Promise<ArticleDraft | null> {
    console.log('[DraftService] loadDraft() START');
    try {
      console.log('[DraftService] Getting item from AsyncStorage...');
      const draftJson = await AsyncStorage.getItem(DRAFT_KEY);
      console.log('[DraftService] AsyncStorage returned:', draftJson ? 'has data' : 'null');

      if (!draftJson) {
        console.log('[DraftService] No draft found, returning null');
        return null;
      }

      const draft: ArticleDraft = JSON.parse(draftJson);
      console.log('[DraftService] Draft parsed, id:', draft.id, 'createdAt:', draft.createdAt);

      // Check expiration
      const expired = isDraftExpired(draft);
      console.log('[DraftService] Draft expired?', expired);

      if (expired) {
        console.log('[DraftService] Draft is expired, calling deleteDraft()...');
        await this.deleteDraft();
        console.log('[DraftService] deleteDraft() completed, returning null');
        return null;
      }

      console.log('[DraftService] Returning valid draft');
      return draft;
    } catch (error) {
      console.error('[DraftService] Failed to load draft:', error);
      return null;
    }
  }

  /**
   * Delete draft from AsyncStorage and cleanup images (local + Storage)
   * NOTE: Reads AsyncStorage directly to avoid circular recursion with loadDraft()
   * @param keepStorageImages - If true, don't delete images from Firebase Storage (used after publishing)
   */
  async deleteDraft(keepStorageImages: boolean = false): Promise<void> {
    console.log('[DraftService] deleteDraft() START, keepStorageImages:', keepStorageImages);
    try {
      // Read directly from AsyncStorage - DO NOT call loadDraft() here!
      // loadDraft() calls deleteDraft() for expired drafts, causing infinite recursion
      console.log('[DraftService] Reading AsyncStorage directly...');
      const draftJson = await AsyncStorage.getItem(DRAFT_KEY);
      console.log('[DraftService] deleteDraft got draftJson:', draftJson ? 'has data' : 'null');

      if (draftJson) {
        const draft: ArticleDraft = JSON.parse(draftJson);
        console.log('[DraftService] Deleting cached images for draft:', draft.id);

        // Delete local cached images
        await deleteCachedImages(draft.id);
        console.log('[DraftService] Local cached images deleted');

        // Delete images from Firebase Storage (unless we're keeping them for a published article)
        if (!keepStorageImages && draft.storageUrls && draft.storageUrls.length > 0) {
          console.log('[DraftService] Deleting Storage images for draft:', draft.id);
          await deleteDraftImagesFromStorage(draft.id);
          console.log('[DraftService] Storage images deleted');
        } else if (keepStorageImages) {
          console.log('[DraftService] 📸 Keeping Storage images for published article');
        }
      }

      console.log('[DraftService] Removing draft from AsyncStorage...');
      await AsyncStorage.removeItem(DRAFT_KEY);
      console.log('[DraftService] deleteDraft() COMPLETE');
    } catch (error) {
      console.error('[DraftService] Failed to delete draft:', error);
    }
  }

  /**
   * Check if draft exists
   */
  async hasDraft(): Promise<boolean> {
    try {
      const draftJson = await AsyncStorage.getItem(DRAFT_KEY);
      if (!draftJson) return false;

      const draft: ArticleDraft = JSON.parse(draftJson);

      // Don't count expired drafts
      if (isDraftExpired(draft)) {
        await this.deleteDraft();
        return false;
      }

      return true;
    } catch (error) {
      console.error('Failed to check draft:', error);
      return false;
    }
  }

  /**
   * Cache photos locally for draft persistence
   */
  async cachePhotos(
    photos: string[],
    draftId: string
  ): Promise<string[]> {
    const cachedUris: string[] = [];

    for (let i = 0; i < photos.length; i++) {
      const cachedUri = await cacheImage(photos[i], draftId, i);
      cachedUris.push(cachedUri);
    }

    return cachedUris;
  }

  /**
   * Update draft photos and cache them
   */
  async updateDraftPhotos(
    draft: ArticleDraft,
    newPhotos: string[]
  ): Promise<ArticleDraft> {
    // Cache new photos
    const cachedPhotos = await this.cachePhotos(newPhotos, draft.id);

    const updatedDraft: ArticleDraft = {
      ...draft,
      photos: cachedPhotos,
      originalPhotoUris: newPhotos,
      updatedAt: new Date().toISOString(),
    };

    await this.saveDraft(updatedDraft);
    return updatedDraft;
  }

  /**
   * Update draft fields
   */
  async updateDraftFields(
    draft: ArticleDraft,
    fields: DraftFields
  ): Promise<ArticleDraft> {
    const updatedDraft: ArticleDraft = {
      ...draft,
      fields,
      currentStep: Math.max(draft.currentStep, 2),
      updatedAt: new Date().toISOString(),
    };

    await this.saveDraft(updatedDraft);
    return updatedDraft;
  }

  /**
   * Update draft pricing
   */
  async updateDraftPricing(
    draft: ArticleDraft,
    pricing: DraftPricing
  ): Promise<ArticleDraft> {
    const updatedDraft: ArticleDraft = {
      ...draft,
      pricing,
      currentStep: Math.max(draft.currentStep, 3),
      updatedAt: new Date().toISOString(),
    };

    await this.saveDraft(updatedDraft);
    return updatedDraft;
  }

  /**
   * Update draft AI result and storage URLs
   */
  async updateDraftAIResult(
    draft: ArticleDraft,
    aiResult: AIAnalysisResult,
    storageUrls?: string[]
  ): Promise<ArticleDraft> {
    console.log('[DraftService] 📸 updateDraftAIResult called with:', {
      draftId: draft.id,
      hasAiResult: !!aiResult,
      storageUrlsCount: storageUrls?.length || 0,
      storageUrls: storageUrls,
      existingStorageUrls: draft.storageUrls,
    });

    const updatedDraft: ArticleDraft = {
      ...draft,
      aiResult,
      storageUrls: storageUrls || draft.storageUrls,
      updatedAt: new Date().toISOString(),
    };

    console.log('[DraftService] 📸 Saving draft with storageUrls:', updatedDraft.storageUrls);
    await this.saveDraft(updatedDraft);
    return updatedDraft;
  }

  /**
   * Update draft storage URLs (from AI analysis upload)
   */
  async updateDraftStorageUrls(
    draft: ArticleDraft,
    storageUrls: string[]
  ): Promise<ArticleDraft> {
    const updatedDraft: ArticleDraft = {
      ...draft,
      storageUrls,
      updatedAt: new Date().toISOString(),
    };

    await this.saveDraft(updatedDraft);
    return updatedDraft;
  }

  /**
   * Update current step
   */
  async updateDraftStep(
    draft: ArticleDraft,
    step: number
  ): Promise<ArticleDraft> {
    const updatedDraft: ArticleDraft = {
      ...draft,
      currentStep: step,
      updatedAt: new Date().toISOString(),
    };

    await this.saveDraft(updatedDraft);
    return updatedDraft;
  }

  /**
   * Cleanup expired drafts and orphaned images (local + Storage)
   * Call this on app startup
   */
  async cleanupExpiredDrafts(): Promise<void> {
    try {
      const draft = await this.loadDraft();

      // loadDraft already handles expiration check and deletion (including Storage)
      // But we also need to cleanup orphaned local images

      const dirInfo = await FileSystem.getInfoAsync(DRAFT_IMAGES_DIR);
      if (!dirInfo.exists) return;

      const files = await FileSystem.readDirectoryAsync(DRAFT_IMAGES_DIR);

      if (!draft) {
        // No draft exists, delete all cached images
        await Promise.all(
          files.map(file =>
            FileSystem.deleteAsync(`${DRAFT_IMAGES_DIR}${file}`, { idempotent: true })
          )
        );
      } else {
        // Delete images that don't belong to current draft
        const orphanedFiles = files.filter(f => !f.startsWith(draft.id));
        await Promise.all(
          orphanedFiles.map(file =>
            FileSystem.deleteAsync(`${DRAFT_IMAGES_DIR}${file}`, { idempotent: true })
          )
        );
      }
    } catch (error) {
      console.warn('Failed to cleanup drafts:', error);
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
