import {useEffect, useRef, useState} from 'react';
import {ActivityIndicator, Keyboard, Pressable, StyleSheet, Text, TextInput, View} from 'react-native';
import {useQuery} from '@tanstack/react-query';
import {useAuthenticatedUid} from '@/hooks/useAuth';
import {useLabelLifecycleContext} from '@/hooks/useLabelLifecycleContext';
import {getAuthSessionGeneration} from '@/store/authStore';
import {searchCanadianAddresses, type AddressSuggestion} from '@/services/addressAutocompleteService';
import {readScopedQuery} from '@/utils/readScopedQuery';
import {colors, radius, sizing, spacing, typography} from '@/constants/theme';
import type {AddressFormValues} from '../types';

interface Props {
  values: AddressFormValues;
  scopeKey: string;
  onChangeField: <K extends keyof AddressFormValues>(field: K, value: AddressFormValues[K]) => void;
  onSelectAddress: (suggestion: AddressSuggestion) => boolean;
  postalCodeError?: boolean;
  destinationProvinceError?: boolean;
  disabled?: boolean;
}

/** Suggestions fill this checkout only; they never save or validate an address. */
export function ShippingAddressForm({values, scopeKey, onChangeField, onSelectAddress, postalCodeError = false, destinationProvinceError = false, disabled = false}: Props) {
  const uid = useAuthenticatedUid();
  const context = useLabelLifecycleContext(`checkout-address:${scopeKey}`, uid);
  const ownerKey = JSON.stringify([uid, getAuthSessionGeneration(), scopeKey, context.focusRevision]);
  const [searchOpen, setSearchOpen] = useState(false);
  const revision = useRef(0);
  const [search, setSearch] = useState({ownerKey: '', value: '', revision: 0});
  useEffect(() => {
    if (!searchOpen || disabled || !context.focused || values.address.trim().length < 3) return;
    let operation: ReturnType<typeof context.capture>;
    try {operation = context.capture();} catch {return;}
    const timer = setTimeout(() => {
      try {context.assertCurrent(operation); revision.current++; setSearch({ownerKey, value: values.address, revision: revision.current});} catch {/* Superseded search. */}
    }, 300);
    return () => clearTimeout(timer);
  }, [values.address, ownerKey, searchOpen, disabled, context.frame, context.focused, context.focusRevision]);
  const currentSearch = !disabled && searchOpen && context.focused && search.ownerKey === ownerKey && search.value === values.address && search.value.trim().length >= 3;
  const query = useQuery({
    // The street itself stays out of keys and the global query-error logger.
    queryKey: ['checkout-address-suggestions', uid, ownerKey, search.revision],
    enabled: currentSearch, staleTime: 0, gcTime: 0, retry: false,
    queryFn: ({signal}) => readScopedQuery(signal, () => {const operation = context.capture(); return () => context.assertCurrent(operation);},
      async current => {const suggestions = await searchCanadianAddresses(search.value, signal); current(); return suggestions.filter(item => item.province.trim().toUpperCase() === 'QC');}),
  });
  const suggestions = currentSearch && query.isSuccess && !query.isFetching && !query.isError ? query.data : [];
  const change = <K extends keyof AddressFormValues>(field: K, value: AddressFormValues[K]) => {
    if (disabled) return;
    try {context.capture(); setSearchOpen(field === 'address'); onChangeField(field, value);} catch {/* Old owner or focus. */}
  };
  const choose = (suggestion: AddressSuggestion) => {
    if (!currentSearch || !query.isSuccess || query.isFetching || query.isError || !suggestions.includes(suggestion)) return;
    try {context.capture(); if (onSelectAddress(suggestion)) {setSearchOpen(false); Keyboard.dismiss();}} catch {/* Old selection cannot change another address. */}
  };
  return <View style={styles.section}>
    <Text accessibilityRole="header" style={styles.title}>Adresse de livraison</Text>
    <View style={styles.field}>
      <Text style={styles.label}>Rechercher une adresse</Text>
      <TextInput accessibilityLabel="Rechercher une adresse" editable={!disabled} style={styles.input} value={values.address}
        onFocus={() => {try {context.capture(); setSearchOpen(true);} catch {/* Inactive. */}}}
        onChangeText={value => change('address', value)} placeholder="Numéro et nom de rue" placeholderTextColor={colors.muted} autoComplete="street-address" />
      {currentSearch && query.isFetching ? <ActivityIndicator accessibilityLabel="Recherche d’adresses" color={colors.primary} /> : null}
      {suggestions.length ? <View style={styles.suggestions}>{suggestions.map(suggestion => <Pressable key={suggestion.id} accessibilityRole="button" accessibilityLabel={suggestion.label}
        style={styles.suggestion} onPress={() => choose(suggestion)}><Text style={styles.body}>{suggestion.label}</Text></Pressable>)}</View> : null}
      {currentSearch && !query.isFetching && (query.isError || query.isSuccess && !suggestions.length)
        ? <Text style={styles.caption}>{query.isError ? 'Recherche indisponible. Complétez les champs ci-dessous.' : 'Précisez la rue et la ville, ou complétez les champs ci-dessous.'}</Text> : null}
    </View>
    <View style={styles.field}><Text style={styles.label}>Nom complet</Text><TextInput accessibilityLabel="Nom complet" editable={!disabled} style={styles.input} value={values.fullName}
      onFocus={() => setSearchOpen(false)} onChangeText={value => change('fullName', value)} placeholder="Prénom et nom" placeholderTextColor={colors.muted} autoCapitalize="words" autoComplete="name" /></View>
    <View style={styles.field}><Text style={styles.label}>Appartement, bureau (facultatif)</Text><TextInput accessibilityLabel="Appartement ou bureau" editable={!disabled} style={styles.input} value={values.apartment}
      onFocus={() => setSearchOpen(false)} onChangeText={value => change('apartment', value)} placeholder="Appartement 2" placeholderTextColor={colors.muted} /></View>
    <View style={styles.field}><Text style={styles.label}>Ville</Text><TextInput accessibilityLabel="Ville" editable={!disabled} style={styles.input} value={values.city}
      onFocus={() => setSearchOpen(false)} onChangeText={value => change('city', value)} placeholder="Ville" placeholderTextColor={colors.muted} autoCapitalize="words" /></View>
    <View style={styles.row}>
      <View style={styles.half}><Text style={styles.label}>Province</Text><Pressable accessibilityRole="radio" accessibilityLabel="Québec" accessibilityState={{checked: values.province === 'QC', disabled}}
        disabled={disabled} onPress={() => change('province', 'QC')} style={[styles.province, values.province === 'QC' && styles.selected]}><Text style={styles.body}>Québec</Text></Pressable></View>
      <View style={styles.half}><Text style={styles.label}>Code postal</Text><TextInput accessibilityLabel="Code postal" editable={!disabled} style={styles.input} value={values.postalCode}
        onFocus={() => setSearchOpen(false)} onChangeText={value => change('postalCode', value)} placeholder="H2J 2K1" placeholderTextColor={colors.muted} autoCapitalize="characters" autoComplete="postal-code" maxLength={7} /></View>
    </View>
    {destinationProvinceError ? <Text accessibilityRole="alert" style={styles.error}>L’adresse actuelle est hors Québec. Indiquez une adresse de livraison au Québec.</Text> : null}
    {postalCodeError ? <Text accessibilityRole="alert" style={styles.error}>Vérifiez le code postal de cette adresse au Québec.</Text> : null}
  </View>;
}

