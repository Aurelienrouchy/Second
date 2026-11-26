import { serializeRouteParam } from '@/features/sell/utils/routeParams';
/**
 * Photos Review + Analysis Screen (merged)
 * Le brouillon est relu localement ; seul un choix explicite envoie les photos à l’IA.
 */

import React, { useState, useCallback, useEffect, useLayoutEffect, useRef, useId, useMemo } from 'react';
import {
  View,
  Text,
  StyleSheet,
  Pressable,
  Alert,
  useWindowDimensions,
} from 'react-native';
import {
  cancelAnimation,
  useSharedValue,
  useAnimatedStyle,
  withRepeat,
  withTiming,
  Easing,
} from 'react-native-reanimated';
import { useRouter, useLocalSearchParams, useFocusEffect, useNavigation } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import * as ImagePicker from 'expo-image-picker';
import { ScrollView } from 'react-native-gesture-handler';

import { track } from '@/lib/analytics';
import { auth } from '@/config/firebaseConfig';
import { colors, sizing, spacing, radius, typography } from '@/constants/theme';
import { ScreenHeader } from '@/components/ui';
import { Button } from '@/components/ui/Button';
import {
  DraggablePhotoGrid,
  AnalysisCard,
  ProgressStepsList,
  AnalysisFooter,
} from '@/features/sell';
import { analyzeProductImage, createMockAIResult } from '@/features/sell/services/aiService';
import {
  PHOTO_GRID_GUTTER,
  countPrefilledFields,
  handoffStorageUrls,
} from '@/features/sell/utils/photosReview';
import { AIAnalysisResult, AnalysisPhase, CONDITION_DISPLAY } from '@/types/ai';
import draftService, { createEmptyDraft, analysisMatchesPhotos } from '@/features/sell/services/draftService';
import { getColorName } from '@/data/colors';
import { getMaterialName } from '@/data/materials';
import { moveSellPhoto } from '@/utils/sellPhotos';
import { movePhotoGridOrder } from '@/features/sell/utils/photoGrid';
import { useLabelLifecycleContext } from '@/hooks/useLabelLifecycleContext';
import { getAuthSessionGeneration, useAuthStore } from '@/store/authStore';

// =============================================================================
// CONSTANTS & TYPES
// =============================================================================

const MAX_PHOTOS = 5;

type AnalysisState = 'idle' | 'loading' | 'opening' | 'complete' | 'error';
interface AnalysisHandoff { photos: string[]; result: AIAnalysisResult; storageUrls: string[] }

interface ProgressStep {
  label: string;
  state: 'done' | 'active' | 'pending';
}

// The server runs the whole analysis in ONE model call: the client observes
// two milestones only. The former four steps ticked « Catégorie détectée »
// before any call to the model, then froze for the whole wait.
const INITIAL_PROGRESS_STEPS: ProgressStep[] = [
  { label: 'Envoi des photos', state: 'pending' },
  { label: 'Préparation des détails', state: 'pending' },
];

function reviewPhotos(value: unknown): string[] {
  if (typeof value !== 'string') return [];
  try {
    const photos: unknown = JSON.parse(value);
    return Array.isArray(photos) && photos.length <= MAX_PHOTOS && photos.every(uri => typeof uri === 'string' && uri.trim().length > 0)
      ? photos : [];
  } catch {return [];}
}

function buildFinalPills(result: AIAnalysisResult): string[] {
  const pills: string[] = [];
  if (result.category?.displayName) pills.push(result.category.displayName);
  if (result.brand?.detected) pills.push(result.brand.detected);
  const detectedMaterials = result.materials?.materialIds?.length ? result.materials.materialIds : result.materials?.primaryMaterialId ? [result.materials.primaryMaterialId] : [];
  detectedMaterials.forEach(id => pills.push(getMaterialName(id)));
  if (result.colors?.primaryColorId) pills.push(getColorName(result.colors.primaryColorId));
  const sizeValue = result.size?.normalized || result.size?.detected;
  if (sizeValue) pills.push('Taille ' + sizeValue);
  if (result.condition?.conditionId) {const display = CONDITION_DISPLAY[result.condition.conditionId]; if (display) pills.push(display);}
  return pills;
}

// =============================================================================
// MAIN COMPONENT
// =============================================================================

