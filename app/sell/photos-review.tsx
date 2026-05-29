/**
 * Photos Review + Analysis Screen (merged)
 * Analysis starts automatically on mount, then auto-navigates to details on complete.
 */

import React, { useState, useCallback, useEffect, useRef } from 'react';
import {
  View,
  Text,
  StyleSheet,
  Pressable,
  ScrollView,
  useWindowDimensions,
} from 'react-native';
import {
  useSharedValue,
  useAnimatedStyle,
  withRepeat,
  withTiming,
  Easing,
} from 'react-native-reanimated';
import { useRouter, useLocalSearchParams } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import * as ImagePicker from 'expo-image-picker';
import { Image } from 'expo-image';

import { colors, fonts, spacing, radius } from '@/constants/theme';
import { ScreenHeader } from '@/components/ui';
import StepProgressBar from '@/components/sell/StepProgressBar';
import {
  AnalysisCard,
  ProgressStepsList,
  AnalysisFooter,
} from '@/features/sell';
import { analyzeProductImage, createMockAIResult } from '@/services/aiService';
import { AIAnalysisResult, AnalysisPhase, CONDITION_DISPLAY } from '@/types/ai';
import draftService from '@/services/draftService';

// =============================================================================
// CONSTANTS & TYPES
// =============================================================================

const MAX_PHOTOS = 5;
const GRID_GAP = 3;
const GRID_HEIGHT = 260;

type AnalysisState = 'idle' | 'loading' | 'complete' | 'error';

interface ProgressStep {
  label: string;
  state: 'done' | 'active' | 'pending';
}

const INITIAL_PROGRESS_STEPS: ProgressStep[] = [
  { label: 'Catégorie détectée', state: 'pending' },
  { label: 'Couleur et matière identifiées', state: 'pending' },
  { label: "Lecture de l'étiquette...", state: 'pending' },
  { label: 'Génération du titre et description', state: 'pending' },
];

// =============================================================================
// MAIN COMPONENT
// =============================================================================

