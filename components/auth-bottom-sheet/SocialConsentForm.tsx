/**
 * SocialConsentForm — MANDATORY consent step shown after a NEW (or not-yet-
 * consented) social sign-in (Google/Apple).
 *
 * Loi 25 (art. 12, 14): a social sign-in must NOT bypass the age gate or the
 * Terms/Privacy consent. Until this form is completed, the freshly created
 * social account has no proof of consent and must be rolled back if the user
 * backs out (handled by the parent via AuthService.rollbackUnconsentedAccount).
 *
 * Reuses ConsentFields (same DOB + checkboxes + legal copy as email sign-up).
 * Presentational only — the parent owns state, validation and the callable.
 */

import React from 'react';
import { ActivityIndicator, Pressable, Text } from 'react-native';

import { colors } from '@/constants/theme';

import { ConsentFields } from './ConsentFields';
import { styles } from './styles';

export interface SocialConsentFormProps {
  dobDay: string;
  dobMonth: string;
  dobYear: string;
  acceptedTerms: boolean;
  acceptedPrivacy: boolean;
  marketingOptIn: boolean;
  showAgeError: boolean;
  /** True until DOB >= 16 AND both required boxes are checked. */
  submitDisabled: boolean;
  isLoading: boolean;
  onChangeDobDay: (value: string) => void;
  onChangeDobMonth: (value: string) => void;
  onChangeDobYear: (value: string) => void;
  onBlurDob: () => void;
  onToggleTerms: () => void;
  onTogglePrivacy: () => void;
  onToggleMarketing: () => void;
  onSubmit: () => void;
}

function SocialConsentFormComponent({
  dobDay,
  dobMonth,
  dobYear,
  acceptedTerms,
  acceptedPrivacy,
  marketingOptIn,
  showAgeError,
  submitDisabled,
  isLoading,
  onChangeDobDay,
  onChangeDobMonth,
  onChangeDobYear,
  onBlurDob,
  onToggleTerms,
  onTogglePrivacy,
  onToggleMarketing,
  onSubmit,
}: SocialConsentFormProps) {
  return (
    <>
      <Text style={[styles.title, styles.titleStandalone]}>Avant de continuer</Text>
      <Text style={styles.message}>
        Pour utiliser Second, indiquez votre date de naissance et acceptez nos
        conditions.
      </Text>

      <ConsentFields
        dobDay={dobDay}
        dobMonth={dobMonth}
        dobYear={dobYear}
        acceptedTerms={acceptedTerms}
        acceptedPrivacy={acceptedPrivacy}
        marketingOptIn={marketingOptIn}
        showAgeError={showAgeError}
        onChangeDobDay={onChangeDobDay}
        onChangeDobMonth={onChangeDobMonth}
        onChangeDobYear={onChangeDobYear}
        onBlurDob={onBlurDob}
        onToggleTerms={onToggleTerms}
        onTogglePrivacy={onTogglePrivacy}
        onToggleMarketing={onToggleMarketing}
      />

      <Pressable
        testID="social-consent-submit"
        style={[styles.primaryButton, submitDisabled && styles.disabledButton]}
        onPress={onSubmit}
        disabled={submitDisabled}
        accessibilityLabel="Continuer"
        accessibilityRole="button"
      >
        {isLoading ? (
          <ActivityIndicator color={colors.white} />
        ) : (
          <Text style={styles.primaryButtonText}>CONTINUER</Text>
        )}
      </Pressable>
    </>
  );
}

export const SocialConsentForm = React.memo(SocialConsentFormComponent);
