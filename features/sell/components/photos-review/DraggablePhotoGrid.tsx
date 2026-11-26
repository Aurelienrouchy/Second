import React, { useCallback, useLayoutEffect, useMemo, useRef } from 'react';
import { AccessibilityInfo, AppState, StyleSheet } from 'react-native';
import { Gesture, GestureDetector, Pressable } from 'react-native-gesture-handler';
import Animated, { Easing, useReducedMotion, useSharedValue, withTiming } from 'react-native-reanimated';
import { scheduleOnRN } from 'react-native-worklets';
import * as Haptics from 'expo-haptics';
import { animations, colors, components, sizing } from '@/constants/theme';
import { Ionicons } from '@expo/vector-icons';
import { DraggablePhotoTile } from './DraggablePhotoTile';
import { movePhotoGridOrder, photoGridTarget, photoGridTouchIndex, type PhotoGridItem } from '../../utils/photoGrid';

interface DraggablePhotoGridProps {
  items: PhotoGridItem[]; width: number; maxPhotos: number; ownerUid?: string; disabled: boolean; dragging: boolean;
  contextKey: symbol; contextRevision: string;
  onMove: (from: number, to: number) => boolean; onRemove: (index: number) => void;
  onAdd: () => void;
  onDragStateChange: (dragging: boolean) => void;
}
interface DragOperation { epoch: number; token: number; from: number; ids: string }
const COLUMNS = components.photoReview.columns;
const GAP = components.photoReview.gridGap;
const REMOVE_TARGET = sizing.minTouchTarget;

