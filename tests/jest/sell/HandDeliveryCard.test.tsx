import React from 'react';
import { fireEvent, render, screen } from '@testing-library/react-native';

import { HandDeliveryCard } from '@/features/sell/components/pricing/HandDeliveryCard';

function renderCard(overrides: Partial<React.ComponentProps<typeof HandDeliveryCard>> = {}) {
  const props = {
    isActive: true,
    onToggle: jest.fn(),
    selectedNeighborhoods: [],
    onNeighborhoodToggle: jest.fn(),
    onViewMore: jest.fn(),
    ...overrides,
  };
  render(<HandDeliveryCard {...props} />);
  return props;
}

describe('HD01 — le corps de la carte ne désactive pas la seule option de livraison', () => {
  it('toucher le libellé « Quartiers » ne bascule pas la carte', () => {
    const props = renderCard();
    fireEvent.press(screen.getByText(/Quartiers/));
    expect(props.onToggle).not.toHaveBeenCalled();
  });

  it('toucher « Voir plus » ouvre la liste sans basculer la carte', () => {
    const props = renderCard();
    fireEvent.press(screen.getByText('Voir plus'));
    expect(props.onViewMore).toHaveBeenCalledTimes(1);
    expect(props.onToggle).not.toHaveBeenCalled();
  });

  it("l'en-tête reste la cible qui bascule l'option", () => {
    const props = renderCard();
    fireEvent.press(screen.getByText('Remise en main propre'));
    expect(props.onToggle).toHaveBeenCalledTimes(1);
  });
});

describe('HD02 — une case à cocher, pas un bouton radio', () => {
  it('expose le rôle checkbox coché quand la remise est active', () => {
    renderCard({ isActive: true });
    expect(screen.getByRole('checkbox', { checked: true })).toBeTruthy();
  });

  it('expose le rôle checkbox décoché quand la remise est inactive', () => {
    renderCard({ isActive: false });
    expect(screen.getByRole('checkbox', { checked: false })).toBeTruthy();
  });
});
