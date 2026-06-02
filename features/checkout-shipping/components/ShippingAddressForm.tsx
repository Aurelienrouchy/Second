/**
 * ShippingAddressForm
 * Renders the address input fields for checkout shipping.
 */

import React from 'react';
import { View, Text, TextInput, Pressable, ScrollView, StyleSheet } from 'react-native';

import { colors, fonts, radius } from '@/constants/theme';
import type { AddressFormValues } from '../types';

// =============================================================================
// CANADIAN PROVINCES
// =============================================================================

const PROVINCES = [
  { code: 'AB', label: 'Alberta' },
  { code: 'BC', label: 'Colombie-Britannique' },
  { code: 'MB', label: 'Manitoba' },
  { code: 'NB', label: 'Nouveau-Brunswick' },
  { code: 'NL', label: 'Terre-Neuve-et-Labrador' },
  { code: 'NS', label: 'Nouvelle-Écosse' },
  { code: 'NT', label: 'Territoires du Nord-Ouest' },
  { code: 'NU', label: 'Nunavut' },
  { code: 'ON', label: 'Ontario' },
  { code: 'PE', label: 'Île-du-Prince-Édouard' },
  { code: 'QC', label: 'Québec' },
  { code: 'SK', label: 'Saskatchewan' },
  { code: 'YT', label: 'Yukon' },
] as const;

// =============================================================================
// TYPES
// =============================================================================

interface ShippingAddressFormProps {
  values: AddressFormValues;
  onChangeField: <K extends keyof AddressFormValues>(
    field: K,
    value: AddressFormValues[K],
  ) => void;
  /** When true, surfaces an inline error on the postal code field. */
  postalCodeError?: boolean;
}

// =============================================================================
// COMPONENT
// =============================================================================

export const ShippingAddressForm = React.memo(function ShippingAddressForm({
  values,
  onChangeField,
  postalCodeError = false,
}: ShippingAddressFormProps) {
  return (
    <>
      <Text style={styles.sectionTitle}>ADRESSE DE LIVRAISON</Text>
      <View style={styles.formGroup}>
        <View style={styles.formField}>
          <Text style={styles.fieldLabel}>NOM COMPLET</Text>
          <TextInput
            style={styles.fieldInput}
            value={values.fullName}
            onChangeText={(v) => onChangeField('fullName', v)}
            placeholder="Jean Dupont"
            placeholderTextColor={colors.muted}
            autoCapitalize="words"
          />
        </View>
        <View style={styles.formField}>
          <Text style={styles.fieldLabel}>ADRESSE</Text>
          <TextInput
            style={styles.fieldInput}
            value={values.address}
            onChangeText={(v) => onChangeField('address', v)}
            placeholder="123 rue Exemple"
            placeholderTextColor={colors.muted}
          />
        </View>
        <View style={styles.formField}>
          <Text style={styles.fieldLabel}>APPARTEMENT (OPTIONNEL)</Text>
          <TextInput
            style={styles.fieldInput}
            value={values.apartment}
            onChangeText={(v) => onChangeField('apartment', v)}
            placeholder="Apt 2B"
            placeholderTextColor={colors.muted}
          />
        </View>
        <View style={styles.formFieldRow}>
          <View style={[styles.formFieldHalf, styles.formFieldHalfLeft]}>
            <Text style={styles.fieldLabel}>VILLE</Text>
            <TextInput
              style={styles.fieldInput}
              value={values.city}
              onChangeText={(v) => onChangeField('city', v)}
              placeholderTextColor={colors.muted}
            />
          </View>
          <View style={styles.formFieldHalf}>
            <Text style={styles.fieldLabel}>PROVINCE</Text>
            <ScrollView
              horizontal
              showsHorizontalScrollIndicator={false}
              contentContainerStyle={styles.provinceChipsContainer}
            >
              {PROVINCES.map((p) => {
                const selected = values.province === p.code;
                return (
                  <Pressable
                    key={p.code}
                    style={[
                      styles.provinceChip,
                      selected && styles.provinceChipSelected,
                    ]}
                    onPress={() => onChangeField('province', p.code)}
                  >
                    <Text
                      style={[
                        styles.provinceChipText,
                        selected && styles.provinceChipTextSelected,
                      ]}
                    >
                      {p.code}
                    </Text>
                  </Pressable>
                );
              })}
            </ScrollView>
          </View>
        </View>
        <View style={[styles.formField, styles.formFieldLast]}>
          <Text style={styles.fieldLabel}>CODE POSTAL</Text>
          <TextInput
            style={styles.fieldInput}
            value={values.postalCode}
            onChangeText={(v) => onChangeField('postalCode', v)}
            placeholder="H2J 2K1"
            placeholderTextColor={colors.muted}
            autoCapitalize="characters"
            maxLength={7}
          />
          {postalCodeError ? (
            <Text style={styles.fieldError}>Format attendu : A1A 1A1</Text>
          ) : null}
        </View>
      </View>
    </>
  );
});

// =============================================================================
// STYLES
// =============================================================================

const styles = StyleSheet.create({
  sectionTitle: {
    fontFamily: fonts.sansMedium,
    fontSize: 9,
    letterSpacing: 1.8,
    color: colors.muted,
    marginBottom: 12,
    textTransform: 'uppercase',
  },
  formGroup: {
    backgroundColor: colors.white,
    borderWidth: 1,
    borderColor: colors.borderStrong,
    borderRadius: radius.sm,
    overflow: 'hidden',
    marginBottom: 20,
  },
  formField: {
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  formFieldLast: {
    borderBottomWidth: 0,
  },
  fieldError: {
    fontFamily: fonts.sans,
    fontSize: 11,
    color: colors.danger,
    marginTop: 6,
  },
  formFieldRow: {
    flexDirection: 'row',
  },
  formFieldHalf: {
    flex: 1,
    paddingHorizontal: 16,
    paddingVertical: 12,
  },
  formFieldHalfLeft: {
    borderRightWidth: 1,
    borderRightColor: colors.border,
  },
  fieldLabel: {
    fontFamily: fonts.sansMedium,
    fontSize: 9,
    letterSpacing: 1.5,
    color: colors.muted,
    marginBottom: 6,
    textTransform: 'uppercase',
  },
  fieldInput: {
    fontFamily: fonts.sans,
    fontSize: 14,
    color: colors.charcoal,
    padding: 0,
  },
  provinceChipsContainer: {
    flexDirection: 'row',
    gap: 6,
    paddingVertical: 2,
  },
  provinceChip: {
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: radius.xs,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surfaceWarm,
  },
  provinceChipSelected: {
    borderColor: colors.charcoal,
    backgroundColor: colors.charcoal,
  },
  provinceChipText: {
    fontFamily: fonts.sansMedium,
    fontSize: 12,
    color: colors.muted,
  },
  provinceChipTextSelected: {
    color: colors.cream,
  },
});
