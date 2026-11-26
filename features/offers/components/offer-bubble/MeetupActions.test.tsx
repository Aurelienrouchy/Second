/**
 * Tests métier — <MeetupActions /> (components/offer-bubble/MeetupActions.tsx).
 *
 * Ce composant portait les DEUX boutons du cycle de rencontre en bloc :
 * « Signaler une absence » n'existait donc que là où un bouton « Confirmer »
 * était affiché. Or, à l'étape « rencontre en attente », seul le VENDEUR en a
 * un — l'acheteur n'avait aucun recours tant que le vendeur n'avait pas
 * confirmé, alors que `reportMeetupNoShow` accepte les deux parties sur les
 * deux statuts et que les deux documents métier le promettent.
 *
 * Les deux boutons sont désormais indépendants : chacun n'apparaît que si son
 * handler est fourni.
 */

import { fireEvent, render, screen } from '@testing-library/react-native';

jest.mock('@expo/vector-icons', () => {
  const React = require('react');
  const { View } = require('react-native');
  return { Ionicons: (props: Record<string, unknown>) => React.createElement(View, props) };
});

import { MeetupActions } from './MeetupActions';

describe('<MeetupActions />', () => {
  it('rend le recours seul quand aucune confirmation n’est possible', () => {
    render(<MeetupActions onReportNoShow={jest.fn()} confirmLabel="Confirmer le rendez-vous" />);
    expect(screen.getByText('Signaler une absence')).toBeTruthy();
    // Aucun bouton de confirmation, quel que soit son libellé — tester le seul
    // libellé attendu ferait passer ce test alors que l'ancien « Confirmer »
    // s'affiche encore.
    expect(screen.queryByText('Confirmer le rendez-vous')).toBeNull();
    expect(screen.queryByText('Confirmer')).toBeNull();
  });

  it('rend la confirmation seule quand le recours est fermé', () => {
    render(<MeetupActions onConfirm={jest.fn()} confirmLabel="Rencontre effectuée" />);
    expect(screen.getByText('Rencontre effectuée')).toBeTruthy();
    expect(screen.queryByText('Signaler une absence')).toBeNull();
  });

  it('affiche le libellé qu’on lui donne, pas un libellé fixe', () => {
    render(
      <MeetupActions
        onConfirm={jest.fn()}
        onReportNoShow={jest.fn()}
        confirmLabel="Confirmer le rendez-vous"
      />,
    );
    expect(screen.getByText('Confirmer le rendez-vous')).toBeTruthy();
  });

  it('notifie chacun de ses deux handlers', () => {
    const onConfirm = jest.fn();
    render(<MeetupActions onConfirm={onConfirm} confirmLabel="Confirmer le rendez-vous" />);
    fireEvent.press(screen.getByText('Confirmer le rendez-vous'));
    expect(onConfirm).toHaveBeenCalledTimes(1);

    screen.unmount();
    const onReportNoShow = jest.fn();
    render(<MeetupActions onReportNoShow={onReportNoShow} confirmLabel="x" />);
    fireEvent.press(screen.getByText('Signaler une absence'));
    expect(onReportNoShow).toHaveBeenCalledTimes(1);
  });

  it('verrouille les DEUX boutons pendant qu’une action est en vol', () => {
    let release: () => void = () => {};
    const onConfirm = jest.fn(() => new Promise<void>((r) => { release = r; }));
    render(
      <MeetupActions
        onConfirm={onConfirm}
        onReportNoShow={jest.fn()}
        confirmLabel="Confirmer le rendez-vous"
      />,
    );

    fireEvent.press(screen.getByText('Confirmer le rendez-vous'));

    // Les libellés cèdent la place à un indicateur : on interroge donc l'état
    // d'accessibilité, seul témoin fiable du verrou.
    const buttons = screen.UNSAFE_getAllByProps({ accessible: true }).filter(
      (n) => n.props.accessibilityState !== undefined,
    );
    expect(buttons.length).toBeGreaterThanOrEqual(2);
    expect(buttons.every((b) => b.props.accessibilityState.disabled === true)).toBe(true);
    release();
  });
});
