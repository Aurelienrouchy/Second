import { Ionicons } from '@expo/vector-icons';
import { Image, type ImageLoadEventData } from 'expo-image';
import React, { useCallback, useMemo, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import Animated, { useAnimatedStyle, useSharedValue, withTiming } from 'react-native-reanimated';
import { scheduleOnRN } from 'react-native-worklets';

import type { ArticleImage } from '@/types';
import { clampImageTranslation, fittedImageSize } from '@/utils/galleryGeometry';

interface Props {
  image: ArticleImage;
  width: number;
  height: number;
  onNavigate: (direction: number) => void;
  onZoomChange: (zoomed: boolean) => void;
}

/** A fresh instance per selected photo: scale/offsets never leak across pages. */
export const ZoomableGalleryImage = React.memo(function ZoomableGalleryImage({
  image, width, height, onNavigate, onZoomChange,
}: Props) {
  const [failed, setFailed] = useState(false);
  const scale = useSharedValue(1);
  const startScale = useSharedValue(1);
  const x = useSharedValue(0);
  const y = useSharedValue(0);
  const startX = useSharedValue(0);
  const startY = useSharedValue(0);
  const imageWidth = useSharedValue(width);
  const imageHeight = useSharedValue(height);

  const handleLoad = useCallback((event: ImageLoadEventData) => {
    const fitted = fittedImageSize(width, height, event.source.width, event.source.height);
    imageWidth.set(fitted.width);
    imageHeight.set(fitted.height);
  }, [width, height, imageWidth, imageHeight]);

  const pinch = useMemo(() => Gesture.Pinch().withTestId('gallery-pinch')
    .onStart(() => {
      startScale.value = scale.value;
      startX.value = x.value;
      startY.value = y.value;
    })
    .onUpdate((event) => {
      const nextScale = Math.max(1, Math.min(4, startScale.value * event.scale));
      const ratio = nextScale / startScale.value;
      scale.value = nextScale;
      x.value = clampImageTranslation(startX.value * ratio + (1 - ratio) * (event.focalX - width / 2), imageWidth.value, width, nextScale);
      y.value = clampImageTranslation(startY.value * ratio + (1 - ratio) * (event.focalY - height / 2), imageHeight.value, height, nextScale);
    })
    .onFinalize(() => { scheduleOnRN(onZoomChange, scale.value > 1); }),
  [scale, startScale, x, y, startX, startY, imageWidth, imageHeight, width, height, onZoomChange]);

  const pan = useMemo(() => Gesture.Pan().withTestId('gallery-pan')
    .maxPointers(1).minDistance(8).averageTouches(true)
    .onStart(() => { startX.value = x.value; startY.value = y.value; startScale.value = scale.value; })
    .onUpdate((event) => {
      if (startScale.value > 1) {
        x.value = clampImageTranslation(startX.value + event.translationX, imageWidth.value, width, scale.value);
        y.value = clampImageTranslation(startY.value + event.translationY, imageHeight.value, height, scale.value);
      } else {
        x.value = event.translationX;
      }
    })
    .onEnd((event) => {
      if (startScale.value === 1) {
        const horizontal = Math.abs(event.translationX) > Math.abs(event.translationY) * 1.5;
        if (horizontal && (Math.abs(event.translationX) > width * 0.18 || Math.abs(event.velocityX) > 700)) {
          scheduleOnRN(onNavigate, event.translationX < 0 ? 1 : -1);
        }
      }
    })
    .onFinalize(() => {
      if (scale.value === 1) { x.value = withTiming(0); y.value = withTiming(0); }
    }),
  [scale, startScale, x, y, startX, startY, imageWidth, imageHeight, width, height, onNavigate]);

  const doubleTap = useMemo(() => Gesture.Tap().withTestId('gallery-double-tap').numberOfTaps(2)
    .onEnd((event, success) => {
      if (!success) return;
      const target = scale.value > 1 ? 1 : 3;
      x.value = withTiming(clampImageTranslation((width / 2 - event.x) * (target - 1), imageWidth.value, width, target));
      y.value = withTiming(clampImageTranslation((height / 2 - event.y) * (target - 1), imageHeight.value, height, target));
      scale.value = withTiming(target);
      scheduleOnRN(onZoomChange, target > 1);
    }),
  [scale, x, y, imageWidth, imageHeight, width, height, onZoomChange]);

  const gesture = useMemo(() => Gesture.Simultaneous(pinch, pan, doubleTap), [pinch, pan, doubleTap]);
  const animatedStyle = useAnimatedStyle(() => ({ transform: [{ translateX: x.value }, { translateY: y.value }, { scale: scale.value }] }));

  return (
    <View style={[styles.viewport, { width, height }]} testID="gallery-zoom-image">
      {failed ? (
        <View style={styles.fallback} accessibilityLabel="Photo indisponible">
          <Ionicons name="image-outline" size={40} color="#FFFFFF" />
          <Text style={styles.fallbackText}>Photo indisponible</Text>
        </View>
      ) : (
        <GestureDetector gesture={gesture}>
          <Animated.View collapsable={false} style={[styles.image, animatedStyle]}>
            <Image source={{ uri: image.url }} style={styles.image} contentFit="contain"
              onLoad={handleLoad} onError={() => setFailed(true)} accessibilityLabel="Photo de l’article agrandie" />
          </Animated.View>
        </GestureDetector>
      )}
    </View>
  );
});

const styles = StyleSheet.create({
  viewport: { overflow: 'hidden', justifyContent: 'center', alignItems: 'center' },
  image: { width: '100%', height: '100%' },
  fallback: { alignItems: 'center', gap: 12 },
  fallbackText: { color: '#FFFFFF' },
});
