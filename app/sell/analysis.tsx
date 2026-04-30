import React, { useState, useEffect } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  ScrollView,
} from 'react-native';
import Animated, {
  useSharedValue,
  useAnimatedStyle,
  withRepeat,
  withTiming,
  withSpring,
  Easing,
  FadeIn,
  FadeInDown,
} from 'react-native-reanimated';
import { useRouter, useLocalSearchParams } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Image } from 'expo-image';
import { colors, fonts, spacing, radius, animations } from '@/constants/theme';
import StepProgressBar from '@/components/sell/StepProgressBar';
import FormFieldGroup from '@/components/sell/FormFieldGroup';
import ConfidenceDots from '@/components/sell/ConfidenceDots';
import { analyzeProductImage, createMockAIResult } from '@/services/aiService';
import { AIAnalysisResult, AnalysisPhase, ConfidenceLevel, CONDITION_DISPLAY } from '@/types/ai';
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
  const [progress, setProgress] = useState(0);
  const [currentPhase, setCurrentPhase] = useState<string>('Envoi des images...');
  const [aiResult, setAiResult] = useState<AIAnalysisResult | null>(null);
  const [storageUrls, setStorageUrls] = useState<string[]>([]);
  const [errorMessage, setErrorMessage] = useState<string>('');
  const [detectedPills, setDetectedPills] = useState<string[]>([]);
  const [progressSteps, setProgressSteps] = useState<ProgressStep[]>([
    { label: 'Categorie detectee', state: 'pending' },
    { label: 'Couleur et matiere identifiees', state: 'pending' },
    { label: "Lecture de l'etiquette...", state: 'pending' },
    { label: 'Generation du titre et description', state: 'pending' },
  ]);

  // Animated spinner rotation
  const spinnerRotation = useSharedValue(0);
  const progressWidth = useSharedValue(0);
  // Small spinner for active step
  const stepSpinnerRotation = useSharedValue(0);

  useEffect(() => {
    spinnerRotation.value = withRepeat(
      withTiming(360, { duration: 1200, easing: Easing.linear }),
      -1,
      false
    );
    stepSpinnerRotation.value = withRepeat(
      withTiming(360, { duration: 1000, easing: Easing.linear }),
      -1,
      false
    );
  }, []);

  useEffect(() => {
    runAnalysis();
  }, []);

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
      { label: 'Categorie detectee', state: activeIndex > 0 ? 'done' : activeIndex === 0 ? 'active' : 'pending' },
      { label: 'Couleur et matiere identifiees', state: activeIndex > 1 ? 'done' : activeIndex === 1 ? 'active' : 'pending' },
      { label: "Lecture de l'etiquette...", state: activeIndex > 2 ? 'done' : activeIndex === 2 ? 'active' : 'pending' },
      { label: 'Generation du titre et description', state: activeIndex > 3 ? 'done' : activeIndex === 3 ? 'active' : 'pending' },
    ]);
  };

  const runAnalysis = async () => {
    setScreenState('loading');
    setProgress(0);
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
          setProgress(p);
          progressWidth.value = withTiming(p, { duration: 300 });
        },
        onPhaseChange: (phase: AnalysisPhase, message: string) => {
          setCurrentPhase(message);
          updateProgressSteps(phase);
          // Progressively add pills
          if (phase === 'category') setDetectedPills((prev) => [...new Set([...prev, 'Categorie'])]);
          if (phase === 'analysis') setDetectedPills((prev) => [...new Set([...prev, 'Categorie', 'Couleur', 'Matiere'])]);
          if (phase === 'brand') setDetectedPills((prev) => [...new Set([...prev, 'Categorie', 'Couleur', 'Matiere', 'Marque'])]);
        },
      });

      if (response.success && response.result) {
        const urls = response.storageUrls || [];
        setStorageUrls(urls);
        setAiResult(response.result);
        await draftService.updateDraftAIResult(draft, response.result, urls);
        // Build final pills from result
        buildFinalPills(response.result);
        // Mark all steps done
        setProgressSteps((prev) => prev.map((s) => ({ ...s, state: 'done' as const })));
        setScreenState('complete');
      } else {
        setErrorMessage(
          response.error?.message || "Une erreur est survenue lors de l'analyse"
        );
        setScreenState('error');
      }
    } catch (error: any) {
      setErrorMessage(error.message || 'Une erreur est survenue');
      setScreenState('error');
    }
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

  const spinnerStyle = useAnimatedStyle(() => ({
    transform: [{ rotate: `${spinnerRotation.value}deg` }],
  }));

  const stepSpinnerStyle = useAnimatedStyle(() => ({
    transform: [{ rotate: `${stepSpinnerRotation.value}deg` }],
  }));

  const progressBarStyle = useAnimatedStyle(() => ({
    width: `${progressWidth.value}%`,
  }));

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

  const getConfidence = (field: string): ConfidenceLevel | undefined => {
    if (!aiResult) return undefined;
    if (field === 'brand') return aiResult.brand?.confidence as ConfidenceLevel | undefined;
    if (field === 'condition') return aiResult.condition?.confidence as ConfidenceLevel | undefined;
    if (field === 'size') return aiResult.size?.confidence as ConfidenceLevel | undefined;
    return undefined;
  };

  return (
    <View style={styles.container}>
      {/* Header — charcoal zone */}
      <View style={[styles.headerBar, { paddingTop: insets.top }]}>
        <StepProgressBar currentStep={screenState === 'complete' ? 3 : 2} />

        {/* Photo strip in charcoal zone */}
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
        {/* Analysis card */}
        <View style={styles.analysisCard}>
          {screenState === 'loading' && (
            <>
              <Animated.View style={[styles.spinnerContainer, spinnerStyle]}>
                <Ionicons name="sync-outline" size={24} color={colors.sage} />
              </Animated.View>

              <Text style={styles.analysisTitle}>Analyse en cours</Text>
              <Text style={styles.analysisSubtitle}>
                Notre IA identifie les details{'\n'}de ton article
              </Text>

              {/* Progress bar */}
              <View style={styles.progressBarContainer}>
                <Animated.View style={[styles.progressBarFill, progressBarStyle]} />
              </View>
            </>
          )}

          {screenState === 'complete' && (
            <>
              <Animated.View
                entering={FadeIn.duration(300)}
                style={styles.completeIconContainer}
              >
                <Ionicons name="checkmark" size={20} color={colors.white} />
              </Animated.View>

              <Text style={styles.completeTitleInline}>Analyse terminee</Text>
              <Text style={styles.completeSubInline}>
                {prefilledCount} champs pre-remplis
              </Text>
            </>
          )}

          {screenState === 'error' && (
            <>
              <View style={styles.errorIconContainer}>
                <Ionicons name="alert-circle-outline" size={24} color={colors.danger} />
              </View>

              <Text style={styles.analysisTitle}>Erreur d'analyse</Text>
              <Text style={styles.analysisSubtitle}>{errorMessage}</Text>
            </>
          )}

          {/* Detection pills */}
          {detectedPills.length > 0 && (
            <View style={styles.pillsRow}>
              {detectedPills.map((pill, index) => (
                <Animated.View
                  key={pill}
                  entering={FadeInDown.delay(index * 80).duration(200)}
                  style={styles.detectionPill}
                >
                  <Text style={styles.detectionPillText}>{pill}</Text>
                </Animated.View>
              ))}
            </View>
          )}
        </View>

        {/* Progress steps checklist (during loading) */}
        {screenState === 'loading' && (
          <View style={styles.stepsChecklist}>
            {progressSteps.map((step, index) => (
              <Animated.View
                key={step.label}
                entering={FadeInDown.delay(index * 100).duration(250)}
                style={styles.stepItem}
              >
                {step.state === 'done' && (
                  <View style={styles.stepIconDone}>
                    <Ionicons name="checkmark" size={10} color={colors.white} />
                  </View>
                )}
                {step.state === 'active' && (
                  <View style={styles.stepIconActive}>
                    <Animated.View style={stepSpinnerStyle}>
                      <View style={styles.stepSpinnerInner} />
                    </Animated.View>
                  </View>
                )}
                {step.state === 'pending' && (
                  <View style={styles.stepIconPending} />
                )}
                <Text
                  style={[
                    styles.stepText,
                    step.state === 'done' && styles.stepTextDone,
                    step.state === 'pending' && styles.stepTextPending,
                  ]}
                >
                  {step.label}
                </Text>
              </Animated.View>
            ))}
          </View>
        )}

        {/* Results summary (when complete) — with confidence dots */}
        {screenState === 'complete' && aiResult && (
          <Animated.View entering={FadeInDown.delay(200).duration(300)}>
            <View style={styles.sectionTitle}>
              <Text style={styles.sectionTitleText}>RESUME DE L'ANALYSE</Text>
              <View style={styles.sectionTitleLine} />
            </View>
            <FormFieldGroup>
              {aiResult.title ? (
                <View style={styles.resultRow}>
                  <Text style={styles.resultLabel}>TITRE</Text>
                  <Text style={styles.resultValue} numberOfLines={1}>{aiResult.title}</Text>
                  <ConfidenceDots level="high" />
                </View>
              ) : null}
              {aiResult.brand?.detected ? (
                <View style={styles.resultRow}>
                  <Text style={styles.resultLabel}>MARQUE</Text>
                  <Text style={styles.resultValue}>{aiResult.brand.detected}</Text>
                  <View style={styles.aiBadge}>
                    <Text style={styles.aiBadgeText}>IA</Text>
                  </View>
                </View>
              ) : null}
              {aiResult.category?.displayName ? (
                <View style={styles.resultRow}>
                  <Text style={styles.resultLabel}>CATEGORIE</Text>
                  <Text style={styles.resultValue}>
                    {aiResult.category.fullLabel
                      ? aiResult.category.fullLabel.split(' > ').slice(0, 2).join(' / ')
                      : aiResult.category.displayName}
                  </Text>
                  <ConfidenceDots level={aiResult.category?.categoryId ? 'medium' : 'low'} />
                </View>
              ) : null}
              {aiResult.condition?.conditionId ? (
                <View style={styles.resultRow}>
                  <Text style={styles.resultLabel}>ETAT</Text>
                  <Text style={styles.resultValue}>
                    {CONDITION_DISPLAY[aiResult.condition.conditionId] || aiResult.condition.conditionId}
                  </Text>
                  <View style={styles.aiBadge}>
                    <Text style={styles.aiBadgeText}>IA</Text>
                  </View>
                </View>
              ) : null}
              {aiResult.size?.normalized ? (
                <View style={styles.resultRow}>
                  <Text style={styles.resultLabel}>TAILLE</Text>
                  <Text style={styles.resultValue}>{aiResult.size.normalized}</Text>
                  <View style={styles.aiBadge}>
                    <Text style={styles.aiBadgeText}>IA</Text>
                  </View>
                </View>
              ) : null}
              {aiResult.colors?.primaryColorId ? (
                <View style={styles.resultRow}>
                  <Text style={styles.resultLabel}>COULEUR</Text>
                  <Text style={styles.resultValue}>{aiResult.colors.primaryColorId}</Text>
                  <View style={styles.aiBadge}>
                    <Text style={styles.aiBadgeText}>IA</Text>
                  </View>
                </View>
              ) : null}
              {aiResult.materials?.primaryMaterialId ? (
                <View style={styles.resultRow}>
                  <Text style={styles.resultLabel}>MATIERE</Text>
                  <Text style={styles.resultValue}>{aiResult.materials.primaryMaterialId}</Text>
                  <View style={styles.aiBadge}>
                    <Text style={styles.aiBadgeText}>IA</Text>
                  </View>
                </View>
              ) : null}
            </FormFieldGroup>
          </Animated.View>
        )}
      </ScrollView>

      {/* Footer */}
      <View style={[styles.footer, { paddingBottom: insets.bottom + 16 }]}>
        {screenState === 'complete' && (
          <TouchableOpacity
            style={styles.primaryButton}
            onPress={handleContinue}
            activeOpacity={0.85}
          >
            <Text style={styles.primaryButtonText}>MODIFIER LES DETAILS</Text>
            <Ionicons name="arrow-forward" size={18} color={colors.cream} />
          </TouchableOpacity>
        )}

        {screenState === 'error' && (
          <>
            <TouchableOpacity
              style={styles.primaryButton}
              onPress={runAnalysis}
              activeOpacity={0.85}
            >
              <Ionicons name="refresh-outline" size={18} color={colors.cream} />
              <Text style={styles.primaryButtonText}>REESSAYER</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={styles.manualLink}
              onPress={handleManualEntry}
            >
              <Text style={styles.manualLinkText}>ou remplir manuellement</Text>
            </TouchableOpacity>
          </>
        )}

        {screenState === 'loading' && (
          <TouchableOpacity
            style={styles.manualLink}
            onPress={handleManualEntry}
          >
            <Text style={styles.manualLinkText}>Passer et remplir manuellement</Text>
          </TouchableOpacity>
        )}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.surfaceWarm,
  },
  // Header — charcoal zone (step bar + photo strip)
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
  // Analysis card
  analysisCard: {
    backgroundColor: colors.charcoal,
    borderRadius: radius.sm,
    padding: spacing.lg,
    alignItems: 'center',
    marginBottom: spacing.md,
    overflow: 'hidden',
  },
  spinnerContainer: {
    width: 48,
    height: 48,
    borderRadius: 24,
    backgroundColor: 'rgba(122, 140, 110, 0.15)',
    justifyContent: 'center',
    alignItems: 'center',
    marginBottom: spacing.md,
  },
  completeIconContainer: {
    width: 32,
    height: 32,
    borderRadius: 16,
    backgroundColor: colors.sage,
    justifyContent: 'center',
    alignItems: 'center',
    marginBottom: 10,
  },
  errorIconContainer: {
    width: 48,
    height: 48,
    borderRadius: 24,
    backgroundColor: colors.dangerLight,
    justifyContent: 'center',
    alignItems: 'center',
    marginBottom: spacing.md,
  },
  analysisTitle: {
    fontFamily: fonts.displayMedium,
    fontSize: 22,
    color: colors.cream,
    marginBottom: 6,
    textAlign: 'center',
  },
  analysisSubtitle: {
    fontFamily: fonts.sans,
    fontSize: 12,
    color: 'rgba(245, 240, 232, 0.4)',
    textAlign: 'center',
    lineHeight: 20,
    marginBottom: spacing.md,
  },
  completeTitleInline: {
    fontFamily: fonts.sansMedium,
    fontSize: 13,
    color: colors.cream,
    marginBottom: 4,
  },
  completeSubInline: {
    fontFamily: fonts.sans,
    fontSize: 11,
    color: 'rgba(245, 240, 232, 0.4)',
  },
  // Progress bar
  progressBarContainer: {
    width: '100%',
    height: 2,
    backgroundColor: 'rgba(255, 255, 255, 0.06)',
    borderRadius: 1,
    overflow: 'hidden',
    marginTop: 14,
  },
  progressBarFill: {
    height: '100%',
    backgroundColor: colors.sage,
    borderRadius: 1,
  },
  // Detection pills
  pillsRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    justifyContent: 'center',
    gap: 5,
    marginTop: 12,
  },
  detectionPill: {
    paddingHorizontal: 10,
    paddingVertical: 3,
    backgroundColor: 'rgba(122, 140, 110, 0.15)',
    borderWidth: 1,
    borderColor: 'rgba(122, 140, 110, 0.25)',
    borderRadius: 2,
  },
  detectionPillText: {
    fontFamily: fonts.sansMedium,
    fontSize: 10,
    color: colors.sage,
    letterSpacing: 0.6,
  },
  // Progress steps checklist
  stepsChecklist: {
    gap: 12,
    marginBottom: spacing.lg,
  },
  stepItem: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  stepIconDone: {
    width: 24,
    height: 24,
    borderRadius: 12,
    backgroundColor: colors.sage,
    justifyContent: 'center',
    alignItems: 'center',
  },
  stepIconActive: {
    width: 24,
    height: 24,
    borderRadius: 12,
    borderWidth: 1.5,
    borderColor: colors.borderStrong,
    justifyContent: 'center',
    alignItems: 'center',
  },
  stepSpinnerInner: {
    width: 8,
    height: 8,
    borderRadius: 4,
    borderWidth: 1.5,
    borderColor: 'transparent',
    borderTopColor: colors.rust,
  },
  stepIconPending: {
    width: 24,
    height: 24,
    borderRadius: 12,
    borderWidth: 1.5,
    borderColor: colors.border,
  },
  stepText: {
    fontFamily: fonts.sans,
    fontSize: 12,
    color: colors.charcoal,
  },
  stepTextDone: {
    color: colors.charcoal,
  },
  stepTextPending: {
    color: colors.muted,
  },
  // Section title
  sectionTitle: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    marginBottom: 14,
  },
  sectionTitleText: {
    fontFamily: fonts.sansMedium,
    fontSize: 9,
    letterSpacing: 1.8,
    color: colors.muted,
    textTransform: 'uppercase',
  },
  sectionTitleLine: {
    flex: 1,
    height: 1,
    backgroundColor: colors.border,
  },
  // Results summary
  resultRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingVertical: 13,
  },
  resultLabel: {
    fontFamily: fonts.sansMedium,
    fontSize: 11,
    letterSpacing: 0.88,
    color: colors.muted,
    width: 80,
  },
  resultValue: {
    flex: 1,
    fontFamily: fonts.sans,
    fontSize: 14,
    color: colors.charcoal,
  },
  aiBadge: {
    backgroundColor: colors.sageLight,
    paddingHorizontal: 8,
    paddingVertical: 2,
    borderRadius: 100,
    marginLeft: 8,
  },
  aiBadgeText: {
    fontFamily: fonts.sansMedium,
    fontSize: 9,
    color: colors.sage,
    letterSpacing: 0.72,
  },
  // Footer
  footer: {
    backgroundColor: colors.cream,
    paddingTop: 16,
    paddingHorizontal: 24,
    borderTopWidth: 1,
    borderTopColor: colors.border,
  },
  primaryButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.charcoal,
    paddingVertical: 16,
    borderRadius: radius.md,
    gap: 10,
  },
  primaryButtonText: {
    fontFamily: fonts.sansMedium,
    fontSize: 12,
    letterSpacing: 2.16,
    color: colors.cream,
    textTransform: 'uppercase',
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
});
