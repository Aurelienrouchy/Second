import React from 'react';
import { act, fireEvent, render } from '@testing-library/react-native';
import { AppState } from 'react-native';
import { GestureHandlerRootView, State } from 'react-native-gesture-handler';
import { fireGestureHandler, getByGestureTestId } from 'react-native-gesture-handler/jest-utils';
import { DraggablePhotoGrid } from './DraggablePhotoGrid';
import { DraggablePhotoTile } from './DraggablePhotoTile';
import * as Reanimated from 'react-native-reanimated';
import { movePhotoGridOrder, photoGridTarget, photoGridTouchIndex } from '../../utils/photoGrid';

jest.mock('react-native-reanimated', () => ({ ...require('react-native-reanimated/mock'), useReducedMotion: () => false }));
const mockImageMount = jest.fn();
const mockImageUnmount = jest.fn();
jest.mock('@/components/PrivateStorageImage', () => ({
  PrivateStorageImage: ({ uri, ...props }: { uri: string; testID?: string; onError?: () => void }) => {
    const React = require('react');
    const { View } = require('react-native');
    React.useEffect(() => { mockImageMount(); return () => { mockImageUnmount(); }; }, []);
    return React.createElement(View, { ...props, accessibilityLabel: uri });
  },
}));
const items = [
  { id: 'photo-a', uri: 'file:///same.jpg' },
  { id: 'photo-b', uri: 'file:///same.jpg' },
  { id: 'photo-c', uri: 'file:///third.jpg' },
];
const context = Symbol('photo-context');
beforeEach(() => {
  jest.clearAllMocks();
  Object.defineProperty(AppState, 'currentState', { configurable: true, value: 'active' });
});

it('inserts instead of swapping, clamps empty destinations and excludes remove targets and gaps', () => {
  expect(movePhotoGridOrder(['a', 'b', 'c', 'd', 'e'], 4, 0)).toEqual(['e', 'a', 'b', 'c', 'd']);
  expect(photoGridTarget(216, 108, 108, 3, 5)).toBe(-1);
  expect(photoGridTarget(-200, -200, 108, 3, 5)).toBe(0);
  expect(photoGridTouchIndex(80, 20, 100, 8, 3, 5, 44)).toBe(-1);
  expect(photoGridTouchIndex(105, 50, 100, 8, 3, 5, 44)).toBe(-1);
  expect(photoGridTouchIndex(50, 50, 100, 8, 3, 5, 44)).toBe(0);
});

it('does not commit a cancelled drag and commits one insertion after a successful drop', async () => {
  const onMove = jest.fn(() => true);
  const onDrag = jest.fn();
  render(<GestureHandlerRootView><DraggablePhotoGrid items={items} width={316} maxPhotos={5} onAdd={jest.fn()} disabled={false} dragging={false}
    contextKey={context} contextRevision="1" onMove={onMove} onRemove={jest.fn()} onDragStateChange={onDrag} /></GestureHandlerRootView>);
  await act(async () => {
    fireGestureHandler(getByGestureTestId('sell-photo-grid-drag'), [
      { state: State.BEGAN, x: 50, y: 50, translationX: 0, translationY: 0 },
      { state: State.ACTIVE, x: 50, y: 50, translationX: 0, translationY: 0 },
      { state: State.ACTIVE, x: 266, y: 50, translationX: 216, translationY: 0 },
      { state: State.CANCELLED, x: 266, y: 50, translationX: 216, translationY: 0 },
    ]);
  });
  expect(onMove).not.toHaveBeenCalled();
  expect(onDrag).toHaveBeenLastCalledWith(false);
  await act(async () => {
    fireGestureHandler(getByGestureTestId('sell-photo-grid-drag'), [
      { state: State.BEGAN, x: 50, y: 50, translationX: 0, translationY: 0 },
      { state: State.ACTIVE, x: 50, y: 50, translationX: 0, translationY: 0 },
      { state: State.ACTIVE, x: 266, y: 50, translationX: 216, translationY: 0 },
      { state: State.END, x: 266, y: 50, translationX: 216, translationY: 0 },
    ]);
  });
  expect(onMove).toHaveBeenCalledTimes(1);
  expect(onMove).toHaveBeenCalledWith(0, 2);
});

