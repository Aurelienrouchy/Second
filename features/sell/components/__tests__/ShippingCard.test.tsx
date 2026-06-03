/**
 * <ShippingCard /> — option d'expédition postale (écran Prix & livraison).
 *
 * Comportement MÉTIER :
 *  - le corps (formats de colis) n'est révélé QUE lorsque l'option est active ;
 *  - taper la carte bascule l'option (onToggle) ;
 *  - sélectionner un format remonte la valeur métier exacte ('small'|'medium'
 *    |'large') via onPackageSizeSelect ;
 *  - une suggestion IA de format affiche le badge "IA".
 *
 * NB : l'écran masque cette carte quand SHIPPING_ENABLED est false ; ce test
 * vérifie la carte isolément (contrat du composant), indépendamment du flag.
 */

import React from 'react';
import { fireEvent, render, screen } from '@testing-library/react-native';

import { ShippingCard } from '@/features/sell';

describe('<ShippingCard />', () => {
  it('cache les formats de colis quand l’option est inactive', () => {
    render(
      <ShippingCard
        isActive={false}
        onToggle={jest.fn()}
        packageSize={null}
        onPackageSizeSelect={jest.fn()}
      />,
    );
    expect(screen.getByText('Expédition postale')).toBeOnTheScreen();
    // Le label des formats n'apparaît pas tant que l'option n'est pas activée.
    expect(screen.queryByText('Format du colis')).toBeNull();
    expect(screen.queryByText('Moyen')).toBeNull();
  });

  it('révèle les formats de colis quand l’option est active', () => {
    render(
      <ShippingCard
        isActive
        onToggle={jest.fn()}
        packageSize={null}
        onPackageSizeSelect={jest.fn()}
      />,
    );
    expect(screen.getByText('Format du colis')).toBeOnTheScreen();
    expect(screen.getByText('Petit')).toBeOnTheScreen();
    expect(screen.getByText('Moyen')).toBeOnTheScreen();
    expect(screen.getByText('Grand')).toBeOnTheScreen();
  });

  it('bascule l’option au tap sur la carte', () => {
    const onToggle = jest.fn();
    render(
      <ShippingCard
        isActive={false}
        onToggle={onToggle}
        packageSize={null}
        onPackageSizeSelect={jest.fn()}
      />,
    );
    fireEvent.press(screen.getByText('Expédition postale'));
    expect(onToggle).toHaveBeenCalledTimes(1);
  });

  it('remonte la valeur métier du format sélectionné', () => {
    const onPackageSizeSelect = jest.fn();
    render(
      <ShippingCard
        isActive
        onToggle={jest.fn()}
        packageSize={null}
        onPackageSizeSelect={onPackageSizeSelect}
      />,
    );
    fireEvent.press(screen.getByText('Grand'));
    expect(onPackageSizeSelect).toHaveBeenCalledWith('large');
  });

  it('affiche le badge IA quand un format est suggéré par l’analyse', () => {
    render(
      <ShippingCard
        isActive
        onToggle={jest.fn()}
        packageSize="medium"
        onPackageSizeSelect={jest.fn()}
        aiSuggestedSize="medium"
      />,
    );
    expect(screen.getByText('IA')).toBeOnTheScreen();
    expect(screen.getByText("Format suggéré selon l'article")).toBeOnTheScreen();
  });

  it('n’affiche pas le badge IA sans suggestion', () => {
    render(
      <ShippingCard
        isActive
        onToggle={jest.fn()}
        packageSize="medium"
        onPackageSizeSelect={jest.fn()}
      />,
    );
    expect(screen.queryByText("Format suggéré selon l'article")).toBeNull();
  });
});
