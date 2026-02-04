import { useState, useEffect, useCallback, useRef } from 'react';
import { AppState, AppStateStatus } from 'react-native';
import draftService, {
  ArticleDraft,
  DraftFields,
  DraftPricing,
  createEmptyDraft,
} from '@/services/draftService';
import { AIAnalysisResult } from '@/types/ai';

type SaveStatus = 'idle' | 'saving' | 'saved' | 'error';

interface UseDraftReturn {
  draft: ArticleDraft | null;
  saveStatus: SaveStatus;
  isLoading: boolean;
  hasDraft: boolean;

  // Actions
  initDraft: () => Promise<ArticleDraft>;
  loadExistingDraft: () => Promise<ArticleDraft | null>;
  updatePhotos: (photos: string[]) => Promise<void>;
  updateFields: (fields: DraftFields) => void;
  updateFieldsImmediate: (fields: DraftFields) => Promise<void>;
  updatePricing: (pricing: DraftPricing) => Promise<void>;
  updateAIResult: (aiResult: AIAnalysisResult) => Promise<void>;
  updateStep: (step: number) => Promise<void>;
  deleteDraft: () => Promise<void>;
  checkForDraft: () => Promise<boolean>;
}

export function useDraft(): UseDraftReturn {
  const [draft, setDraft] = useState<ArticleDraft | null>(null);
  const [saveStatus, setSaveStatus] = useState<SaveStatus>('idle');
  const [isLoading, setIsLoading] = useState(true);
  const [hasDraft, setHasDraft] = useState(false);

  // Ref to track current draft for background save
  const draftRef = useRef<ArticleDraft | null>(null);
  draftRef.current = draft;

  // Debounce timer for field updates
  const saveDebounceTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Check for existing draft on mount
  useEffect(() => {
    checkForDraft();
  }, []);

  // Handle app background/foreground
  useEffect(() => {
    const handleAppStateChange = async (nextAppState: AppStateStatus) => {
      if (nextAppState === 'background' && draftRef.current) {
        // Save draft when app goes to background
        try {
          await draftService.saveDraft(draftRef.current);
        } catch (error) {
          console.warn('Failed to save draft on background:', error);
        }
      }
    };

    const subscription = AppState.addEventListener('change', handleAppStateChange);
    return () => subscription.remove();
  }, []);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      if (saveDebounceTimer.current) {
        clearTimeout(saveDebounceTimer.current);
      }
    };
  }, []);

  const checkForDraft = useCallback(async (): Promise<boolean> => {
    setIsLoading(true);
    try {
      const exists = await draftService.hasDraft();
      setHasDraft(exists);
      return exists;
    } finally {
      setIsLoading(false);
    }
  }, []);

  const loadExistingDraft = useCallback(async (): Promise<ArticleDraft | null> => {
    setIsLoading(true);
    try {
      const existingDraft = await draftService.loadDraft();
      if (existingDraft) {
        setDraft(existingDraft);
        setHasDraft(true);
      }
      return existingDraft;
    } finally {
      setIsLoading(false);
    }
  }, []);

  const initDraft = useCallback(async (): Promise<ArticleDraft> => {
    // Delete any existing draft first
    await draftService.deleteDraft();

    const newDraft = createEmptyDraft();
    await draftService.saveDraft(newDraft);
    setDraft(newDraft);
    setHasDraft(true);
    return newDraft;
  }, []);

  const saveDraft = useCallback(async (updatedDraft: ArticleDraft) => {
    setSaveStatus('saving');
    try {
      await draftService.saveDraft(updatedDraft);
      setSaveStatus('saved');

      // Reset to idle after a delay
      setTimeout(() => setSaveStatus('idle'), 2000);
    } catch (error) {
      setSaveStatus('error');
      console.error('Failed to save draft:', error);
    }
  }, []);

  const updatePhotos = useCallback(async (photos: string[]) => {
    if (!draft) return;

    setSaveStatus('saving');
    try {
      const updatedDraft = await draftService.updateDraftPhotos(draft, photos);
      setDraft(updatedDraft);
      setSaveStatus('saved');
      setTimeout(() => setSaveStatus('idle'), 2000);
    } catch (error) {
      setSaveStatus('error');
      console.error('Failed to update photos:', error);
    }
  }, [draft]);

  // Debounced field update for inline editing
  const updateFields = useCallback((fields: DraftFields) => {
    if (!draft) return;

    const updatedDraft: ArticleDraft = {
      ...draft,
      fields,
      currentStep: Math.max(draft.currentStep, 2),
      updatedAt: new Date().toISOString(),
    };
    setDraft(updatedDraft);

    // Debounce save
    if (saveDebounceTimer.current) {
      clearTimeout(saveDebounceTimer.current);
    }

    setSaveStatus('saving');
    saveDebounceTimer.current = setTimeout(async () => {
      try {
        await draftService.saveDraft(updatedDraft);
        setSaveStatus('saved');
        setTimeout(() => setSaveStatus('idle'), 2000);
      } catch (error) {
        setSaveStatus('error');
      }
    }, 500);
  }, [draft]);

  // Immediate field update (for step navigation)
  const updateFieldsImmediate = useCallback(async (fields: DraftFields) => {
    if (!draft) return;

    const updatedDraft = await draftService.updateDraftFields(draft, fields);
    setDraft(updatedDraft);
  }, [draft]);

  const updatePricing = useCallback(async (pricing: DraftPricing) => {
    if (!draft) return;

    setSaveStatus('saving');
    try {
      const updatedDraft = await draftService.updateDraftPricing(draft, pricing);
      setDraft(updatedDraft);
      setSaveStatus('saved');
      setTimeout(() => setSaveStatus('idle'), 2000);
    } catch (error) {
      setSaveStatus('error');
      console.error('Failed to update pricing:', error);
    }
  }, [draft]);

  const updateAIResult = useCallback(async (aiResult: AIAnalysisResult) => {
    if (!draft) return;

    setSaveStatus('saving');
    try {
      const updatedDraft = await draftService.updateDraftAIResult(draft, aiResult);
      setDraft(updatedDraft);
      setSaveStatus('saved');
      setTimeout(() => setSaveStatus('idle'), 2000);
    } catch (error) {
      setSaveStatus('error');
      console.error('Failed to update AI result:', error);
    }
  }, [draft]);

  const updateStep = useCallback(async (step: number) => {
    if (!draft) return;

    try {
      const updatedDraft = await draftService.updateDraftStep(draft, step);
      setDraft(updatedDraft);
    } catch (error) {
      console.error('Failed to update step:', error);
    }
  }, [draft]);

  const deleteDraft = useCallback(async () => {
    try {
      await draftService.deleteDraft();
      setDraft(null);
      setHasDraft(false);
      setSaveStatus('idle');
    } catch (error) {
      console.error('Failed to delete draft:', error);
    }
  }, []);

  return {
    draft,
    saveStatus,
    isLoading,
    hasDraft,
    initDraft,
    loadExistingDraft,
    updatePhotos,
    updateFields,
    updateFieldsImmediate,
    updatePricing,
    updateAIResult,
    updateStep,
    deleteDraft,
    checkForDraft,
  };
}

export default useDraft;
