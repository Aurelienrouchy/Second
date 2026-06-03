import React from 'react';
import { View, Text, Pressable, StyleSheet } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { colors, fonts } from '@/constants/theme';

interface TopControlsProps {
  topInset: number;
  photoCount: number;
  maxPhotos: number;
  torchActive: boolean;
  onClose: () => void;
  onFlipCamera: () => void;
  onToggleTorch: () => void;
}

export const TopControls = React.memo(function TopControls({
  topInset,
  photoCount,
  maxPhotos,
  torchActive,
  onClose,
  onFlipCamera,
  onToggleTorch,
}: TopControlsProps) {
  return (
    <View style={[styles.topControls, { paddingTop: topInset + 8 }]}>
      <Pressable
        style={styles.circleButton}
        onPress={onClose}
        hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
      >
        <Ionicons name="close" size={20} color={colors.cream} />
      </Pressable>

      <View style={styles.counterPill}>
        <Text style={styles.counterText}>
          {photoCount} / {maxPhotos}
        </Text>
      </View>

      <View style={styles.rightControls}>
        <Pressable
          style={[styles.circleButton, torchActive && styles.circleButtonActive]}
          onPress={onToggleTorch}
          hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
        >
          <Ionicons
            name={torchActive ? 'flash' : 'flash-off'}
            size={20}
            color={torchActive ? colors.charcoal : colors.cream}
          />
        </Pressable>

        <Pressable
          style={styles.circleButton}
          onPress={onFlipCamera}
          hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
        >
          <Ionicons
            name="camera-reverse-outline"
            size={20}
            color={colors.cream}
          />
        </Pressable>
      </View>
    </View>
  );
});

const styles = StyleSheet.create({
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
  rightControls: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
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
  circleButtonActive: {
    backgroundColor: colors.cream,
    borderColor: colors.cream,
  },
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
});
