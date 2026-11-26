/** Automatic product estimate, with no manual size choice or promised ceiling. */

import React from 'react';
import { fireEvent, render, screen } from '@testing-library/react-native';

import { ShippingCard } from '../pricing/ShippingCard';
import { automaticShippingEstimate } from '@/functions/src/shared/automaticShippingEstimate';
import { getCategoryPath } from '@/functions/src/shared/categories';

const light = automaticShippingEstimate({categoryIds: getCategoryPath('women_clothing_tops_tshirts')});
const unknown = automaticShippingEstimate({categoryIds: []});

describe('<ShippingCard />', () => {
  it('keeps the estimate hidden when disabled and toggles shipping on an explicit tap', () => {
    const onToggle = jest.fn();
    render(
      <ShippingCard
        isActive={false}
        onToggle={onToggle}
        estimate={light}
      />,
    );
    expect(screen.getByText('Expédition postale')).toBeOnTheScreen();
    expect(screen.queryByTestId('sell-parcel-estimate')).toBeNull();
    fireEvent.press(screen.getByRole('checkbox', {name: 'Expédition postale'}));
    expect(onToggle).toHaveBeenCalledTimes(1);
  });

  it('shows the current product family and changes it with the actual category estimate', () => {
    const view = render(
      <ShippingCard
        isActive
        onToggle={jest.fn()}
        estimate={light}
      />,
    );
    expect(screen.getByTestId('sell-parcel-estimate')).toHaveTextContent('Vêtement léger');
    view.rerender(<ShippingCard isActive onToggle={jest.fn()} estimate={unknown} />);
    expect(screen.getByTestId('sell-parcel-estimate')).toHaveTextContent('Objet à protéger');
  });

  it('does not require a size choice or present fixed weights as guaranteed limits', () => {
    render(
      <ShippingCard
        isActive
        onToggle={jest.fn()}
        estimate={light}
      />,
    );
    expect(screen.queryByText(/Petit|Moyen|Grand|<500|<1kg|<2kg/)).toBeNull();
    expect(screen.queryByText(/IA|intelligence artificielle/)).toBeNull();
  });
});