export default function PhotosReviewScreen() {
  const router = useRouter();
  const [photoOwnerUid] = useState(() => auth.currentUser?.uid);
  const navigation = useNavigation();
  const insets = useSafeAreaInsets();
  const params = useLocalSearchParams();
  const { width: screenWidth } = useWindowDimensions();

  const [photos, setPhotos] = useState<string[]>(() => reviewPhotos(params.photos));
  const photoIdPrefix = useId();
  const nextPhotoId = useRef(photos.length);
  const [photoIds, setPhotoIds] = useState(() => photos.map((_, index) => `${photoIdPrefix}-${index}`));
  const [isDragging, setIsDragging] = useState(false);
  const draggingRef = useRef(false);
  const galleryPending = useRef(false);
  const handleDragStateChange = useCallback((dragging: boolean) => {
    draggingRef.current = dragging;
    setIsDragging(dragging);
  }, []);
  const photoSelection = useRef(photos);
  // Draft media edits may retain their old aiResult. Only restore that cache
  // for the original selection, or a selection explicitly analysed here.
  const analysisPhotoSelection = useRef<string[] | null>(photos);
  const screenContext = useLabelLifecycleContext(JSON.stringify(['sell-photo-analysis', photos]), photoOwnerUid ?? null);
  const authGeneration = useAuthStore(() => getAuthSessionGeneration());
  // Local photo edits invalidate operations, but do not start a new restoration visit.
  const restorationKey = JSON.stringify([photoOwnerUid ?? null, authGeneration, screenContext.focusRevision]);
  const latestScreenContext = useRef(screenContext);
  useLayoutEffect(() => {latestScreenContext.current = screenContext;});
  const renderedScope = useRef<{ frame: symbol; revision: string; operation: ReturnType<typeof screenContext.capture> } | null>(null);
  // Capture after the hook commits a changed photo frame, without another render.
  useLayoutEffect(() => {
    try {
      renderedScope.current = {frame: screenContext.frame, revision: screenContext.focusRevision, operation: screenContext.capture()};
    } catch {renderedScope.current = null;}
  }, [screenContext.frame, screenContext.focusRevision, screenContext.focused]);
  const assertRenderedScope = () => {
    const scope = renderedScope.current;
    if (!scope || scope.frame !== screenContext.frame || scope.revision !== screenContext.focusRevision || photoSelection.current !== photos)
      throw new Error('Rouvrez vos photos avant de continuer.');
    screenContext.assertCurrent(scope.operation);
    draftService.assertCurrentOwner(photoOwnerUid);
  };

  // Analysis state
  const [analysisState, setAnalysisState] = useState<AnalysisState>('idle');
  const [handoffError, setHandoffError] = useState(false);
  const [restoredContext, setRestoredContext] = useState<string | null>(null);
  const isHydrating = photos.length > 0 && screenContext.focused &&
    restoredContext !== restorationKey;
  const [aiResult, setAiResult] = useState<AIAnalysisResult | null>(null);
  const [storageUrls, setStorageUrls] = useState<string[]>([]);
  const photoItems = useMemo(() => photos.map((uri, index) => ({ id: photoIds[index], uri,
    fallbackUri: storageUrls.length === photos.length ? storageUrls[index] : undefined })), [photos, photoIds, storageUrls]);
  const [errorMessage, setErrorMessage] = useState('');
  // False when retrying would fail again (quota reached).
  const [errorRetryable, setErrorRetryable] = useState(true);
  const [detectedPills, setDetectedPills] = useState<string[]>([]);
  const [progressSteps, setProgressSteps] = useState<ProgressStep[]>(
    INITIAL_PROGRESS_STEPS.map((s) => ({ ...s })),
  );

  // Animated values for spinners
  const spinnerRotation = useSharedValue(0);
  const progressWidth = useSharedValue(0);
  const stepSpinnerRotation = useSharedValue(0);

  // Explicit analysis/retry counter, threaded into ai_analysis_* events.
  const analysisAttempt = useRef(0);

  // Guard against double navigation (repeated taps on CONTINUER)
  const hasNavigated = useRef(false);
  const detailHandoff = useRef<symbol | null>(null);
  const successfulAnalysis = useRef<(AnalysisHandoff & { generation: number }) | null>(null);
  const focusVisit = useRef(0);
  useFocusEffect(useCallback(() => {
    hasNavigated.current = false;
    return () => {focusVisit.current += 1;};
  }, []));
  const photoSaveRef = useRef<Promise<unknown>>(Promise.resolve());
  const abortControllerRef = useRef<AbortController | null>(null);
  const isMountedRef = useRef(true);

  const persistPhotoSnapshot = useCallback((nextPhotos: string[], nextUrls: string[]) => {
    const selected = photoSelection.current;
    const invalidateAnalysis = analysisPhotoSelection.current !== nextPhotos;
    let phase = 'queued';
    const assertSnapshot = () => {
      draftService.assertCurrentOwner(photoOwnerUid);
      if (!isMountedRef.current || selected !== photoSelection.current || nextPhotos !== selected)
        throw new Error('La sélection de photos a changé.');
    };
    const save = photoSaveRef.current.catch(() => undefined).then(async () => {
      phase = 'snapshot_before_read';
      assertSnapshot();
      phase = 'draft_read';
      const existing = await draftService.loadDraft();
      phase = 'snapshot_after_read';
      assertSnapshot();
      phase = 'cache_and_persist';
      const saved = await draftService.updateDraftPhotos(existing ?? createEmptyDraft(), nextPhotos, nextUrls, {invalidateAnalysis});
      phase = 'snapshot_after_persist';
      assertSnapshot();
      return saved;
    }).catch((error: unknown) => {
      if (__DEV__) console.warn('[PhotosReview] Photo snapshot save failed', { phase, name: error instanceof Error ? error.name : 'unknown' });
      throw error;
    });
    photoSaveRef.current = save;
    return save;
  }, [photoOwnerUid]);

  const applyPhotoEdit = useCallback((nextPhotos: string[], nextUrls: string[], nextIds: string[]) => {
    photoSelection.current = nextPhotos;
    analysisPhotoSelection.current = null;
    successfulAnalysis.current = null;
    setHandoffError(false);
    setPhotos(nextPhotos);
    setPhotoIds(nextIds);
    setStorageUrls(nextUrls);
    setAiResult(null);
    setDetectedPills([]);
    setAnalysisState('idle');
    setErrorMessage('');
    void persistPhotoSnapshot(nextPhotos, nextUrls).catch(() => {
      Alert.alert('Brouillon non sauvegardé', 'Vos photos restent disponibles ici. Réessayez avant de quitter.');
    });
  }, [persistPhotoSnapshot]);

  // Abort in-flight analysis on unmount / when leaving the screen
  useEffect(() => {
    isMountedRef.current = true;
    return () => {
      isMountedRef.current = false;
      abortControllerRef.current?.abort();
    };
  }, []);

  useEffect(() => {
    if (!screenContext.focused || abortControllerRef.current?.signal.aborted) {
      abortControllerRef.current?.abort();
      setAnalysisState(previous => previous === 'loading' || previous === 'opening'
        ? successfulAnalysis.current?.photos === photoSelection.current && successfulAnalysis.current.generation === getAuthSessionGeneration() ? 'complete' : 'idle'
        : previous);
    }
    return () => {
      abortControllerRef.current?.abort();
      if (detailHandoff.current) {detailHandoff.current = null; hasNavigated.current = false;}
    };
  }, [screenContext.frame, screenContext.focusRevision, screenContext.focused]);

  const canAddMore = photos.length < MAX_PHOTOS;
  const remainingSlots = MAX_PHOTOS - photos.length;
  const isAnalyzing = analysisState === 'loading';
  const isOpeningDetails = analysisState === 'opening';
  const isBusy = isAnalyzing || isOpeningDetails;

  // Persist the photo list — and the uploaded images kept aligned with it —
  // into the draft. Adding, removing or promoting a photo here only touched
  // screen state: on resume, a removed photo came back and was published.
  useEffect(() => {
    const context = latestScreenContext.current;
    if (isBusy || !context.focused || photos.length === 0) return;
    let scope: ReturnType<typeof context.capture>;
    try {scope = context.capture();} catch {return;}
    const timeoutId = setTimeout(async () => {
      try {
        context.assertCurrent(scope);
        draftService.assertCurrentOwner(photoOwnerUid);
        const draft = await draftService.loadDraft();
        context.assertCurrent(scope);
        draftService.assertCurrentOwner(photoOwnerUid);
        if (!draft) return;
        const sameAs = (list: string[]) =>
          list.length === photos.length && list.every((uri, i) => uri === photos[i]);
        if (sameAs(draft.photos) || sameAs(draft.originalPhotoUris)) return;
        await persistPhotoSnapshot(photos, storageUrls);
      } catch (e) {
        if (__DEV__) console.warn('[PhotosReview] Failed to persist photos:', e);
      }
    }, 300);
    return () => clearTimeout(timeoutId);
  }, [photos, storageUrls, isBusy, photoOwnerUid, persistPhotoSnapshot, screenContext.frame, screenContext.focusRevision, screenContext.focused]);

  // =============================================================================
  // ANIMATIONS
  // =============================================================================

  // Les deux rotations infinies ne servent qu'au temps de l'analyse : sans
  // annulation elles continuaient de tourner sur tout le reste du tunnel.
  useEffect(() => {
    if (!isAnalyzing) return;
    spinnerRotation.value = withRepeat(
      withTiming(360, { duration: 1200, easing: Easing.linear }),
      -1,
      false,
    );
    stepSpinnerRotation.value = withRepeat(
      withTiming(360, { duration: 1000, easing: Easing.linear }),
      -1,
      false,
    );
    return () => {
      cancelAnimation(spinnerRotation);
      cancelAnimation(stepSpinnerRotation);
    };
  }, [isAnalyzing, spinnerRotation, stepSpinnerRotation]);

  const spinnerStyle = useAnimatedStyle(() => ({
    transform: [{ rotate: `${spinnerRotation.value}deg` }],
  }));

  // =============================================================================
  // ANALYSIS LOGIC (from analysis.tsx)
  // =============================================================================

  const openDetails = async (snapshot: AnalysisHandoff, assertContext: () => void) => {
    if (draggingRef.current || !snapshot.photos.length || hasNavigated.current || detailHandoff.current) return;
    try {assertContext();} catch {return;}
    const token = Symbol('details-handoff');
    detailHandoff.current = token;
    hasNavigated.current = true;
    const current = () => {
      assertContext();
      if (!isMountedRef.current || detailHandoff.current !== token || photoSelection.current !== snapshot.photos ||
          analysisPhotoSelection.current !== snapshot.photos) throw new Error('Ouverture interrompue.');
    };
    setAnalysisState('opening');
    setHandoffError(false);
    try {
      current();
      const savedPhotos = await persistPhotoSnapshot(snapshot.photos, snapshot.storageUrls);
      current();
      await draftService.updateDraftAIResult(savedPhotos, snapshot.result, snapshot.storageUrls);
      current();
      track('sell_step_completed', {
        step: 'photos_review', photo_count: snapshot.photos.length,
        prefilled_count: countPrefilledFields(snapshot.result), ai_used: true,
      });
      router.push({
        pathname: '/sell/details',
        params: {
          photos: serializeRouteParam(snapshot.photos),
          aiResult: serializeRouteParam(snapshot.result),
          storageUrls: serializeRouteParam(snapshot.storageUrls),
        },
      });
    } catch {
      if (detailHandoff.current !== token) return;
      detailHandoff.current = null;
      hasNavigated.current = false;
      try {assertContext();} catch {return;}
      if (!isMountedRef.current || photoSelection.current !== snapshot.photos) return;
      setHandoffError(true);
      setAnalysisState('complete');
    } finally {
      if (detailHandoff.current === token) detailHandoff.current = null;
    }
  };

  const updateProgressSteps = (phase: AnalysisPhase) => {
    const phaseIndex: Record<string, number> = {
      upload: -1,
      category: 0,
      analysis: 1,
      brand: 2,
      validation: 3,
    };
    const uploading = (phaseIndex[phase] ?? -1) < 0;

    setProgressSteps([
      { label: 'Envoi des photos', state: uploading ? 'active' : 'done' },
      { label: 'Préparation des détails', state: uploading ? 'pending' : 'active' },
    ]);
  };

  const runAnalysis = async () => {
    if (draggingRef.current || !photos.length || isHydrating || hasNavigated.current || abortControllerRef.current && !abortControllerRef.current.signal.aborted) return;
    let operation: ReturnType<typeof screenContext.capture>;
    try {
      assertRenderedScope();
      const started = screenContext.start();
      if (!started) return;
      operation = started;
    } catch {return;}
    const controller = new AbortController();
    abortControllerRef.current = controller;
    const assertAnalysisContext = () => {
      screenContext.assertCurrent(operation);
      draftService.assertCurrentOwner(photoOwnerUid);
      if (!isMountedRef.current || controller.signal.aborted || photoSelection.current !== photos) throw new Error('Analyse interrompue.');
    };
    const current = () => {assertAnalysisContext(); if (hasNavigated.current) throw new Error('Analyse interrompue.');};

    setAnalysisState('loading');
    setHandoffError(false);
    setErrorMessage('');
    setErrorRetryable(true);
    setDetectedPills([]);
    progressWidth.value = 0;
    setProgressSteps(INITIAL_PROGRESS_STEPS.map((s) => ({ ...s })));

    analysisAttempt.current += 1;
    const attemptNumber = analysisAttempt.current;
    const analysisStartedAt = Date.now();
    track('ai_analysis_started', {
      photo_count: photos.length,
      hydrated_from_draft: false,
      attempt_number: attemptNumber,
    });

    try {
      current();
      await photoSaveRef.current.catch(() => undefined);
      current();
      // The draft can be missing if AsyncStorage was purged or the parse failed.
      // Rather than blocking the analysis, recover by recreating an empty draft
      // seeded with the photos we already hold in screen state.
      let draft = await draftService.loadDraft();
      current();
      if (!draft) {
        if (!isMountedRef.current || controller.signal.aborted) return;
        if (__DEV__) console.log('[PhotosReview] No draft found, recreating from current photos');
        draft = await draftService.updateDraftPhotos(createEmptyDraft(), photos);
        current();
      }

      current();
      const response = await analyzeProductImage(photos, {
        draftId: draft.id,
        signal: controller.signal,
        onProgress: (p) => {
          if (!screenContext.isCurrent(operation) || controller.signal.aborted || photoSelection.current !== photos) return;
          progressWidth.value = withTiming(p, { duration: 300 });
        },
        onPhaseChange: (phase: AnalysisPhase, _message: string) => {
          if (!screenContext.isCurrent(operation) || controller.signal.aborted || photoSelection.current !== photos) return;
          updateProgressSteps(phase);
          // No « detected » pill before there is data: they are built from
          // the actual result (buildFinalPills).
        },
      });

      // L'écran a été quitté pendant l'analyse : on jette le résultat, mais on
      // garde l'adresse des images déjà téléversées, sinon elles restent
      // orphelines dans Storage et la reprise les re-téléverse entièrement.
      if (!isMountedRef.current || controller.signal.aborted || !screenContext.isCurrent(operation) || photoSelection.current !== photos) {
        if (response.storageUrls?.length) {
          try {
            draftService.assertCurrentOwner(photoOwnerUid);
            const latest = await draftService.loadDraft();
            draftService.assertCurrentOwner(photoOwnerUid);
            if (latest?.id === draft.id && latest.photos.length === photos.length && latest.photos.every((uri, index) => uri === photos[index]))
              await draftService.updateDraftStorageUrls(latest, response.storageUrls);
          } catch (e) {
            if (__DEV__) console.warn('[PhotosReview] Keeping uploaded images failed:', e);
          }
        }
        return;
      }

      if (response.success && response.result) {
        current();
        const urls = response.storageUrls || [];
        const snapshot = {photos, result: response.result, storageUrls: urls};
        successfulAnalysis.current = {...snapshot, generation: authGeneration};
        analysisPhotoSelection.current = photos;
        setStorageUrls(urls);
        setAiResult(response.result);
        setDetectedPills(buildFinalPills(response.result));
        setProgressSteps((prev) => prev.map((s) => ({ ...s, state: 'done' as const })));
        track('ai_analysis_completed', {
          photo_count: photos.length,
          hydrated_from_draft: false,
          prefilled_count: countPrefilledFields(response.result),
          detected_category: !!response.result.category?.categoryId,
          detected_brand: !!response.result.brand?.detected,
          detected_size: !!(response.result.size?.normalized || response.result.size?.detected),
          duration_ms: Date.now() - analysisStartedAt,
        });
        await openDetails(snapshot, assertAnalysisContext);
      } else {
        setErrorMessage(response.error?.message || "Une erreur est survenue lors de l'analyse");
        setErrorRetryable(response.error?.retryable !== false);
        setAnalysisState('error');
        track('ai_analysis_failed', {
          photo_count: photos.length,
          error_code: response.error?.code ?? 'analysis_failed',
          attempt_number: attemptNumber,
        });
      }
    } catch (error: unknown) {
      // Ignore cancellations triggered by unmount / leaving the screen.
      if (!isMountedRef.current || controller.signal.aborted || !screenContext.isCurrent(operation)) return;
      const message = error instanceof Error ? error.message : 'Une erreur est survenue';
      setErrorMessage(message);
      setAnalysisState('error');
      track('ai_analysis_failed', {
        photo_count: photos.length,
        error_code: error instanceof Error ? error.name : 'exception',
        attempt_number: attemptNumber,
      });
    } finally {
      if (abortControllerRef.current === controller) abortControllerRef.current = null;
      screenContext.finish(operation);
    }
  };

  // =============================================================================
  // LOCAL RESTORATION ONLY — never sends photos or starts an analysis.
  // =============================================================================

  useEffect(() => {
    const context = latestScreenContext.current;
    if (!context.focused || photos.length === 0 || restoredContext === restorationKey) return;
    let operation: ReturnType<typeof context.capture>;
    try {operation = context.capture();} catch {return;}
    let cancelled = false;
    const current = () => {
      context.assertCurrent(operation);
      draftService.assertCurrentOwner(photoOwnerUid);
      if (cancelled || !isMountedRef.current || photoSelection.current !== photos) throw new Error('Lecture locale interrompue.');
    };
    const hydrate = async () => {
      try {
        current();
        await photoSaveRef.current.catch(() => undefined);
        current();
        const draft = await draftService.loadDraft();
        // Only for the SAME photos, in the same order. Comparing their number
        // re-used, for new photos, the images and text of a previous article.
        current();
        const fresh = successfulAnalysis.current;
        if (fresh?.photos === photos && fresh.generation === getAuthSessionGeneration()) {
          setStorageUrls(fresh.storageUrls);
          setAiResult(fresh.result);
          setDetectedPills(buildFinalPills(fresh.result));
          setProgressSteps(prev => prev.map(step => ({...step, state: 'done' as const})));
          setAnalysisState('complete');
          return;
        }
        if (analysisPhotoSelection.current === photos && draft?.aiResult && analysisMatchesPhotos(draft, photos)) {
          if (__DEV__) console.log('[PhotosReview] Hydrating AI result from draft');
          analysisAttempt.current += 1;
          track('ai_analysis_started', {
            photo_count: photos.length,
            hydrated_from_draft: true,
            attempt_number: analysisAttempt.current,
          });
          setStorageUrls(draft.storageUrls);
          setAiResult(draft.aiResult);
          setDetectedPills(buildFinalPills(draft.aiResult));
          setProgressSteps((prev) => prev.map((s) => ({ ...s, state: 'done' as const })));
          setAnalysisState('complete');
          track('ai_analysis_completed', {
            photo_count: photos.length,
            hydrated_from_draft: true,
            prefilled_count: countPrefilledFields(draft.aiResult),
            detected_category: !!draft.aiResult.category?.categoryId,
            detected_brand: !!draft.aiResult.brand?.detected,
            detected_size: !!(draft.aiResult.size?.normalized || draft.aiResult.size?.detected),
            duration_ms: 0,
          });
          return;
        }
      } catch (e) {
        if (__DEV__) console.error('[PhotosReview] Failed to read draft for hydration:', e);
      } finally {
        try {
          current();
          setRestoredContext(restorationKey);
        } catch { /* A stale read cannot release the current visit's restoration guard. */ }
      }
    };
    void hydrate();
    return () => {cancelled = true;};
  }, [photos, photoOwnerUid, screenContext.frame, screenContext.focusRevision, screenContext.focused, restorationKey, restoredContext]);

  const prefilledCount = countPrefilledFields(aiResult);

  // =============================================================================
  // PHOTO HANDLERS
  // =============================================================================

  const handleBack = async () => {
    if (hasNavigated.current) return;
    try {assertRenderedScope();} catch {return;}
    hasNavigated.current = true;
    abortControllerRef.current?.abort();
    try {
      await (photos.length > 0 ? persistPhotoSnapshot(photos, storageUrls) : photoSaveRef.current);
      assertRenderedScope();
      router.back();
    } catch {
      hasNavigated.current = false;
      Alert.alert('Brouillon non sauvegardé', 'Réessayez avant de quitter pour conserver vos photos.');
    }
  };

  // Rebind native back to this render's exact media/session snapshot.
  useEffect(() => navigation.addListener('beforeRemove', (event) => {
    if (hasNavigated.current || draftService.wasPublished) return;
    event.preventDefault();
    const leave = async () => {
      if (hasNavigated.current) return;
      try {assertRenderedScope();} catch {return;}
      hasNavigated.current = true;
      abortControllerRef.current?.abort();
      try {
        await (photos.length > 0 ? persistPhotoSnapshot(photos, storageUrls) : photoSaveRef.current);
        assertRenderedScope();
        navigation.dispatch(event.data.action);
      } catch {
        hasNavigated.current = false;
        Alert.alert('Brouillon non sauvegardé', 'Réessayez avant de quitter pour conserver vos photos.');
      }
    };
    if (isAnalyzing) Alert.alert('Quitter l’analyse ?', 'L’analyse en cours sera perdue.', [
      {text: 'Rester', style: 'cancel'},
      {text: 'Quitter', style: 'destructive', onPress: () => {void leave();}},
    ]);
    else void leave();
  }));

  const handleAddPhotos = async () => {
    if (draggingRef.current || !canAddMore || isBusy || hasNavigated.current || galleryPending.current) return;
    galleryPending.current = true;
    const selected = photoSelection.current;
    const visit = focusVisit.current;

    try {
      assertRenderedScope();
      const result = await ImagePicker.launchImageLibraryAsync({
        mediaTypes: ['images'] as const,
        allowsMultipleSelection: true,
        quality: 0.8,
        exif: false,
        selectionLimit: remainingSlots,
        preferredAssetRepresentationMode:
          ImagePicker.UIImagePickerPreferredAssetRepresentationMode.Compatible,
      });

      // The native picker may background the app. Reacquire its current active
      // context, but never adopt results after a different visit or selection.
      latestScreenContext.current.capture();
      draftService.assertCurrentOwner(photoOwnerUid);
      if (!isMountedRef.current || selected !== photoSelection.current || visit !== focusVisit.current) return;

      if (!result.canceled && result.assets.length > 0) {
        const uris = result.assets.map((asset) => asset.uri);
        const added = uris.slice(0, remainingSlots);
        const addedIds = added.map(() => `${photoIdPrefix}-${nextPhotoId.current++}`);
        applyPhotoEdit([...photos, ...added], [], [...photoIds, ...addedIds]);
        track('sell_photo_added', {
          screen: 'photos_review',
          method: 'gallery',
          count_added: added.length,
          photo_count_after: photos.length + added.length,
        });
      } else if (result.canceled) {
        track('sell_photo_added', {
          screen: 'photos_review',
          method: 'gallery',
          count_added: 0,
          photo_count_after: photos.length,
          cancelled: true,
        });
      }
    } catch (error) {
      if (!isMountedRef.current || selected !== photoSelection.current || visit !== focusVisit.current) return;
      try {latestScreenContext.current.capture(); draftService.assertCurrentOwner(photoOwnerUid);} catch {return;}
      if (__DEV__) console.error('Error picking images:', error);
      Alert.alert('Import impossible', 'Les photos n’ont pas pu être importées. Réessayez.');
    } finally {galleryPending.current = false;}
  };

  const handleMovePhoto = (from: number, to: number): boolean => {
    if (from === to || isBusy || hasNavigated.current || !Number.isInteger(from) || !Number.isInteger(to) || from < 0 || to < 0 || from >= photos.length || to >= photos.length) return false;
    try {assertRenderedScope();} catch {return false;}
    const next = moveSellPhoto(photos, storageUrls, from, to);
    applyPhotoEdit(next.photos, next.storageUrls, movePhotoGridOrder(photoIds, from, to));
    return true;
  };

  const handleRemovePhoto = (index: number) => {
    if (draggingRef.current || isBusy || hasNavigated.current) return;
    try {assertRenderedScope();} catch {return;}
    applyPhotoEdit(
      photos.filter((_, i) => i !== index),
      storageUrls.length === photos.length ? storageUrls.filter((_, i) => i !== index) : [],
      photoIds.filter((_, i) => i !== index),
    );
    track('sell_photo_removed', {
      screen: 'photos_review', photo_index: index, photo_count_after: Math.max(0, photos.length - 1),
    });
  };

  // =============================================================================
  // NAVIGATION HANDLERS
  // =============================================================================

  const handleContinue = async () => {
    if (draggingRef.current || isHydrating || !screenContext.focused || !aiResult || analysisPhotoSelection.current !== photos || hasNavigated.current) return;
    try {assertRenderedScope();} catch {return;}
    // Every photo could be removed after the analysis; the refusal only came
    // three screens later, at publish time.
    if (photos.length === 0) {
      Alert.alert('Aucune photo', 'Ajoute au moins une photo pour continuer.');
      return;
    }
    const fresh = successfulAnalysis.current;
    const snapshot = fresh?.photos === photos && fresh.generation === getAuthSessionGeneration()
      ? fresh : {photos, result: aiResult, storageUrls};
    await openDetails(snapshot, assertRenderedScope);
  };

  const handleManualEntry = async () => {
    if (draggingRef.current || photos.length === 0 || hasNavigated.current) return;
    try {assertRenderedScope();} catch {return;}
    hasNavigated.current = true;
    // Abandon any running analysis when the user opts for manual entry.
    abortControllerRef.current?.abort();
    // Otherwise the screen stayed on « Analyse en cours », photo actions
    // locked, when the seller came back to it.
    if (analysisState === 'loading') setAnalysisState('idle');
    track('ai_analysis_skipped', {
      photo_count: photos.length,
      analysis_state_at_tap: analysisState === 'complete' || analysisState === 'opening' ? 'idle' : analysisState,
    });
    try {
      await persistPhotoSnapshot(photos, storageUrls);
      assertRenderedScope();
    } catch {
      hasNavigated.current = false;
      Alert.alert('Brouillon non sauvegardé', 'Réessayez avant de continuer.');
      return;
    }
    const mockResult = createMockAIResult();
    router.push({
      pathname: '/sell/details',
      params: {
        photos: serializeRouteParam(photos),
        aiResult: serializeRouteParam(mockResult),
        storageUrls: serializeRouteParam(handoffStorageUrls(photos, storageUrls)),
      },
    });
  };

  const handleRetry = () => {
    void runAnalysis();
  };

  // =============================================================================
  // GRID LAYOUT
  // =============================================================================

  // Map AnalysisState to ScreenState for sub-components that expect 'loading' | 'complete' | 'error'
  const screenStateForComponents = analysisState === 'idle' ? 'loading' : analysisState === 'opening' ? 'complete' : analysisState;

  // =============================================================================
  // RENDER
  // =============================================================================

  return (
    <View style={styles.container} testID="sell-photos-review-screen">
      <ScreenHeader
        title="Tes photos"
        onBack={handleBack}
        rightContent={
          <Text style={styles.headerCount}>
            {photos.length} / {MAX_PHOTOS}
          </Text>
        }
      />
      <ScrollView
        style={styles.scrollView}
        contentContainerStyle={styles.scrollContent}
        showsVerticalScrollIndicator={false}
        scrollEnabled={!isDragging}
      >
        <DraggablePhotoGrid items={photoItems} width={screenWidth - PHOTO_GRID_GUTTER * 2} maxPhotos={MAX_PHOTOS}
          ownerUid={photoOwnerUid} disabled={isBusy || isHydrating || !screenContext.focused} dragging={isDragging}
          contextKey={screenContext.frame} contextRevision={screenContext.focusRevision}
          onMove={handleMovePhoto} onRemove={handleRemovePhoto} onAdd={handleAddPhotos} onDragStateChange={handleDragStateChange} />
        {/* Analysis section -- inline below photos */}
        {analysisState !== 'idle' && (
          <View style={styles.analysisSection}>
            <AnalysisCard
              screenState={screenStateForComponents}
              errorMessage={errorMessage}
              prefilledCount={prefilledCount}
              detectedPills={detectedPills}
              spinnerStyle={spinnerStyle}
              progressWidth={progressWidth}
            />

            {analysisState === 'loading' && (
              <ProgressStepsList
                steps={progressSteps}
                stepSpinnerRotation={stepSpinnerRotation}
              />
            )}

          </View>
        )}

        {/* Tips section */}
        <View style={styles.tipsSection}>
          <Text style={styles.tipsTitle}>CONSEILS POUR DE MEILLEURES PHOTOS</Text>
          <View style={styles.tipRow}>
            <View style={styles.tipDot} />
            <Text style={styles.tipText}>Bonne luminosité, fond neutre</Text>
          </View>
          <View style={styles.tipRow}>
            <View style={styles.tipDot} />
            <Text style={styles.tipText}>Montrer tous les détails et défauts</Text>
          </View>
          <View style={styles.tipRow}>
            <View style={styles.tipDot} />
            <Text style={styles.tipText}>Photos claires, pas de reflets</Text>
          </View>
        </View>
      </ScrollView>

      {/* Sticky footer -- contextual based on analysis state */}
      {analysisState === 'idle' && (
        <View style={[styles.footer, { paddingBottom: insets.bottom + spacing.md }]}>
          <Button
            variant="primary"
            size="default"
            fullWidth
            onPress={handleRetry}
            disabled={photos.length === 0 || isHydrating || isDragging || !screenContext.focused}
            accessibilityLabel="Préparer mon annonce"
            testID="sell-analyze-button"
            rightIcon={<Ionicons name="arrow-forward" size={sizing.iconSM} color={colors.foreground} />}
          >
            Préparer mon annonce
          </Button>

          <Pressable
            style={styles.manualLink}
            onPress={handleManualEntry}
            disabled={isDragging}
            testID="sell-manual-entry-button"
          >
            <Text style={styles.manualLinkText}>Remplir manuellement</Text>
          </Pressable>
        </View>
      )}

      {analysisState !== 'idle' && (
        <AnalysisFooter
          screenState={screenStateForComponents}
          bottomInset={insets.bottom}
          onContinue={handleContinue}
          onRetry={handleRetry}
          onManualEntry={handleManualEntry}
          canRetry={errorRetryable}
          handoffError={handoffError}
          opening={isOpeningDetails}
          disabled={isHydrating || isDragging || !screenContext.focused || photos.length === 0}
        />
      )}
    </View>
  );
}

