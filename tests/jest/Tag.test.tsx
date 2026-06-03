/**
 * Smoke test composant RN — <Tag /> (components/ui/Tag.tsx).
 *
 * Vérifie le comportement OBSERVABLE du Tag sélectionnable :
 * - rend son label
 * - notifie onPress + déclenche un retour haptique au tap
 * - respecte `disabled` (pas de onPress, état d'accessibilité reflété)
 * - expose l'état sélectionné via accessibilityState
 *
 * Sert aussi de smoke test du socle Jest (preset jest-expo + RNTL + mocks
 * reanimated/haptics/gesture-handler).
 */

import * as Haptics from 'expo-haptics';
import React from 'react';
import { fireEvent, render, screen } from '@testing-library/react-native';

import { Tag } from '@/components/ui/Tag';

describe('<Tag />', () => {
  it('rend le label fourni en children', () => {
    render(<Tag testID="tag">Vintage</Tag>);

    expect(screen.getByTestId('tag')).toBeOnTheScreen();
    expect(screen.getByText('Vintage')).toBeOnTheScreen();
  });

  it('notifie onPress et déclenche un retour haptique au tap', () => {
    const onPress = jest.fn();
    render(
      <Tag testID="tag" onPress={onPress}>
        Luxe
      </Tag>,
    );

    fireEvent.press(screen.getByTestId('tag'));

    expect(onPress).toHaveBeenCalledTimes(1);
    expect(Haptics.impactAsync).toHaveBeenCalledWith(Haptics.ImpactFeedbackStyle.Light);
  });

  it('ne notifie pas onPress quand disabled', () => {
    const onPress = jest.fn();
    render(
      <Tag testID="tag" onPress={onPress} disabled>
        Indisponible
      </Tag>,
    );

    fireEvent.press(screen.getByTestId('tag'));

    expect(onPress).not.toHaveBeenCalled();
    expect(screen.getByTestId('tag')).toBeDisabled();
  });

  it('reflète l’état sélectionné via accessibilité', () => {
    render(
      <Tag testID="tag" selected>
        Coton
      </Tag>,
    );

    expect(screen.getByTestId('tag')).toBeSelected();
  });
});
