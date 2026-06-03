/**
 * ValueComparisonBox — comparaison de valeur + complément en argent (propose-swap).
 *
 * Comportement MÉTIER :
 *  - calcule et affiche la différence de valeur et indique EN FAVEUR DE QUI.
 *  - affiche "Valeurs equivalentes" quand les totaux sont égaux (pas de
 *    suggestion de complément).
 *  - propose un montant suggéré = différence ; le tap pré-remplit le champ.
 *  - sanitise la saisie (chiffres uniquement).
 *  - bascule le payeur (Je paie / l'autre paie).
 *
 * Le composant attend des prix EN DOLLARS (formatPrice). On vérifie la copy FR
 * réellement rendue.
 */

import React from 'react';
import { fireEvent, render, screen } from '@testing-library/react-native';

// Le barrel @/components/ui ré-exporte des composants natifs lourds
// (ThemedBottomSheet → @expo/ui → expo-asset, OfflineBanner → expo-network…)
// non transformés par le preset. Les composants testés n'en consomment que
// Text/Caption : on réduit le barrel à ces primitives (texte RN).
jest.mock('@/components/ui', () => {
  const React = require('react');
  const { Text: RNText } = require('react-native');
  const Text = (props: Record<string, unknown>) => React.createElement(RNText, props);
  const Caption = (props: Record<string, unknown>) => React.createElement(RNText, props);
  return { Text, Caption };
});

// Import direct du composant (pas via le barrel @/features/propose-swap) pour
// isoler le test du reste de la feature.
import { ValueComparisonBox } from '@/features/propose-swap/components/ValueComparisonBox';

const baseProps = {
  initiatorTotal: 0,
  receiverTotal: 0,
  complementAmount: '',
  complementPayer: 'initiator' as const,
  receiverName: 'Bob',
  onComplementAmountChange: jest.fn(),
  onComplementPayerChange: jest.fn(),
};

describe('<ValueComparisonBox /> — différence de valeur', () => {
  it('annonce la différence EN SA FAVEUR quand le receveur a plus de valeur', () => {
    render(
      <ValueComparisonBox {...baseProps} initiatorTotal={40} receiverTotal={100} />
    );

    // 100 - 40 = 60 $ en sa faveur (le receveur donne plus).
    expect(screen.getByText('Différence de 60 $ en sa faveur')).toBeOnTheScreen();
  });

  it('annonce la différence EN TA FAVEUR quand l’initiateur a plus de valeur', () => {
    render(
      <ValueComparisonBox {...baseProps} initiatorTotal={120} receiverTotal={50} />
    );

    expect(screen.getByText('Différence de 70 $ en ta faveur')).toBeOnTheScreen();
  });

  it('affiche "Valeurs equivalentes" et aucun bouton suggéré quand les totaux sont égaux', () => {
    render(
      <ValueComparisonBox {...baseProps} initiatorTotal={60} receiverTotal={60} />
    );

    expect(screen.getByText('Valeurs equivalentes')).toBeOnTheScreen();
    expect(screen.queryByText(/Suggéré:/)).toBeNull();
  });
});

describe('<ValueComparisonBox /> — montant suggéré', () => {
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

    const suggest = screen.getByText('Suggéré: 60 $');
    fireEvent.press(suggest);

    // Le complément suggéré = différence absolue (60), passé en string.
    expect(onComplementAmountChange).toHaveBeenCalledWith('60');
  });
});

describe('<ValueComparisonBox /> — saisie du complément', () => {
  it('sanitise la saisie en ne gardant que les chiffres', () => {
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

    expect(onComplementAmountChange).toHaveBeenCalledWith('123');
  });
});

describe('<ValueComparisonBox /> — choix du payeur', () => {
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
