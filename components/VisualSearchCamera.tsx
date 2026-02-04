/**
 * VisualSearchCamera Component
 * Camera capture for visual product search
 *
 * Differences from CameraCapture:
 * - Single photo only (not multi-photo)
 * - Guide frame to help framing the product
 * - Preview + confirm step before searching
 * - Contextual help text
 */

import React, { useRef, useState, useEffect } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  ActivityIndicator,
  Linking,
  Platform,
} from 'react-native';
import { CameraView, CameraType, useCameraPermissions } from 'expo-camera';
import { Image } from 'expo-image';
import * as ImagePicker from 'expo-image-picker';
import { Ionicons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { colors, spacing, typography, radius } from '@/constants/theme';

// ============================================================
// Types
// ============================================================

interface VisualSearchCameraProps {
  onClose: () => void;
  onPhotoCapture: (uri: string) => void;
}

// ============================================================
// Component
// ============================================================

export default function VisualSearchCamera({
  onClose,
  onPhotoCapture,
}: VisualSearchCameraProps) {
  const [permission, requestPermission] = useCameraPermissions();
  const [facing, setFacing] = useState<CameraType>('back');
  const [isCapturing, setIsCapturing] = useState(false);
  const [capturedUri, setCapturedUri] = useState<string | null>(null);
  const cameraRef = useRef<CameraView>(null);
  const insets = useSafeAreaInsets();

  // Request permission on mount
  useEffect(() => {
    if (!permission?.granted && permission?.canAskAgain) {
      requestPermission();
    }
  }, [permission]);

  // Take a photo
  const handleCapture = async () => {
    if (!cameraRef.current || isCapturing) return;

    setIsCapturing(true);
    try {
      const photo = await cameraRef.current.takePictureAsync({
        quality: 0.8,
        skipProcessing: false,
      });
      if (photo?.uri) {
        setCapturedUri(photo.uri);
      }
    } catch (error) {
      console.error('[VisualSearchCamera] Error taking photo:', error);
    } finally {
      setIsCapturing(false);
    }
  };

  // Pick from gallery
  const handleGalleryPress = async () => {
    try {
      const result = await ImagePicker.launchImageLibraryAsync({
        mediaTypes: ['images'] as const,
        allowsMultipleSelection: false,
        quality: 0.8,
      });

      if (!result.canceled && result.assets.length > 0) {
        setCapturedUri(result.assets[0].uri);
      }
    } catch (error) {
      console.error('[VisualSearchCamera] Error picking image:', error);
    }
  };

  // Retake photo
  const handleRetake = () => {
    setCapturedUri(null);
  };

  // Confirm and search
  const handleConfirm = () => {
    if (capturedUri) {
      onPhotoCapture(capturedUri);
    }
  };

  const toggleCameraFacing = () => {
    setFacing((current) => (current === 'back' ? 'front' : 'back'));
  };

  // ─── Permission: Loading ────────────────────────────────────
  if (!permission) {
    return (
      <View style={styles.container}>
        <ActivityIndicator size="large" color={colors.primary} />
      </View>
    );
  }

  // ─── Permission: Denied ─────────────────────────────────────
  if (!permission.granted) {
    return (
      <View style={styles.container}>
        <View style={styles.permissionDenied}>
          <Ionicons name="camera-outline" size={64} color={colors.muted} />
          <Text style={styles.permissionTitle}>Accès caméra requis</Text>
          <Text style={styles.permissionText}>
            Pour rechercher par photo, autorisez l'accès à la caméra.
          </Text>

          <TouchableOpacity
            style={styles.settingsButton}
            onPress={() => Linking.openSettings()}
          >
            <Ionicons name="settings-outline" size={20} color={colors.white} />
            <Text style={styles.settingsButtonText}>Ouvrir les réglages</Text>
          </TouchableOpacity>

          <Text style={styles.orText}>ou</Text>

          <TouchableOpacity style={styles.galleryFallbackButton} onPress={handleGalleryPress}>
            <Ionicons name="images-outline" size={24} color={colors.primary} />
            <Text style={styles.galleryFallbackText}>Sélectionner depuis la galerie</Text>
          </TouchableOpacity>

          <TouchableOpacity style={styles.cancelButton} onPress={onClose}>
            <Text style={styles.cancelText}>Annuler</Text>
          </TouchableOpacity>
        </View>
      </View>
    );
  }

  // ─── Preview + Confirm ──────────────────────────────────────
  if (capturedUri) {
    return (
      <View style={styles.container}>
        <View style={[styles.previewHeader, { paddingTop: insets.top + 8 }]}>
          <TouchableOpacity onPress={handleRetake} style={styles.headerButton}>
            <Ionicons name="arrow-back" size={24} color={colors.foreground} />
          </TouchableOpacity>
          <Text style={styles.headerTitle}>Recherche visuelle</Text>
          <View style={styles.headerButton} />
        </View>

        <View style={styles.previewContent}>
          <View style={styles.previewImageContainer}>
            <Image
              source={{ uri: capturedUri }}
              style={styles.previewImage}
              contentFit="contain"
            />
          </View>
        </View>

        <View style={[styles.previewActions, { paddingBottom: insets.bottom + 16 }]}>
          <TouchableOpacity style={styles.retakeButton} onPress={handleRetake}>
            <Ionicons name="refresh-outline" size={20} color={colors.foreground} />
            <Text style={styles.retakeButtonText}>Reprendre</Text>
          </TouchableOpacity>

          <TouchableOpacity style={styles.searchButton} onPress={handleConfirm}>
            <Ionicons name="search" size={20} color={colors.white} />
            <Text style={styles.searchButtonText}>Rechercher</Text>
          </TouchableOpacity>
        </View>
      </View>
    );
  }

  // ─── Camera View ────────────────────────────────────────────
  return (
    <View style={styles.container}>
      <CameraView ref={cameraRef} style={styles.camera} facing={facing}>
        <View style={styles.overlay}>
          {/* Top controls */}
          <View style={[styles.topControls, { paddingTop: insets.top + 8 }]}>
            <TouchableOpacity style={styles.closeButton} onPress={onClose}>
              <Ionicons name="close" size={28} color="#FFFFFF" />
            </TouchableOpacity>
            <TouchableOpacity style={styles.flipButton} onPress={toggleCameraFacing}>
              <Ionicons name="camera-reverse-outline" size={24} color="#FFFFFF" />
            </TouchableOpacity>
          </View>

          {/* Guide frame */}
          <View style={styles.guideContainer}>
            <View style={styles.guideFrame}>
              {/* Corner indicators */}
              <View style={[styles.corner, styles.cornerTopLeft]} />
              <View style={[styles.corner, styles.cornerTopRight]} />
              <View style={[styles.corner, styles.cornerBottomLeft]} />
              <View style={[styles.corner, styles.cornerBottomRight]} />
            </View>
            <Text style={styles.guideText}>Cadrez le produit à rechercher</Text>
          </View>

          {/* Bottom controls */}
          <View style={[styles.bottomControls, { paddingBottom: insets.bottom + 16 }]}>
            <TouchableOpacity style={styles.galleryButton} onPress={handleGalleryPress}>
              <Ionicons name="images-outline" size={26} color="#FFFFFF" />
            </TouchableOpacity>

            <TouchableOpacity
              style={styles.captureButton}
              onPress={handleCapture}
              disabled={isCapturing}
              accessibilityLabel="Rechercher par photo"
            >
              {isCapturing ? (
                <ActivityIndicator size="small" color={colors.primary} />
              ) : (
                <View style={styles.captureButtonInner} />
              )}
            </TouchableOpacity>

            <TouchableOpacity style={styles.cancelCameraButton} onPress={onClose}>
              <Text style={styles.cancelCameraText}>Annuler</Text>
            </TouchableOpacity>
          </View>
        </View>
      </CameraView>
    </View>
  );
}

// ============================================================
// Styles
// ============================================================

const GUIDE_SIZE = 260;
const CORNER_SIZE = 24;
const CORNER_BORDER = 3;

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#000000',
  },
  camera: {
    flex: 1,
  },
  overlay: {
    flex: 1,
    justifyContent: 'space-between',
  },

  // ─── Top Controls ───────────────────────────────────────────
  topControls: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    paddingHorizontal: spacing.md,
  },
  closeButton: {
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: 'rgba(0, 0, 0, 0.4)',
    justifyContent: 'center',
    alignItems: 'center',
  },
  flipButton: {
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: 'rgba(0, 0, 0, 0.4)',
    justifyContent: 'center',
    alignItems: 'center',
  },

  // ─── Guide Frame ────────────────────────────────────────────
  guideContainer: {
    alignItems: 'center',
  },
  guideFrame: {
    width: GUIDE_SIZE,
    height: GUIDE_SIZE,
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.3)',
    borderRadius: radius.md,
    position: 'relative',
  },
  corner: {
    position: 'absolute',
    width: CORNER_SIZE,
    height: CORNER_SIZE,
  },
  cornerTopLeft: {
    top: -1,
    left: -1,
    borderTopWidth: CORNER_BORDER,
    borderLeftWidth: CORNER_BORDER,
    borderColor: '#FFFFFF',
    borderTopLeftRadius: radius.md,
  },
  cornerTopRight: {
    top: -1,
    right: -1,
    borderTopWidth: CORNER_BORDER,
    borderRightWidth: CORNER_BORDER,
    borderColor: '#FFFFFF',
    borderTopRightRadius: radius.md,
  },
  cornerBottomLeft: {
    bottom: -1,
    left: -1,
    borderBottomWidth: CORNER_BORDER,
    borderLeftWidth: CORNER_BORDER,
    borderColor: '#FFFFFF',
    borderBottomLeftRadius: radius.md,
  },
  cornerBottomRight: {
    bottom: -1,
    right: -1,
    borderBottomWidth: CORNER_BORDER,
    borderRightWidth: CORNER_BORDER,
    borderColor: '#FFFFFF',
    borderBottomRightRadius: radius.md,
  },
  guideText: {
    color: 'rgba(255, 255, 255, 0.8)',
    fontSize: 15,
    fontFamily: typography.body.fontFamily,
    marginTop: spacing.md,
    textAlign: 'center',
  },

  // ─── Bottom Controls ────────────────────────────────────────
  bottomControls: {
    flexDirection: 'row',
    justifyContent: 'center',
    alignItems: 'center',
    paddingHorizontal: spacing.xl,
    gap: 40,
  },
  galleryButton: {
    width: 52,
    height: 52,
    borderRadius: 26,
    backgroundColor: 'rgba(0, 0, 0, 0.4)',
    justifyContent: 'center',
    alignItems: 'center',
  },
  captureButton: {
    width: 76,
    height: 76,
    borderRadius: 38,
    backgroundColor: '#FFFFFF',
    justifyContent: 'center',
    alignItems: 'center',
    borderWidth: 4,
    borderColor: 'rgba(255, 255, 255, 0.5)',
  },
  captureButtonInner: {
    width: 60,
    height: 60,
    borderRadius: 30,
    backgroundColor: '#FFFFFF',
  },
  cancelCameraButton: {
    width: 52,
    height: 52,
    justifyContent: 'center',
    alignItems: 'center',
  },
  cancelCameraText: {
    color: '#FFFFFF',
    fontSize: 13,
    fontFamily: typography.label.fontFamily,
    fontWeight: '500',
  },

  // ─── Preview Screen ─────────────────────────────────────────
  previewHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: spacing.md,
    paddingBottom: spacing.sm,
    backgroundColor: colors.surface,
  },
  headerButton: {
    width: 44,
    height: 44,
    borderRadius: 22,
    justifyContent: 'center',
    alignItems: 'center',
  },
  headerTitle: {
    fontFamily: typography.label.fontFamily,
    fontSize: 17,
    fontWeight: '600',
    color: colors.foreground,
  },
  previewContent: {
    flex: 1,
    backgroundColor: colors.surface,
    justifyContent: 'center',
    alignItems: 'center',
    padding: spacing.lg,
  },
  previewImageContainer: {
    width: '100%',
    aspectRatio: 3 / 4,
    maxHeight: '80%',
    borderRadius: radius.md,
    overflow: 'hidden',
    backgroundColor: colors.borderLight,
  },
  previewImage: {
    width: '100%',
    height: '100%',
  },
  previewActions: {
    flexDirection: 'row',
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.md,
    gap: spacing.md,
    backgroundColor: colors.surface,
  },
  retakeButton: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.sm,
    height: 52,
    borderRadius: radius.sm,
    borderWidth: 1.5,
    borderColor: colors.border,
    backgroundColor: colors.surface,
  },
  retakeButtonText: {
    fontFamily: typography.button.fontFamily,
    fontSize: 16,
    fontWeight: '600',
    color: colors.foreground,
  },
  searchButton: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.sm,
    height: 52,
    borderRadius: radius.sm,
    backgroundColor: colors.primary,
  },
  searchButtonText: {
    fontFamily: typography.button.fontFamily,
    fontSize: 16,
    fontWeight: '600',
    color: colors.white,
  },

  // ─── Permission Denied ──────────────────────────────────────
  permissionDenied: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    padding: spacing.xl,
    backgroundColor: colors.surface,
  },
  permissionTitle: {
    fontFamily: typography.h3.fontFamily,
    fontSize: 20,
    fontWeight: '700',
    color: colors.foreground,
    marginTop: spacing.md,
    marginBottom: spacing.sm,
  },
  permissionText: {
    fontFamily: typography.body.fontFamily,
    fontSize: 16,
    color: colors.muted,
    textAlign: 'center',
    lineHeight: 24,
    marginBottom: spacing.lg,
  },
  settingsButton: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    backgroundColor: colors.foreground,
    paddingHorizontal: spacing.lg,
    paddingVertical: 14,
    borderRadius: radius.sm,
  },
  settingsButtonText: {
    color: colors.white,
    fontFamily: typography.button.fontFamily,
    fontSize: 16,
    fontWeight: '600',
  },
  orText: {
    fontSize: 14,
    color: colors.muted,
    marginVertical: spacing.md,
  },
  galleryFallbackButton: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    paddingVertical: spacing.md,
  },
  galleryFallbackText: {
    fontFamily: typography.button.fontFamily,
    fontSize: 16,
    fontWeight: '500',
    color: colors.primary,
  },
  cancelButton: {
    marginTop: spacing.lg,
    paddingVertical: spacing.md,
  },
  cancelText: {
    fontFamily: typography.body.fontFamily,
    fontSize: 16,
    color: colors.muted,
  },
});