// =============================================================================
// STYLES
// =============================================================================

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.surfaceWarm,
  },

  headerCount: {
    ...typography.labelUppercase,
    color: colors.muted,
  },

  // Scroll
  scrollView: {
    flex: 1,
  },
  scrollContent: {
    paddingHorizontal: PHOTO_GRID_GUTTER,
    paddingTop: spacing.md,
    paddingBottom: spacing.lg,
    gap: spacing.lg,
  },

  // Analysis section
  analysisSection: {
    gap: spacing.md,
  },

  // Tips
  tipsSection: {
    gap: spacing.sm,
  },
  tipsTitle: {
    ...typography.labelUppercase,
    color: colors.muted,
    marginBottom: spacing.xs,
    textTransform: 'uppercase',
  },
  tipRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: spacing.sm,
  },
  tipDot: {
    width: spacing.xs,
    height: spacing.xs,
    borderRadius: radius.full,
    backgroundColor: colors.sage,
    marginTop: spacing.sm,
  },
  tipText: {
    flex: 1,
    ...typography.bodySmall,
    color: colors.charcoal,
  },

  // Footer (idle state)
  footer: {
    backgroundColor: colors.cream,
    paddingTop: spacing.md,
    paddingHorizontal: PHOTO_GRID_GUTTER,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: colors.border,
  },
  manualLink: {
    minHeight: sizing.minTouchTarget,
    paddingVertical: spacing.sm,
    justifyContent: 'center',
    alignItems: 'center',
  },
  manualLinkText: {
    ...typography.caption,
    color: colors.muted,
  },
});
