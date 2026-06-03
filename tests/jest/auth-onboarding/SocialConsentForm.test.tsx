/**
 * SocialConsentForm — étape de consentement OBLIGATOIRE après une connexion
 * sociale (Loi 25 art. 12, 14 : un sign-in social ne contourne JAMAIS l'age
 * gate + CGU/Politique).
 *
 * Le composant est presentational : le parent calcule submitDisabled (DOB >= 16
 * ET les deux cases cochées). On vérifie le contrat observable :
 *  - submitDisabled=true → CONTINUER ne déclenche pas onSubmit
 *  - submitDisabled=false → onSubmit déclenché
 *  - showAgeError → message « au moins 16 ans » affiché
 *  - les toggles de consentement remontent au parent
 */

// Même neutralisation du barrel UI que SignUpForm (ConsentFields → Checkbox).
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

import {
  SocialConsentForm,
  type SocialConsentFormProps,
} from '@/components/auth-bottom-sheet/SocialConsentForm';

function baseProps(overrides: Partial<SocialConsentFormProps> = {}): SocialConsentFormProps {
  return {
    dobDay: '15',
    dobMonth: '06',
    dobYear: String(new Date().getFullYear() - 25),
    acceptedTerms: true,
    acceptedPrivacy: true,
    marketingOptIn: false,
    showAgeError: false,
    submitDisabled: false,
    isLoading: false,
    onChangeDobDay: jest.fn(),
    onChangeDobMonth: jest.fn(),
    onChangeDobYear: jest.fn(),
    onBlurDob: jest.fn(),
    onToggleTerms: jest.fn(),
    onTogglePrivacy: jest.fn(),
    onToggleMarketing: jest.fn(),
    onSubmit: jest.fn(),
    ...overrides,
  };
}

describe('SocialConsentForm', () => {
  it('affiche le titre de l\'étape de consentement obligatoire', () => {
    render(<SocialConsentForm {...baseProps()} />);
    expect(screen.getByText('Avant de continuer')).toBeOnTheScreen();
  });

  it('submitDisabled=false → CONTINUER déclenche onSubmit', () => {
    const onSubmit = jest.fn();
    render(<SocialConsentForm {...baseProps({ submitDisabled: false, onSubmit })} />);
    fireEvent.press(screen.getByLabelText('Continuer'));
    expect(onSubmit).toHaveBeenCalledTimes(1);
  });

  it('submitDisabled=true → CONTINUER ne déclenche PAS onSubmit', () => {
    const onSubmit = jest.fn();
    render(<SocialConsentForm {...baseProps({ submitDisabled: true, onSubmit })} />);
    fireEvent.press(screen.getByLabelText('Continuer'));
    expect(onSubmit).not.toHaveBeenCalled();
  });

  it('showAgeError → message « au moins 16 ans » affiché', () => {
    render(<SocialConsentForm {...baseProps({ showAgeError: true })} />);
    expect(screen.getByText(/au moins 16 ans/)).toBeOnTheScreen();
  });

  it('pas de message d\'âge quand showAgeError=false', () => {
    render(<SocialConsentForm {...baseProps({ showAgeError: false })} />);
    expect(screen.queryByText(/au moins 16 ans/)).toBeNull();
  });

  it('cocher CGU et Politique remonte au parent', () => {
    const onToggleTerms = jest.fn();
    const onTogglePrivacy = jest.fn();
    render(
      <SocialConsentForm
        {...baseProps({
          acceptedTerms: false,
          acceptedPrivacy: false,
          onToggleTerms,
          onTogglePrivacy,
        })}
      />,
    );
    fireEvent.press(screen.getByLabelText(/J'ai lu et j'accepte les Conditions/));
    fireEvent.press(screen.getByLabelText(/J'ai lu et j'accepte la Politique/));
    expect(onToggleTerms).toHaveBeenCalledTimes(1);
    expect(onTogglePrivacy).toHaveBeenCalledTimes(1);
  });

  it('blur d\'un champ DOB notifie onBlurDob', () => {
    const onBlurDob = jest.fn();
    render(<SocialConsentForm {...baseProps({ onBlurDob })} />);
    fireEvent(screen.getByLabelText('Année de naissance'), 'blur');
    expect(onBlurDob).toHaveBeenCalled();
  });
});
