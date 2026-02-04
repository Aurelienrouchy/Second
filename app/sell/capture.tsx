import React, { useState, useCallback, useEffect } from 'react';
import { View, Text, StyleSheet, TouchableOpacity, Alert } from 'react-native';
import { useRouter, useLocalSearchParams } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import CameraCapture from '@/components/CameraCapture';
import PhotoStrip from '@/components/PhotoStrip';
import StepIndicator from '@/components/StepIndicator';
import AIAnalysisLoader from '@/components/AIAnalysisLoader';
import { analyzeProductImage, createMockAIResult } from '@/services/aiService';
import { AIAnalysisResult } from '@/types/ai';
import draftService, { ArticleDraft, createEmptyDraft } from '@/services/draftService';

const MAX_PHOTOS = 5;

type SaveStatus = 'idle' | 'saving' | 'saved' | 'error';

export default function CaptureScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const params = useLocalSearchParams();

  // Check if resuming from draft
  const isResuming = params.resumeDraft === 'true';
  const resumedPhotos: string[] = params.photos
    ? JSON.parse(params.photos as string)
    : [];

  const [photos, setPhotos] = useState<string[]>(isResuming ? resumedPhotos : []);
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const [analysisError, setAnalysisError] = useState<string | undefined>();
  const [saveStatus, setSaveStatus] = useState<SaveStatus>('idle');
  const [draft, setDraft] = useState<ArticleDraft | null>(null);

  // Initialize or load draft on mount
  useEffect(() => {
    const initDraft = async () => {
      if (isResuming) {
        // Load existing draft
        const existingDraft = await draftService.loadDraft();
        if (existingDraft) {
          setDraft(existingDraft);
        }
      } else {
        // Create new draft
        const newDraft = createEmptyDraft();
        await draftService.saveDraft(newDraft);
        setDraft(newDraft);
      }
    };
    initDraft();
  }, [isResuming]);

  // Save photos to draft when they change
  useEffect(() => {
    if (!draft) return;

    const savePhotos = async () => {
      setSaveStatus('saving');
      try {
        const updatedDraft = await draftService.updateDraftPhotos(draft, photos);
        setDraft(updatedDraft);
        setSaveStatus('saved');
        setTimeout(() => setSaveStatus('idle'), 2000);
      } catch (error) {
        setSaveStatus('error');
        console.error('Failed to save photos:', error);
      }
    };

    // Save when photos change (including when all removed)
    // Use a small debounce to avoid saving on every rapid change
    const timeoutId = setTimeout(() => {
      if (photos.length > 0) {
        savePhotos();
      } else if (draft.photos.length > 0) {
        // Photos were cleared - update draft
        savePhotos();
      }
    }, 300);

    return () => clearTimeout(timeoutId);
  }, [photos, draft?.id]); // Depend on photos array and draft id

  const handlePhotoTaken = useCallback((uri: string) => {
    setPhotos((prev) => {
      if (prev.length >= MAX_PHOTOS) return prev;
      return [...prev, uri];
    });
  }, []);

  const handlePhotosSelected = useCallback((uris: string[]) => {
    setPhotos((prev) => {
      const remaining = MAX_PHOTOS - prev.length;
      const newPhotos = uris.slice(0, remaining);
      return [...prev, ...newPhotos];
    });
  }, []);

  const handleRemovePhoto = useCallback((index: number) => {
    setPhotos((prev) => prev.filter((_, i) => i !== index));
  }, []);

  const handleMakePrimary = useCallback((index: number) => {
    if (index === 0) return; // Already primary
    setPhotos((prev) => {
      const newPhotos = [...prev];
      const [photo] = newPhotos.splice(index, 1);
      newPhotos.unshift(photo);
      return newPhotos;
    });
  }, []);

  const handleClose = () => {
    if (photos.length > 0) {
      Alert.alert(
        'Quitter?',
        'Votre brouillon sera sauvegardé. Vous pourrez le reprendre plus tard.',
        [
          { text: 'Annuler', style: 'cancel' },
          {
            text: 'Quitter',
            onPress: () => router.replace('/(tabs)'),
          },
        ]
      );
    } else {
      // No photos, delete the draft
      draftService.deleteDraft();
      router.replace('/(tabs)');
    }
  };

  const handleAnalyze = async () => {
    if (photos.length === 0) {
      Alert.alert('Aucune photo', 'Ajoutez au moins une photo pour continuer.');
      return;
    }

    if (!draft) {
      Alert.alert('Erreur', 'Le brouillon n\'a pas été initialisé.');
      return;
    }

    setIsAnalyzing(true);
    setAnalysisError(undefined);

    try {
      // Analyze ALL photos for better detection (including label)
      // Pass draftId so images are uploaded to Storage under that ID
      const response = await analyzeProductImage(photos, {
        draftId: draft.id,
      });

      if (response.success && response.result) {
        // Save AI result AND storage URLs to draft
        const storageUrls = response.storageUrls || [];
        console.log('[Capture] 📸 AI analysis complete, storageUrls:', {
          count: storageUrls.length,
          urls: storageUrls,
        });
        const updatedDraft = await draftService.updateDraftAIResult(
          draft,
          response.result,
          storageUrls
        );
        setDraft(updatedDraft);

        // Navigate to details with AI results and storage URLs
        navigateToDetails(response.result, storageUrls);
      } else {
        // Show error
        setAnalysisError(response.error?.message || 'Une erreur est survenue');
      }
    } catch (error: any) {
      setAnalysisError(error.message || 'Une erreur est survenue');
    }
  };

  const navigateToDetails = (aiResult: AIAnalysisResult, storageUrls?: string[]) => {
    setIsAnalyzing(false);
    router.push({
      pathname: '/sell/details',
      params: {
        photos: JSON.stringify(photos),
        aiResult: JSON.stringify(aiResult),
        storageUrls: JSON.stringify(storageUrls || []),
      },
    });
  };

  const handleManualEntry = () => {
    // Navigate with empty/mock AI result
    const mockResult = createMockAIResult();
    navigateToDetails(mockResult);
  };

  const handleCancelAnalysis = () => {
    setIsAnalyzing(false);
    setAnalysisError(undefined);
  };

  return (
    <View style={styles.container}>
      {/* Custom header */}
      <View style={[styles.header, { paddingTop: insets.top }]}>
        <View style={styles.headerContent}>
          {/* Close button */}
          <TouchableOpacity onPress={handleClose} style={styles.headerButton}>
            <Ionicons name="close" size={28} color="#1F2937" />
          </TouchableOpacity>

          {/* Step indicator */}
          <View style={styles.stepIndicatorContainer}>
            <StepIndicator currentStep={1} />
          </View>

          {/* Spacer for alignment */}
          <View style={styles.headerButton} />
        </View>
      </View>

      {/* Camera view */}
      <View style={styles.cameraContainer}>
        <CameraCapture
          onPhotoTaken={handlePhotoTaken}
          onPhotosSelected={handlePhotosSelected}
          maxPhotos={MAX_PHOTOS}
          currentPhotoCount={photos.length}
        />
      </View>

      {/* Photo strip */}
      <PhotoStrip
        photos={photos}
        maxPhotos={MAX_PHOTOS}
        onRemove={handleRemovePhoto}
        onMakePrimary={handleMakePrimary}
      />

      {/* Action button */}
      <View style={[styles.footer, { paddingBottom: insets.bottom + 16 }]}>
        <TouchableOpacity
          style={[
            styles.analyzeButton,
            photos.length === 0 && styles.analyzeButtonDisabled,
          ]}
          onPress={handleAnalyze}
          disabled={photos.length === 0}
        >
          <Ionicons
            name="sparkles"
            size={20}
            color={photos.length > 0 ? '#FFFFFF' : '#9CA3AF'}
          />
          <Text
            style={[
              styles.analyzeButtonText,
              photos.length === 0 && styles.analyzeButtonTextDisabled,
            ]}
          >
            Analyser avec l'IA
          </Text>
        </TouchableOpacity>

        {photos.length === 0 && (
          <Text style={styles.helpText}>
            Prenez ou sélectionnez au moins une photo
          </Text>
        )}
      </View>

      {/* AI Analysis Loader */}
      <AIAnalysisLoader
        visible={isAnalyzing}
        imageUri={photos[0]}
        onCancel={handleCancelAnalysis}
        onManualEntry={handleManualEntry}
        error={analysisError}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#000000',
  },
  header: {
    backgroundColor: '#FFFFFF',
    borderBottomWidth: 1,
    borderBottomColor: '#E5E7EB',
  },
  headerContent: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 8,
    paddingBottom: 8,
  },
  headerButton: {
    width: 44,
    height: 44,
    justifyContent: 'center',
    alignItems: 'center',
  },
  stepIndicatorContainer: {
    flex: 1,
    alignItems: 'center',
  },
  cameraContainer: {
    flex: 1,
  },
  footer: {
    backgroundColor: '#FFFFFF',
    paddingTop: 16,
    paddingHorizontal: 16,
    borderTopWidth: 1,
    borderTopColor: '#E5E7EB',
  },
  analyzeButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#8B5CF6',
    paddingVertical: 16,
    borderRadius: 12,
    gap: 8,
  },
  analyzeButtonDisabled: {
    backgroundColor: '#E5E7EB',
  },
  analyzeButtonText: {
    color: '#FFFFFF',
    fontSize: 16,
    fontWeight: '600',
  },
  analyzeButtonTextDisabled: {
    color: '#9CA3AF',
  },
  helpText: {
    textAlign: 'center',
    color: '#9CA3AF',
    fontSize: 14,
    marginTop: 12,
  },
});