/** One keyed parent keeps native image views alive throughout reorder and upload. */
export const DraggablePhotoGrid = React.memo(function DraggablePhotoGrid(props: DraggablePhotoGridProps) {
  const { items, width, maxPhotos, ownerUid, disabled, dragging, contextKey, contextRevision } = props;
  const ids = useMemo(() => items.map(item => item.id), [items]);
  const signature = JSON.stringify(ids);
  const size = Math.max(0, (width - GAP * (COLUMNS - 1)) / COLUMNS);
  const stride = size + GAP;
  const reduceMotion = useReducedMotion();
  const live = useRef(props);
  const currentEpoch = useRef(0);
  const operation = useRef<DragOperation | null>(null);
  const order = useSharedValue(ids);
  const originalOrder = useSharedValue(ids);
  const activeId = useSharedValue<string | null>(null);
  const dragX = useSharedValue(0), dragY = useSharedValue(0), lift = useSharedValue(0);
  const enabled = useSharedValue(!disabled);
  const epoch = useSharedValue(0), token = useSharedValue(0), startedEpoch = useSharedValue(0);
  const startIndex = useSharedValue(-1);
  const validTarget = useSharedValue(false);
  useLayoutEffect(() => { live.current = props; });
  useLayoutEffect(() => {
    currentEpoch.current += 1;
    epoch.value = currentEpoch.current;
    enabled.value = !disabled;
    order.value = ids;
    originalOrder.value = ids;
    activeId.value = null;
    lift.value = 0;
    if (operation.current) { operation.current = null; live.current.onDragStateChange(false); }
    return () => {
      currentEpoch.current += 1;
      epoch.value = currentEpoch.current;
      enabled.value = false;
      activeId.value = null;
      if (operation.current) { operation.current = null; live.current.onDragStateChange(false); }
    };
  }, [signature, width, disabled, contextKey, contextRevision, ids, epoch, enabled, order, originalOrder, activeId, lift]);

  const announceMove = useCallback((from: number, to: number, count: number) => {
    AccessibilityInfo.announceForAccessibility(`Photo ${from + 1} déplacée en position ${to + 1} sur ${count}${to === 0 ? ', photo principale' : ''}.`);
  }, []);
  const beginDrag = useCallback((dragEpoch: number, dragToken: number, from: number) => {
    const current = live.current;
    if (dragEpoch !== currentEpoch.current || current.disabled || AppState.currentState !== 'active') return;
    operation.current = { epoch: dragEpoch, token: dragToken, from, ids: JSON.stringify(current.items.map(item => item.id)) };
    current.onDragStateChange(true);
    void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => undefined);
  }, []);
  const finishDrag = useCallback((dragEpoch: number, dragToken: number, to: number, commit: boolean) => {
    const pending = operation.current;
    if (!pending || pending.epoch !== dragEpoch || pending.token !== dragToken) return;
    operation.current = null;
    const current = live.current;
    current.onDragStateChange(false);
    const currentIds = current.items.map(item => item.id);
    const valid = commit && dragEpoch === currentEpoch.current && !current.disabled && AppState.currentState === 'active' &&
      pending.ids === JSON.stringify(currentIds) && to >= 0 && to < currentIds.length;
    const moved = valid && pending.from !== to && current.onMove(pending.from, to);
    order.value = moved ? movePhotoGridOrder(currentIds, pending.from, to) : currentIds;
    if (moved) { announceMove(pending.from, to, currentIds.length); void Haptics.selectionAsync().catch(() => undefined); }
  }, [announceMove, order]);
  const moveAccessible = useCallback((from: number, to: number) => {
    const current = live.current;
    if (operation.current || current.disabled || AppState.currentState !== 'active') return;
    if (current.onMove(from, to)) announceMove(from, to, current.items.length);
  }, [announceMove]);
  const removePhoto = useCallback((index: number) => {
    if (!operation.current && !live.current.disabled && !live.current.dragging) live.current.onRemove(index);
  }, []);
  const addPhoto = useCallback(() => {
    if (!operation.current && !live.current.disabled && !live.current.dragging && AppState.currentState === 'active') live.current.onAdd();
  }, []);

  const pan = useMemo(() => Gesture.Pan().withTestId('sell-photo-grid-drag').maxPointers(1)
    .enabled(!disabled && ids.length > 1).activateAfterLongPress(animations.duration.slow)
    .onTouchesDown((event, manager) => {
      const touch = event.allTouches[0];
      const index = touch ? photoGridTouchIndex(touch.x, touch.y, size, GAP, COLUMNS, ids.length, REMOVE_TARGET) : -1;
      if (!enabled.value || activeId.value !== null || index < 0) { manager.fail(); return; }
    })
    .onStart(event => {
      const from = photoGridTouchIndex(event.x, event.y, size, GAP, COLUMNS, ids.length, REMOVE_TARGET);
      if (!enabled.value || activeId.value !== null || from < 0 || from >= ids.length) return;
      token.value += 1;
      startedEpoch.value = epoch.value;
      startIndex.value = from;
      validTarget.value = true;
      originalOrder.value = [...order.value];
      activeId.value = ids[from];
      dragX.value = (from % COLUMNS) * stride;
      dragY.value = Math.floor(from / COLUMNS) * stride;
      lift.value = withTiming(reduceMotion ? 0 : 1, { duration: animations.duration.fast, easing: Easing.out(Easing.cubic) });
      scheduleOnRN(beginDrag, startedEpoch.value, token.value, from);
    })
    .onUpdate(event => {
      const id = activeId.value;
      if (!enabled.value || id === null || startedEpoch.value !== epoch.value) return;
      dragX.value = (startIndex.value % COLUMNS) * stride + event.translationX;
      dragY.value = Math.floor(startIndex.value / COLUMNS) * stride + event.translationY;
      const target = photoGridTarget(dragX.value, dragY.value, stride, COLUMNS, ids.length);
      validTarget.value = target >= 0;
      const from = order.value.indexOf(id);
      if (target >= 0 && from !== target) order.value = movePhotoGridOrder(order.value, from, target);
    })
    .onFinalize((_event, success) => {
      const id = activeId.value;
      if (id === null || startedEpoch.value !== epoch.value) return;
      const commit = success && enabled.value && validTarget.value;
      if (!commit) order.value = originalOrder.value;
      const target = order.value.indexOf(id);
      const dragEpoch = startedEpoch.value, dragToken = token.value;
      const timing = { duration: reduceMotion ? 0 : animations.duration.normal, easing: Easing.out(Easing.cubic) };
      dragX.value = withTiming((target % COLUMNS) * stride, timing);
      lift.value = withTiming(0, timing);
      dragY.value = withTiming(Math.floor(target / COLUMNS) * stride, timing, finished => {
        if (!finished || epoch.value !== dragEpoch || token.value !== dragToken) return;
        activeId.value = null;
        scheduleOnRN(finishDrag, dragEpoch, dragToken, target, commit);
      });
    }), [disabled, ids, size, stride, reduceMotion, enabled, activeId, token, startedEpoch, epoch,
    startIndex, validTarget, originalOrder, order, dragX, dragY, lift, beginDrag, finishDrag]);
  const layout = useMemo(() => StyleSheet.create({ grid: { width, height: Math.ceil(maxPhotos / COLUMNS) * stride - GAP } }), [width, maxPhotos, stride]);
  const emptySlots = useMemo(() => Array.from({ length: Math.max(0, maxPhotos - items.length) }, (_, offset) => {
    const index = items.length + offset;
    return { index, style: StyleSheet.create({ slot: { width: size, height: size, left: (index % COLUMNS) * stride,
      top: Math.floor(index / COLUMNS) * stride } }).slot };
  }), [maxPhotos, items.length, size, stride]);
  return <GestureDetector gesture={pan}><Animated.View style={layout.grid} testID="sell-photo-grid">
    {items.map((item, index) => <DraggablePhotoTile key={item.id} item={item} index={index} count={items.length}
      size={size} ownerUid={ownerUid} disabled={disabled || dragging} reduceMotion={reduceMotion} order={order}
      activeId={activeId} dragX={dragX} dragY={dragY} lift={lift} onMove={moveAccessible} onRemove={removePhoto} />)}
    {emptySlots.map(slot => <Pressable key={`empty-${slot.index}`} style={[styles.emptySlot, slot.style]}
      onPress={addPhoto} disabled={disabled || dragging} accessibilityRole="button" accessibilityLabel="Ajouter une photo"
      testID={`sell-photo-add-slot-${slot.index}`}>
      <Ionicons name="add" size={sizing.iconMD} color={colors.muted} />
    </Pressable>)}
  </Animated.View></GestureDetector>;
});

const styles = StyleSheet.create({
  emptySlot: { position: 'absolute', borderWidth: components.photoReview.emptyBorderWidth, borderStyle: 'dashed',
    borderRadius: components.photoReview.tileRadius, borderColor: colors.borderStrong,
    backgroundColor: colors.transparent, alignItems: 'center', justifyContent: 'center' },
});
