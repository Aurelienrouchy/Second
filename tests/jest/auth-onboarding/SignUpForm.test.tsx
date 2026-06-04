/**
 * SignUpForm — gate des CREDENTIALS (post-split auth).
 *
 * Depuis le refacto auth/pseudo, SignUpForm ne collecte QUE les trois champs
 * d'identifiants : nom d'affichage + email + mot de passe. L'age gate (DOB), les
 * consentements (CGU/Politique) et le choix du @pseudo ont été déplacés vers la
 * route plein écran OBLIGATOIRE app/complete-profile.tsx (atteinte juste après
 * la création du compte). Ce composant est presentational : le parent détient
 * l'état et reçoit les changements via callbacks.
 *
 * On exerce le composant via ses props : on monte avec un jeu de props et on
 * vérifie que onSubmit est (ou non) déclenché au tap, ce qui reflète l'état
 * disabled calculé en interne (submitDisabled). On vérifie aussi le hint
 * displayName et la notification onChangeDisplayName.
 */

// BottomSheetTextInput exige le contexte BottomSheet (useBottomSheetInternal) —
// hors périmètre d'un test unitaire du formulaire. On le réduit au TextInput RN
// natif (mêmes props value/onChangeText/onBlur/accessibilityLabel), ce qui
// préserve le comportement testé sans monter un BottomSheet réel.
jest.mock('@gorhom/bottom-sheet', () => {
  const { TextInput } = require('react-native');
  return { BottomSheetTextInput: TextInput };
});

import React from 'react';
import { fireEvent, render, screen } from '@testing-library/react-native';

import { SignUpForm, type SignUpFormProps } from '@/components/auth-bottom-sheet/SignUpForm';
import { COPY_USERNAME } from '@/constants/authMessages';

function baseProps(overrides: Partial<SignUpFormProps> = {}): SignUpFormProps {
  return {
    email: 'marie@example.com',
    password: 'secret1',
    displayName: 'Marie',
    isLoading: false,
    onChangeEmail: jest.fn(),
    onChangePassword: jest.fn(),
    onChangeDisplayName: jest.fn(),
    onSubmit: jest.fn(),
    ...overrides,
  };
}

describe('SignUpForm — gate de soumission (credentials only)', () => {
  it('email + mot de passe + nom d\'affichage remplis → onSubmit déclenché', () => {
    const onSubmit = jest.fn();
    render(<SignUpForm {...baseProps({ onSubmit })} />);

    fireEvent.press(screen.getByLabelText("S'inscrire"));
    expect(onSubmit).toHaveBeenCalledTimes(1);
  });

  it('email vide → bouton désactivé, onSubmit jamais appelé', () => {
    const onSubmit = jest.fn();
    render(<SignUpForm {...baseProps({ email: '', onSubmit })} />);

    fireEvent.press(screen.getByLabelText("S'inscrire"));
    expect(onSubmit).not.toHaveBeenCalled();
  });

  it('mot de passe vide → bouton désactivé', () => {
    const onSubmit = jest.fn();
    render(<SignUpForm {...baseProps({ password: '', onSubmit })} />);

    fireEvent.press(screen.getByLabelText("S'inscrire"));
    expect(onSubmit).not.toHaveBeenCalled();
  });

  it('nom d\'affichage vide → bouton désactivé', () => {
    const onSubmit = jest.fn();
    render(<SignUpForm {...baseProps({ displayName: '', onSubmit })} />);

    fireEvent.press(screen.getByLabelText("S'inscrire"));
    expect(onSubmit).not.toHaveBeenCalled();
  });

  it('isLoading → bouton désactivé (anti double-soumission)', () => {
    const onSubmit = jest.fn();
    render(<SignUpForm {...baseProps({ isLoading: true, onSubmit })} />);

    fireEvent.press(screen.getByLabelText("S'inscrire"));
    expect(onSubmit).not.toHaveBeenCalled();
  });
});

describe('SignUpForm — champs', () => {
  it('affiche le hint du nom d\'affichage tant qu\'il est valide / non touché', () => {
    render(<SignUpForm {...baseProps()} />);
    expect(screen.getByText(COPY_USERNAME.displayNameHint)).toBeOnTheScreen();
  });

  it('nom d\'affichage trop court après blur → erreur 3 caractères, hint masqué', () => {
    render(<SignUpForm {...baseProps({ displayName: 'Ab' })} />);

    // Avant interaction, pas d'erreur (champ non touché).
    expect(screen.queryByText(/3 caractères minimum/)).toBeNull();

    fireEvent(screen.getByLabelText("Nom d'affichage"), 'blur');
    expect(screen.getByText(/3 caractères minimum/)).toBeOnTheScreen();
    // Le hint cède la place à l'erreur.
    expect(screen.queryByText(COPY_USERNAME.displayNameHint)).toBeNull();
  });

  it('saisie du nom d\'affichage notifie le parent via onChangeDisplayName', () => {
    const onChangeDisplayName = jest.fn();
    render(<SignUpForm {...baseProps({ onChangeDisplayName })} />);

    fireEvent.changeText(screen.getByLabelText("Nom d'affichage"), 'Marie Curie');
    expect(onChangeDisplayName).toHaveBeenCalledWith('Marie Curie');
  });

  it('email invalide après blur → erreur affichée', () => {
    render(<SignUpForm {...baseProps({ email: 'pasunemail' })} />);

    expect(screen.queryByText(/Adresse email invalide/)).toBeNull();
    fireEvent(screen.getByLabelText('Adresse email'), 'blur');
    expect(screen.getByText(/Adresse email invalide/)).toBeOnTheScreen();
  });

  it('mot de passe trop court après blur → erreur 6 caractères', () => {
    render(<SignUpForm {...baseProps({ password: '123' })} />);

    expect(screen.queryByText(/6 caractères minimum/)).toBeNull();
    fireEvent(screen.getByLabelText('Mot de passe'), 'blur');
    expect(screen.getByText(/6 caractères minimum/)).toBeOnTheScreen();
  });
});
