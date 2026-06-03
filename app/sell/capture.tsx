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
import { useRouter, useLocalSearchParams } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { CameraView, CameraType, useCameraPermissions } from 'expo-camera';
import * as ImagePicker from 'expo-image-picker';

import { colors, fonts, radius } from '@/constants/theme';
import { Skeleton } from '@/components/ui/Skeleton';
import BlurOverlay from '@/components/sell/BlurOverlay';
import CameraGuides from '@/components/sell/CameraGuides';
import draftService, { ArticleDraft, createEmptyDraft } from '@/services/draftService';
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
  const insets = useSafeAreaInsets();
  const params = useLocalSearchParams();
  const cameraRef = useRef<CameraView>(null);

  const isResuming = params.resumeDraft === 'true';
  const resumedPhotos: string[] = params.photos
    ? JSON.parse(params.photos as string)
    : [];

  const [photos, setPhotos] = useState<string[]>(isResuming ? resumedPhotos : []);
  const [permission, requestPermission] = useCameraPermissions();
  const [facing, setFacing] = useState<CameraType>('back');
  const [torchActive, setTorchActive] = useState(false);
  const [isCapturing, setIsCapturing] = useState(false);
  const draftRef = useRef<ArticleDraft | null>(null);

  const canTakeMore = photos.length < MAX_PHOTOS;
  const hasPhotos = photos.length > 0;
  const showThumbStrip = hasPhotos || canTakeMore;

  // ── Camera fade-in on ready (parity with iOS SellOverlayCapture) ──
  const cameraOpacity = useSharedValue(0);

  const cameraFadeStyle = useAnimatedStyle(() => ({
    opacity: cameraOpacity.value,
  }));

  const handleCameraReady = useCallback(() => {
    cameraOpacity.value = withTiming(1, {
      duration: 260,
      easing: Easing.out(Easing.cubic),
    });
  }, []);

  // ── Thumb container height animation ──
  const thumbContainerHeight = useSharedValue(0);

  useEffect(() => {
    thumbContainerHeight.value = withTiming(showThumbStrip ? THUMB_CONTAINER_HEIGHT : 0, {
      duration: 300,
      easing: Easing.out(Easing.cubic),
    });
  }, [showThumbStrip]);

  const thumbContainerStyle = useAnimatedStyle(() => ({
    height: thumbContainerHeight.value,
    opacity: interpolate(thumbContainerHeight.value, [0, THUMB_CONTAINER_HEIGHT * 0.5], [0, 1]),
  }));

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
        if (existingDraft) draftRef.current = existingDraft;
      } else {
        const newDraft = createEmptyDraft();
        await draftService.saveDraft(newDraft);
        draftRef.current = newDraft;
      }
    };
    initDraft();
  }, [isResuming]);

  // Save photos to draft when they change
  useEffect(() => {
    if (!draftRef.current) return;
    const currentDraft = draftRef.current;
    const savePhotos = async () => {
      try {
        const updatedDraft = await draftService.updateDraftPhotos(currentDraft, photos);
        draftRef.current = updatedDraft;
      } catch (error) {
        if (__DEV__) console.error('Failed to save photos:', error);
      }
    };
    const timeoutId = setTimeout(() => {
      if (photos.length > 0 || currentDraft.photos.length > 0) {
        savePhotos();
      }
    }, 300);
    return () => clearTimeout(timeoutId);
  }, [photos]);

  // Handlers
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
        setPhotos((prev) => {
          const remaining = MAX_PHOTOS - prev.length;
          return [...prev, ...uris.slice(0, remaining)];
        });
      }
    } catch (error) {
      if (__DEV__) console.error('Error picking images:', error);
    }
  };

  const handleRemovePhoto = useCallback((index: number) => {
    setPhotos((prev) => prev.filter((_, i) => i !== index));
  }, []);

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
          { text: 'Annuler', style: 'cancel' },
          { text: 'Quitter', onPress: () => router.replace('/(tabs)') },
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
      params: { photos: JSON.stringify(photos) },
    });
  };

  const toggleCameraFacing = () => {
    setFacing((current) => (current === 'back' ? 'front' : 'back'));
  };

  const toggleTorch = () => {
    setTorchActive((current) => !current);
  };

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

  if (!permission.granted) {
    return (
      <View style={styles.container}>
        <PermissionDenied onGalleryPress={handleGalleryPress} />
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
    <View style={styles.container}>
      <StatusBar style="light" />

      <Animated.View style={[StyleSheet.absoluteFill, cameraFadeStyle]}>
        <CameraView
          ref={cameraRef}
          style={StyleSheet.absoluteFill}
          facing={facing}
          enableTorch={torchActive}
          onCameraReady={handleCameraReady}
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
        onClose={handleClose}
        onFlipCamera={toggleCameraFacing}
      />

      {!canTakeMore && (
        <View style={[styles.maxBadge, { top: topOverlayHeight + 12 }]}>
          <Text style={styles.maxBadgeText}>Maximum atteint</Text>
        </View>
      )}

      <View style={[styles.bottomSection, { paddingBottom: insets.bottom + 16 }]}>
        <CameraControlsRow
          canTakeMore={canTakeMore}
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
