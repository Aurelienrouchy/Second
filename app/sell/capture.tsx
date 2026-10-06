/**
 * Camera Capture Screen
 * Design System: Editorial Luxe -- Cream, Charcoal, Rust, Sage
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
  Alert,
} from 'react-native';
import Animated, { useSharedValue, useAnimatedStyle, withTiming, interpolate, Easing } from 'react-native-reanimated';
import { StatusBar } from 'expo-status-bar';
import { useRouter, useLocalSearchParams, useNavigation } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { CameraView, useCameraPermissions } from 'expo-camera';
import * as ImagePicker from 'expo-image-picker';

import { track } from '@/lib/analytics';
import { colors, fonts, radius } from '@/constants/theme';
import { Skeleton } from '@/components/ui/Skeleton';
import BlurOverlay from '@/components/sell/BlurOverlay';
import CameraGuides from '@/components/sell/CameraGuides';
import draftService, { ArticleDraft, createEmptyDraft } from '@/services/draftService';
import {
  useSellCamera,
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

  const isResuming = params.resumeDraft === 'true';
  const resumedPhotos: string[] = params.photos
    ? JSON.parse(params.photos as string)
    : [];

  const [photos, setPhotos] = useState<string[]>(isResuming ? resumedPhotos : []);
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
      if (isResuming) {
        const existingDraft = await draftService.loadDraft();
        if (existingDraft) draftRef.current = existingDraft;
      } else {
        const newDraft = createEmptyDraft();
        await draftService.saveDraft(newDraft);
        draftRef.current = newDraft;
      }
    };
    draftReadyRef.current = initDraft();
  }, [isResuming]);

  // Persist edits while staying on the screen; Continue/close flush immediately.
  useEffect(() => {
    photoSaveTimer.current = setTimeout(() => {
      persistPhotos().catch(() => {
        if (__DEV__) console.error('Failed to save draft photos');
      });
    }, 300);
    return () => { if (photoSaveTimer.current) clearTimeout(photoSaveTimer.current); };
  }, [persistPhotos]);

  useEffect(() => navigation.addListener('beforeRemove', (event) => {
    if (leavingRef.current || draftService.wasPublished) return;
    event.preventDefault();
    Alert.alert('Quitter ?', 'Vos photos seront sauvegardées en brouillon.', [
      { text: 'Annuler', style: 'cancel' },
      { text: 'Quitter', onPress: () => { void saveBeforeLeaving(() => navigation.dispatch(event.data.action)); } },
    ]);
  }), [navigation, saveBeforeLeaving]);

  // Handlers
  const handleCapture = async () => {
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
  };

  const handleGalleryPress = async () => {
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
  };

  const handleRemovePhoto = useCallback((index: number) => {
    setPhotos((prev) => prev.filter((_, i) => i !== index));
    track('sell_photo_removed', {
      screen: 'capture',
      photo_index: index,
      photo_count_after: Math.max(0, photos.length - 1),
    });
  }, [photos.length]);

  const handleClose = () => {
    const draft = draftRef.current;
    // Preserve the draft if it holds work beyond the local photos:
    // already-uploaded Storage images or an AI analysis result would be lost.
    const hasUploadedWork =
      photos.length > 0 ||
      (draft?.storageUrls?.length ?? 0) > 0 ||
      draft?.aiResult != null;

    if (hasUploadedWork) {
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
              void saveBeforeLeaving(() => router.replace('/(tabs)'));
            },
          },
        ],
      );
    } else {
      void draftService.deleteDraft().then(() => router.replace('/(tabs)'));
    }
  };

  const handleContinue = () => {
    if (photos.length === 0) {
      Alert.alert('Aucune photo', 'Ajoutez au moins une photo pour continuer.');
      return;
    }
    track('sell_step_completed', { step: 'capture', photo_count: photos.length });
    void saveBeforeLeaving(() => router.push({
      pathname: '/sell/photos-review',
      params: { photos: JSON.stringify(photos) },
    }));
  };

  const toggleCameraFacing = camera.flip;
  const toggleTorch = camera.toggleTorch;

  // Overlay heights
  const topOverlayHeight = insets.top + 56;
  const bottomOverlayHeight = 140 + insets.bottom;

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
          torchAvailable={facing === 'back' && camera.ready}
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
