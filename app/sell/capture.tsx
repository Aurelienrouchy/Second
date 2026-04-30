/**
 * Camera Capture Screen
 * Design System: Editorial Luxe — Cream, Charcoal, Rust, Sage
 *
 * Full-screen camera with:
 * - Top row: close | counter pill | flip (single row over blur)
 * - Viewfinder: corner brackets + contextual guide text
 * - Bottom: thumbnail strip + gallery / capture / continue controls
 */

import React, { useState, useCallback, useEffect, useRef } from 'react';
import {
  View,
  Text,
  StyleSheet,
  Pressable,
  Alert,
  ScrollView,
  ActivityIndicator,
  Linking,
} from 'react-native';
import { useRouter, useLocalSearchParams } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { CameraView, CameraType, useCameraPermissions } from 'expo-camera';
import * as ImagePicker from 'expo-image-picker';
import { Image } from 'expo-image';

import { colors, fonts, spacing, radius } from '@/constants/theme';
import BlurOverlay from '@/components/sell/BlurOverlay';
import CameraGuides from '@/components/sell/CameraGuides';
import draftService, { ArticleDraft, createEmptyDraft } from '@/services/draftService';

// =============================================================================
// CONSTANTS
// =============================================================================

const MAX_PHOTOS = 5;

type SaveStatus = 'idle' | 'saving' | 'saved' | 'error';

// =============================================================================
// MAIN COMPONENT
// =============================================================================

