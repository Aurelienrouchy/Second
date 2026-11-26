/**
 * <ShopValidationCard /> — carte de modération d'une boutique (panel admin).
 *
 * Comportement MÉTIER de la carte selon le status de la boutique :
 *  - Les actions Approuver / Rejeter ne s'affichent QUE pour une boutique
 *    'pending' (on n'approuve pas deux fois une boutique déjà traitée).
 *  - Approuver / Rejeter notifient le parent SANS déclencher onViewDetails
 *    (stopPropagation) — un tap sur l'action ne doit pas naviguer.
 *  - Un tap sur la carte (hors boutons) ouvre le détail.
 *  - disabled neutralise les actions (anti double-tap pendant une mutation).
 *  - Une boutique 'rejected' affiche la raison du rejet stockée dans
 *    verificationDetails.reason.
 *  - Le badge de status affiche le libellé FR correct.
 */

import React from 'react';
import { fireEvent, render, screen } from '@testing-library/react-native';

// @expo/vector-icons est déjà mocké au setup (View avec accessibilityLabel),
// expo-image aussi. ShopValidationCard ne consomme rien d'autre de natif.

import ShopValidationCard from './ShopValidationCard';
import type { Shop } from '@/types';

function makeShop(overrides: Partial<Shop> = {}): Shop {
  return {
    id: 'shop_1',
    ownerId: 'owner_1',
    name: 'Friperie du Plateau',
    description: 'desc',
    type: 'friperie',
    address: {
      street: '123 rue Saint-Denis',
      city: 'Montréal',
      postalCode: 'H2X 1L2',
      country: 'CA',
    },
    location: { latitude: 45.5, longitude: -73.5 },
    phoneNumber: '514-555-0100',
    email: 'contact@friperie.ca',
    openingHours: {},
    images: [],
    status: 'pending',
    reviewCount: 0,
    articlesCount: 0,
    createdAt: new Date('2026-01-15T12:00:00Z'),
    updatedAt: new Date('2026-01-15T12:00:00Z'),
    ...overrides,
  } as Shop;
}

// Les boutons Approuver/Rejeter appellent e.stopPropagation() (pour ne pas
// propager le tap à la carte). fireEvent.press n'injecte pas de synthetic
// event → on en fournit un minimal.
const pressEvent = { stopPropagation: jest.fn() };

function renderCard(overrides: Partial<Shop> = {}, props: Record<string, unknown> = {}) {
  const onApprove = jest.fn();
  const onReject = jest.fn();
  const onViewDetails = jest.fn();
  const utils = render(
    <ShopValidationCard
      shop={makeShop(overrides)}
      onApprove={onApprove}
      onReject={onReject}
      onViewDetails={onViewDetails}
      {...props}
    />,
  );
  return { onApprove, onReject, onViewDetails, ...utils };
}

describe('<ShopValidationCard /> — actions selon le status', () => {
  it("affiche Approuver/Rejeter pour une boutique 'pending'", () => {
    renderCard({ status: 'pending' });

    expect(screen.getByText('Approuver')).toBeOnTheScreen();
    expect(screen.getByText('Rejeter')).toBeOnTheScreen();
  });

  it("n'affiche AUCUNE action pour une boutique déjà 'approved'", () => {
    renderCard({ status: 'approved' });

    expect(screen.queryByText('Approuver')).toBeNull();
    expect(screen.queryByText('Rejeter')).toBeNull();
  });

  it('notifie onApprove sans déclencher onViewDetails (stopPropagation)', () => {
    const { onApprove, onViewDetails } = renderCard({ status: 'pending' });

    fireEvent.press(screen.getByText('Approuver'), pressEvent);

    expect(onApprove).toHaveBeenCalledTimes(1);
    expect(pressEvent.stopPropagation).toHaveBeenCalled();
    expect(onViewDetails).not.toHaveBeenCalled();
  });

  it('notifie onReject sans déclencher onViewDetails', () => {
    const { onReject, onViewDetails } = renderCard({ status: 'pending' });

    fireEvent.press(screen.getByText('Rejeter'), pressEvent);

    expect(onReject).toHaveBeenCalledTimes(1);
    expect(onViewDetails).not.toHaveBeenCalled();
  });

  it('ouvre le détail au tap sur la carte (nom de la boutique)', () => {
    const { onViewDetails } = renderCard({ status: 'pending', name: 'Friperie X' });

    fireEvent.press(screen.getByText('Friperie X'));

    expect(onViewDetails).toHaveBeenCalledTimes(1);
  });

  it('disabled neutralise Approuver et Rejeter (anti double-tap)', () => {
    const { onApprove, onReject } = renderCard({ status: 'pending' }, { disabled: true });

    fireEvent.press(screen.getByText('Approuver'), pressEvent);
    fireEvent.press(screen.getByText('Rejeter'), pressEvent);

    expect(onApprove).not.toHaveBeenCalled();
    expect(onReject).not.toHaveBeenCalled();
  });
});

describe('<ShopValidationCard /> — affichage status & rejet', () => {
  it("affiche la raison du rejet pour une boutique 'rejected'", () => {
    renderCard({
      status: 'rejected',
      verificationDetails: { reason: 'Photos insuffisantes' },
    });

    expect(screen.getByText('Photos insuffisantes')).toBeOnTheScreen();
  });

  it('affiche le libellé FR du status dans le badge', () => {
    renderCard({ status: 'suspended' });
    expect(screen.getByText('Suspendue')).toBeOnTheScreen();
  });

  it('affiche le type de boutique en libellé FR (ShopTypeLabels)', () => {
    renderCard({ status: 'pending', type: 'depot-vente' });
    expect(screen.getByText('Dépôt-vente')).toBeOnTheScreen();
  });
});