it('keeps each duplicate URI occurrence mounted during reorder and exposes accessible cover actions', () => {
  const onMove = jest.fn(() => true);
  const props = { width: 316, maxPhotos: 5, onAdd: jest.fn(), disabled: false, dragging: false, contextKey: context, contextRevision: '1',
    onMove, onRemove: jest.fn(), onDragStateChange: jest.fn() };
  const { getByTestId, getAllByLabelText, queryByTestId, rerender } = render(<GestureHandlerRootView><DraggablePhotoGrid {...props} items={items} /></GestureHandlerRootView>);
  expect(getAllByLabelText('Ajouter une photo')).toHaveLength(2);
  fireEvent.press(getByTestId('sell-photo-add-slot-3'));
  expect(props.onAdd).toHaveBeenCalledTimes(1);
  fireEvent(getByTestId('sell-photo-accessibility-1'), 'accessibilityAction', { nativeEvent: { actionName: 'makePrimary' } });
  expect(onMove).toHaveBeenCalledWith(1, 0);
  const second = getByTestId('sell-photo-tile-photo-b');
  rerender(<GestureHandlerRootView><DraggablePhotoGrid {...props} items={[items[1], items[0], items[2]]} /></GestureHandlerRootView>);
  expect(getByTestId('sell-photo-tile-photo-b')).toBe(second);
  expect(getByTestId('sell-photo-accessibility-0')).toHaveProp('accessibilityLabel', 'Photo 1 sur 3, photo principale');
  expect(mockImageMount).toHaveBeenCalledTimes(3);
  expect(mockImageUnmount).not.toHaveBeenCalled();
  rerender(<GestureHandlerRootView><DraggablePhotoGrid {...props} dragging items={items} /></GestureHandlerRootView>);
  fireEvent.press(getByTestId('sell-photo-add-slot-3'));
  expect(props.onAdd).toHaveBeenCalledTimes(1);
  rerender(<GestureHandlerRootView><DraggablePhotoGrid {...props} items={[]} /></GestureHandlerRootView>);
  expect(getAllByLabelText('Ajouter une photo')).toHaveLength(5);
  expect(queryByTestId('sell-photo-add-slot-5')).toBeNull();
});

it('keeps a working local source after upload and adopts the aligned private fallback only after a local error', () => {
  const props = { width: 316, maxPhotos: 5, onAdd: jest.fn(), disabled: false, dragging: false, contextKey: context, contextRevision: '1',
    onMove: jest.fn(() => true), onRemove: jest.fn(), onDragStateChange: jest.fn() };
  const { getByTestId, rerender } = render(<GestureHandlerRootView><DraggablePhotoGrid {...props} items={[items[0]]} /></GestureHandlerRootView>);
  const tile = getByTestId('sell-photo-tile-photo-a');
  rerender(<GestureHandlerRootView><DraggablePhotoGrid {...props} items={[{ ...items[0], fallbackUri: 'https://private/fallback-a' }]} /></GestureHandlerRootView>);
  expect(getByTestId('sell-photo-image-photo-a')).toHaveProp('accessibilityLabel', 'file:///same.jpg');
  fireEvent(getByTestId('sell-photo-image-photo-a'), 'error');
  expect(getByTestId('sell-photo-image-photo-a')).toHaveProp('accessibilityLabel', 'https://private/fallback-a');
  expect(getByTestId('sell-photo-tile-photo-a')).toBe(tile);
  expect(mockImageMount).toHaveBeenCalledTimes(1);
  expect(mockImageUnmount).not.toHaveBeenCalled();
});

it('mounts an added photo in its final slot before the shared order contains it, without an entry translation', () => {
  const timing = jest.spyOn(Reanimated, 'withTiming');
  function AddedPhoto() {
    const order = Reanimated.useSharedValue(['photo-a', 'photo-b']);
    const activeId = Reanimated.useSharedValue<string | null>(null);
    const dragX = Reanimated.useSharedValue(0), dragY = Reanimated.useSharedValue(0), lift = Reanimated.useSharedValue(0);
    return <DraggablePhotoTile item={items[2]} index={2} count={3} size={100} disabled={false} reduceMotion={false}
      order={order} activeId={activeId} dragX={dragX} dragY={dragY} lift={lift} onMove={jest.fn()} onRemove={jest.fn()} />;
  }
  const { getByTestId } = render(<GestureHandlerRootView><AddedPhoto /></GestureHandlerRootView>);
  expect(getByTestId('sell-photo-tile-photo-c')).toHaveStyle({ transform: [{ translateX: 216 }, { translateY: 0 }, { scale: 1 }] });
  expect(getByTestId('sell-photo-image-photo-c')).toHaveProp('accessibilityLabel', 'file:///third.jpg');
  expect(timing).not.toHaveBeenCalled();
  timing.mockRestore();
});
