import React from 'react';
import { fireEvent, render } from '@testing-library/react-native';
import { PermissionDenied } from '../capture/PermissionDenied';

describe('sell without camera permission', () => {
  it('keeps gallery selection, Continue and close available after photos are selected', () => {
    const onGalleryPress = jest.fn();
    const onContinue = jest.fn();
    const onClose = jest.fn();
    const screen = render(<PermissionDenied photoCount={2} onGalleryPress={onGalleryPress} onContinue={onContinue} onClose={onClose} />);
    fireEvent.press(screen.getByTestId('sell-gallery-button'));
    fireEvent.press(screen.getByTestId('sell-capture-continue'));
    fireEvent.press(screen.getByTestId('sell-close-button'));
    expect(onGalleryPress).toHaveBeenCalledTimes(1);
    expect(onContinue).toHaveBeenCalledTimes(1);
    expect(onClose).toHaveBeenCalledTimes(1);
  });
  it('does not offer Continue without photos', () => {
    const screen = render(<PermissionDenied onGalleryPress={jest.fn()} onContinue={jest.fn()} />);
    expect(screen.queryByTestId('sell-capture-continue')).toBeNull();
  });
});
