/**
 * <SellFooter /> — CTA d'avancement du tunnel Vendre.
 *
 * Comportement MÉTIER : le footer gate la progression. Tant que l'étape n'est
 * pas valide (isValid=false), le bouton est désactivé et ne déclenche pas
 * onPress ; une fois valide, le tap avance le flux. Le label est piloté par
 * l'étape ("CONTINUER", "APERÇU", ...).
 */

import React from 'react';
import { fireEvent, render, screen } from '@testing-library/react-native';

import { SellFooter } from '@/features/sell';

describe('<SellFooter />', () => {
  it('affiche le label de l’étape courante', () => {
    render(
      <SellFooter label="APERÇU" onPress={jest.fn()} isValid bottomInset={0} />,
    );
    expect(screen.getByText('APERÇU')).toBeOnTheScreen();
  });

  it('déclenche onPress quand l’étape est valide', () => {
    const onPress = jest.fn();
    render(
      <SellFooter label="CONTINUER" onPress={onPress} isValid bottomInset={0} />,
    );
    fireEvent.press(screen.getByText('CONTINUER'));
    expect(onPress).toHaveBeenCalledTimes(1);
  });

  it('bloque la progression quand l’étape est invalide', () => {
    const onPress = jest.fn();
    render(
      <SellFooter
        label="CONTINUER"
        onPress={onPress}
        isValid={false}
        bottomInset={0}
      />,
    );
    fireEvent.press(screen.getByText('CONTINUER'));
    expect(onPress).not.toHaveBeenCalled();
  });
});

describe('<SellFooter /> — une étape invalide dit pourquoi', () => {
  it('au tap, une étape invalide appelle onInvalidPress, pas onPress', () => {
    // Le bouton désactivé ne déclenchait RIEN : les écrans Prix et Détails
    // n'affichaient jamais leurs messages d'erreur, puisqu'ils ne naissent
    // qu'au tap.
    const onPress = jest.fn();
    const onInvalidPress = jest.fn();
    render(
      <SellFooter
        label="APERÇU"
        onPress={onPress}
        onInvalidPress={onInvalidPress}
        isValid={false}
        bottomInset={0}
      />,
    );
    fireEvent.press(screen.getByText('APERÇU'));
    expect(onInvalidPress).toHaveBeenCalledTimes(1);
    expect(onPress).not.toHaveBeenCalled();
  });
});
