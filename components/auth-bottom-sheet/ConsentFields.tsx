/**
 * ConsentFields — shared age gate (date of birth) + mandatory consent
 * checkboxes (Terms + Privacy) plus an optional marketing opt-in.
 *
 * Factored out of SignUpForm so the SAME block (and the same legal copy from
 * COPY_CONSENT) is reused by:
 *  - email sign-up (SignUpForm)
 *  - the post-social-sign-in consent step (SocialConsentForm)
 *
 * Presentational only: the parent owns the DOB/checkbox state and the
 * submit-disabled computation. This component just renders inputs + links.
 */

import { Link } from 'expo-router';
import React, { useCallback, useState } from 'react';
import { Text, TextInput, View } from 'react-native';

import { Checkbox } from '@/components/ui';
import { COPY_CONSENT } from '@/constants/authMessages';
import { colors } from '@/constants/theme';

import { styles } from './styles';

export interface ConsentFieldsProps {
  dobDay: string;
  dobMonth: string;
  dobYear: string;
  acceptedTerms: boolean;
  acceptedPrivacy: boolean;
  marketingOptIn: boolean;
  /** True when the completed DOB does not satisfy the 16+ age gate. */
  showAgeError: boolean;
  onChangeDobDay: (value: string) => void;
  onChangeDobMonth: (value: string) => void;
  onChangeDobYear: (value: string) => void;
  onBlurDob: () => void;
  onToggleTerms: () => void;
  onTogglePrivacy: () => void;
  onToggleMarketing: () => void;
}

function ConsentFieldsComponent({
  dobDay,
  dobMonth,
  dobYear,
  acceptedTerms,
  acceptedPrivacy,
  marketingOptIn,
  showAgeError,
  onChangeDobDay,
  onChangeDobMonth,
  onChangeDobYear,
  onBlurDob,
  onToggleTerms,
  onTogglePrivacy,
  onToggleMarketing,
}: ConsentFieldsProps) {
  return (
    <>
      {/* Date of birth (age gate) */}
      <Text style={styles.dobLabel}>{COPY_CONSENT.dobLabel}</Text>
      <View style={styles.dobRow}>
        <TextInput
          style={[styles.input, styles.dobField]}
          placeholder="JJ"
          placeholderTextColor={colors.muted}
          value={dobDay}
          onChangeText={(t) => onChangeDobDay(t.replace(/\D/g, '').slice(0, 2))}
          onBlur={onBlurDob}
          keyboardType="number-pad"
          maxLength={2}
          accessibilityLabel="Jour de naissance"
        />
        <Text style={styles.dobSeparator}>/</Text>
        <TextInput
          style={[styles.input, styles.dobField]}
          placeholder="MM"
          placeholderTextColor={colors.muted}
          value={dobMonth}
          onChangeText={(t) => onChangeDobMonth(t.replace(/\D/g, '').slice(0, 2))}
          onBlur={onBlurDob}
          keyboardType="number-pad"
          maxLength={2}
          accessibilityLabel="Mois de naissance"
        />
        <Text style={styles.dobSeparator}>/</Text>
        <TextInput
          style={[styles.input, styles.dobFieldYear]}
          placeholder="AAAA"
          placeholderTextColor={colors.muted}
          value={dobYear}
          onChangeText={(t) => onChangeDobYear(t.replace(/\D/g, '').slice(0, 4))}
          onBlur={onBlurDob}
          keyboardType="number-pad"
          maxLength={4}
          accessibilityLabel="Année de naissance"
        />
      </View>
      {showAgeError ? (
        <Text style={styles.fieldError}>{COPY_CONSENT.ageError}</Text>
      ) : null}

      {/* Consent checkboxes */}
      <View style={styles.consentBlock}>
        <Checkbox
          checked={acceptedTerms}
          onToggle={onToggleTerms}
          accessibilityLabel={`${COPY_CONSENT.termsPrefix}${COPY_CONSENT.termsLink}`}
        >
          <Text style={styles.consentText}>
            {COPY_CONSENT.termsPrefix}
            <Link href="/legal/terms" style={styles.consentLink}>
              {COPY_CONSENT.termsLink}
            </Link>
            {COPY_CONSENT.termsSuffix}
          </Text>
        </Checkbox>

        <Checkbox
          checked={acceptedPrivacy}
          onToggle={onTogglePrivacy}
          accessibilityLabel={`${COPY_CONSENT.privacyPrefix}${COPY_CONSENT.privacyLink}`}
        >
          <Text style={styles.consentText}>
            {COPY_CONSENT.privacyPrefix}
            <Link href="/legal/privacy-policy" style={styles.consentLink}>
              {COPY_CONSENT.privacyLink}
            </Link>
            {COPY_CONSENT.privacySuffix}
          </Text>
        </Checkbox>

        <Checkbox
          checked={marketingOptIn}
          onToggle={onToggleMarketing}
          accessibilityLabel={COPY_CONSENT.marketing}
        >
          <Text style={styles.consentText}>{COPY_CONSENT.marketing}</Text>
        </Checkbox>

        <Text style={styles.law25Note}>
          {COPY_CONSENT.law25Prefix}
          <Link href="/legal/privacy-policy" style={styles.consentLink}>
            {COPY_CONSENT.law25Link}
          </Link>
          {COPY_CONSENT.law25Suffix}
        </Text>
      </View>
    </>
  );
}

export const ConsentFields = React.memo(ConsentFieldsComponent);

/**
 * Local DOB blur-tracking helper so both SignUpForm and SocialConsentForm
 * share the same "only show the age error after the user has filled the
 * three fields" behaviour without duplicating state plumbing.
 */
export function useDobTouched() {
  const [dobTouched, setDobTouched] = useState(false);
  const markDobTouched = useCallback(() => setDobTouched(true), []);
  return { dobTouched, markDobTouched };
}
