import React, { useState } from 'react';
import { StyleSheet, Text, View, type AccessibilityActionEvent } from 'react-native';
import { Pressable } from 'react-native-gesture-handler';
import Animated, { Easing, useAnimatedReaction, useAnimatedStyle, useSharedValue, withTiming, type SharedValue } from 'react-native-reanimated';
import { Ionicons } from '@expo/vector-icons';
import { PrivateStorageImage } from '@/components/PrivateStorageImage';
import { animations, colors, components, radius, shadows, sizing, spacing, typography } from '@/constants/theme';
import type { PhotoGridItem } from '../../utils/photoGrid';

interface DraggablePhotoTileProps {
  item: PhotoGridItem; index: number; count: number; size: number; ownerUid?: string;
  disabled: boolean; reduceMotion: boolean; order: SharedValue<string[]>;
  activeId: SharedValue<string | null>; dragX: SharedValue<number>; dragY: SharedValue<number>; lift: SharedValue<number>;
  onMove: (from: number, to: number) => void; onRemove: (index: number) => void;
}

const COLUMNS = components.photoReview.columns;
const GAP = components.photoReview.gridGap;
const LIFT_SCALE = animations.scale.draggedPhoto;
const SHADOW_OPACITY = shadows.elevated.shadowOpacity;
const ELEVATION = shadows.elevated.elevation;

export const DraggablePhotoTile = React.memo(function DraggablePhotoTile({ item, index, count, size, ownerUid, disabled,
  reduceMotion, order, activeId, dragX, dragY, lift, onMove, onRemove }: DraggablePhotoTileProps) {
  const [failedLocalUri, setFailedLocalUri] = useState<string | null>(null);
  const sourceUri = failedLocalUri === item.uri && item.fallbackUri ? item.fallbackUri : item.uri;
  const stride = size + GAP;
  const positionX = useSharedValue((index % COLUMNS) * stride);
  const positionY = useSharedValue(Math.floor(index / COLUMNS) * stride);
  useAnimatedReaction(() => order.value.indexOf(item.id), (next, previous) => {
    const position = next < 0 ? index : next;
    const x = (position % COLUMNS) * stride;
    const y = Math.floor(position / COLUMNS) * stride;
    const animate = !reduceMotion && previous !== null && previous >= 0 && next >= 0 && previous !== next;
    const timing = { duration: animations.duration.fast, easing: Easing.out(Easing.cubic) };
    positionX.value = animate ? withTiming(x, timing) : x;
    positionY.value = animate ? withTiming(y, timing) : y;
  });
  const animatedStyle = useAnimatedStyle(() => {
    const active = activeId.value === item.id;
    return {
      width: size, height: size,
      zIndex: active ? 1 : 0,
      shadowOpacity: active ? SHADOW_OPACITY * lift.value : 0,
      elevation: active ? ELEVATION : 0,
      borderColor: active ? colors.primary : colors.transparent,
      transform: [
        { translateX: active ? dragX.value : positionX.value },
        { translateY: active ? dragY.value : positionY.value },
        { scale: active && !reduceMotion ? 1 + (LIFT_SCALE - 1) * lift.value : 1 },
      ],
    };
  });
  const handleAccessibilityAction = (event: AccessibilityActionEvent) => {
    if (disabled) return;
    const action = event.nativeEvent.actionName;
    if (action === 'moveBefore' && index > 0) onMove(index, index - 1);
    else if (action === 'moveAfter' && index < count - 1) onMove(index, index + 1);
    else if (action === 'makePrimary' && index > 0) onMove(index, 0);
  };
  return <Animated.View style={[styles.tile, animatedStyle]} testID={`sell-photo-tile-${item.id}`}>
    <View style={styles.imageFrame} accessible accessibilityRole="image"
      accessibilityLabel={`Photo ${index + 1} sur ${count}${index === 0 ? ', photo principale' : ''}`}
      accessibilityHint="Utilisez les actions pour changer l’ordre des photos."
      accessibilityState={{ disabled }}
      accessibilityActions={disabled ? [] : [
        ...(index > 0 ? [{ name: 'moveBefore', label: 'Avancer' }, { name: 'makePrimary', label: 'Définir comme photo principale' }] : []),
        ...(index < count - 1 ? [{ name: 'moveAfter', label: 'Reculer' }] : []),
      ]}
      onAccessibilityAction={handleAccessibilityAction}
      testID={`sell-photo-accessibility-${index}`}>
      <PrivateStorageImage uri={sourceUri} allowLocalSource localSourceOwnerUid={ownerUid}
        testID={`sell-photo-image-${item.id}`}
        onError={() => {
          if (sourceUri === item.uri && /^(file:\/\/|content:\/\/|ph:\/\/|assets-library:\/\/|blob:|data:image\/)/.test(item.uri)) setFailedLocalUri(item.uri);
        }}
        style={StyleSheet.absoluteFill} contentFit="cover" />
      {index === 0 ? <View style={styles.primaryBadge}><Text style={styles.primaryText}>Principale</Text></View> : null}
    </View>
    <Pressable style={styles.removeTarget} disabled={disabled} onPress={() => onRemove(index)}
      accessibilityRole="button" accessibilityLabel={`Supprimer la photo ${index + 1}`}
      testID={`sell-thumbnail-remove-${index}`}>
      <View style={styles.removeDisc}><Ionicons name="close" size={sizing.iconSM} color={colors.charcoal} /></View>
    </Pressable>
  </Animated.View>;
});

const styles = StyleSheet.create({
  tile: { position: 'absolute', top: 0, left: 0, backgroundColor: colors.surfaceWarm,
    ...shadows.elevated, borderWidth: StyleSheet.hairlineWidth, borderRadius: components.photoReview.tileRadius },
  imageFrame: { flex: 1, overflow: 'hidden', backgroundColor: colors.border, borderRadius: components.photoReview.tileRadius },
  primaryBadge: { position: 'absolute', left: components.photoReview.badgeInset, bottom: components.photoReview.badgeInset,
    backgroundColor: colors.overlay, paddingHorizontal: spacing.sm, paddingVertical: spacing.xs, borderRadius: radius.full },
  primaryText: { ...typography.caption, color: colors.cream },
  removeTarget: { position: 'absolute', top: 0, right: 0, width: sizing.minTouchTarget,
    height: sizing.minTouchTarget, alignItems: 'center', justifyContent: 'center' },
  removeDisc: { width: components.photoReview.removeDiscSize, height: components.photoReview.removeDiscSize,
    borderRadius: radius.full, backgroundColor: colors.surfaceWarm,
    borderWidth: StyleSheet.hairlineWidth, borderColor: colors.border, ...shadows.card,
    alignItems: 'center', justifyContent: 'center' },
});
