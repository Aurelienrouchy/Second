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
import * as ImagePicker from 'expo-image-picker';
import { Ionicons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

interface CameraCaptureProps {
  onPhotoTaken: (uri: string) => void;
  onPhotosSelected: (uris: string[]) => void;
  maxPhotos: number;
  currentPhotoCount: number;
  disabled?: boolean;
}

export default function CameraCapture({
  onPhotoTaken,
  onPhotosSelected,
  maxPhotos,
  currentPhotoCount,
  disabled = false,
}: CameraCaptureProps) {
  const [permission, requestPermission] = useCameraPermissions();
  const [facing, setFacing] = useState<CameraType>('back');
  const [isCapturing, setIsCapturing] = useState(false);
  const cameraRef = useRef<CameraView>(null);
  const insets = useSafeAreaInsets();

  const canTakeMore = currentPhotoCount < maxPhotos;
  const remainingSlots = maxPhotos - currentPhotoCount;

  // Request permission on mount
  useEffect(() => {
    if (!permission?.granted && permission?.canAskAgain) {
      requestPermission();
    }
  }, [permission]);

  const handleCapture = async () => {
    if (!cameraRef.current || isCapturing || !canTakeMore || disabled) return;

    setIsCapturing(true);
    try {
      const photo = await cameraRef.current.takePictureAsync({
        quality: 0.7,
        skipProcessing: false,
      });
      if (photo?.uri) {
        onPhotoTaken(photo.uri);
      }
    } catch (error) {
      console.error('Error taking photo:', error);
    } finally {
      setIsCapturing(false);
    }
  };

  const handleGalleryPress = async () => {
    if (disabled) return;

    try {
      const result = await ImagePicker.launchImageLibraryAsync({
        mediaTypes: ['images'] as const,
        allowsMultipleSelection: true,
        quality: 0.7,
        selectionLimit: remainingSlots,
      });

      if (!result.canceled && result.assets.length > 0) {
        const uris = result.assets.map((asset) => asset.uri);
        onPhotosSelected(uris);
      }
    } catch (error) {
      console.error('Error picking images:', error);
    }
  };

  const toggleCameraFacing = () => {
    setFacing((current) => (current === 'back' ? 'front' : 'back'));
  };

  const openSettings = () => {
    Linking.openSettings();
  };

  // Loading state
  if (!permission) {
    return (
      <View style={styles.container}>
        <ActivityIndicator size="large" color="#F79F24" />
      </View>
    );
  }

  // Permission denied - show fallback
  if (!permission.granted) {
    return (
      <View style={styles.container}>
        <View style={styles.permissionDenied}>
          <Ionicons name="camera-outline" size={64} color="#9CA3AF" />
          <Text style={styles.permissionTitle}>Accès caméra requis</Text>
          <Text style={styles.permissionText}>
            Pour prendre des photos de vos articles, autorisez l'accès à la caméra dans les réglages.
          </Text>

          <TouchableOpacity style={styles.settingsButton} onPress={openSettings}>
            <Ionicons name="settings-outline" size={20} color="#FFFFFF" />
            <Text style={styles.settingsButtonText}>Ouvrir les réglages</Text>
          </TouchableOpacity>

          <Text style={styles.orText}>ou</Text>

          <TouchableOpacity style={styles.galleryFallbackButton} onPress={handleGalleryPress}>
            <Ionicons name="images-outline" size={24} color="#F79F24" />
            <Text style={styles.galleryFallbackText}>
              Sélectionner depuis la galerie
            </Text>
          </TouchableOpacity>
        </View>
      </View>
    );
  }

  // Camera view
  return (
    <View style={styles.container}>
      <CameraView
        ref={cameraRef}
        style={styles.camera}
        facing={facing}
      >
        {/* Camera overlay with controls */}
        <View style={styles.overlay}>
          {/* Top controls */}
          <View style={[styles.topControls, { paddingTop: insets.top + 8 }]}>
            <TouchableOpacity
              style={styles.flipButton}
              onPress={toggleCameraFacing}
            >
              <Ionicons name="camera-reverse-outline" size={28} color="#FFFFFF" />
            </TouchableOpacity>
          </View>

          {/* Max reached message */}
          {!canTakeMore && (
            <View style={styles.maxReachedBadge}>
              <Text style={styles.maxReachedText}>Maximum atteint (5/5)</Text>
            </View>
          )}

          {/* Bottom controls */}
          <View style={[styles.bottomControls, { paddingBottom: insets.bottom + 16 }]}>
            {/* Gallery button */}
            <TouchableOpacity
              style={styles.galleryButton}
              onPress={handleGalleryPress}
              disabled={!canTakeMore || disabled}
            >
              <Ionicons
                name="images-outline"
                size={28}
                color={canTakeMore ? '#FFFFFF' : '#6B7280'}
              />
            </TouchableOpacity>

            {/* Capture button */}
            <TouchableOpacity
              style={[
                styles.captureButton,
                (!canTakeMore || disabled) && styles.captureButtonDisabled,
              ]}
              onPress={handleCapture}
              disabled={!canTakeMore || isCapturing || disabled}
            >
              {isCapturing ? (
                <ActivityIndicator size="small" color="#F79F24" />
              ) : (
                <View
                  style={[
                    styles.captureButtonInner,
                    (!canTakeMore || disabled) && styles.captureButtonInnerDisabled,
                  ]}
                />
              )}
            </TouchableOpacity>

            {/* Placeholder for symmetry */}
            <View style={styles.placeholderButton} />
          </View>
        </View>
      </CameraView>
    </View>
  );
}

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
  topControls: {
    flexDirection: 'row',
    justifyContent: 'flex-end',
    paddingHorizontal: 16,
  },
  flipButton: {
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: 'rgba(0, 0, 0, 0.4)',
    justifyContent: 'center',
    alignItems: 'center',
  },
  maxReachedBadge: {
    alignSelf: 'center',
    backgroundColor: 'rgba(239, 68, 68, 0.9)',
    paddingHorizontal: 16,
    paddingVertical: 8,
    borderRadius: 20,
  },
  maxReachedText: {
    color: '#FFFFFF',
    fontSize: 14,
    fontWeight: '600',
  },
  bottomControls: {
    flexDirection: 'row',
    justifyContent: 'center',
    alignItems: 'center',
    paddingHorizontal: 32,
    gap: 40,
  },
  galleryButton: {
    width: 56,
    height: 56,
    borderRadius: 28,
    backgroundColor: 'rgba(0, 0, 0, 0.4)',
    justifyContent: 'center',
    alignItems: 'center',
  },
  captureButton: {
    width: 80,
    height: 80,
    borderRadius: 40,
    backgroundColor: '#FFFFFF',
    justifyContent: 'center',
    alignItems: 'center',
    borderWidth: 4,
    borderColor: 'rgba(255, 255, 255, 0.5)',
  },
  captureButtonDisabled: {
    backgroundColor: '#6B7280',
    borderColor: 'rgba(107, 114, 128, 0.5)',
  },
  captureButtonInner: {
    width: 64,
    height: 64,
    borderRadius: 32,
    backgroundColor: '#FFFFFF',
  },
  captureButtonInnerDisabled: {
    backgroundColor: '#9CA3AF',
  },
  placeholderButton: {
    width: 56,
    height: 56,
  },
  // Permission denied styles
  permissionDenied: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    padding: 32,
    backgroundColor: '#F9FAFB',
  },
  permissionTitle: {
    fontSize: 20,
    fontWeight: '700',
    color: '#1F2937',
    marginTop: 16,
    marginBottom: 8,
  },
  permissionText: {
    fontSize: 16,
    color: '#6B7280',
    textAlign: 'center',
    lineHeight: 24,
    marginBottom: 24,
  },
  settingsButton: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    backgroundColor: '#1F2937',
    paddingHorizontal: 24,
    paddingVertical: 14,
    borderRadius: 12,
  },
  settingsButtonText: {
    color: '#FFFFFF',
    fontSize: 16,
    fontWeight: '600',
  },
  orText: {
    fontSize: 14,
    color: '#9CA3AF',
    marginVertical: 16,
  },
  galleryFallbackButton: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingVertical: 12,
  },
  galleryFallbackText: {
    fontSize: 16,
    fontWeight: '500',
    color: '#F79F24',
  },
});
