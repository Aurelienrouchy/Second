import { act, fireEvent, render } from '@testing-library/react-native';
import { GestureHandlerRootView, State } from 'react-native-gesture-handler';
import { fireGestureHandler, getByGestureTestId } from 'react-native-gesture-handler/jest-utils';

jest.mock('@/lib/analytics', () => ({ track: jest.fn() }));
jest.mock('react-native-safe-area-context', () => ({ useSafeAreaInsets: () => ({ top: 44, bottom: 20, left: 0, right: 0 }) }));
jest.mock('react-native-worklets', () => ({
  ...jest.requireActual('react-native-worklets'),
  scheduleOnRN: (callback: (...args: unknown[]) => void, ...args: unknown[]) => callback(...args),
}));

import ImageGallery from '@/components/ImageGallery';
import { ZoomableGalleryImage } from '@/components/ZoomableGalleryImage';

const images = [{ url: 'https://example.com/one.jpg' }, { url: 'https://example.com/two.jpg' }, { url: 'https://example.com/three.jpg' }];

describe('article gallery navigation', () => {
  it('opens the tapped photo, syncs modal arrows to inline selection, and returns to the selected photo', () => {
    const onIndex = jest.fn();
    const screen = render(<GestureHandlerRootView><ImageGallery images={images} onImageIndexChange={onIndex} /></GestureHandlerRootView>);
    fireEvent.press(screen.getByTestId('article-photo-1'));
    expect(screen.getByText('2 / 3')).toBeTruthy();
    fireEvent.press(screen.getByTestId('gallery-next'));
    expect(screen.getByText('3 / 3')).toBeTruthy();
    expect(onIndex).toHaveBeenLastCalledWith(2);
    fireEvent.press(screen.getByTestId('gallery-next'));
    expect(screen.getByText('3 / 3')).toBeTruthy();
    fireEvent.press(screen.getByTestId('gallery-close'));
    expect(screen.getByLabelText('Voir la photo 3')).toBeSelected();
    fireEvent.press(screen.getByLabelText('Voir la photo 1'));
    expect(onIndex).toHaveBeenLastCalledWith(0);
    fireEvent.press(screen.getByTestId('article-photo-0'));
    expect(screen.getByText('1 / 3')).toBeTruthy();
  });

  it('resets selection when another article replaces the gallery and renders a missing-photo state', () => {
    const screen = render(<GestureHandlerRootView><ImageGallery images={images} articleId="one" /></GestureHandlerRootView>);
    fireEvent.press(screen.getByLabelText('Voir la photo 3'));
    screen.rerender(<GestureHandlerRootView><ImageGallery images={images.slice(0, 1)} articleId="two" /></GestureHandlerRootView>);
    fireEvent.press(screen.getByTestId('article-photo-0'));
    expect(screen.getByText('1 / 1')).toBeTruthy();
    screen.rerender(<GestureHandlerRootView><ImageGallery images={[]} articleId="empty" /></GestureHandlerRootView>);
    expect(screen.getByText('Photo indisponible')).toBeTruthy();
  });

  it('allows swiping to another image only at base zoom and resets zoom on navigation', () => {
    const screen = render(<GestureHandlerRootView><ImageGallery images={images} /></GestureHandlerRootView>);
    fireEvent.press(screen.getByTestId('article-photo-0'));
    act(() => fireGestureHandler(getByGestureTestId('gallery-pinch'), [
      { state: State.BEGAN, scale: 1 }, { state: State.ACTIVE, scale: 1, focalX: 100, focalY: 100 },
      { scale: 2, focalX: 100, focalY: 100 }, { state: State.END, scale: 2 },
    ]));
    act(() => fireGestureHandler(getByGestureTestId('gallery-pan'), [
      { state: State.BEGAN }, { state: State.ACTIVE, translationX: 0, translationY: 0 },
      { translationX: -200, translationY: 0 }, { state: State.END, translationX: -200, translationY: 0 },
    ]));
    expect(screen.getByText('1 / 3')).toBeTruthy();
    fireEvent.press(screen.getByTestId('gallery-next'));
    expect(screen.getByText('2 / 3')).toBeTruthy();
    expect(screen.getByText('Pincez ou touchez deux fois pour zoomer')).toBeTruthy();
    act(() => fireGestureHandler(getByGestureTestId('gallery-pan'), [
      { state: State.BEGAN }, { state: State.ACTIVE, translationX: 0, translationY: 0 },
      { translationX: -200, translationY: 0 }, { state: State.END, translationX: -200, translationY: 0 },
    ]));
    expect(screen.getByText('3 / 3')).toBeTruthy();
  });
});

describe('selected photo gestures', () => {
  it('accumulates repeated pinch gestures and lets users return to the original zoom', () => {
    const onZoom = jest.fn();
    render(<GestureHandlerRootView><ZoomableGalleryImage image={images[0]} width={400} height={600} onZoomChange={onZoom} onNavigate={jest.fn()} /></GestureHandlerRootView>);
    const pinch = () => getByGestureTestId('gallery-pinch');
    act(() => fireGestureHandler(pinch(), [{ state: State.BEGAN, scale: 1 }, { state: State.ACTIVE, scale: 1 }, { scale: 3 }, { state: State.END, scale: 3 }]));
    expect(onZoom).toHaveBeenLastCalledWith(true);
    act(() => fireGestureHandler(pinch(), [{ state: State.BEGAN, scale: 1 }, { state: State.ACTIVE, scale: 1 }, { scale: 0.5 }, { state: State.END, scale: 0.5 }]));
    expect(onZoom).toHaveBeenLastCalledWith(true); // 3 × .5 = 1.5, never reset to .5
    act(() => fireGestureHandler(pinch(), [{ state: State.BEGAN, scale: 1 }, { state: State.ACTIVE, scale: 1 }, { scale: 0.1 }, { state: State.END, scale: 0.1 }]));
    expect(onZoom).toHaveBeenLastCalledWith(false);
  });
});
