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
  ActivityIndicator,
} from 'react-native';
import { useRouter, useLocalSearchParams } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { CameraView, CameraType, useCameraPermissions } from 'expo-camera';
import * as ImagePicker from 'expo-image-picker';

import { colors, fonts } from '@/constants/theme';
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
  const [isCapturing, setIsCapturing] = useState(false);
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
        if (existingDraft) setDraft(existingDraft);
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
      try {
        const updatedDraft = await draftService.updateDraftPhotos(draft, photos);
        setDraft(updatedDraft);
      } catch (error) {
        if (__DEV__) console.error('Failed to save photos:', error);
      }
    };
    const timeoutId = setTimeout(() => {
      if (photos.length > 0 || draft.photos.length > 0) {
        savePhotos();
      }
    }, 300);
    return () => clearTimeout(timeoutId);
  }, [photos, draft?.id]);

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
      if (__DEV__) console.error('Error picking images:', error);
    }
  };

  const handleRemovePhoto = useCallback((index: number) => {
    setPhotos((prev) => prev.filter((_, i) => i !== index));
  }, []);

  const handleClose = () => {
    if (photos.length > 0) {
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

  // Overlay heights
  const topOverlayHeight = insets.top + 56;
  const bottomOverlayHeight = photos.length > 0 ? 200 + insets.bottom : 140 + insets.bottom;

  // Permission states
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
        <PermissionDenied onGalleryPress={handleGalleryPress} />
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
    <View style={styles.container}>
      <CameraView
        ref={cameraRef}
        style={StyleSheet.absoluteFill}
        facing={facing}
      />

      <BlurOverlay position="top" height={topOverlayHeight} intensity={0.6} />

      <View
        style={[
          styles.guidesArea,
          { top: topOverlayHeight, bottom: bottomOverlayHeight },
        ]}
      >
        <CameraGuides message={guideMessage} subMessage={guideSubMessage} />
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
        <ThumbnailStrip photos={photos} onRemovePhoto={handleRemovePhoto} />

        <CameraControlsRow
          canTakeMore={canTakeMore}
          isCapturing={isCapturing}
          hasPhotos={photos.length > 0}
          onGalleryPress={handleGalleryPress}
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
  bottomSection: {
    position: 'absolute',
    bottom: 0,
    left: 0,
    right: 0,
    zIndex: 10,
  },
});