export default function CaptureScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const params = useLocalSearchParams();
  const cameraRef = useRef<CameraView>(null);

  // Check if resuming from draft
  const isResuming = params.resumeDraft === 'true';
  const resumedPhotos: string[] = params.photos
    ? JSON.parse(params.photos as string)
    : [];

  const [photos, setPhotos] = useState<string[]>(isResuming ? resumedPhotos : []);
  const [permission, requestPermission] = useCameraPermissions();
  const [facing, setFacing] = useState<CameraType>('back');
  const [isCapturing, setIsCapturing] = useState(false);
  const [saveStatus, setSaveStatus] = useState<SaveStatus>('idle');
  const [draft, setDraft] = useState<ArticleDraft | null>(null);

  const canTakeMore = photos.length < MAX_PHOTOS;

  // Request permission on mount
  useEffect(() => {
    if (!permission?.granted && permission?.canAskAgain) {
      requestPermission();
    }
  }, [permission]);

  // Initialize or load draft on mount
  useEffect(() => {
    const initDraft = async () => {
      if (isResuming) {
        const existingDraft = await draftService.loadDraft();
        if (existingDraft) {
          setDraft(existingDraft);
        }
      } else {
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

    const timeoutId = setTimeout(() => {
      if (photos.length > 0) {
        savePhotos();
      } else if (draft.photos.length > 0) {
        savePhotos();
      }
    }, 300);

    return () => clearTimeout(timeoutId);
  }, [photos, draft?.id]);

  // =============================================================================
  // HANDLERS
  // =============================================================================

  const handleCapture = async () => {
    if (!cameraRef.current || isCapturing || !canTakeMore) return;

    setIsCapturing(true);
    try {
      const photo = await cameraRef.current.takePictureAsync({
        quality: 0.7,
        skipProcessing: false,
      });
      if (photo?.uri) {
        setPhotos((prev) => {
          if (prev.length >= MAX_PHOTOS) return prev;
          return [...prev, photo.uri];
        });
      }
    } catch (error) {
      console.error('Error taking photo:', error);
    } finally {
      setIsCapturing(false);
    }
  };

  const handleGalleryPress = async () => {
    const remainingSlots = MAX_PHOTOS - photos.length;
    if (remainingSlots <= 0) return;

    try {
      const result = await ImagePicker.launchImageLibraryAsync({
        mediaTypes: ['images'] as const,
        allowsMultipleSelection: true,
        quality: 0.7,
        selectionLimit: remainingSlots,
      });

      if (!result.canceled && result.assets.length > 0) {
        const uris = result.assets.map((asset) => asset.uri);
        setPhotos((prev) => {
          const remaining = MAX_PHOTOS - prev.length;
          return [...prev, ...uris.slice(0, remaining)];
        });
      }
    } catch (error) {
      console.error('Error picking images:', error);
    }
  };

  const toggleCameraFacing = () => {
    setFacing((current) => (current === 'back' ? 'front' : 'back'));
  };

  const handleRemovePhoto = useCallback((index: number) => {
    setPhotos((prev) => prev.filter((_, i) => i !== index));
  }, []);

  const handleClose = () => {
    if (photos.length > 0) {
      Alert.alert(
        'Quitter ?',
        'Votre brouillon sera sauvegarde. Vous pourrez le reprendre plus tard.',
        [
          { text: 'Annuler', style: 'cancel' },
          {
            text: 'Quitter',
            onPress: () => router.replace('/(tabs)'),
          },
        ],
      );
    } else {
      draftService.deleteDraft();
      router.replace('/(tabs)');
    }
  };

  const handleContinue = () => {
    if (photos.length === 0) {
      Alert.alert('Aucune photo', 'Ajoutez au moins une photo pour continuer.');
      return;
    }

    router.push({
      pathname: '/sell/photos-review',
      params: {
        photos: JSON.stringify(photos),
      },
    });
  };

  // Overlay heights
  const topOverlayHeight = insets.top + 56;
  const bottomOverlayHeight = photos.length > 0 ? 200 + insets.bottom : 140 + insets.bottom;

  // =============================================================================
  // PERMISSION STATES
  // =============================================================================

  if (!permission) {
    return (
      <View style={styles.container}>
        <View style={styles.centerContent}>
          <ActivityIndicator size="large" color={colors.cream} />
        </View>
      </View>
    );
  }

  if (!permission.granted) {
    return (
      <View style={styles.container}>
        <View style={styles.permissionDenied}>
          <View style={styles.permissionIconCircle}>
            <Ionicons name="camera-outline" size={32} color={colors.muted} />
          </View>
          <Text style={styles.permissionTitle}>Acces camera requis</Text>
          <Text style={styles.permissionText}>
            Pour prendre des photos de vos articles, autorisez l'acces a la camera dans les reglages.
          </Text>

          <Pressable
            style={styles.settingsButton}
            onPress={() => Linking.openSettings()}
          >
            <Ionicons name="settings-outline" size={18} color={colors.cream} />
            <Text style={styles.settingsButtonText}>OUVRIR LES REGLAGES</Text>
          </Pressable>

          <Text style={styles.orText}>ou</Text>

          <Pressable style={styles.galleryFallbackButton} onPress={handleGalleryPress}>
            <Ionicons name="images-outline" size={20} color={colors.rust} />
            <Text style={styles.galleryFallbackText}>
              Selectionner depuis la galerie
            </Text>
          </Pressable>
        </View>
      </View>
    );
  }

  // =============================================================================
  // CAMERA VIEW
  // =============================================================================

  return (
    <View style={styles.container}>
      {/* Camera fills entire screen */}
      <CameraView
        ref={cameraRef}
        style={StyleSheet.absoluteFill}
        facing={facing}
      />

      {/* Top blur overlay */}
      <BlurOverlay position="top" height={topOverlayHeight} intensity={0.6} />

      {/* Camera guides — corner brackets between overlays */}
      <View
        style={[
          styles.guidesArea,
          { top: topOverlayHeight, bottom: bottomOverlayHeight },
        ]}
      >
        <CameraGuides
          message={
            photos.length === 0
              ? 'Cadre ton article'
              : photos.length === 1
                ? 'Ajoute un detail'
                : photos.length < MAX_PHOTOS
                  ? 'Continue !'
                  : undefined
          }
          subMessage={
            photos.length === 0
              ? 'Photo principale face avant'
              : photos.length === 1
                ? 'Etiquette, defaut, texture...'
                : photos.length < MAX_PHOTOS
                  ? 'Dos, cote, etiquette de taille...'
                  : undefined
          }
        />
      </View>

      {/* Bottom blur overlay */}
      <BlurOverlay position="bottom" height={bottomOverlayHeight} intensity={0.65} />

      {/* Top controls — close | counter | flip (single row, matching mockup) */}
      <View style={[styles.topControls, { paddingTop: insets.top + 8 }]}>
        <Pressable
          style={styles.circleButton}
          onPress={handleClose}
          hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
        >
          <Ionicons name="close" size={20} color={colors.cream} />
        </Pressable>

        <View style={styles.counterPill}>
          <Text style={styles.counterText}>
            {photos.length} / {MAX_PHOTOS}
          </Text>
        </View>

        <Pressable
          style={styles.circleButton}
          onPress={toggleCameraFacing}
          hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
        >
          <Ionicons name="camera-reverse-outline" size={20} color={colors.cream} />
        </Pressable>
      </View>

      {/* Max reached badge */}
      {!canTakeMore && (
        <View style={[styles.maxBadge, { top: topOverlayHeight + 12 }]}>
          <Text style={styles.maxBadgeText}>Maximum atteint</Text>
        </View>
      )}

      {/* Bottom section (over blur overlay) */}
      <View style={[styles.bottomSection, { paddingBottom: insets.bottom + 16 }]}>
        {/* Thumbnail strip */}
        {photos.length > 0 && (
          <ScrollView
            horizontal
            showsHorizontalScrollIndicator={false}
            contentContainerStyle={styles.thumbnailStrip}
            style={styles.thumbnailScrollView}
          >
            {photos.map((uri, index) => (
              <View key={`${uri}-${index}`} style={styles.thumbWrapper}>
                <Image
                  source={{ uri }}
                  style={[
                    styles.thumbnail,
                    index === 0 && styles.thumbnailPrimary,
                  ]}
                  contentFit="cover"
                />
                {index === 0 && <View style={styles.primaryDot} />}
                <Pressable
                  style={styles.thumbRemove}
                  onPress={() => handleRemovePhoto(index)}
                  hitSlop={{ top: 6, bottom: 6, left: 6, right: 6 }}
                >
                  <Ionicons name="close" size={10} color={colors.white} />
                </Pressable>
              </View>
            ))}
          </ScrollView>
        )}

        {/* Camera controls */}
        <View style={styles.controlsRow}>
          {/* Gallery button */}
          <Pressable
            style={[
              styles.galleryButton,
              !canTakeMore && styles.galleryButtonDisabled,
            ]}
            onPress={handleGalleryPress}
            disabled={!canTakeMore}
          >
            <Ionicons
              name="images-outline"
              size={22}
              color={canTakeMore ? colors.cream : colors.muted}
            />
          </Pressable>

          {/* Capture button */}
          <Pressable
            style={styles.captureButton}
            onPress={handleCapture}
            disabled={!canTakeMore || isCapturing}
          >
            <View
              style={[
                styles.captureButtonOuter,
                !canTakeMore && styles.captureButtonOuterDisabled,
              ]}
            />
            {isCapturing ? (
              <ActivityIndicator size="small" color={colors.charcoal} />
            ) : (
              <View
                style={[
                  styles.captureButtonInner,
                  !canTakeMore && styles.captureButtonInnerDisabled,
                ]}
              />
            )}
          </Pressable>

          {/* Continue button or placeholder */}
          {photos.length > 0 ? (
            <Pressable style={styles.continueButton} onPress={handleContinue}>
              <Text style={styles.continueText}>Continuer</Text>
              <Ionicons name="arrow-forward" size={14} color={colors.cream} />
            </Pressable>
          ) : (
            <View style={styles.placeholderButton} />
          )}
        </View>
      </View>
    </View>
  );
}

// =============================================================================
// STYLES
// =============================================================================

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#0F0E0C',
  },
  centerContent: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
  },

  // Guides area positioned between overlays
  guidesArea: {
    position: 'absolute',
    left: 0,
    right: 0,
    zIndex: 3,
  },

  // Top controls — single row: close | counter | flip
  topControls: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    zIndex: 10,
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: 20,
  },
  circleButton: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: 'rgba(0, 0, 0, 0.25)',
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.15)',
    justifyContent: 'center',
    alignItems: 'center',
  },

  // Counter pill — inline between buttons
  counterPill: {
    backgroundColor: 'rgba(0, 0, 0, 0.5)',
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 20,
  },
  counterText: {
    fontFamily: fonts.sansMedium,
    fontSize: 11,
    color: 'rgba(245, 240, 232, 0.7)',
    letterSpacing: 0.7,
  },

  // Max reached badge
  maxBadge: {
    position: 'absolute',
    alignSelf: 'center',
    zIndex: 10,
    backgroundColor: colors.danger,
    paddingHorizontal: 16,
    paddingVertical: 6,
    borderRadius: 20,
  },
  maxBadgeText: {
    fontFamily: fonts.sansMedium,
    fontSize: 11,
    color: colors.cream,
    letterSpacing: 0.3,
  },

  // Bottom section
  bottomSection: {
    position: 'absolute',
    bottom: 0,
    left: 0,
    right: 0,
    zIndex: 10,
  },

  // Thumbnail strip
  thumbnailScrollView: {
    marginBottom: 16,
    borderTopWidth: 1,
    borderTopColor: 'rgba(245, 240, 232, 0.06)',
  },
  thumbnailStrip: {
    paddingHorizontal: 24,
    paddingVertical: 12,
    gap: 8,
  },
  thumbWrapper: {
    position: 'relative',
  },
  thumbnail: {
    width: 52,
    height: 68,
    borderWidth: 2,
    borderColor: 'transparent',
  },
  thumbnailPrimary: {
    borderColor: colors.rust,
  },
  primaryDot: {
    position: 'absolute',
    bottom: -8,
    alignSelf: 'center',
    width: 6,
    height: 6,
    borderRadius: 3,
    backgroundColor: colors.rust,
  },
  thumbRemove: {
    position: 'absolute',
    top: -8,
    right: -8,
    width: 18,
    height: 18,
    borderRadius: 9,
    backgroundColor: colors.charcoal,
    justifyContent: 'center',
    alignItems: 'center',
  },

  // Camera controls row
  controlsRow: {
    flexDirection: 'row',
    justifyContent: 'center',
    alignItems: 'center',
    paddingHorizontal: 24,
    paddingTop: 20,
    gap: 24,
  },
  galleryButton: {
    width: 48,
    height: 48,
    borderRadius: 24,
    borderWidth: 1,
    borderColor: 'rgba(245, 240, 232, 0.15)',
    justifyContent: 'center',
    alignItems: 'center',
  },
  galleryButtonDisabled: {
    borderColor: 'rgba(140, 136, 128, 0.15)',
  },

  // Capture button — 72px outer ring + 56px inner fill
  captureButton: {
    width: 72,
    height: 72,
    justifyContent: 'center',
    alignItems: 'center',
  },
  captureButtonOuter: {
    position: 'absolute',
    width: 72,
    height: 72,
    borderRadius: 36,
    borderWidth: 2,
    borderColor: 'rgba(245, 240, 232, 0.4)',
  },
  captureButtonOuterDisabled: {
    borderColor: 'rgba(140, 136, 128, 0.3)',
  },
  captureButtonInner: {
    width: 56,
    height: 56,
    borderRadius: 28,
    backgroundColor: colors.cream,
  },
  captureButtonInnerDisabled: {
    backgroundColor: colors.muted,
  },

  // Continue button — rust pill
  continueButton: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    backgroundColor: colors.rust,
    paddingHorizontal: 20,
    paddingVertical: 12,
    borderRadius: 20,
  },
  continueText: {
    fontFamily: fonts.sansMedium,
    fontSize: 13,
    color: colors.cream,
    letterSpacing: 0.3,
  },
  placeholderButton: {
    width: 48,
    height: 48,
  },

  // =============================================================================
  // PERMISSION DENIED STATE
  // =============================================================================

  permissionDenied: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    padding: 32,
    backgroundColor: colors.surfaceWarm,
  },
  permissionIconCircle: {
    width: 72,
    height: 72,
    borderRadius: 36,
    backgroundColor: 'rgba(26, 24, 20, 0.04)',
    justifyContent: 'center',
    alignItems: 'center',
    marginBottom: spacing.md,
  },
  permissionTitle: {
    fontFamily: fonts.displaySemiBold,
    fontSize: 22,
    lineHeight: 28,
    color: colors.charcoal,
    marginBottom: spacing.sm,
  },
  permissionText: {
    fontFamily: fonts.sans,
    fontSize: 14,
    lineHeight: 22,
    color: colors.muted,
    textAlign: 'center',
    marginBottom: spacing.lg,
  },
  settingsButton: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    backgroundColor: colors.charcoal,
    paddingHorizontal: 24,
    paddingVertical: 14,
    borderRadius: radius.sm,
  },
  settingsButtonText: {
    fontFamily: fonts.sansMedium,
    color: colors.cream,
    fontSize: 11,
    letterSpacing: 2.16,
  },
  orText: {
    fontFamily: fonts.sans,
    fontSize: 13,
    color: colors.muted,
    marginVertical: 16,
  },
  galleryFallbackButton: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingVertical: 12,
  },
  galleryFallbackText: {
    fontFamily: fonts.sansMedium,
    fontSize: 14,
    color: colors.rust,
  },
});