const styles = StyleSheet.create({
  section: {gap: spacing.md}, title: {...typography.h3, color: colors.foreground}, field: {gap: spacing.xs},
  label: {...typography.bodySmall, color: colors.foregroundSecondary}, body: {...typography.body, color: colors.foreground},
  caption: {...typography.caption, color: colors.muted}, error: {...typography.bodySmall, color: colors.danger},
  input: {...typography.body, minHeight: sizing.minTouchTarget, color: colors.foreground, backgroundColor: colors.surface, borderWidth: StyleSheet.hairlineWidth, borderColor: colors.borderStrong, borderRadius: radius.sm, paddingHorizontal: spacing.md, paddingVertical: spacing.sm},
  row: {flexDirection: 'row', gap: spacing.md}, half: {flex: 1, gap: spacing.xs},
  province: {minHeight: sizing.minTouchTarget, justifyContent: 'center', paddingHorizontal: spacing.md, borderWidth: StyleSheet.hairlineWidth, borderColor: colors.borderStrong, borderRadius: radius.sm},
  selected: {borderColor: colors.primary, backgroundColor: colors.primaryLight},
  suggestions: {borderWidth: StyleSheet.hairlineWidth, borderColor: colors.border, borderRadius: radius.sm, backgroundColor: colors.surface},
  suggestion: {minHeight: sizing.minTouchTarget, justifyContent: 'center', padding: spacing.md, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: colors.border},
});
