/**
 * ValueComparisonBox — comparaison de valeur + complément en argent (propose-swap).
 *
 * Comportement MÉTIER :
 *  - affiche les totaux indicatifs du bon côté sans jugement monétaire.
 *  - propose un montant suggéré = différence ; le tap pré-remplit le champ.
 *  - sanitise la saisie (chiffres uniquement).
 *  - bascule le payeur (Je paie / l'autre paie).
 *
 * Le composant attend des prix EN DOLLARS (formatPrice). On vérifie la copy FR
 * réellement rendue.
 */

import React from 'react';
import { fireEvent, render, screen } from '@testing-library/react-native';

jest.mock('@/config/featureFlags', () => ({ PAYMENTS_ENABLED: false }));
const paymentFlags = jest.requireMock('@/config/featureFlags') as { PAYMENTS_ENABLED: boolean };
beforeEach(() => { paymentFlags.PAYMENTS_ENABLED = false; });

// Le barrel @/components/ui ré-exporte des composants natifs lourds
// (ThemedBottomSheet → @expo/ui → expo-asset, OfflineBanner → expo-network…)
// non transformés par le preset. Les composants testés n'en consomment que
// Text/Caption : on réduit le barrel à ces primitives (texte RN).
jest.mock('@/components/ui', () => {
  const React = require('react');
  const { Text: RNText } = require('react-native');
  const Text = (props: Record<string, unknown>) => React.createElement(RNText, props);
  const Caption = (props: Record<string, unknown>) => React.createElement(RNText, props);
  return {
  Button: jest.requireActual('@/components/ui/Button').Button,
 Text, Caption };
});

// Import direct du composant (pas via le barrel @/features/swap) pour
// isoler le test du reste de la feature.
import { ValueComparisonBox } from '@/features/swap/components/propose/ValueComparisonBox';

const baseProps = {
  initiatorTotal: 0,
  receiverTotal: 0,
  complementAmount: '',
  complementPayer: 'initiator' as const,
  receiverName: 'Bob',
  onComplementAmountChange: jest.fn(),
  onComplementPayerChange: jest.fn(),
};

describe('<ValueComparisonBox /> — valeurs indicatives', () => {
  it.each([[40, 100], [120, 50], [60, 60]])('conserve le bon total de chaque côté (%s / %s), sans jugement sur la valeur', (initiatorTotal, receiverTotal) => {
    render(<ValueComparisonBox {...baseProps} initiatorTotal={initiatorTotal} receiverTotal={receiverTotal} />);
    expect(screen.getByLabelText(`Vous recevez, ${receiverTotal} $`)).toBeOnTheScreen();
    expect(screen.getByLabelText(`Vous proposez, ${initiatorTotal} $`)).toBeOnTheScreen();
    expect(screen.queryByText(/Différence|en sa faveur|en votre faveur|équivalentes/)).toBeNull();
    expect(screen.queryByText(/Suggéré:/)).toBeNull();
  });
});

describe('<ValueComparisonBox /> — paiements désactivés', () => {
  it('garde les valeurs indicatives et masque toutes les commandes de complément', () => {
    render(<ValueComparisonBox {...baseProps} initiatorTotal={40} receiverTotal={100} />);
    expect(screen.getByText('Valeurs indicatives')).toBeOnTheScreen();
    expect(screen.queryByText(/complément en argent/)).toBeNull();
    expect(screen.queryByText('Je paie')).toBeNull();
    expect(screen.queryByPlaceholderText('0')).toBeNull();
    expect(screen.queryByText(/Suggéré/)).toBeNull();
  });
});

describe('<ValueComparisonBox /> — montant suggéré', () => {
  beforeEach(() => { paymentFlags.PAYMENTS_ENABLED = true; });
  it('propose la différence en montant suggéré et la reporte au tap', () => {
    const onComplementAmountChange = jest.fn();
    render(
      <ValueComparisonBox
        {...baseProps}
        initiatorTotal={40}
        receiverTotal={100}
        onComplementAmountChange={onComplementAmountChange}
      />
    );

    const suggest = screen.getByText('Suggéré : 60 $');
    fireEvent.press(suggest);

    // Le complément suggéré = différence absolue (60), passé en string.
    expect(onComplementAmountChange).toHaveBeenCalledWith('60.00');
  });
});

describe('<ValueComparisonBox /> — saisie du complément', () => {
  beforeEach(() => { paymentFlags.PAYMENTS_ENABLED = true; });
  it('conserve la saisie brute pour sa validation monétaire explicite', () => {
    const onComplementAmountChange = jest.fn();
    render(
      <ValueComparisonBox
        {...baseProps}
        initiatorTotal={10}
        receiverTotal={20}
        onComplementAmountChange={onComplementAmountChange}
      />
    );

    const input = screen.getByPlaceholderText('0');
    fireEvent.changeText(input, '1a2$3');

    expect(onComplementAmountChange).toHaveBeenCalledWith('1a2$3');
  });
});

describe('<ValueComparisonBox /> — choix du payeur', () => {
  beforeEach(() => { paymentFlags.PAYMENTS_ENABLED = true; });
  it('affiche le nom du receveur sur le bouton "paie" et notifie le changement de payeur', () => {
    const onComplementPayerChange = jest.fn();
    render(
      <ValueComparisonBox
        {...baseProps}
        initiatorTotal={10}
        receiverTotal={20}
        receiverName="Bob"
        onComplementPayerChange={onComplementPayerChange}
      />
    );

    expect(screen.getByText('Je paie')).toBeOnTheScreen();

    fireEvent.press(screen.getByText('Bob paie'));
    expect(onComplementPayerChange).toHaveBeenCalledWith('receiver');

    fireEvent.press(screen.getByText('Je paie'));
    expect(onComplementPayerChange).toHaveBeenCalledWith('initiator');
  });

  it('retombe sur "L\'autre paie" quand le nom du receveur est inconnu', () => {
    render(
      <ValueComparisonBox
        {...baseProps}
        initiatorTotal={10}
        receiverTotal={20}
        receiverName={undefined}
      />
    );

    expect(screen.getByText("L'autre paie")).toBeOnTheScreen();
  });
});
