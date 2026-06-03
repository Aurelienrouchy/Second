/**
 * SignUpForm — règle MÉTIER du gate d'inscription (age 16+ + consentement).
 *
 * Le bouton « S'inscrire » reste désactivé tant que :
 *   email + mot de passe + nom d'affichage remplis, ET
 *   date de naissance = âge >= 16, ET
 *   CGU + Politique cochées.
 *
 * On exerce le composant via ses props (presentational) : on monte avec un jeu
 * de props et on vérifie que onSubmit est (ou non) déclenché au tap, ce qui
 * reflète l'état disabled calculé en interne (submitDisabled). On vérifie aussi
 * l'erreur d'âge affichée après blur d'une DOB < 16.
 */

// expo-apple-authentication ship en ESM et n'est pas whitelisté dans
// transformIgnorePatterns → on le mocke (isAvailableAsync pilote le bouton Apple).
jest.mock('expo-apple-authentication', () => ({
  isAvailableAsync: jest.fn(() => Promise.resolve(false)),
  AppleAuthenticationScope: { FULL_NAME: 0, EMAIL: 1 },
}));

// Le barrel @/components/ui draine toute la lib UI (OfflineBanner → expo-network,
// Avatar → expo-linear-gradient, ThemedBottomSheet → gorhom…) — hors périmètre de
// ce test. On ne consomme que Checkbox (via ConsentFields) : on le mocke en
// Pressable + accessibilityState pour garder le comportement coché/notifié.
jest.mock('@/components/ui', () => {
  const React = require('react');
  const { Pressable } = require('react-native');
  return {
    Checkbox: ({ checked, onToggle, children, accessibilityLabel }: any) =>
      React.createElement(
        Pressable,
        {
          accessibilityRole: 'checkbox',
          accessibilityState: { checked },
          accessibilityLabel,
          onPress: onToggle,
        },
        children,
      ),
  };
});

import React from 'react';
import { fireEvent, render, screen } from '@testing-library/react-native';

import { SignUpForm, type SignUpFormProps } from '@/components/auth-bottom-sheet/SignUpForm';

// DOB valide pour ~25 ans (année relative à aujourd'hui).
const ADULT_YEAR = String(new Date().getFullYear() - 25);
const MINOR_YEAR = String(new Date().getFullYear() - 14);

function baseProps(overrides: Partial<SignUpFormProps> = {}): SignUpFormProps {
  return {
    email: 'marie@example.com',
    password: 'secret1',
    username: 'Marie',
    dobDay: '15',
    dobMonth: '06',
    dobYear: ADULT_YEAR,
    acceptedTerms: true,
    acceptedPrivacy: true,
    marketingOptIn: false,
    isLoading: false,
    onChangeEmail: jest.fn(),
    onChangePassword: jest.fn(),
    onChangeUsername: jest.fn(),
    onChangeDobDay: jest.fn(),
    onChangeDobMonth: jest.fn(),
    onChangeDobYear: jest.fn(),
    onToggleTerms: jest.fn(),
    onTogglePrivacy: jest.fn(),
    onToggleMarketing: jest.fn(),
    onSubmit: jest.fn(),
    onSwitchToSignIn: jest.fn(),
    onSocialAuth: jest.fn(),
    ...overrides,
  };
}

describe('SignUpForm — gate de soumission', () => {
  it('tous les critères remplis (adulte + consentements) → onSubmit déclenché', () => {
    const onSubmit = jest.fn();
    render(<SignUpForm {...baseProps({ onSubmit })} />);

    fireEvent.press(screen.getByLabelText("S'inscrire"));
    expect(onSubmit).toHaveBeenCalledTimes(1);
  });

  it('CGU non cochées → bouton désactivé, onSubmit jamais appelé', () => {
    const onSubmit = jest.fn();
    render(<SignUpForm {...baseProps({ acceptedTerms: false, onSubmit })} />);

    fireEvent.press(screen.getByLabelText("S'inscrire"));
    expect(onSubmit).not.toHaveBeenCalled();
  });

  it('Politique non cochée → bouton désactivé', () => {
    const onSubmit = jest.fn();
    render(<SignUpForm {...baseProps({ acceptedPrivacy: false, onSubmit })} />);

    fireEvent.press(screen.getByLabelText("S'inscrire"));
    expect(onSubmit).not.toHaveBeenCalled();
  });

  it('mineur (<16) → bouton désactivé même avec consentements', () => {
    const onSubmit = jest.fn();
    render(<SignUpForm {...baseProps({ dobYear: MINOR_YEAR, onSubmit })} />);

    fireEvent.press(screen.getByLabelText("S'inscrire"));
    expect(onSubmit).not.toHaveBeenCalled();
  });

  it('nom d\'affichage vide → bouton désactivé', () => {
    const onSubmit = jest.fn();
    render(<SignUpForm {...baseProps({ username: '', onSubmit })} />);

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

describe('SignUpForm — erreur d\'âge', () => {
  it('affiche l\'erreur 16 ans après blur d\'une DOB mineure complète', () => {
    render(<SignUpForm {...baseProps({ dobYear: MINOR_YEAR })} />);

    // L'erreur n'apparaît qu'après que l'utilisateur a touché le champ DOB.
    expect(screen.queryByText(/au moins 16 ans/)).toBeNull();

    fireEvent(screen.getByLabelText('Année de naissance'), 'blur');
    expect(screen.getByText(/au moins 16 ans/)).toBeOnTheScreen();
  });

  it('pas d\'erreur d\'âge pour un adulte', () => {
    render(<SignUpForm {...baseProps()} />);
    fireEvent(screen.getByLabelText('Année de naissance'), 'blur');
    expect(screen.queryByText(/au moins 16 ans/)).toBeNull();
  });
});

describe('SignUpForm — toggles & navigation', () => {
  it('cocher les consentements notifie le parent', () => {
    const onToggleTerms = jest.fn();
    const onTogglePrivacy = jest.fn();
    render(
      <SignUpForm
        {...baseProps({ acceptedTerms: false, acceptedPrivacy: false, onToggleTerms, onTogglePrivacy })}
      />,
    );

    fireEvent.press(screen.getByLabelText(/J'ai lu et j'accepte les Conditions/));
    fireEvent.press(screen.getByLabelText(/J'ai lu et j'accepte la Politique/));
    expect(onToggleTerms).toHaveBeenCalledTimes(1);
    expect(onTogglePrivacy).toHaveBeenCalledTimes(1);
  });

  it('bascule vers la connexion', () => {
    const onSwitchToSignIn = jest.fn();
    render(<SignUpForm {...baseProps({ onSwitchToSignIn })} />);
    fireEvent.press(screen.getByText('Se connecter'));
    expect(onSwitchToSignIn).toHaveBeenCalledTimes(1);
  });

  it('lance l\'inscription Google', () => {
    const onSocialAuth = jest.fn();
    render(<SignUpForm {...baseProps({ onSocialAuth })} />);
    fireEvent.press(screen.getByLabelText("S'inscrire avec Google"));
    expect(onSocialAuth).toHaveBeenCalledWith('Google');
  });
});