export default function PhotosReviewScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const params = useLocalSearchParams();
  const { width: screenWidth } = useWindowDimensions();

  const initialPhotos: string[] = params.photos
    ? JSON.parse(params.photos as string)
    : [];

  const [photos, setPhotos] = useState<string[]>(initialPhotos);

  // Analysis state
  const [analysisState, setAnalysisState] = useState<AnalysisState>('idle');
  const [aiResult, setAiResult] = useState<AIAnalysisResult | null>(null);
  const [storageUrls, setStorageUrls] = useState<string[]>([]);
  const [errorMessage, setErrorMessage] = useState('');
  const [detectedPills, setDetectedPills] = useState<string[]>([]);
  const [progressSteps, setProgressSteps] = useState<ProgressStep[]>(
    INITIAL_PROGRESS_STEPS.map((s) => ({ ...s })),
  );

  // Animated values for spinners
  const spinnerRotation = useSharedValue(0);
  const progressWidth = useSharedValue(0);
  const stepSpinnerRotation = useSharedValue(0);

  // Track if analysis has already been triggered
  const analysisTriggered = useRef(false);

  // Guard against double navigation (timer + manual click)
  const hasNavigated = useRef(false);

  const canAddMore = photos.length < MAX_PHOTOS;
  const remainingSlots = MAX_PHOTOS - photos.length;
  const isAnalyzing = analysisState === 'loading';

  // =============================================================================
  // ANIMATIONS
  // =============================================================================

  useEffect(() => {
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
  }, [spinnerRotation, stepSpinnerRotation]);

  const spinnerStyle = useAnimatedStyle(() => ({
    transform: [{ rotate: `${spinnerRotation.value}deg` }],
  }));

  // =============================================================================
  // AUTO-START ANALYSIS
  // =============================================================================

  useEffect(() => {
    if (photos.length > 0 && !analysisTriggered.current) {
      analysisTriggered.current = true;
      runAnalysis();
    }
  }, [photos.length]);

  // =============================================================================
  // ANALYSIS LOGIC (from analysis.tsx)
  // =============================================================================

  const updateProgressSteps = (phase: AnalysisPhase) => {
    const phaseIndex: Record<string, number> = {
      upload: -1,
      category: 0,
      analysis: 1,
      brand: 2,
      validation: 3,
    };
    const activeIndex = phaseIndex[phase] ?? -1;

    setProgressSteps([
      { label: 'Catégorie détectée', state: activeIndex > 0 ? 'done' : activeIndex === 0 ? 'active' : 'pending' },
      { label: 'Couleur et matière identifiées', state: activeIndex > 1 ? 'done' : activeIndex === 1 ? 'active' : 'pending' },
      { label: "Lecture de l'étiquette...", state: activeIndex > 2 ? 'done' : activeIndex === 2 ? 'active' : 'pending' },
      { label: 'Génération du titre et description', state: activeIndex > 3 ? 'done' : activeIndex === 3 ? 'active' : 'pending' },
    ]);
  };

  const buildFinalPills = (result: AIAnalysisResult) => {
    const pills: string[] = [];
    if (result.category?.displayName) pills.push(result.category.displayName);
    if (result.brand?.detected) pills.push(result.brand.detected);
    if (result.materials?.primaryMaterialId) pills.push(result.materials.primaryMaterialId);
    if (result.colors?.primaryColorId) pills.push(result.colors.primaryColorId);
    if (result.size?.normalized) pills.push('Taille ' + result.size.normalized);
    if (result.condition?.conditionId) {
      const display = CONDITION_DISPLAY[result.condition.conditionId];
      if (display) pills.push(display);
    }
    setDetectedPills(pills);
  };

  const runAnalysis = async () => {
    setAnalysisState('loading');
    setErrorMessage('');
    setDetectedPills([]);
    progressWidth.value = 0;
    setProgressSteps(INITIAL_PROGRESS_STEPS.map((s) => ({ ...s })));

    try {
      const draft = await draftService.loadDraft();
      if (!draft) {
        setErrorMessage('Brouillon introuvable');
        setAnalysisState('error');
        return;
      }

      const response = await analyzeProductImage(photos, {
        draftId: draft.id,
        onProgress: (p) => {
          progressWidth.value = withTiming(p, { duration: 300 });
        },
        onPhaseChange: (phase: AnalysisPhase, _message: string) => {
          updateProgressSteps(phase);
          if (phase === 'category') {
            setDetectedPills((prev) => [...new Set([...prev, 'Catégorie'])]);
          }
          if (phase === 'analysis') {
            setDetectedPills((prev) => [...new Set([...prev, 'Catégorie', 'Couleur', 'Matière'])]);
          }
          if (phase === 'brand') {
            setDetectedPills((prev) => [...new Set([...prev, 'Catégorie', 'Couleur', 'Matière', 'Marque'])]);
          }
        },
      });

      if (response.success && response.result) {
        const urls = response.storageUrls || [];
        setStorageUrls(urls);
        setAiResult(response.result);
        await draftService.updateDraftAIResult(draft, response.result, urls);
        buildFinalPills(response.result);
        setProgressSteps((prev) => prev.map((s) => ({ ...s, state: 'done' as const })));
        setAnalysisState('complete');
      } else {
        setErrorMessage(response.error?.message || "Une erreur est survenue lors de l'analyse");
        setAnalysisState('error');
      }
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : 'Une erreur est survenue';
      setErrorMessage(message);
      setAnalysisState('error');
    }
  };

  // Count pre-filled fields
  const prefilledCount = aiResult
    ? [
        aiResult.title,
        aiResult.description,
        aiResult.brand?.detected,
        aiResult.category?.categoryId,
        aiResult.condition?.conditionId,
        aiResult.size?.normalized,
        aiResult.colors?.colorIds?.length > 0,
        aiResult.materials?.materialIds?.length > 0,
      ].filter(Boolean).length
    : 0;

  // =============================================================================
  // PHOTO HANDLERS
  // =============================================================================

  const handleBack = () => {
    router.back();
  };

  const handleAddPhotos = async () => {
    if (!canAddMore || isAnalyzing) return;

    try {
      const result = await ImagePicker.launchImageLibraryAsync({
        mediaTypes: ['images'] as const,
        allowsMultipleSelection: true,
        quality: 0.8,
        exif: false,
        selectionLimit: remainingSlots,
        preferredAssetRepresentationMode:
          ImagePicker.UIImagePickerPreferredAssetRepresentationMode.Compatible,
      });

      if (!result.canceled && result.assets.length > 0) {
        const uris = result.assets.map((asset) => asset.uri);
        setPhotos((prev) => {
          const remaining = MAX_PHOTOS - prev.length;
          return [...prev, ...uris.slice(0, remaining)];
        });
      }
    } catch (error) {
      if (__DEV__) console.error('Error picking images:', error);
    }
  };

  const handleMakePrimary = useCallback((index: number) => {
    if (index === 0 || isAnalyzing) return;
    setPhotos((prev) => {
      const newPhotos = [...prev];
      const [photo] = newPhotos.splice(index, 1);
      newPhotos.unshift(photo);
      return newPhotos;
    });
  }, [isAnalyzing]);

  const handleRemovePhoto = useCallback((index: number) => {
    if (isAnalyzing) return;
    setPhotos((prev) => prev.filter((_, i) => i !== index));
  }, [isAnalyzing]);

  // =============================================================================
  // NAVIGATION HANDLERS
  // =============================================================================

  const handleContinue = useCallback(() => {
    if (!aiResult || hasNavigated.current) return;
    hasNavigated.current = true;
    router.push({
      pathname: '/sell/details',
      params: {
        photos: JSON.stringify(photos),
        aiResult: JSON.stringify(aiResult),
        storageUrls: JSON.stringify(storageUrls),
      },
    });
  }, [aiResult, photos, storageUrls, router]);

  // No auto-redirect — user reviews photos and clicks "Continuer" manually

  const handleManualEntry = () => {
    const mockResult = createMockAIResult();
    router.push({
      pathname: '/sell/details',
      params: {
        photos: JSON.stringify(photos),
        aiResult: JSON.stringify(mockResult),
        storageUrls: JSON.stringify([]),
      },
    });
  };

  const handleRetry = () => {
    analysisTriggered.current = true;
    runAnalysis();
  };

  // =============================================================================
  // GRID LAYOUT
  // =============================================================================

  const mainWidth = (screenWidth - spacing.md * 2 - GRID_GAP) * 0.62;
  const sideWidth = screenWidth - spacing.md * 2 - GRID_GAP - mainWidth;
  const sideHeight = (GRID_HEIGHT - GRID_GAP) / 2;

  // Photo management disabled during analysis
  const photoActionsOpacity = isAnalyzing ? 0.4 : 1;

  // Map AnalysisState to ScreenState for sub-components that expect 'loading' | 'complete' | 'error'
  const screenStateForComponents = analysisState === 'idle' ? 'loading' : analysisState;

  // =============================================================================
  // RENDER
  // =============================================================================

  return (
    <View style={styles.container}>
      <ScreenHeader
        title="Tes photos"
        onBack={handleBack}
        rightContent={
          <Text style={styles.headerCount}>
            {photos.length} / {MAX_PHOTOS}
          </Text>
        }
      />
      <StepProgressBar currentStep={1} />

      <ScrollView
        style={styles.scrollView}
        contentContainerStyle={styles.scrollContent}
        showsVerticalScrollIndicator={false}
      >
        {/* Photo grid */}
        {photos.length > 0 && (
          <View style={[styles.gridContainer, { opacity: photoActionsOpacity }]}>
            {/* Main photo */}
            <Pressable
              style={[styles.gridMain, { width: mainWidth, height: GRID_HEIGHT }]}
              onPress={() => handleMakePrimary(0)}
              disabled={isAnalyzing}
            >
              <Image
                source={{ uri: photos[0] }}
                style={StyleSheet.absoluteFill}
                contentFit="cover"
              />
              {/* Badge -- top-right, matching mockup */}
              <View style={styles.primaryBadge}>
                <Text style={styles.primaryBadgeText}>PRINCIPALE</Text>
              </View>
              {/* Remove button */}
              <Pressable
                style={styles.gridRemove}
                onPress={() => handleRemovePhoto(0)}
                hitSlop={{ top: 6, bottom: 6, left: 6, right: 6 }}
                disabled={isAnalyzing}
              >
                <Ionicons name="close" size={12} color={colors.white} />
              </Pressable>
            </Pressable>

            {/* Side photos */}
            <View style={[styles.gridSide, { width: sideWidth }]}>
              {photos.slice(1, 3).map((uri, index) => (
                <Pressable
                  key={`side-${index}`}
                  style={[styles.gridSideItem, { height: sideHeight }]}
                  onPress={() => handleMakePrimary(index + 1)}
                  disabled={isAnalyzing}
                >
                  <Image
                    source={{ uri }}
                    style={StyleSheet.absoluteFill}
                    contentFit="cover"
                  />
                  <Pressable
                    style={styles.gridRemove}
                    onPress={() => handleRemovePhoto(index + 1)}
                    hitSlop={{ top: 6, bottom: 6, left: 6, right: 6 }}
                    disabled={isAnalyzing}
                  >
                    <Ionicons name="close" size={12} color={colors.white} />
                  </Pressable>
                </Pressable>
              ))}
              {/* Empty slot placeholder in side column */}
              {photos.length < 3 && (
                <Pressable
                  style={[styles.gridSideEmpty, { height: sideHeight }]}
                  onPress={handleAddPhotos}
                  disabled={isAnalyzing}
                >
                  <Ionicons name="add" size={24} color={colors.muted} />
                </Pressable>
              )}
            </View>
          </View>
        )}

        {/* Extra photos row (4th and 5th) */}
        {photos.length > 3 && (
          <View style={[styles.extraRow, { opacity: photoActionsOpacity }]}>
            {photos.slice(3).map((uri, index) => (
              <Pressable
                key={`extra-${index}`}
                style={styles.extraItem}
                onPress={() => handleMakePrimary(index + 3)}
                disabled={isAnalyzing}
              >
                <Image
                  source={{ uri }}
                  style={StyleSheet.absoluteFill}
                  contentFit="cover"
                />
                <Pressable
                  style={styles.gridRemove}
                  onPress={() => handleRemovePhoto(index + 3)}
                  hitSlop={{ top: 6, bottom: 6, left: 6, right: 6 }}
                  disabled={isAnalyzing}
                >
                  <Ionicons name="close" size={12} color={colors.white} />
                </Pressable>
              </Pressable>
            ))}
          </View>
        )}

        {/* Add photos button -- centered layout matching mockup */}
        {canAddMore && (
          <Pressable
            style={[styles.addButton, { opacity: photoActionsOpacity }]}
            onPress={handleAddPhotos}
            disabled={isAnalyzing}
          >
            <View style={styles.addButtonIconCircle}>
              <Ionicons name="add" size={20} color={colors.muted} />
            </View>
            <Text style={styles.addButtonTitle}>Ajouter des photos</Text>
            <Text style={styles.addButtonSub}>
              {remainingSlots} emplacement{remainingSlots > 1 ? 's' : ''} restant
              {remainingSlots > 1 ? 's' : ''}
            </Text>
          </Pressable>
        )}

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

            {/* Results not shown — auto-navigates to details on complete */}
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
        <View style={[styles.footer, { paddingBottom: insets.bottom + 16 }]}>
          <Pressable
            style={[
              styles.analyzeButton,
              photos.length === 0 && styles.analyzeButtonDisabled,
            ]}
            onPress={handleRetry}
            disabled={photos.length === 0}
          >
            <Ionicons
              name="sparkles-outline"
              size={18}
              color={photos.length > 0 ? colors.cream : colors.muted}
            />
            <Text
              style={[
                styles.analyzeButtonText,
                photos.length === 0 && styles.analyzeButtonTextDisabled,
              ]}
            >
              ANALYSER AVEC L'IA
            </Text>
          </Pressable>

          <Pressable style={styles.manualLink} onPress={handleManualEntry}>
            <Text style={styles.manualLinkText}>ou remplir manuellement</Text>
          </Pressable>
        </View>
      )}

      {(analysisState === 'loading' || analysisState === 'error') && (
        <AnalysisFooter
          screenState={screenStateForComponents}
          bottomInset={insets.bottom}
          onContinue={handleContinue}
          onRetry={handleRetry}
          onManualEntry={handleManualEntry}
        />
      )}

      {analysisState === 'complete' && (
        <View style={[styles.footer, { paddingBottom: insets.bottom + 16 }]}>
          <Pressable
            style={styles.continueButton}
            onPress={handleContinue}
          >
            <Ionicons name="checkmark-circle-outline" size={18} color={colors.cream} />
            <Text style={styles.continueButtonText}>CONTINUER</Text>
          </Pressable>
        </View>
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
    fontFamily: fonts.sansMedium,
    fontSize: 11,
    color: colors.muted,
    letterSpacing: 1,
  },

  // Scroll
  scrollView: {
    flex: 1,
  },
  scrollContent: {
    paddingHorizontal: 20,
    paddingTop: 16,
    paddingBottom: 32,
  },

  // Photo grid -- no border-radius per mockup
  gridContainer: {
    flexDirection: 'row',
    gap: GRID_GAP,
    marginBottom: spacing.md,
  },
  gridMain: {
    overflow: 'hidden',
    backgroundColor: colors.border,
  },
  // Badge -- top-right position matching HTML mockup
  primaryBadge: {
    position: 'absolute',
    top: 8,
    right: 8,
    backgroundColor: 'rgba(0, 0, 0, 0.4)',
    paddingHorizontal: 8,
    paddingVertical: 4,
  },
  primaryBadgeText: {
    fontFamily: fonts.sansMedium,
    fontSize: 9,
    letterSpacing: 1.2,
    color: colors.cream,
    textTransform: 'uppercase',
  },
  gridRemove: {
    position: 'absolute',
    top: 8,
    right: 8,
    width: 24,
    height: 24,
    borderRadius: 12,
    backgroundColor: 'rgba(0, 0, 0, 0.5)',
    justifyContent: 'center',
    alignItems: 'center',
  },
  gridSide: {
    gap: GRID_GAP,
  },
  gridSideItem: {
    overflow: 'hidden',
    backgroundColor: colors.border,
  },
  gridSideEmpty: {
    borderWidth: 1.5,
    borderColor: colors.borderStrong,
    borderStyle: 'dashed',
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: 'transparent',
  },

  // Extra row for 4th-5th photos
  extraRow: {
    flexDirection: 'row',
    gap: GRID_GAP,
    marginBottom: spacing.md,
  },
  extraItem: {
    flex: 1,
    height: 100,
    overflow: 'hidden',
    backgroundColor: colors.border,
  },

  // Add photos button -- centered layout matching mockup
  addButton: {
    borderWidth: 1.5,
    borderColor: colors.borderStrong,
    borderStyle: 'dashed',
    borderRadius: radius.md,
    paddingVertical: 24,
    paddingHorizontal: 16,
    marginBottom: spacing.lg,
    alignItems: 'center',
    backgroundColor: 'rgba(255, 255, 255, 0.4)',
  },
  addButtonIconCircle: {
    width: 40,
    height: 40,
    borderRadius: 20,
    borderWidth: 1,
    borderColor: colors.borderStrong,
    justifyContent: 'center',
    alignItems: 'center',
    marginBottom: 12,
  },
  addButtonTitle: {
    fontFamily: fonts.sansMedium,
    fontSize: 13,
    color: colors.charcoal,
    marginBottom: 4,
  },
  addButtonSub: {
    fontFamily: fonts.sans,
    fontSize: 11,
    color: colors.muted,
  },

  // Analysis section
  analysisSection: {
    marginBottom: spacing.lg,
  },

  // Tips
  tipsSection: {
    paddingTop: spacing.sm,
  },
  tipsTitle: {
    fontFamily: fonts.sansMedium,
    fontSize: 9,
    letterSpacing: 1.8,
    color: colors.muted,
    marginBottom: 12,
    textTransform: 'uppercase',
  },
  tipRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 12,
    marginBottom: 10,
  },
  tipDot: {
    width: 4,
    height: 4,
    borderRadius: 2,
    backgroundColor: colors.sage,
    marginTop: 6,
  },
  tipText: {
    flex: 1,
    fontFamily: fonts.sans,
    fontSize: 13,
    lineHeight: 18,
    color: colors.charcoal,
  },

  // Footer (idle state)
  footer: {
    backgroundColor: colors.cream,
    paddingTop: 16,
    paddingHorizontal: 20,
    borderTopWidth: 1,
    borderTopColor: colors.border,
  },
  analyzeButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.charcoal,
    paddingVertical: 14,
    borderRadius: radius.md,
    gap: 8,
  },
  analyzeButtonDisabled: {
    backgroundColor: colors.border,
  },
  analyzeButtonText: {
    fontFamily: fonts.sansMedium,
    fontSize: 13,
    letterSpacing: 2.16,
    color: colors.cream,
    textTransform: 'uppercase',
  },
  analyzeButtonTextDisabled: {
    color: colors.muted,
  },
  manualLink: {
    paddingVertical: 14,
    alignItems: 'center',
  },
  manualLinkText: {
    fontFamily: fonts.sans,
    fontSize: 12,
    color: colors.muted,
    letterSpacing: 0.72,
  },
  continueButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.sage,
    paddingVertical: 14,
    borderRadius: radius.md,
    gap: 8,
  },
  continueButtonText: {
    fontFamily: fonts.sansMedium,
    fontSize: 13,
    letterSpacing: 2.16,
    color: colors.cream,
    textTransform: 'uppercase',
  },
});
