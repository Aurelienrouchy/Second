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

import React, { useState, useCallback, useEffect, useLayoutEffect, useRef } from 'react';
import { AppState, View, Text, StyleSheet, Alert, type LayoutChangeEvent } from 'react-native';
import Animated, { useSharedValue, useAnimatedStyle, withTiming, interpolate, Easing } from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { CameraView, useCameraPermissions } from 'expo-camera';
import * as ImagePicker from 'expo-image-picker';
import { StatusBar } from 'expo-status-bar';
import { useNavigation } from 'expo-router';

import { BlurView } from 'expo-blur';
import { track } from '@/lib/analytics';
import { auth } from '@/config/firebaseConfig';
import { colors, fonts, spacing } from '@/constants/theme';
import type { ImmersivePresentation } from '@/store/immersiveOverlayStore';

// CameraView wrapped for Reanimated so we can fade in the feed once it is ready.
import draftService, { createEmptyDraft, ArticleDraft, hasDraftProgress } from '@/features/sell/services/draftService';
import CameraGuides from '@/features/sell/components/shared/CameraGuides';
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
  presentation?: ImmersivePresentation;
}

function SellOverlayCaptureInner({ onClose, onContinue, presentation }: SellOverlayCaptureProps) {
  const navigation = useNavigation();
  const insets = useSafeAreaInsets();
  const cameraRef = useRef<CameraView>(null);
  const [photoOwnerUid] = useState(() => auth.currentUser?.uid);

  const [photos, setPhotos] = useState<string[]>([]);
  const [permission, requestPermission] = useCameraPermissions();
  const [foreground, setForeground] = useState(() => AppState.currentState === 'active');
  const [focused, setFocused] = useState(() => navigation.isFocused());
  const entranceFinished = presentation?.entranceFinished ?? true;
  const visible = presentation?.visible ?? true;
  const preparesInOverlay = !!presentation;
  const active = (presentation?.active ?? true) && foreground && focused;
  const cameraEnabled = (permission?.granted ?? false) && active;
  const camera = useSellCamera(cameraEnabled);
  const interactive = useRef(false);
  useLayoutEffect(() => { interactive.current = visible && active; }, [visible, active]);
  useEffect(() => {
    const activity = AppState.addEventListener('change', state => setForeground(state === 'active'));
    const focus = navigation.addListener('focus', () => setFocused(true));
    const blur = navigation.addListener('blur', () => setFocused(false));
    return () => { activity.remove(); focus(); blur(); };
  }, [navigation]);
  const { facing, torchActive, isCapturing, onReady: markCameraReady, flip: flipCamera,
    toggleTorch: toggleCameraTorch, beginCapture, isCaptureCurrent, finishCapture } = camera;
  const reportReady = presentation?.onReady;
  const [controlsHeight, setControlsHeight] = useState(140);
  const handleControlsLayout = useCallback((event: LayoutChangeEvent) => {
    setControlsHeight(event.nativeEvent.layout.height);
  }, []);
  const topOverlayHeight = insets.top + 56;
  const bottomControlsHeight = controlsHeight + insets.bottom + spacing.md;
  const draftRef = useRef<ArticleDraft | null>(null);
  const draftHydratedRef = useRef(false);
  const [draftHydrated, setDraftHydrated] = useState(false);
  useLayoutEffect(() => { draftHydratedRef.current = draftHydrated; }, [draftHydrated]);
  const captureMounted = useRef(true);
  const draftInitActive = useRef(true);
  const draftReadyRef = useRef<Promise<void>>(Promise.resolve());
  const photoSaveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const leavingRef = useRef(false);
  const departureRevision = useRef(0);
  const galleryPending = useRef(false);
  const handlePrivacyOpen = useCallback(() => { departureRevision.current += 1; }, []);
  useEffect(() => {
    captureMounted.current = true;
    return () => { captureMounted.current = false; departureRevision.current += 1; };
  }, []);
  useLayoutEffect(() => {
    if (presentation?.active === false) {
      draftInitActive.current = false;
      departureRevision.current += 1;
    }
  }, [presentation?.active]);

  const persistPhotos = useCallback(async () => {
    if (!draftHydratedRef.current || !captureMounted.current) return;
    if (photoSaveTimer.current) clearTimeout(photoSaveTimer.current);
    draftService.assertCurrentOwner(photoOwnerUid);
    await draftReadyRef.current;
    if (!captureMounted.current) return;
    draftService.assertCurrentOwner(photoOwnerUid);
    const draft = draftRef.current ?? await draftService.loadDraft() ?? createEmptyDraft();
    draftService.assertCurrentOwner(photoOwnerUid);
    draftRef.current = await draftService.updateDraftPhotos(draft, photos);
    draftService.assertCurrentOwner(photoOwnerUid);
  }, [photos, photoOwnerUid]);

  const saveBeforeLeaving = useCallback(async (leave: () => void) => {
    if (leavingRef.current || !navigation.isFocused()) return;
    const revision = departureRevision.current;
    leavingRef.current = true;
    try {
      await persistPhotos();
      if (!captureMounted.current || revision !== departureRevision.current || !navigation.isFocused()) return;
      leave();
    } catch {
      if (captureMounted.current && revision === departureRevision.current && navigation.isFocused()) {
        Alert.alert('Brouillon non sauvegardé', 'Réessayez avant de quitter pour conserver vos photos.');
      }
    } finally {
      leavingRef.current = false;
    }
  }, [persistPhotos, navigation]);

  // ── Camera fade-in ──
  // The native camera surface renders as a black rectangle until it is ready.
  // We keep the feed at opacity 0 over the DS-colored backdrop and fade it in
  // only once `onCameraReady` fires, so the black rectangle never animates in
  // with the overlay opening transition.
  const cameraOpacity = useSharedValue(0);

  const handleCameraReady = useCallback(() => {
    if (!markCameraReady()) return;
    cameraOpacity.set(preparesInOverlay ? 1 : withTiming(1, {
      duration: CAMERA_FADE_DURATION,
      easing: Easing.out(Easing.ease),
    }));
  }, [cameraOpacity, markCameraReady, preparesInOverlay]);

  const cameraStyle = useAnimatedStyle(() => ({
    opacity: cameraOpacity.value,
  }));

  const canTakeMore = photos.length < MAX_PHOTOS;
  const hasPhotos = photos.length > 0;
  const showThumbStrip = hasPhotos || canTakeMore;

  useLayoutEffect(() => { cameraOpacity.set(0); }, [camera.mountKey, cameraOpacity]);
  useEffect(() => {
    // A denied permission or native error is a real fallback, not a camera-ready signal.
    reportReady?.(active && (camera.ready || camera.error ||
      !!permission && !permission.granted && permission.status !== 'undetermined'));
  }, [active, camera.ready, camera.error, permission, reportReady]);

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
    if (!entranceFinished) return;
    let current = true;
    const isCurrent = () => current && captureMounted.current && draftInitActive.current;
    const initDraft = async () => {
      try {
        draftService.assertCurrentOwner(photoOwnerUid);
        const existingDraft = await draftService.loadDraft();
        if (!isCurrent()) return;
        draftService.assertCurrentOwner(photoOwnerUid);
        if (existingDraft) {
          draftRef.current = existingDraft;
          if (existingDraft.photos.length > 0) {
            setPhotos(existingDraft.photos);
          }
        } else {
          const newDraft = createEmptyDraft();
          await draftService.saveDraft(newDraft);
          if (!isCurrent()) return;
          draftService.assertCurrentOwner(photoOwnerUid);
          draftRef.current = newDraft;
        }
        setDraftHydrated(true);
      } catch (e) {
        if (isCurrent() && __DEV__) console.error('[SellOverlayCapture] Failed to init draft:', e);
      }
    };
    draftReadyRef.current = initDraft();
    return () => { current = false; };
  }, [photoOwnerUid, entranceFinished]);

  // Persist edits while staying on the screen; Continue/close flush immediately.
  useEffect(() => {
    if (!entranceFinished || !draftHydrated || !active) return;
    photoSaveTimer.current = setTimeout(() => {
      persistPhotos().catch(() => {
        if (__DEV__) console.error('Failed to save draft photos');
      });
    }, 300);
    return () => { if (photoSaveTimer.current) clearTimeout(photoSaveTimer.current); };
  }, [persistPhotos, entranceFinished, draftHydrated, active]);

  // The native permission sheet must not interrupt the entering animation.
  useEffect(() => {
    if (entranceFinished && active && !permission?.granted && permission?.canAskAgain) {
      requestPermission();
    }
  }, [permission, requestPermission, entranceFinished, active]);

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
    if (!interactive.current || !draftHydratedRef.current) return;
    const nativeCamera = cameraRef.current;
    if (!nativeCamera || !canTakeMore) return;
    const capture = beginCapture();
    if (!capture) return;
    try {
      const photo = await nativeCamera.takePictureAsync({
        quality: 0.7,
        skipProcessing: false,
      });
      if (!isCaptureCurrent(capture)) return;
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
      if (!isCaptureCurrent(capture)) return;
      if (__DEV__) console.error('Error taking photo:', error);
      // A failed shot was silent in production.
      Alert.alert('Photo impossible', "La photo n'a pas pu être prise. Réessayez.");
    } finally {
      finishCapture(capture);
    }
  }, [canTakeMore, photos.length, beginCapture, isCaptureCurrent, finishCapture]);

  const handleGalleryPress = useCallback(async () => {
    if (!interactive.current || !draftHydratedRef.current || galleryPending.current) return;
    const remainingSlots = MAX_PHOTOS - photos.length;
    if (remainingSlots <= 0) return;
    galleryPending.current = true;
    const revision = departureRevision.current;
    const isCurrent = () => {
      try {draftService.assertCurrentOwner(photoOwnerUid);} catch {return false;}
      return captureMounted.current && departureRevision.current === revision && navigation.isFocused();
    };
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
      if (!isCurrent()) return;
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
      if (!isCurrent()) return;
      if (__DEV__) console.error('Error picking images:', error);
      Alert.alert('Import impossible', "Les photos n'ont pas pu être importées. Réessayez.");
    } finally {galleryPending.current = false;}
  }, [photos.length, navigation, photoOwnerUid]);

  const handleRemovePhoto = useCallback((index: number) => {
    if (!interactive.current || !draftHydratedRef.current) return;
    setPhotos((prev) => prev.filter((_, i) => i !== index));
    track('sell_photo_removed', {
      screen: 'capture',
      photo_index: index,
      photo_count_after: Math.max(0, photos.length - 1),
    });
  }, [photos.length]);

  const handleClose = useCallback(() => {
    if (!interactive.current) return;
    if (!draftHydratedRef.current) {
      draftInitActive.current = false;
      departureRevision.current += 1;
      onClose();
      return;
    }
    // Same rule as the Android capture screen: real work — photos, uploaded
    // images or an analysis — is kept and announced; an empty draft is
    // deleted. The overlay ignored the draft entirely and never deleted it,
    // leaving an empty draft that the next entry offered to resume.
    const hasWork = photos.length > 0 || hasDraftProgress(draftRef.current);
    if (hasWork) {
      Alert.alert(
        'Quitter ?',
        'Votre brouillon sera sauvegardé. Vous pourrez le reprendre plus tard.',
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
    if (!interactive.current || !draftHydratedRef.current) return;
    if (photos.length === 0) {
      Alert.alert('Aucune photo', 'Ajoutez au moins une photo pour continuer.');
      return;
    }
    track('sell_step_completed', { step: 'capture', photo_count: photos.length });
    void saveBeforeLeaving(() => onContinue(photos));
  }, [photos, onContinue, saveBeforeLeaving]);

  const toggleCameraFacing = useCallback(() => { if (interactive.current) flipCamera(); }, [flipCamera]);
  const toggleTorch = useCallback(() => { if (interactive.current) toggleCameraTorch(); }, [toggleCameraTorch]);

  // ── Permission loading ──

  if (!permission) {
    return <View style={styles.container} />;
  }

  // ── Permission denied ──

  if (!permission.granted || camera.error) {
    return (
      <View style={styles.container}>
        <PermissionDenied
          onPrivacyOpen={handlePrivacyOpen}
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
      {visible && <StatusBar style="light" />}
      {/* Camera full-screen — feed visible edge to edge.
          Starts at opacity 0 over the DS backdrop, fades in on onCameraReady
          so the native black surface never animates in with the overlay. */}
      {cameraEnabled && <AnimatedCameraView
        key={camera.mountKey}
        ref={cameraRef}
        style={[StyleSheet.absoluteFill, cameraStyle]}
        facing={facing}
        enableTorch={facing === 'back' && torchActive}
        active={cameraEnabled}
        onCameraReady={handleCameraReady}
        onMountError={camera.onMountError}
      />}

      {entranceFinished && <>
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
          torchAvailable={camera.torchAvailable}
          flipAvailable={camera.flipAvailable}
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
              ownerUid={photoOwnerUid}
                photos={photos}
                onRemovePhoto={handleRemovePhoto}
                onGalleryPress={handleGalleryPress}
                canAddMore={canTakeMore && draftHydrated}
              />
            )}
          </Animated.View>

          <View style={{ paddingBottom: insets.bottom + 16 }}>
            <CameraControlsRow
              onPrivacyOpen={handlePrivacyOpen}
              onLayout={handleControlsLayout}
              canTakeMore={canTakeMore && camera.ready && draftHydrated}
              isCapturing={isCapturing}
              hasPhotos={photos.length > 0}
              onCapture={handleCapture}
              onContinue={handleContinue}
            />
          </View>
        </BlurView>
      </Animated.View>
      </>}
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
