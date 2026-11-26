/**
 * <TextareaField /> — titre et description de l'annonce.
 *
 * Comportement SAISIE : ce sont les deux seuls champs de texte libre du tunnel.
 * La correction automatique et le correcteur orthographique y étaient forcés à
 * false, ce qui laissait passer les fautes de frappe dans le texte public de
 * l'annonce alors que l'écran d'édition, lui, gardait la correction active.
 */

import React from 'react';
import { render, screen } from '@testing-library/react-native';

import { TextareaField } from '../details/TextareaField';

function renderField(props = {}) {
  return render(
    <TextareaField
      label="Description"
      value="Robe fleurie"
      onChangeText={jest.fn()}
      placeholder="Décris ton article"
      maxLength={500}
      testID="sell-description-input"
      {...props}
    />,
  );
}

describe('<TextareaField /> — la correction du texte reste active', () => {
  it('ne coupe pas la correction automatique', () => {
    renderField();
    expect(screen.getByTestId('sell-description-input').props.autoCorrect).not.toBe(false);
  });

  it('ne coupe pas le correcteur orthographique', () => {
    renderField();
    expect(screen.getByTestId('sell-description-input').props.spellCheck).not.toBe(false);
  });

  it('laisse la correction active aussi sur le champ multiligne', () => {
    renderField({ multiline: true, numberOfLines: 4 });
    const champ = screen.getByTestId('sell-description-input');
    expect(champ.props.autoCorrect).not.toBe(false);
    expect(champ.props.spellCheck).not.toBe(false);
  });
});
