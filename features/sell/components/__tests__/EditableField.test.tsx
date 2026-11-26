import { fireEvent, render, screen } from '@testing-library/react-native';

jest.mock('@expo/vector-icons', () => {
  const { View } = require('react-native');
  return { Ionicons: View };
});

import EditableField from '../details/EditableField';

function renderField() {
  const onSave = jest.fn();
  const onDraftChange = jest.fn();
  render(
    <EditableField label="Titre" value="Robe" onSave={onSave} onDraftChange={onDraftChange} />,
  );
  fireEvent.press(screen.getByText('Robe'));
  return { onSave, onDraftChange };
}

describe('<EditableField /> — la saisie en cours', () => {
  it('remonte ce qui est tapé, avant toute confirmation', () => {
    // Taper « Enregistrer » sans « Confirmer » perdait la saisie : seul le
    // champ la connaissait.
    const { onDraftChange } = renderField();
    fireEvent.changeText(screen.getByDisplayValue('Robe'), 'Robe d’été');
    expect(onDraftChange).toHaveBeenLastCalledWith('Robe d’été');
  });

  it('signale la fin de la saisie quand elle est confirmée', () => {
    const { onSave, onDraftChange } = renderField();
    fireEvent.changeText(screen.getByDisplayValue('Robe'), '  Robe d’été ');
    fireEvent.press(screen.getByText('Confirmer'));
    expect(onSave).toHaveBeenCalledWith('Robe d’été');
    expect(onDraftChange).toHaveBeenLastCalledWith(null);
  });

  it('signale la fin de la saisie quand elle est annulée', () => {
    const { onSave, onDraftChange } = renderField();
    fireEvent.changeText(screen.getByDisplayValue('Robe'), 'Autre');
    fireEvent.press(screen.getByText('Annuler'));
    expect(onSave).not.toHaveBeenCalled();
    expect(onDraftChange).toHaveBeenLastCalledWith(null);
  });
});
