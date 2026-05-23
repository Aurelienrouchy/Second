import React, { useState, useEffect } from 'react';
import {
  View,
  StyleSheet,
  ScrollView,
} from 'react-native';
import {
  useSharedValue,
  useAnimatedStyle,
  withRepeat,
  withTiming,
  Easing,
} from 'react-native-reanimated';
import { useRouter, useLocalSearchParams } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Image } from 'expo-image';
import { colors, spacing } from '@/constants/theme';
import StepProgressBar from '@/components/sell/StepProgressBar';
import {
  AnalysisCard,
  ProgressStepsList,
  ResultsSummary,
  AnalysisFooter,
} from '@/features/sell';
import { analyzeProductImage, createMockAIResult } from '@/services/aiService';
import { AIAnalysisResult, AnalysisPhase, CONDITION_DISPLAY } from '@/types/ai';
import draftService from '@/services/draftService';

type ScreenState = 'loading' | 'complete' | 'error';

interface ProgressStep {
  label: string;
  state: 'done' | 'active' | 'pending';
}

export default function AnalysisScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const params = useLocalSearchParams();

  const photos: string[] = params.photos
    ? JSON.parse(params.photos as string)
    : [];

  const [screenState, setScreenState] = useState<ScreenState>('loading');
  const [aiResult, setAiResult] = useState<AIAnalysisResult | null>(null);
  const [storageUrls, setStorageUrls] = useState<string[]>([]);
  const [errorMessage, setErrorMessage] = useState<string>('');
  const [detectedPills, setDetectedPills] = useState<string[]>([]);
  const [progressSteps, setProgressSteps] = useState<ProgressStep[]>([
    { label: 'Catégorie détectée', state: 'pending' },
    { label: 'Couleur et matière identifiées', state: 'pending' },
    { label: "Lecture de l'étiquette...", state: 'pending' },
    { label: 'Génération du titre et description', state: 'pending' },
  ]);

  // Animated values
  const spinnerRotation = useSharedValue(0);
  const progressWidth = useSharedValue(0);
  const stepSpinnerRotation = useSharedValue(0);

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
  }, []);

  useEffect(() => {
    runAnalysis();
  }, []);

  const spinnerStyle = useAnimatedStyle(() => ({
    transform: [{ rotate: `${spinnerRotation.value}deg` }],
  }));

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
    setScreenState('loading');
    setErrorMessage('');
    setDetectedPills([]);

    try {
      const draft = await draftService.loadDraft();
      if (!draft) {
        setErrorMessage('Brouillon introuvable');
        setScreenState('error');
        return;
      }

      const response = await analyzeProductImage(photos, {
        draftId: draft.id,
        onProgress: (p) => {
          progressWidth.value = withTiming(p, { duration: 300 });
        },
        onPhaseChange: (phase: AnalysisPhase, _message: string) => {
          updateProgressSteps(phase);
          if (phase === 'category') setDetectedPills((prev) => [...new Set([...prev, 'Catégorie'])]);
          if (phase === 'analysis') setDetectedPills((prev) => [...new Set([...prev, 'Catégorie', 'Couleur', 'Matière'])]);
          if (phase === 'brand') setDetectedPills((prev) => [...new Set([...prev, 'Catégorie', 'Couleur', 'Matière', 'Marque'])]);
        },
      });

      if (response.success && response.result) {
        const urls = response.storageUrls || [];
        setStorageUrls(urls);
        setAiResult(response.result);
        await draftService.updateDraftAIResult(draft, response.result, urls);
        buildFinalPills(response.result);
        setProgressSteps((prev) => prev.map((s) => ({ ...s, state: 'done' as const })));
        setScreenState('complete');
      } else {
        setErrorMessage(response.error?.message || "Une erreur est survenue lors de l'analyse");
        setScreenState('error');
      }
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : 'Une erreur est survenue';
      setErrorMessage(message);
      setScreenState('error');
    }
  };

  const handleContinue = () => {
    if (!aiResult) return;
    router.push({
      pathname: '/sell/details',
      params: {
        photos: JSON.stringify(photos),
        aiResult: JSON.stringify(aiResult),
        storageUrls: JSON.stringify(storageUrls),
      },
    });
  };

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

  return (
    <View style={styles.container}>
      {/* Header -- charcoal zone */}
      <View style={[styles.headerBar, { paddingTop: insets.top }]}>
        <StepProgressBar currentStep={screenState === 'complete' ? 3 : 2} />

        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={styles.photoStrip}
          style={styles.photoStripContainer}
        >
          {photos.map((uri, index) => (
            <Image
              key={`photo-${index}`}
              source={{ uri }}
              style={styles.photoThumb}
              contentFit="cover"
            />
          ))}
        </ScrollView>
      </View>

      <ScrollView
        style={styles.scrollView}
        contentContainerStyle={styles.scrollContent}
        showsVerticalScrollIndicator={false}
      >
        <AnalysisCard
          screenState={screenState}
          errorMessage={errorMessage}
          prefilledCount={prefilledCount}
          detectedPills={detectedPills}
          spinnerStyle={spinnerStyle}
          progressWidth={progressWidth}
        />

        {screenState === 'loading' && (
          <ProgressStepsList
            steps={progressSteps}
            stepSpinnerRotation={stepSpinnerRotation}
          />
        )}

        {screenState === 'complete' && aiResult && (
          <ResultsSummary aiResult={aiResult} />
        )}
      </ScrollView>

      <AnalysisFooter
        screenState={screenState}
        bottomInset={insets.bottom}
        onContinue={handleContinue}
        onRetry={runAnalysis}
        onManualEntry={handleManualEntry}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.surfaceWarm,
  },
  headerBar: {
    backgroundColor: colors.charcoal,
  },
  photoStripContainer: {
    paddingBottom: 20,
  },
  photoStrip: {
    paddingHorizontal: spacing.lg,
    gap: 8,
  },
  photoThumb: {
    width: 72,
    height: 96,
    borderRadius: 0,
  },
  scrollView: {
    flex: 1,
  },
  scrollContent: {
    paddingHorizontal: 20,
    paddingTop: 20,
    paddingBottom: 32,
  },
});
