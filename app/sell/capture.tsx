import { serializeRouteParam } from '@/features/sell/utils/routeParams';
import { useSellCamera } from '@/features/sell/hooks/useSellCamera';
import { useSellActorSource, isSellActorSourceCurrent } from '@/features/sell/hooks/useSellActorSource';
import { captureTradeSession, assertTradeSessionCurrent, staleTradeOperation } from '@/services/tradeOperation';
import { useSellExitGuard } from '@/features/sell/hooks/useSellExitGuard';
/**
 * Camera Capture Screen
 * Design System: Editorial Luxe -- Cream, Charcoal, Rust, Sage
 *
 * Full-screen camera with:
 * - Top row: close | counter pill | flip (single row over blur)
 * - Viewfinder: corner brackets + contextual guide text
 * - Bottom: thumbnail strip + gallery / capture / continue controls
 */

import React, { useState, useCallback, useEffect, useLayoutEffect, useRef } from 'react';
import {
  View,
  Text,
  StyleSheet,
  Alert,
  type LayoutChangeEvent,
} from 'react-native';
import Animated, { useSharedValue, useAnimatedStyle, withTiming, interpolate, Easing } from 'react-native-reanimated';
import { StatusBar } from 'expo-status-bar';
import { useRouter, useLocalSearchParams, useNavigation } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { CameraView, useCameraPermissions } from 'expo-camera';
import * as ImagePicker from 'expo-image-picker';

import { track } from '@/lib/analytics';
import { auth } from '@/config/firebaseConfig';
import { colors, fonts, radius, spacing } from '@/constants/theme';
import { Skeleton } from '@/components/ui/Skeleton';
import BlurOverlay from '@/features/sell/components/shared/BlurOverlay';
import CameraGuides from '@/features/sell/components/shared/CameraGuides';
import draftService, { ArticleDraft, createEmptyDraft } from '@/features/sell/services/draftService';
import {
  PermissionDenied,
  TopControls,
  ThumbnailStrip,
  CameraControlsRow,
} from '@/features/sell';

const MAX_PHOTOS = 5;
const THUMB_CONTAINER_HEIGHT = 92;

