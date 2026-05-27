/**
 * SellOverlayCapture — Camera capture UI rendered inside the ImmersiveOverlay.
 *
 * Reproduces the full camera capture experience from app/sell/capture.tsx
 * but without Expo Router dependencies (no useRouter, no useLocalSearchParams).
 * Photos are persisted to draftService so they survive app kills.
 * Designed to live above the Skia gradient overlay.
 *
 * Props:
 *   onClose     — dismiss the overlay (with confirmation if photos exist)
 *   onContinue  — hand captured photos to the parent for navigation
 */

import React, { useState, useCallback, useEffect, useRef } from 'react';
import { View, Text, StyleSheet, Alert } from 'react-native';
import Animated, { useSharedValue, useAnimatedStyle, withTiming, interpolate, Easing } from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { CameraView, CameraType, useCameraPermissions } from 'expo-camera';
import * as ImagePicker from 'expo-image-picker';

import { BlurView } from 'expo-blur';
import { colors, fonts } from '@/constants/theme';
import draftService, { createEmptyDraft, ArticleDraft } from '@/services/draftService';
import CameraGuides from '@/components/sell/CameraGuides';
import { PermissionDenied } from './PermissionDenied';
import { TopControls } from './TopControls';
import { ThumbnailStrip } from './ThumbnailStrip';
import { CameraControlsRow } from './CameraControlsRow';

const MAX_PHOTOS = 5;
const THUMB_CONTAINER_HEIGHT = 92;

interface SellOverlayCaptureProps {
  onClose: () => void;
  onContinue: (photos: string[]) => void;
}

