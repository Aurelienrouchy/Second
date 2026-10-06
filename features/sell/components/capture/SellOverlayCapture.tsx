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
import { CameraView, useCameraPermissions } from 'expo-camera';
import * as ImagePicker from 'expo-image-picker';
import { StatusBar } from 'expo-status-bar';

import { BlurView } from 'expo-blur';
import { track } from '@/lib/analytics';
import { colors, fonts } from '@/constants/theme';

import draftService, { createEmptyDraft, ArticleDraft } from '@/services/draftService';
import CameraGuides from '@/components/sell/CameraGuides';
import { PermissionDenied } from './PermissionDenied';
import { TopControls } from './TopControls';
import { ThumbnailStrip } from './ThumbnailStrip';
import { CameraControlsRow } from './CameraControlsRow';
import { useSellCamera } from '../../hooks/useSellCamera';

// CameraView is remounted for each native camera session.
const AnimatedCameraView = Animated.createAnimatedComponent(CameraView);

const MAX_PHOTOS = 5;
const THUMB_CONTAINER_HEIGHT = 92;
const CAMERA_FADE_DURATION = 260;

interface SellOverlayCaptureProps {
  onClose: () => void;
  onContinue: (photos: string[]) => void;
}

function SellOverlayCaptureInner({ onClose, onContinue }: SellOverlayCaptureProps) {
  const insets = useSafeAreaInsets();
  const cameraRef = useRef<CameraView>(null);

  const [photos, setPhotos] = useState<string[]>([]);
  const [permission, requestPermission] = useCameraPermissions();
  const camera = useSellCamera(permission?.granted ?? false);
  const { facing, torchActive, onReady: markCameraReady } = camera;
  const [isCapturing, setIsCapturing] = useState(false);
  const draftRef = useRef<ArticleDraft | null>(null);
  const draftReadyRef = useRef<Promise<void>>(Promise.resolve());
  const photoSaveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const leavingRef = useRef(false);

  const persistPhotos = useCallback(async () => {
    if (photoSaveTimer.current) clearTimeout(photoSaveTimer.current);
    await draftReadyRef.current;
    const draft = draftRef.current ?? await draftService.loadDraft() ?? createEmptyDraft();
    draftRef.current = await draftService.updateDraftPhotos(draft, photos);
  }, [photos]);

  const saveBeforeLeaving = useCallback(async (leave: () => void) => {
    if (leavingRef.current) return;
    leavingRef.current = true;
    try {
      await persistPhotos();
      leave();
    } catch {
      Alert.alert('Brouillon non sauvegardé', 'Réessayez avant de quitter pour conserver vos photos.');
    } finally {
      leavingRef.current = false;
    }
  }, [persistPhotos]);

  // ── Camera fade-in ──
  // The native camera surface renders as a black rectangle until it is ready.
  // We keep the feed at opacity 0 over the DS-colored backdrop and fade it in
  // only once `onCameraReady` fires, so the black rectangle never animates in
  // with the overlay opening transition.
  const cameraOpacity = useSharedValue(0);

  const handleCameraReady = useCallback(() => {
    if (!markCameraReady()) return;
    cameraOpacity.set(withTiming(1, {
      duration: CAMERA_FADE_DURATION,
      easing: Easing.out(Easing.ease),
    }));
  }, [cameraOpacity, markCameraReady]);

  const cameraStyle = useAnimatedStyle(() => ({
    opacity: cameraOpacity.value,
  }));

  const canTakeMore = photos.length < MAX_PHOTOS;
  const hasPhotos = photos.length > 0;
  const showThumbStrip = hasPhotos || canTakeMore;

  useEffect(() => { cameraOpacity.set(0); }, [camera.mountKey, cameraOpacity]);

  // ── Thumb container height animation ──
  const thumbContainerHeight = useSharedValue(0);

  useEffect(() => {
    thumbContainerHeight.set(withTiming(showThumbStrip ? THUMB_CONTAINER_HEIGHT : 0, {
      duration: 300,
      easing: Easing.out(Easing.cubic),
    }));
  }, [showThumbStrip, thumbContainerHeight]);

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
    draftReadyRef.current = initDraft();
  }, []);

  // Persist edits while staying on the screen; Continue/close flush immediately.
  useEffect(() => {
    photoSaveTimer.current = setTimeout(() => {
      persistPhotos().catch(() => {
        if (__DEV__) console.error('Failed to save draft photos');
      });
    }, 300);
    return () => { if (photoSaveTimer.current) clearTimeout(photoSaveTimer.current); };
  }, [persistPhotos]);

  // Request permission on mount
  useEffect(() => {
    if (!permission?.granted && permission?.canAskAgain) {
      requestPermission();
    }
  }, [permission, requestPermission]);

  // Fire once when the OS resolves the camera permission to denied.
  const cameraDeniedTracked = useRef(false);
  useEffect(() => {
    if (permission?.status === 'denied' && !cameraDeniedTracked.current) {
      cameraDeniedTracked.current = true;
      track('permission_denied', {
        permission: 'camera',
        context: 'sell_capture',
        can_ask_again: permission.canAskAgain,
      });
    }
  }, [permission]);

  // ── Handlers ──

  const handleCapture = useCallback(async () => {
    if (!cameraRef.current || !camera.ready || isCapturing || !canTakeMore) return;
    setIsCapturing(true);
    try {
      const photo = await cameraRef.current.takePictureAsync({
        quality: 0.7,
        skipProcessing: false,
      });
      if (photo?.uri) {
        let added = false;
        setPhotos((prev) => {
          if (prev.length >= MAX_PHOTOS) return prev;
          added = true;
          return [...prev, photo.uri];
        });
        if (added) {
          track('sell_photo_added', {
            screen: 'capture',
            method: 'camera',
            count_added: 1,
            photo_count_after: Math.min(photos.length + 1, MAX_PHOTOS),
          });
        }
      }
    } catch (error) {
      if (__DEV__) console.error('Error taking photo:', error);
    } finally {
      setIsCapturing(false);
    }
  }, [isCapturing, canTakeMore, photos.length, camera.ready]);

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
        preferredAssetRepresentationMode:
          ImagePicker.UIImagePickerPreferredAssetRepresentationMode.Compatible,
      });
      if (!result.canceled && result.assets.length > 0) {
        const uris = result.assets.map((asset) => asset.uri);
        const added = uris.slice(0, remainingSlots);
        setPhotos((prev) => {
          const remaining = MAX_PHOTOS - prev.length;
          return [...prev, ...uris.slice(0, remaining)];
        });
        track('sell_photo_added', {
          screen: 'capture',
          method: 'gallery',
          count_added: added.length,
          photo_count_after: photos.length + added.length,
        });
      } else if (result.canceled) {
        track('sell_photo_added', {
          screen: 'capture',
          method: 'gallery',
          count_added: 0,
          photo_count_after: photos.length,
          cancelled: true,
        });
      }
    } catch (error) {
      if (__DEV__) console.error('Error picking images:', error);
    }
  }, [photos.length]);

  const handleRemovePhoto = useCallback((index: number) => {
    setPhotos((prev) => prev.filter((_, i) => i !== index));
    track('sell_photo_removed', {
      screen: 'capture',
      photo_index: index,
      photo_count_after: Math.max(0, photos.length - 1),
    });
  }, [photos.length]);

  const handleClose = useCallback(() => {
    if (photos.length > 0) {
      Alert.alert(
        'Quitter ?',
        'Vos photos sont sauvegardees en brouillon.',
        [
          {
            text: 'Annuler',
            style: 'cancel',
            onPress: () =>
              track('sell_exit_prompted', {
                flow_step: 'capture',
                confirmed_leave: false,
                photo_count: photos.length,
              }),
          },
          {
            text: 'Quitter',
            onPress: () => {
              track('sell_exit_prompted', {
                flow_step: 'capture',
                confirmed_leave: true,
                photo_count: photos.length,
              });
              void saveBeforeLeaving(onClose);
            },
          },
        ],
      );
    } else {
      void saveBeforeLeaving(onClose);
    }
  }, [photos.length, onClose, saveBeforeLeaving]);

  const handleContinue = useCallback(() => {
    if (photos.length === 0) {
      Alert.alert('Aucune photo', 'Ajoutez au moins une photo pour continuer.');
      return;
    }
    track('sell_step_completed', { step: 'capture', photo_count: photos.length });
    void saveBeforeLeaving(() => onContinue(photos));
  }, [photos, onContinue, saveBeforeLeaving]);

  const toggleCameraFacing = camera.flip;
  const toggleTorch = camera.toggleTorch;

  // ── Overlay heights ──

  const topOverlayHeight = insets.top + 56;
  const bottomControlsHeight = 140 + insets.bottom;

  // ── Permission loading ──

  if (!permission) {
    return <View style={styles.container} />;
  }

  // ── Permission denied ──

  if (!permission.granted || camera.error) {
    return (
      <View style={styles.container}>
        <PermissionDenied
          onGalleryPress={handleGalleryPress}
          photoCount={photos.length}
          onContinue={handleContinue}
          onClose={handleClose}
          onRetry={camera.error && permission.granted ? camera.retry : undefined}
        />
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
      <StatusBar style="light" />
      {/* Camera full-screen — feed visible edge to edge.
          Starts at opacity 0 over the DS backdrop, fades in on onCameraReady
          so the native black surface never animates in with the overlay. */}
      <AnimatedCameraView
        key={camera.mountKey}
        ref={cameraRef}
        style={[StyleSheet.absoluteFill, cameraStyle]}
        facing={facing}
        enableTorch={facing === 'back' && torchActive}
        onCameraReady={handleCameraReady}
        onMountError={camera.onMountError}
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
          torchActive={torchActive}
          torchAvailable={facing === 'back' && camera.ready}
          onClose={handleClose}
          onFlipCamera={toggleCameraFacing}
          onToggleTorch={toggleTorch}
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
              canTakeMore={canTakeMore && camera.ready}
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
    backgroundColor: colors.deep,
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
    overflow: 'hidden',
  },
  blurFill: {
    flex: 1,
  },
  viewfinder: {
    position: 'absolute',
    left: 0,
    right: 0,
    zIndex: 3,
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
