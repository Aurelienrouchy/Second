/**
 * ConsentFields — shared age gate (date of birth) + mandatory consent
 * checkboxes (Terms + Privacy) plus an optional marketing opt-in.
 *
 * Used by the mandatory post-signup consent route (app/complete-profile.tsx) —
 * a plain full-screen route (NOT a bottom sheet) — so the DOB inputs are plain
 * React Native `TextInput`s (BottomSheetTextInput would throw outside a
 * <BottomSheet>; the route owns its own keyboard-aware ScrollView).
 *
 * Presentational only: the parent owns the DOB/checkbox state and the
 * submit-disabled computation. This component just renders inputs + links, with
 * the legal copy from COPY_CONSENT.
 */

import { Link } from 'expo-router';
import React, { useRef, useState } from 'react';
import { Text, TextInput, View } from 'react-native';

import { Checkbox } from '@/components/ui';
import { COPY_CONSENT } from '@/constants/authMessages';

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
  const monthRef = useRef<TextInput>(null);
  const yearRef = useRef<TextInput>(null);
  const [focusedField, setFocusedField] = useState<'day' | 'month' | 'year' | null>(null);

  const handleChangeDay = (t: string) => {
    const v = t.replace(/\D/g, '').slice(0, 2);
    onChangeDobDay(v);
    if (v.length === 2 || (v.length === 1 && Number(v) >= 4)) {
      monthRef.current?.focus();
    }
  };
  const handleChangeMonth = (t: string) => {
    const v = t.replace(/\D/g, '').slice(0, 2);
    onChangeDobMonth(v);
    if (v.length === 2 || (v.length === 1 && Number(v) >= 2)) {
      yearRef.current?.focus();
    }
  };

  return (
    <>
      {/* Date of birth (age gate) */}
      <Text style={styles.dobLabel}>{COPY_CONSENT.dobLabel}</Text>
      <View style={styles.dobRow}>
        <TextInput
          style={[styles.input, styles.dobField, focusedField === 'day' && styles.dobFieldFocused]}
          placeholder="JJ"
          placeholderTextColor={colors.muted}
          value={dobDay}
          onChangeText={handleChangeDay}
          onFocus={() => setFocusedField('day')}
          onBlur={() => {
            setFocusedField(null);
            onBlurDob();
          }}
          keyboardType="number-pad"
          maxLength={2}
          accessibilityLabel="Jour de naissance"
          testID="signup-dob-day"
        />
        <Text style={styles.dobSeparator}>/</Text>
        <TextInput
          ref={monthRef}
          style={[styles.input, styles.dobField, focusedField === 'month' && styles.dobFieldFocused]}
          placeholder="MM"
          placeholderTextColor={colors.muted}
          value={dobMonth}
          onChangeText={handleChangeMonth}
          onFocus={() => setFocusedField('month')}
          onBlur={() => {
            setFocusedField(null);
            onBlurDob();
          }}
          keyboardType="number-pad"
          maxLength={2}
          accessibilityLabel="Mois de naissance"
          testID="signup-dob-month"
        />
        <Text style={styles.dobSeparator}>/</Text>
        <TextInput
          ref={yearRef}
          style={[styles.input, styles.dobFieldYear, focusedField === 'year' && styles.dobFieldFocused]}
          placeholder="AAAA"
          placeholderTextColor={colors.muted}
          value={dobYear}
          onChangeText={(t) => onChangeDobYear(t.replace(/\D/g, '').slice(0, 4))}
          onFocus={() => setFocusedField('year')}
          onBlur={() => {
            setFocusedField(null);
            onBlurDob();
          }}
          keyboardType="number-pad"
          maxLength={4}
          accessibilityLabel="Année de naissance"
          testID="signup-dob-year"
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
          testID="signup-consent-terms"
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
          testID="signup-consent-privacy"
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
          testID="signup-consent-marketing"
        >
          <Text style={styles.consentText}>{COPY_CONSENT.marketing}</Text>
        </Checkbox>
      </View>
    </>
  );
}

export const ConsentFields = React.memo(ConsentFieldsComponent);