function SellOverlayCaptureInner({ onClose, onContinue }: SellOverlayCaptureProps) {
  const insets = useSafeAreaInsets();
  const cameraRef = useRef<CameraView>(null);

  const [photos, setPhotos] = useState<string[]>([]);
  const [permission, requestPermission] = useCameraPermissions();
  const [facing, setFacing] = useState<CameraType>('back');
  const [isCapturing, setIsCapturing] = useState(false);
  const draftRef = useRef<ArticleDraft | null>(null);

  const canTakeMore = photos.length < MAX_PHOTOS;
  const hasPhotos = photos.length > 0;
  const showThumbStrip = hasPhotos || canTakeMore;

  // ── Thumb container height animation ──
  const thumbContainerHeight = useSharedValue(0);

  useEffect(() => {
    thumbContainerHeight.value = withTiming(showThumbStrip ? THUMB_CONTAINER_HEIGHT : 0, {
      duration: 300,
      easing: Easing.out(Easing.cubic),
    });
  }, [showThumbStrip]);

  const blurBottomStyle = useAnimatedStyle(() => ({
    height: bottomControlsHeight + thumbContainerHeight.value,
  }));

  const viewfinderBottom = useAnimatedStyle(() => ({
    bottom: bottomControlsHeight + thumbContainerHeight.value,
  }));

  const thumbContainerStyle = useAnimatedStyle(() => ({
    height: thumbContainerHeight.value,
    opacity: interpolate(thumbContainerHeight.value, [0, THUMB_CONTAINER_HEIGHT * 0.5], [0, 1]),
  }));

  // ── Initialize draft & restore photos ──
  useEffect(() => {
    const initDraft = async () => {
      try {
        const existingDraft = await draftService.loadDraft();
        if (existingDraft) {
          draftRef.current = existingDraft;
          if (existingDraft.photos.length > 0) {
            setPhotos(existingDraft.photos);
          }
        } else {
          const newDraft = createEmptyDraft();
          await draftService.saveDraft(newDraft);
          draftRef.current = newDraft;
        }
      } catch (e) {
        if (__DEV__) console.error('[SellOverlayCapture] Failed to init draft:', e);
      }
    };
    initDraft();
  }, []);

  // ── Persist photos to draft when they change ──
  useEffect(() => {
    if (!draftRef.current) return;
    const persistPhotos = async () => {
      try {
        if (photos.length > 0 || draftRef.current!.photos.length > 0) {
          const updated = await draftService.updateDraftPhotos(draftRef.current!, photos);
          draftRef.current = updated;
        }
      } catch (e) {
        if (__DEV__) console.error('[SellOverlayCapture] Failed to save draft photos:', e);
      }
    };
    const timeoutId = setTimeout(persistPhotos, 300);
    return () => clearTimeout(timeoutId);
  }, [photos]);

  // Request permission on mount
  useEffect(() => {
    if (!permission?.granted && permission?.canAskAgain) {
      requestPermission();
    }
  }, [permission]);

  // ── Handlers ──

  const handleCapture = useCallback(async () => {
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
      if (__DEV__) console.error('Error taking photo:', error);
    } finally {
      setIsCapturing(false);
    }
  }, [isCapturing, canTakeMore]);

  const handleGalleryPress = useCallback(async () => {
    const remainingSlots = MAX_PHOTOS - photos.length;
    if (remainingSlots <= 0) return;
    try {
      const result = await ImagePicker.launchImageLibraryAsync({
        mediaTypes: ['images'] as const,
        allowsMultipleSelection: true,
        quality: 0.8,
        exif: false,
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
      if (__DEV__) console.error('Error picking images:', error);
    }
  }, [photos.length]);

  const handleRemovePhoto = useCallback((index: number) => {
    setPhotos((prev) => prev.filter((_, i) => i !== index));
  }, []);

  const handleClose = useCallback(() => {
    if (photos.length > 0) {
      Alert.alert(
        'Quitter ?',
        'Vos photos sont sauvegardees en brouillon.',
        [
          { text: 'Annuler', style: 'cancel' },
          { text: 'Quitter', onPress: onClose },
        ],
      );
    } else {
      onClose();
    }
  }, [photos.length, onClose]);

  const handleContinue = useCallback(() => {
    if (photos.length === 0) {
      Alert.alert('Aucune photo', 'Ajoutez au moins une photo pour continuer.');
      return;
    }
    onContinue(photos);
  }, [photos, onContinue]);

  const toggleCameraFacing = useCallback(() => {
    setFacing((current) => (current === 'back' ? 'front' : 'back'));
  }, []);

  // ── Overlay heights ──

  const topOverlayHeight = insets.top + 56;
  const bottomControlsHeight = 140 + insets.bottom;

  // ── Permission loading ──

  if (!permission) {
    return <View style={styles.container} />;
  }

  // ── Permission denied ──

  if (!permission.granted) {
    return (
      <View style={styles.container}>
        <PermissionDenied onGalleryPress={handleGalleryPress} />
      </View>
    );
  }

  // ── Camera guide messages ──

  const guideMessage =
    photos.length === 0
      ? 'Cadrez votre article'
      : photos.length === 1
        ? 'Ajoute un détail'
        : photos.length < MAX_PHOTOS
          ? 'Continue !'
          : undefined;

  const guideSubMessage =
    photos.length === 0
      ? 'Photo principale face avant'
      : photos.length === 1
        ? 'Étiquette, défaut, texture...'
        : photos.length < MAX_PHOTOS
          ? 'Dos, côté, étiquette de taille...'
          : undefined;

  return (
    <View style={styles.container}>
      {/* Camera full-screen — feed visible edge to edge */}
      <CameraView
        ref={cameraRef}
        style={StyleSheet.absoluteFill}
        facing={facing}
      />

      {/* Top blur overlay */}
      <BlurView
        intensity={40}
        tint="dark"
        style={[styles.blurTop, { height: topOverlayHeight }]}
      >
        <TopControls
          topInset={insets.top}
          photoCount={photos.length}
          maxPhotos={MAX_PHOTOS}
          onClose={handleClose}
          onFlipCamera={toggleCameraFacing}
        />
      </BlurView>

      {/* Center viewfinder — clear camera feed, 4:3 area */}
      <Animated.View
        style={[
          styles.viewfinder,
          { top: topOverlayHeight },
          viewfinderBottom,
        ]}
        pointerEvents="none"
      >
        <CameraGuides message={guideMessage} subMessage={guideSubMessage} />
      </Animated.View>

      {!canTakeMore && (
        <View style={[styles.maxBadge, { top: topOverlayHeight + 12 }]}>
          <Text style={styles.maxBadgeText}>Maximum atteint</Text>
        </View>
      )}

      {/* Bottom blur overlay — previews + controls */}
      <Animated.View style={[styles.blurBottom, blurBottomStyle]}>
        <BlurView intensity={40} tint="dark" style={styles.blurFill}>
          <Animated.View style={[styles.thumbContainer, thumbContainerStyle]}>
            {showThumbStrip && (
              <ThumbnailStrip
                photos={photos}
                onRemovePhoto={handleRemovePhoto}
                onGalleryPress={handleGalleryPress}
                canAddMore={canTakeMore}
              />
            )}
          </Animated.View>

          <View style={{ paddingBottom: insets.bottom + 16 }}>
            <CameraControlsRow
              canTakeMore={canTakeMore}
              isCapturing={isCapturing}
              hasPhotos={photos.length > 0}
              onCapture={handleCapture}
              onContinue={handleContinue}
            />
          </View>
        </BlurView>
      </Animated.View>
    </View>
  );
}

export const SellOverlayCapture = React.memo(SellOverlayCaptureInner);

// ── Styles ─────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#0F0E0C',
  },
  blurTop: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    zIndex: 5,
  },
  blurBottom: {
    position: 'absolute',
    bottom: 0,
    left: 0,
    right: 0,
    zIndex: 5,
  },
  viewfinder: {
    position: 'absolute',
    left: 0,
    right: 0,
    zIndex: 3,
  },
  bottomContent: {
    flex: 1,
    justifyContent: 'flex-end',
  },
  thumbContainer: {
    overflow: 'hidden',
  },
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
});