export default function CaptureScreen() {
  const router = useRouter();
  const navigation = useNavigation();
  const insets = useSafeAreaInsets();
  const params = useLocalSearchParams();
  const cameraRef = useRef<CameraView>(null);
  const [photoOwnerUid] = useState(() => auth.currentUser?.uid);
  const { source: actorSource, getCurrentSource } = useSellActorSource();
  const [photoSource] = useState(actorSource);
  const captureMounted = useRef(true);

  const isResuming = params.resumeDraft === 'true';
  const resumedPhotos: string[] = params.photos
    ? JSON.parse(params.photos as string)
    : [];

  const [photos, setPhotos] = useState<string[]>(isResuming ? resumedPhotos : []);
  const [permission, requestPermission] = useCameraPermissions();
  const camera = useSellCamera(permission?.granted ?? false);
  const { facing, torchActive, isCapturing, onReady: markCameraReady } = camera;
  const [controlsHeight, setControlsHeight] = useState(140);
  const handleControlsLayout = useCallback((event: LayoutChangeEvent) => {
    setControlsHeight(event.nativeEvent.layout.height);
  }, []);
  const draftRef = useRef<ArticleDraft | null>(null);
  const draftReadyRef = useRef<Promise<void>>(Promise.resolve());
  const photoSaveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const leavingRef = useRef(false);
  const departureRevision = useRef(0);
  const galleryPending = useRef(false);
  const handlePrivacyOpen = useCallback(() => { departureRevision.current += 1; }, []);
  useLayoutEffect(() => {
    captureMounted.current = true;
    return () => { captureMounted.current = false; departureRevision.current += 1; };
  }, []);
  // A slow save must not authorize leaving with an older photo selection.
  useLayoutEffect(() => { departureRevision.current += 1; }, [photos]);
  const isPhotoSourceCurrent = useCallback(() => captureMounted.current &&
    isSellActorSourceCurrent(getCurrentSource(), photoSource), [getCurrentSource, photoSource]);
  const assertPhotoSourceCurrent = useCallback(() => {
    if (!isPhotoSourceCurrent()) throw staleTradeOperation();
    draftService.assertCurrentOwner(photoOwnerUid);
  }, [isPhotoSourceCurrent, photoOwnerUid]);

  const persistPhotos = useCallback(async () => {
    if (photoSaveTimer.current) clearTimeout(photoSaveTimer.current);
    assertPhotoSourceCurrent();
    await draftReadyRef.current;
    assertPhotoSourceCurrent();
    const draft = draftRef.current ?? await draftService.loadDraft() ?? createEmptyDraft();
    assertPhotoSourceCurrent();
    draftRef.current = await draftService.updateDraftPhotos(draft, photos);
    assertPhotoSourceCurrent();
  }, [photos, assertPhotoSourceCurrent]);

  const saveBeforeLeaving = useCallback(async (leave: () => void) => {
    if (leavingRef.current || !navigation.isFocused()) return;
    const revision = departureRevision.current;
    leavingRef.current = true;
    try {
      await persistPhotos();
      if (!isPhotoSourceCurrent() || revision !== departureRevision.current || !navigation.isFocused()) return;
      leave();
    } catch {
      if (isPhotoSourceCurrent() && revision === departureRevision.current && navigation.isFocused()) {
        Alert.alert('Brouillon non sauvegardé', 'Réessayez avant de quitter pour conserver vos photos.');
      }
    } finally {
      leavingRef.current = false;
    }
  }, [persistPhotos, navigation, isPhotoSourceCurrent]);

  const canTakeMore = photos.length < MAX_PHOTOS;
  const hasPhotos = photos.length > 0;
  const showThumbStrip = hasPhotos || canTakeMore;

  // ── Camera fade-in on ready (parity with iOS SellOverlayCapture) ──
  const cameraOpacity = useSharedValue(0);

  const cameraFadeStyle = useAnimatedStyle(() => ({
    opacity: cameraOpacity.value,
  }));

  const handleCameraReady = useCallback(() => {
    if (!markCameraReady()) return;
    cameraOpacity.set(withTiming(1, {
      duration: 260,
      easing: Easing.out(Easing.cubic),
    }));
  }, [cameraOpacity, markCameraReady]);

  useEffect(() => { cameraOpacity.set(0); }, [camera.mountKey, cameraOpacity]);

  // ── Thumb container height animation ──
  const thumbContainerHeight = useSharedValue(0);

  useEffect(() => {
    thumbContainerHeight.set(withTiming(showThumbStrip ? THUMB_CONTAINER_HEIGHT : 0, {
      duration: 300,
      easing: Easing.out(Easing.cubic),
    }));
  }, [showThumbStrip, thumbContainerHeight]);

  const thumbContainerStyle = useAnimatedStyle(() => ({
    height: thumbContainerHeight.value,
    opacity: interpolate(thumbContainerHeight.value, [0, THUMB_CONTAINER_HEIGHT * 0.5], [0, 1]),
  }));

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

  // Initialize or load draft on mount
  useEffect(() => {
    const initDraft = async () => {
      assertPhotoSourceCurrent();
      if (isResuming) {
        assertPhotoSourceCurrent();
        const existingDraft = await draftService.loadDraft();
        assertPhotoSourceCurrent();
        if (existingDraft) draftRef.current = existingDraft;
      } else {
        const newDraft = await draftService.startNewDraft();
        assertPhotoSourceCurrent();
        draftRef.current = newDraft;
      }
    };
    const ready = initDraft();
    draftReadyRef.current = ready;
    // Preserve failure for Continue/close, while handling an early logout before
    // the debounced save begins awaiting initialization.
    void ready.catch(() => {
      if (__DEV__) console.warn('Draft initialization interrupted');
    });
  }, [isResuming, assertPhotoSourceCurrent]);

  // Persist edits while staying on the screen; Continue/close flush immediately.
  useEffect(() => {
    photoSaveTimer.current = setTimeout(() => {
      persistPhotos().catch(() => {
        if (__DEV__) console.error('Failed to save draft photos');
      });
    }, 300);
    return () => { if (photoSaveTimer.current) clearTimeout(photoSaveTimer.current); };
  }, [persistPhotos]);

  const hasDraftWork = () => photos.length > 0 ||
    (draftRef.current?.storageUrls.length ?? 0) > 0 || draftRef.current?.aiResult != null;
  useSellExitGuard({
    captureOrigin: () => {
      assertPhotoSourceCurrent();
      const session = captureTradeSession(photoOwnerUid);
      const revision = departureRevision.current;
      return () => {
        assertPhotoSourceCurrent(); assertTradeSessionCurrent(session);
        if (revision !== departureRevision.current || !navigation.isFocused()) throw staleTradeOperation();
      };
    },
    hasWork: hasDraftWork,
    isPublished: () => draftService.wasPublished,
    save: async assertCurrent => {
      assertCurrent();
      // Initialization can still be deleting the previous empty draft. Finish
      // it before cleanup, otherwise startNewDraft may write after this exit.
      await draftReadyRef.current;
      assertCurrent();
      if (hasDraftWork()) await persistPhotos();
      else await draftService.deleteDraft();
      assertCurrent();
    },
    onDecision: confirmed => track('sell_exit_prompted', {
      flow_step: 'capture', confirmed_leave: confirmed, photo_count: photos.length,
    }),
    errorMessage: 'Réessayez avant de quitter pour conserver vos photos.',
  });

  // Handlers
  const handleCapture = async () => {
    if (!isPhotoSourceCurrent()) return;
    const nativeCamera = cameraRef.current;
    if (!nativeCamera || !canTakeMore) return;
    const capture = camera.beginCapture();
    if (!capture) return;
    try {
      const photo = await nativeCamera.takePictureAsync({
        quality: 0.7,
        skipProcessing: false,
      });
      if (!camera.isCaptureCurrent(capture) || !isPhotoSourceCurrent()) return;
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
      if (!camera.isCaptureCurrent(capture) || !isPhotoSourceCurrent()) return;
      if (__DEV__) console.error('Error taking photo:', error);
      // A failed shot was silent in production.
      Alert.alert('Photo impossible', "La photo n'a pas pu être prise. Réessayez.");
    } finally {
      camera.finishCapture(capture);
    }
  };

  const handleGalleryPress = async () => {
    if (galleryPending.current || !navigation.isFocused() || !isPhotoSourceCurrent()) return;
    const remainingSlots = MAX_PHOTOS - photos.length;
    if (remainingSlots <= 0) return;
    galleryPending.current = true;
    const revision = departureRevision.current;
    const isCurrent = () => {
      try {assertPhotoSourceCurrent();} catch {return false;}
      return departureRevision.current === revision && navigation.isFocused();
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
  };

  const handleRemovePhoto = useCallback((index: number) => {
    if (!isPhotoSourceCurrent()) return;
    setPhotos((prev) => prev.filter((_, i) => i !== index));
    track('sell_photo_removed', {
      screen: 'capture',
      photo_index: index,
      photo_count_after: Math.max(0, photos.length - 1),
    });
  }, [photos.length, isPhotoSourceCurrent]);

  const handleClose = () => {
    if (!isPhotoSourceCurrent()) return;
    // Expo Router enqueues the request. The native removal guard owns its one
    // confirmation, persistence and exact root-level replay when it is delivered.
    router.replace('/(tabs)');
  };

  const handleContinue = () => {
    if (!isPhotoSourceCurrent()) return;
    if (photos.length === 0) {
      Alert.alert('Aucune photo', 'Ajoutez au moins une photo pour continuer.');
      return;
    }
    track('sell_step_completed', { step: 'capture', photo_count: photos.length });
    void saveBeforeLeaving(() => router.push({
      pathname: '/sell/photos-review',
      params: { photos: serializeRouteParam(photos) },
    }));
  };

  const toggleCameraFacing = camera.flip;
  const toggleTorch = camera.toggleTorch;

  // Overlay heights
  const topOverlayHeight = insets.top + 56;
  const bottomOverlayHeight = controlsHeight + insets.bottom + spacing.md;

  // Permission states
  if (!permission) {
    return (
      <View style={styles.container}>
        <View style={styles.centerContent}>
          <Skeleton
            width={200}
            height={200}
            borderRadius={radius.lg}
            style={styles.skeletonCamera}
          />
        </View>
      </View>
    );
  }

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

  // Camera guide messages
  const guideMessage =
    photos.length === 0
      ? 'Cadre ton article'
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
    <View style={styles.container} testID="sell-capture-screen">
      <StatusBar style="light" />

      <Animated.View style={[StyleSheet.absoluteFill, cameraFadeStyle]}>
        <CameraView
          key={camera.mountKey}
          ref={cameraRef}
          style={StyleSheet.absoluteFill}
          facing={facing}
          enableTorch={facing === 'back' && torchActive}
          onCameraReady={handleCameraReady}
          onMountError={camera.onMountError}
        />
      </Animated.View>

      <BlurOverlay position="top" height={topOverlayHeight} intensity={0.6} />

      <View
        style={[
          styles.guidesArea,
          { top: topOverlayHeight, bottom: bottomOverlayHeight },
        ]}
      >
        <CameraGuides message={guideMessage} subMessage={guideSubMessage} />

        <Animated.View style={[styles.thumbOverlay, thumbContainerStyle]}>
          {showThumbStrip && (
            <ThumbnailStrip
              ownerUid={photoOwnerUid}
              photos={photos}
              onRemovePhoto={handleRemovePhoto}
              onGalleryPress={handleGalleryPress}
              canAddMore={canTakeMore}
            />
          )}
        </Animated.View>
      </View>

      <BlurOverlay position="bottom" height={bottomOverlayHeight} intensity={0.65} />

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

      {!canTakeMore && (
        <View style={[styles.maxBadge, { top: topOverlayHeight + 12 }]}>
          <Text style={styles.maxBadgeText}>Maximum atteint</Text>
        </View>
      )}

      <View style={[styles.bottomSection, { paddingBottom: insets.bottom + 16 }]}>
        <CameraControlsRow
          onPrivacyOpen={handlePrivacyOpen}
          onLayout={handleControlsLayout}
          canTakeMore={canTakeMore && camera.ready}
          isCapturing={isCapturing}
          hasPhotos={photos.length > 0}
          onCapture={handleCapture}
          onContinue={handleContinue}
        />
      </View>
    </View>
  );
}

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
  guidesArea: {
    position: 'absolute',
    left: 0,
    right: 0,
    zIndex: 3,
  },
  thumbOverlay: {
    position: 'absolute',
    bottom: 0,
    left: 0,
    right: 0,
    backgroundColor: 'rgba(15, 14, 12, 0.55)',
    overflow: 'hidden',
    zIndex: 5,
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
  skeletonCamera: {
    backgroundColor: 'rgba(255, 255, 255, 0.06)',
  },
  bottomSection: {
    position: 'absolute',
    bottom: 0,
    left: 0,
    right: 0,
    zIndex: 10,
  },
});
